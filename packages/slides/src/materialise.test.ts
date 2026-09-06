import { describe, expect, test } from "bun:test";
import {
  GENERATABLE_BLOCK_TYPES,
  GENERATABLE_SLIDE_KINDS,
  type GeneratableSlideKind,
  type RichNode,
  richDocToPlainText,
  type Slide,
  type SlideElement,
  SlideSchema,
  WorksheetBlockSchema,
} from "@tj/domain/documents";
import { vocabularyGrid } from "./layouts";
import {
  type IdSupplier,
  materialiseBlock,
  materialiseSlide,
  vocabularySlots,
} from "./materialise";
import { type BlockSpec, BlockSpecSchema, type SlideSpec, SlideSpecSchema } from "./specs";
import { THEMES } from "./themes";

const meta = {
  promptVersion: "generate.v1",
  model: "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
  at: "2026-09-06T10:00:00.000Z",
};

const counter = (): IdSupplier => {
  let n = 0;
  return () => `e${++n}`;
};

const factRefs = ["o1", "v2"];

/** The smallest valid spec of each kind, with recognisable copy. */
function minimalSpec(kind: GeneratableSlideKind): SlideSpec {
  switch (kind) {
    case "title":
      return { kind, factRefs, title: "The water cycle", subtitle: "Year 4 · Science" };
    case "objectives":
      return { kind, factRefs, items: ["Describe evaporation"] };
    case "starter":
      return { kind, factRefs, items: ["What is a gas?"], footnote: "3 minutes" };
    case "vocabulary":
      return { kind, factRefs, entries: [{ term: "Evaporation", definition: "Liquid to gas." }] };
    case "content":
      return { kind, factRefs, heading: "Evaporation", body: "The sun warms the water." };
    case "worked-example":
      return { kind, factRefs, question: "Why does a puddle vanish?", steps: ["Sun warms it"] };
    case "instructions":
      return { kind, factRefs, steps: ["Draw the cycle"] };
    case "discussion":
      return { kind, factRefs, prompt: "Where does rain come from?" };
    case "true-false":
      return { kind, factRefs, statement: "Vapour is a gas.", correct: true };
    case "multiple-choice":
      return {
        kind,
        factRefs,
        stem: "Which process makes vapour?",
        options: [
          { text: "Condensation", correct: false },
          { text: "Precipitation", correct: false },
          { text: "Evaporation", correct: true },
          { text: "Collection", correct: false },
        ],
      };
    case "matching":
      return {
        kind,
        factRefs,
        stem: "Match the term",
        pairs: [
          { left: "Evaporation", right: "Liquid to gas" },
          { left: "Condensation", right: "Gas to liquid" },
          { left: "Precipitation", right: "Falls as rain" },
        ],
      };
    case "fill-gap":
      return {
        kind,
        factRefs,
        stem: "Complete the sentence.",
        sentence: "Water ___ at 100 ___.",
        answers: ["boils", "degrees"],
      };
    case "sort":
      return {
        kind,
        factRefs,
        stem: "Order the cycle",
        steps: ["Evaporation", "Condensation", "Precipitation", "Collection"],
      };
    case "open-response":
      return { kind, factRefs, stem: "Explain the water cycle.", modelAnswer: "Water evaporates…" };
    case "exit-ticket":
      return { kind, factRefs, items: ["One thing", "One question", "One word"] };
    case "plenary":
      return { kind, factRefs, items: ["We can explain evaporation"] };
  }
}

function walk(elements: SlideElement[], visit: (element: SlideElement) => void): void {
  for (const element of elements) {
    visit(element);
    if (element.type === "group") walk(element.children, visit);
  }
}

function textNodes(node: RichNode | undefined, out: RichNode[] = []): RichNode[] {
  if (!node) return out;
  if (node.type === "text") out.push(node);
  for (const child of node.content ?? []) textNodes(child, out);
  return out;
}

const plain = (element: SlideElement | undefined): string =>
  element && "doc" in element && element.doc ? richDocToPlainText(element.doc) : "";

