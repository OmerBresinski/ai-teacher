import { describe, expect, test } from "bun:test";
import {
  type RichDoc,
  type Slide,
  type SlideElement,
  SlideSchema,
  type TextElement,
} from "@tj/domain/documents";
import { codedSetSlide } from "@tj/domain/documents/fixtures";
import { fitSlide } from "./fit-slide";
import { SAFE } from "./grid";
import { docFromNumbered } from "./layouts";
import { lookAndFitPages, materialiseSlide } from "./materialise";
import { SAFE_BOTTOM } from "./metrics";
import { HEADING_NAME } from "./reflow";
import {
  ANSWER_MARK_NAME,
  ANSWERS_NAME,
  answersPanel,
  BODY_NAME,
  COMPARE_NAME,
  compareCards,
  docLines,
  inferStructure,
  KEY_CARD_NAME,
  keyCard,
  layoutQuiz,
  markTerms,
  OPTION_CHIP_NAME,
  parseAnswers,
  parseQuizLine,
  QUESTION_NAME,
  STEP_ARROW_NAME,
  STEP_NAME,
  stepsStrip,
  structureSlide,
} from "./structure";
import { getTheme } from "./themes";

const meta = { promptVersion: "t", model: "m", at: "2026-09-26T00:00:00.000Z" };
/** Chalk & Cream, a low-stimulation theme and the dark one. */
const THEMES = ["chalk", "exam-hall", "night-lab"].map(getTheme);
const chalk = getTheme("chalk");
const text = (d: RichDoc | undefined) => (d ? docLines(d).join(" ") : "");
const named = (els: SlideElement[], name: string) => els.filter((e) => e.name === name);
const inside = (els: SlideElement[]) =>
  els.every((e) => e.y >= SAFE.y && e.y + e.h <= SAFE_BOTTOM + 0.5 && e.x + e.w <= SAFE.x + SAFE.w);

const MC =
  "Waves push grit against a cliff. Which process is this? A Abrasion  B Hydraulic action  C Pressure changes  D Waves hitting";

describe("quiz lines from a code-built set", () => {
  test("a multiple-choice line keeps its stem and four options, the answer letter marks the right one", () => {
    expect(parseQuizLine(MC, "A (Abrasion)")).toEqual({
      stem: "Waves push grit against a cliff. Which process is this?",
      options: ["Abrasion", "Hydraulic action", "Pressure changes", "Waves hitting"],
      correct: 0,
      answer: "A (Abrasion)",
    });
  });
  test("a true/false line is its belief with True and False, answered False", () => {
    expect(
      parseQuizLine("True or false? Veins carry blue blood.", "False. It is dark red."),
    ).toEqual({
      stem: "Veins carry blue blood.",
      options: ["True", "False"],
      correct: 1,
      answer: "False. It is dark red.",
    });
  });
  test("any other line is an open question; the reveal's answers split back in order", () => {
    expect(parseQuizLine("What is sediment?")).toEqual({ stem: "What is sediment?" });
    expect(parseAnswers("Answers: 1 The roots  ·  2 A (2:3)  ·  3 It flows back")).toEqual([
      "The roots",
      "A (2:3)",
      "It flows back",
    ]);
  });
});