describe("materialiseSlide", () => {
  describe.each(THEMES.map((theme) => [theme.id] as const))("theme %s", (themeId) => {
    test.each(GENERATABLE_SLIDE_KINDS.map((kind) => [kind] as const))(
      "%s: a valid slide of that kind with provenance on every element",
      (kind) => {
        const spec = SlideSpecSchema.parse(minimalSpec(kind));
        const slide = materialiseSlide(spec, themeId, meta, counter());
        const result = SlideSchema.safeParse(slide);
        expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
        expect(slide.kind).toBe(kind);
        expect(slide.elements.length).toBeGreaterThan(0);
        walk(slide.elements, (element) => {
          expect(element.authoredBy).toBe("ai");
          expect(element.generatedFrom).toEqual({ factRefs, ...meta });
          if ("doc" in element && element.doc) {
            for (const node of textNodes(element.doc as RichNode)) {
              expect(node.text?.length ?? 0).toBeGreaterThan(0);
            }
          }
        });
      },
    );
  });

  test("no placeholder copy survives on any kind", () => {
    const placeholders = [
      "Lesson title",
      "Year group and class",
      "Learning objective one",
      "Recall question",
      "Term",
      "Definition in one sentence",
      "One idea, explained",
      "Write the question exactly",
      "First step, and why",
      "What to do first",
      "Ask the question you want",
      "Write a statement",
      "Ask a question with one right answer",
      "Option A",
      "Match each term",
      "Term 1",
      "Definition 1",
      "Complete the sentence.",
      "evaporates",
      "Put these in the right order",
      "Step 1",
      "Ask an open question",
      "One thing you learnt",
      "Something we can now",
    ];
    for (const kind of GENERATABLE_SLIDE_KINDS) {
      const spec = minimalSpec(kind);
      const slide = materialiseSlide(spec, "chalk", meta, counter());
      const text = slide.elements.map(plain).join("\n");
      for (const placeholder of placeholders) {
        // A spec may legitimately contain the same words as a placeholder (fill-gap's stem).
        if (JSON.stringify(spec).includes(placeholder)) continue;
        expect(text, `${kind} still shows "${placeholder}"`).not.toContain(placeholder);
      }
    }
  });

  test("is deterministic for the same spec and id supplier", () => {
    const spec = minimalSpec("multiple-choice");
    expect(materialiseSlide(spec, "beacon", meta, counter())).toEqual(
      materialiseSlide(spec, "beacon", meta, counter()),
    );
  });

  test("uses nanoid when no supplier is given, and the slide still parses", () => {
    const slide = materialiseSlide(minimalSpec("matching"), "chalk", meta);
    expect(slide.id).toHaveLength(10);
    expect(SlideSchema.safeParse(slide).success).toBe(true);
  });

  test("notes and the title/subtitle land where the recipe puts them", () => {
    const slide = materialiseSlide(
      { ...minimalSpec("title"), notes: "Welcome the class." },
      "chalk",
      meta,
      counter(),
    );
    expect(slide.notes).toBe("Welcome the class.");
    const [rule, caption, title, subtitle] = slide.elements;
    expect(rule?.type).toBe("shape");
    expect(plain(caption)).toBe("LESSON");
    expect(plain(title)).toBe("The water cycle");
    expect(plain(subtitle)).toBe("Year 4 · Science");
  });

  test("multiple-choice: the correct option is the third card, texts in order", () => {
    const spec = minimalSpec("multiple-choice") as Extract<SlideSpec, { kind: "multiple-choice" }>;
    const slide = materialiseSlide(spec, "chalk", meta, counter());
    const options = slide.elements.filter((element) => element.type === "option");
    expect(options.map(plain)).toEqual(spec.options.map((option) => option.text));
    if (slide.question?.type !== "multiple-choice") throw new Error("not a multiple-choice");
    const correct = slide.question.options.filter((option) => option.correct);
    expect(correct).toHaveLength(1);
    expect(correct[0]?.id).toBe(options[2]?.id);
    expect(slide.question.options.map((option) => option.id)).toEqual(options.map((o) => o.id));
  });

  test("fill-gap: two [[gap:id]] tokens and the answers in order", () => {
    const slide = materialiseSlide(minimalSpec("fill-gap"), "chalk", meta, counter());
    if (slide.question?.type !== "fill-gap") throw new Error("not a fill-gap");
    expect(slide.question.gaps.map((gap) => gap.answer)).toEqual(["boils", "degrees"]);
    const gapText = slide.elements.find((element) => element.type === "gap-text");
    const text = plain(gapText);
    const [a, b] = slide.question.gaps;
    expect(text).toBe(`Water [[gap:${a?.id}]] at 100 [[gap:${b?.id}]].`);
    expect(text).not.toContain("___");
  });

  test("vocabulary: two entries leave no orphan placeholders, whatever the grid holds", () => {
    // Every current theme lays out two rows a column (four slots); the ticket's "three-row
    // theme" does not exist today, so the first column simply holds both entries.
    const theme = THEMES[0] as (typeof THEMES)[number];
    expect(vocabularySlots(theme.id)).toBeGreaterThanOrEqual(2);
    const slide = materialiseSlide(
      {
        kind: "vocabulary",
        factRefs,
        entries: [
          { term: "Evaporation", definition: "Liquid to gas." },
          { term: "Condensation", definition: "Gas to liquid." },
        ],
      },
      theme.id,
      meta,
      counter(),
    );
    const texts = slide.elements.filter((element) => element.type === "text");
    const terms = texts.filter((element) => element.style.preset === "body");
    const defs = texts.filter((element) => element.style.preset === "small");
    expect(terms.map(plain)).toEqual(["Evaporation", "Condensation"]);
    expect(defs.map(plain)).toEqual(["Liquid to gas.", "Gas to liquid."]);
    // Heading hairline plus the one rule between the two entries in the first column.
    const rules = slide.elements.filter((element) => element.type === "shape");
    expect(rules).toHaveLength(2);
    expect(SlideSchema.safeParse(slide).success).toBe(true);
  });

  test("vocabulary: more entries than the theme has slots fill every slot and drop the rest", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({
      term: `Term ${i + 1}`,
      definition: `Definition ${i + 1}`,
    }));
    for (const theme of THEMES) {
      const slots = vocabularySlots(theme.id);
      expect(slots).toBe(vocabularyGrid(theme).rows * 2);
      const slide = materialiseSlide(
        { kind: "vocabulary", factRefs, entries: six },
        theme.id,
        meta,
        counter(),
      );
      const terms = slide.elements.filter((e) => e.type === "text" && e.style.preset === "body");
      expect(terms).toHaveLength(slots);
    }
  });

  test("sort: question.order is the card ids in spec order", () => {
    const spec = minimalSpec("sort") as Extract<SlideSpec, { kind: "sort" }>;
    const slide = materialiseSlide(spec, "chalk", meta, counter());
    const cards = slide.elements.filter((element) => element.type === "option");
    expect(cards.map(plain)).toEqual(spec.steps);
    if (slide.question?.type !== "sort") throw new Error("not a sort");
    expect(slide.question.order).toEqual(cards.map((card) => card.id));
  });

  test("matching: left and right cards in order; pairs join them with fresh ids", () => {
    const spec = minimalSpec("matching") as Extract<SlideSpec, { kind: "matching" }>;
    const slide = materialiseSlide(spec, "chalk", meta, counter());
    const cards = slide.elements.filter((e) => e.type === "text" && e.style.preset === "body");
    expect(cards.map(plain)).toEqual([
      ...spec.pairs.map((p) => p.left),
      ...spec.pairs.map((p) => p.right),
    ]);
    if (slide.question?.type !== "matching") throw new Error("not a matching");
    slide.question.pairs.forEach((pair, i) => {
      expect(pair.leftElementId).toBe(cards[i]?.id ?? "");
      expect(pair.rightElementId).toBe(cards[3 + i]?.id ?? "");
      expect(pair.id).toMatch(/^e\d+$/);
    });
  });

  test("true-false and open-response carry their answer data", () => {
    const tf = materialiseSlide(
      { ...minimalSpec("true-false"), explanation: "It is invisible." } as SlideSpec,
      "chalk",
      meta,
      counter(),
    );
    expect(tf.question).toEqual({
      type: "true-false",
      correct: true,
      explanation: "It is invisible.",
    });
    const open = materialiseSlide(minimalSpec("open-response"), "chalk", meta, counter());
    expect(open.question).toEqual({ type: "open-response", modelAnswer: "Water evaporates…" });
  });

  test("numbered kinds render their items as an ordered list; plenary as bullets", () => {
    const objectives = materialiseSlide(
      { kind: "objectives", factRefs, heading: "Today", items: ["A", "B"] },
      "chalk",
      meta,
      counter(),
    );
    const body = objectives.elements.find((e) => e.type === "text" && e.style.preset === "body");
    expect(body && "doc" in body ? body.doc?.content?.[0]?.type : undefined).toBe("orderedList");
    expect(plain(body)).toBe("A\n\nB");
    expect(plain(objectives.elements[0])).toBe("Today");

    const plenary = materialiseSlide(minimalSpec("plenary"), "chalk", meta, counter());
    const bullets = plenary.elements.find((e) => e.type === "text" && e.style.preset === "body");
    expect(bullets && "doc" in bullets ? bullets.doc?.content?.[0]?.type : undefined).toBe(
      "bulletList",
    );
  });
});

describe("SlideSpecSchema", () => {
  test("covers exactly the generatable kinds", () => {
    const kinds = SlideSpecSchema.options.map((option) => option.shape.kind.value);
    expect([...kinds].sort()).toEqual([...GENERATABLE_SLIDE_KINDS].sort());
  });

  test("rejects blank text, a multiple-choice with two correct options and a gap count mismatch", () => {
    expect(
      SlideSpecSchema.safeParse({ kind: "content", factRefs: [], heading: "  ", body: "x" })
        .success,
    ).toBe(false);
    const mc = minimalSpec("multiple-choice") as Extract<SlideSpec, { kind: "multiple-choice" }>;
    expect(
      SlideSpecSchema.safeParse({
        ...mc,
        options: mc.options.map((o) => ({ ...o, correct: true })),
      }).success,
    ).toBe(false);
    const gap = SlideSpecSchema.safeParse({
      ...minimalSpec("fill-gap"),
      answers: ["boils"],
    });
    expect(gap.success).toBe(false);
    expect(gap.error?.issues[0]?.path).toEqual(["sentence"]);
  });

  test("trims text slots", () => {
    const parsed = SlideSpecSchema.parse({
      kind: "content",
      factRefs: [],
      heading: "  Evaporation ",
      body: " x ",
    });
    expect(parsed).toMatchObject({ heading: "Evaporation", body: "x" });
  });
});