describe("options grid", () => {
  for (const t of THEMES) {
    test(`${t.id}: lettered option cards, the right one marked on reveal step 1, answers of open lines on the panel`, () => {
      const lines = [
        parseQuizLine(MC, "A (Abrasion)"),
        parseQuizLine("True or false? Abrasion needs no sediment.", "False. Sediment scrapes."),
        parseQuizLine("What is sediment?", "Pieces of rock carried by water"),
      ];
      const pages = layoutQuiz(lines, 140, t);
      expect(pages).toHaveLength(1);
      const page = pages[0] as SlideElement[];
      expect(named(page, QUESTION_NAME)).toHaveLength(3);
      expect(named(page, OPTION_CHIP_NAME)).toHaveLength(6);
      const marks = named(page, ANSWER_MARK_NAME);
      expect(marks.map((m) => text((m as { doc?: RichDoc }).doc))).toEqual([
        "A  Abrasion",
        "False",
      ]);
      expect(marks.every((m) => m.revealStep === 1)).toBe(true);
      const panel = named(page, ANSWERS_NAME)[0] as {
        doc?: RichDoc;
        revealStep?: number;
        type: string;
      };
      expect(panel.type).toBe("shape");
      expect(panel.revealStep).toBe(1);
      // The multiple choice is answered in place; the true/false correction and the open answer are on the panel.
      expect(text(panel.doc)).toBe("2 False. Sediment scrapes. 3 Pieces of rock carried by water");
      expect(inside(page)).toBe(true);
      expect(page.every((e) => !e.locked)).toBe(true);
    });
  }

  test("a set too long for one slide continues on the next, numbered on, each page answering its own lines", () => {
    const long = Array.from({ length: 6 }, (_, i) =>
      parseQuizLine(`${MC} ${i}`.replace(/ \d$/, ""), "A (Abrasion)"),
    ).map((l, i) =>
      i % 2
        ? { stem: `Open question number ${i} about coasts and cliffs?`, answer: `Answer ${i}` }
        : l,
    );
    const pages = layoutQuiz(long, 140, chalk);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages)
      expect(inside(page.filter((e) => e.name !== ANSWERS_NAME))).toBe(true);
    const numbers = pages.flatMap((p) =>
      named(p, QUESTION_NAME).map(
        (q) => ((q as TextElement).doc.content?.[0]?.attrs as { start: number } | undefined)?.start,
      ),
    );
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("materialise: a coded starter with quiz hints lays the grid; its answers never run off the slide", () => {
    const slide = materialiseSlide(
      {
        kind: "starter",
        factRefs: [],
        heading: "Exit ticket",
        items: [MC, "What is sediment?", "Name one hard engineering method."],
        footnote: "Answers: 1 A (Abrasion)  ·  2 Rock pieces  ·  3 A sea wall",
      },
      "chalk",
      meta,
      undefined,
      0,
      {
        quiz: [
          parseQuizLine(MC, "A (Abrasion)"),
          { stem: "What is sediment?", answer: "Rock pieces" },
          { stem: "Name one hard engineering method.", answer: "A sea wall" },
        ],
      },
    );
    expect(named(slide.elements, OPTION_CHIP_NAME)).toHaveLength(4);
    const panel = named(slide.elements, ANSWERS_NAME)[0] as SlideElement;
    expect(panel.y + panel.h).toBeLessThanOrEqual(SAFE_BOTTOM);
    expect(fitSlide(slide, chalk).overflow).toEqual([]);
  });

  test("the answers panel is out of the flow: a long set of answers steps nothing down", () => {
    const panel = answersPanel(
      [1, 2, 3, 4].map((n) => ({
        n,
        text: "A long answer that runs to most of a line on the slide, twice over.",
      })),
      chalk,
    ) as SlideElement;
    expect(panel.y + panel.h).toBe(SAFE_BOTTOM);
    const body: TextElement = {
      id: "b",
      type: "text",
      x: SAFE.x,
      y: 140,
      w: SAFE.w,
      h: 120,
      doc: docFromNumbered(["One?", "Two?", "Three?"]),
      style: { preset: "body" },
    };
    const fitted = fitSlide({ id: "s", kind: "exit-ticket", elements: [body, panel] }, chalk);
    expect(fitted.overflow).toEqual([]);
    expect((fitted.slide.elements[0] as TextElement).style.fontSize).toBeUndefined();
  });
});

describe("compare cards", () => {
  const coasts =
    "Hard engineering (built structures) uses sea walls to deflect waves. Soft engineering (working with natural processes) adds beach sediment. Lyme Regis uses both.";
  test("two kinds named in the heading and opening two sentences become two labelled sides", () => {
    const got = inferStructure("Hard and soft engineering suit different coasts", coasts);
    expect(got?.structure.compare).toEqual({
      left: {
        label: "Hard engineering",
        note: "Built structures",
        points: ["Uses sea walls to deflect waves."],
      },
      right: {
        label: "Soft engineering",
        note: "Working with natural processes",
        points: ["Adds beach sediment."],
      },
    });
    expect(got?.rest).toBe("Lyme Regis uses both.");
  });
  for (const t of THEMES) {
    test(`${t.id}: two cards of one height side by side, then the rest under them`, () => {
      const slide = materialiseSlide(
        {
          kind: "content",
          factRefs: [],
          heading: "Hard and soft engineering suit different coasts",
          body: coasts,
        },
        t.id,
        meta,
      );
      const cards = named(slide.elements, COMPARE_NAME);
      expect(cards).toHaveLength(2);
      expect(cards[0]?.h).toBe(cards[1]?.h ?? -1);
      expect(cards[0]?.y).toBe(cards[1]?.y ?? -1);
      const rest = named(slide.elements, BODY_NAME).map((e) => text((e as TextElement).doc));
      expect(rest).toContain("Lyme Regis uses both.");
      expect(fitSlide(slide, t).overflow).toEqual([]);
    });
  }
  test("an explicit hint wins, and sides that cannot fit are not drawn", () => {
    const side = { label: "A", points: ["x ".repeat(400)] };
    expect(compareCards(side, side, 140, SAFE_BOTTOM, chalk)).toBeUndefined();
  });
});

describe("steps strip", () => {
  test("numbered cards joined by arrows, each step on its own reveal step", () => {
    const strip = stepsStrip(
      ["Add the parts", "Divide the total", "Multiply each part"],
      250,
      SAFE_BOTTOM,
      chalk,
      undefined,
      {
        reveal: true,
      },
    );
    const els = strip?.elements ?? [];
    expect(named(els, STEP_NAME)).toHaveLength(3);
    expect(named(els, STEP_ARROW_NAME)).toHaveLength(2);
    expect(named(els, "Step 2").map((e) => e.revealStep)).toEqual([2]);
    expect(inside(els)).toBe(true);
  });
  test("a worked example's working becomes the strip; the steps keep their words", () => {
    const steps = ["3 + 4 = 7 parts", "£42 ÷ 7 = £6", "3 × £6 = £18", "4 × £6 = £24"];
    for (const t of THEMES) {
      const slide = materialiseSlide(
        {
          kind: "worked-example",
          factRefs: [],
          heading: "Share in a ratio",
          question: "Share £42 in the ratio 3:4.",
          steps,
        },
        t.id,
        meta,
      );
      expect(named(slide.elements, "Working card")).toHaveLength(0);
      expect(
        [1, 2, 3, 4].map((n) => text((named(slide.elements, `Step ${n}`)[0] as TextElement).doc)),
      ).toEqual(steps);
      expect(fitSlide(slide, t).overflow).toEqual([]);
    }
  });
  test("a sequence hint on a teaching slide draws the strip under the words", () => {
    const slide = materialiseSlide(
      { kind: "content", factRefs: [], heading: "The water cycle", body: "Water moves in a loop." },
      "chalk",
      meta,
      undefined,
      0,
      { sequence: ["Evaporation", "Condensation", "Precipitation", "Collection"] },
    );
    expect(named(slide.elements, STEP_NAME)).toHaveLength(4);
    expect(slide.elements.some((e) => e.revealStep)).toBe(false);
  });
});

describe("key card", () => {
  test("a word equation comes out of the words onto a labelled card", () => {
    const got = inferStructure(
      "Photosynthesis",
      "Chlorophyll absorbs light. Leaves use carbon dioxide and water: carbon dioxide + water → glucose + oxygen. Light is not an ingredient.",
    );
    expect(got?.structure.keyCard).toEqual({
      label: "Word equation",
      text: "carbon dioxide + water → glucose + oxygen",
    });
    expect(got?.lead).toBe("Chlorophyll absorbs light.");
    expect(got?.rest).toBe("Leaves use carbon dioxide and water. Light is not an ingredient.");
  });
  test("a first sentence defining one of the lesson's terms is a key term card; sums are not equations", () => {
    expect(
      inferStructure("x", "Hydraulic action is erosion by trapped air. Waves squeeze it.", [
        "hydraulic action",
      ])?.structure.keyCard,
    ).toEqual({ label: "Key term", text: "Hydraulic action is erosion by trapped air." });
    expect(inferStructure("Sharing", "Add 2 + 4 = 6 parts, then divide £30 by 6.")).toBeUndefined();
  });
  for (const t of THEMES) {
    test(`${t.id}: the card is a shape with its label and statement on it, all editable`, () => {
      const card = keyCard(
        "Word equation",
        "carbon dioxide + water → glucose + oxygen",
        150,
        SAFE_BOTTOM,
        t,
      );
      const els = card?.elements ?? [];
      expect(named(els, KEY_CARD_NAME)).toHaveLength(1);
      expect(els.filter((e) => e.type === "text").map((e) => text((e as TextElement).doc))).toEqual(
        ["Word equation", "carbon dioxide + water → glucose + oxygen"],
      );
      expect(els.every((e) => !e.locked)).toBe(true);
    });
  }
});

describe("key terms", () => {
  test("the first use of each term is bold in the accent; a term is marked once per slide", () => {
    const doc = markTerms(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Sediment scrapes. More sediments follow." }],
          },
        ],
      },
      ["sediment"],
      chalk,
    );
    const runs = doc.content?.[0]?.content ?? [];
    expect(runs.map((r) => r.text)).toEqual(["Sediment", " scrapes. More sediments follow."]);
    expect(runs[0]?.marks).toEqual([
      { type: "bold" },
      { type: "textStyle", attrs: { color: chalk.colors.accent } },
    ]);
  });
  test("materialise marks terms in running text, never in the heading", () => {
    const slide = materialiseSlide(
      {
        kind: "content",
        factRefs: [],
        heading: "Abrasion and sediment",
        body: "Abrasion happens when sediment scrapes the cliff.",
      },
      "chalk",
      meta,
      undefined,
      0,
      { terms: ["sediment", "abrasion"] },
    );
    const marked = slide.elements.filter(
      (e) => e.type === "text" && JSON.stringify(e.doc).includes('"bold"'),
    );
    // A one-sentence body is set as a key-idea card at the display size; its terms are marked
    // there, and the slide's heading never is.
    expect(marked.every((e) => e.name !== HEADING_NAME)).toBe(true);
    expect(marked.length).toBeGreaterThan(0);
  });
});