describe("materialiseBlock", () => {
  const specs: BlockSpec[] = [
    { type: "heading", factRefs, text: "The water cycle", level: 1 },
    { type: "instructions", factRefs, text: "Answer every question." },
    { type: "paragraph", factRefs, text: "Water moves in a cycle." },
    {
      type: "question",
      factRefs,
      text: "Why does a puddle vanish?",
      answer: "It evaporates.",
      answerLines: 3,
    },
    {
      type: "multiple-choice",
      factRefs,
      text: "Which is a gas?",
      options: [
        { text: "Ice", correct: false },
        { text: "Vapour", correct: true },
        { text: "Rain", correct: false },
        { text: "Snow", correct: false },
      ],
    },
    { type: "fill-gap", factRefs, sentence: "Water ___ at 100 degrees.", answers: ["boils"] },
    {
      type: "matching",
      factRefs,
      pairs: [
        { left: "A", right: "1" },
        { left: "B", right: "2" },
        { left: "C", right: "3" },
      ],
    },
    { type: "word-bank", factRefs, words: ["water", "vapour", "cloud"] },
  ];

  test("covers exactly the generatable block types", () => {
    expect(specs.map((spec) => spec.type).sort()).toEqual([...GENERATABLE_BLOCK_TYPES].sort());
    const types = BlockSpecSchema.options.map((option) => option.shape.type.value);
    expect([...types].sort()).toEqual([...GENERATABLE_BLOCK_TYPES].sort());
  });

  test.each(specs.map((spec) => [spec.type, spec] as const))(
    "%s: a valid block with provenance",
    (_type, spec) => {
      const block = materialiseBlock(BlockSpecSchema.parse(spec), meta, counter());
      const result = WorksheetBlockSchema.safeParse(block);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
      expect(block.authoredBy).toBe("ai");
      expect(block.generatedFrom).toEqual({ factRefs, ...meta });
      expect(block.id).toBe("e1");
    },
  );

  test("question: answer, answerLines and optional marks", () => {
    const block = materialiseBlock(
      { type: "question", factRefs, text: "Why?", answer: "Because.", answerLines: 3, marks: 2 },
      meta,
      counter(),
    );
    expect(block).toMatchObject({ type: "question", answer: "Because.", answerLines: 3, marks: 2 });
    const noMarks = materialiseBlock(
      { type: "question", factRefs, text: "Why?", answer: "Because.", answerLines: 3 },
      meta,
      counter(),
    );
    expect("marks" in noMarks).toBe(false);
  });

  test("fill-gap: gap tokens in the doc match the gaps; option and pair ids are minted", () => {
    const gap = materialiseBlock(specs[5] as BlockSpec, meta, counter());
    if (gap.type !== "fill-gap") throw new Error("not a fill-gap");
    expect(richDocToPlainText(gap.doc)).toBe(`Water [[gap:${gap.gaps[0]?.id}]] at 100 degrees.`);
    const mc = materialiseBlock(specs[4] as BlockSpec, meta, counter());
    if (mc.type !== "multiple-choice") throw new Error("not a multiple-choice");
    expect(mc.options.map((o) => o.id)).toEqual(["e2", "e3", "e4", "e5"]);
    expect(mc.options.filter((o) => o.correct).map((o) => o.text)).toEqual(["Vapour"]);
  });
});

/** Typing aid: every spec kind is exercised by `minimalSpec`. */
const _exhaustive: Record<GeneratableSlideKind, true> = Object.fromEntries(
  GENERATABLE_SLIDE_KINDS.map((kind) => [kind, true as const]),
) as Record<GeneratableSlideKind, true>;
void _exhaustive;
void ({} as Slide);