describe("overflow fixes", () => {
  test("an open question's answer space and label sit under a long stem, inside the slide", () => {
    for (const t of THEMES) {
      const slide = materialiseSlide(
        {
          kind: "open-response",
          factRefs: [],
          stem: "Suppose a council is considering soft engineering for a stretch of coast. Explain why it should check whether the method suits the place and be prepared for ongoing care.",
        },
        t.id,
        meta,
      );
      const space = named(slide.elements, "Answer space")[0] as SlideElement;
      expect(space.y + space.h).toBeLessThanOrEqual(SAFE_BOTTOM);
      expect(fitSlide(slide, t).overflow).toEqual([]);
    }
  });
  test("a paragraph too long even for the fit continues on the next slide, never below the floor", () => {
    const body = Array.from(
      { length: 11 },
      (_, i) => `Sentence ${i} says something that takes up most of a line.`,
    ).join(" ");
    const slide: Slide = materialiseSlide(
      { kind: "content", factRefs: [], heading: "Long", body },
      "chalk",
      meta,
    );
    const pages = lookAndFitPages(slide, chalk);
    expect(pages.length).toBe(2);
    for (const page of pages) expect(fitSlide(page, chalk).overflow).toEqual([]);
    expect(text((named(pages[1]?.elements ?? [], "Heading")[0] as TextElement).doc)).toBe(
      "Long (continued)",
    );
  });
});

describe("a coded set's question follows its answers (TEACH-101)", () => {
  test("re-laid: the strip becomes the answers card, and the question points at it, read from it", () => {
    const [page, ...rest] = structureSlide(codedSetSlide(undefined, { strip: true }), chalk);
    expect(rest).toHaveLength(0);
    const q = page?.question;
    if (q?.type !== "set") throw new Error("expected set");
    const box = page?.elements.find((e) => e.id === q.answersId);
    expect(box?.name).toBe(ANSWERS_NAME);
    expect(q.items.map((a) => a.answer)).toEqual(["AD 43", "Boudica", "Hadrian"]);
    expect(SlideSchema.safeParse(page).success).toBe(true);
  });

  test("answers moved to a slide of their own: neither slide keeps the set question", () => {
    const long = Array.from(
      { length: 6 },
      (_, i) => `Answer ${i + 1} ${"is a long answer ".repeat(3)}`,
    );
    const slide = codedSetSlide(long, { strip: true });
    const list = slide.elements.find((e) => e.id === "set-list") as TextElement;
    list.doc = docFromNumbered(
      long.map(
        (_, i) => `Question ${i + 1} ${"asks something rather long about Rome ".repeat(3)}?`,
      ),
    );
    const pages = structureSlide(slide, chalk);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(page.question).toBeUndefined();
      expect(SlideSchema.safeParse(page).success).toBe(true);
    }
  });
});
