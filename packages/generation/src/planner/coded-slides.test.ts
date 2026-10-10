import { describe, expect, test } from "bun:test";
import type { LessonFacts, OutlineEntry, Slide, TextElement } from "@tj/domain/documents";
import {
  entriesWritten,
  LessonFactsSchema,
  outlineIndices,
  richDocToPlainText,
} from "@tj/domain/documents";
import {
  getTheme,
  materialiseSlide,
  measureHeadless,
  SAFE_BOTTOM,
  THEMES,
  textPartsOf,
} from "@tj/slides";
import { assignFactIds } from "../specs";
import { FIXTURES } from "../testing";
import {
  codedSetSpec,
  EXIT_QUIZ_MAX,
  EXIT_QUIZ_MIN,
  exitLines,
  fitsExitTicket,
  LINE_MAX,
  type Line,
  MC_LINE_MAX,
  misconceptionLine,
  questionLine,
  sameQuestion,
  seededOrder,
  withAnswersReveal,
  withAnswersSlides,
  withShuffledOptions,
} from "./coded-slides";

const mc = {
  id: "q1",
  stem: "Which vessel carries blood away from the heart?",
  answer: "artery",
  reasoning: "",
  distractors: [{ text: "vein" }, { text: "capillary" }, { text: "valve" }],
  use: "slide" as const,
};
const open = {
  id: "q2",
  stem: "Name the chamber that pumps blood to the body.",
  answer: "the left ventricle",
  reasoning: "",
  use: "slide" as const,
};
const facts = {
  objectives: [{ id: "o1", text: "describe the heart" }],
  questions: [mc, open, { ...open, id: "q3", use: "exit" as const }],
  misconceptions: [
    {
      id: "m1",
      belief: "Veins carry blue blood.",
      correction: "Blood in veins is dark red.",
      objectiveRefs: ["o1"],
    },
  ],
  outline: [],
} as unknown as LessonFacts;
const entry = (kind: OutlineEntry["kind"], factRefs: string[]): OutlineEntry =>
  ({ kind, factRefs }) as OutlineEntry;

const plain = (slide: Slide) =>
  slide.elements
    .flatMap((e) =>
      e.type === "text" || (e.type === "shape" && e.doc) ? [JSON.stringify(e.doc ?? e)] : [],
    )
    .join(" ");

describe("lab question lines (r1)", () => {
  test("a question with three distractors is one multiple-choice line; its answer names the letter", () => {
    const line = questionLine(mc, "seed");
    for (const text of ["artery", "vein", "capillary", "valve"]) expect(line.text).toContain(text);
    expect(line.text).toMatch(/ A .+ {2}B .+ {2}C .+ {2}D /);
    const letter = line.answer.slice(0, 1);
    expect(line.text).toContain(`${letter} artery`);
    expect(line.answer).toBe(`${letter} (artery)`);
  });
  test("any other question is its stem, answered in a line", () => {
    expect(questionLine(open)).toMatchObject({ text: open.stem, answer: "the left ventricle" });
    expect(questionLine(open).quiz).toEqual({ stem: open.stem, answer: "the left ventricle" });
  });
  test("a misconception is a true/false line on its belief, answered false with its correction", () => {
    expect(
      misconceptionLine(facts.misconceptions?.[0] ?? { belief: "", correction: "" }),
    ).toMatchObject({
      text: "True or false? Veins carry blue blood.",
      answer: "False. Blood in veins is dark red.",
    });
  });
});

describe("codedSetSpec (r1)", () => {
  test("a check set prints its questions verbatim, answers in the footnote and notes", () => {
    const coded = codedSetSpec(entry("instructions", ["o1", "q1", "q2"]), facts, "L:5");
    expect(coded?.spec.kind).toBe("instructions");
    const spec = coded?.spec as { steps: string[]; footnote: string; notes: string };
    expect(spec.steps).toHaveLength(2);
    expect(spec.steps[1]).toBe(open.stem);
    expect(spec.footnote).toContain("2 the left ventricle");
    expect(spec.notes).toContain("the left ventricle");
  });
  test("the exit quiz takes misconception lines too; the answers are a reveal on the slide", () => {
    const coded = codedSetSpec(entry("exit-ticket", ["o1", "q1", "q3", "m1"]), facts, "L:9");
    const items = (coded?.spec as { items: string[] } | undefined)?.items ?? [];
    expect(items).toHaveLength(3);
    expect(items[2]).toContain("True or false?");
    const slide = withAnswersReveal(
      materialiseSlide(coded?.spec as never, "chalk", {
        promptVersion: "code",
        model: "code",
        at: "2026-09-24T00:00:00.000Z",
      }),
    );
    const answers = slide.elements.find((e) => e.name === "Answers");
    expect(answers?.revealStep).toBe(1);
    expect(plain(slide)).toContain("Blood in veins is dark red.");
    const body = slide.elements.find((e) => e.type === "text" && e.style.preset === "body");
    expect((body?.y ?? 0) + (body?.h ?? 0)).toBeLessThanOrEqual(answers?.y ?? 0);
  });
  test("a starter without a question, and a question slide, stay the model's", () => {
    expect(codedSetSpec(entry("starter", ["o1", "m1"]), facts, "s")).toBeUndefined();
    expect(codedSetSpec(entry("multiple-choice", ["o1", "q1"]), facts, "s")).toBeUndefined();
  });
  test("a line over the list cap is left off, never cut", () => {
    const long = { ...open, id: "q9", stem: "x".repeat(LINE_MAX + 1) };
    const coded = codedSetSpec(
      entry("instructions", ["q9", "q2"]),
      { ...facts, questions: [long, open] } as LessonFacts,
      "s",
    );
    expect((coded?.spec as { steps: string[] } | undefined)?.steps).toEqual([open.stem]);
  });
});

describe("an options-style stem without options (25 Sep, cbm1-cb-y8-rivers-WL)", () => {
  const q7 = {
    id: "q7",
    stem: "Which of the following new housing plans would most reduce flood risk?",
    answer: "Permeable paving and green roofs",
    reasoning: "",
    distractors: [] as { text: string }[],
    use: "slide" as const,
  };
  const q5 = { ...open, id: "q5" };
  const q6 = { ...open, id: "q6", stem: "Name the vessel that returns blood to the heart." };
  const with7 = (q: typeof q7) => ({ ...facts, questions: [q5, q6, q] }) as unknown as LessonFacts;
  test("is left off the check set, and not counted as asked", () => {
    const coded = codedSetSpec(entry("instructions", ["q5", "q6", "q7"]), with7(q7), "L:5");
    expect((coded?.spec as { steps: string[] } | undefined)?.steps).toEqual([q5.stem, q6.stem]);
    expect(coded?.answers).toHaveLength(2);
    expect(coded?.questionRefs).toEqual(["q5", "q6"]);
    // Its only question dropped, the check slide is the model's.
    expect(codedSetSpec(entry("instructions", ["q7"]), with7(q7), "L:5")).toBeUndefined();
  });
  test("with three distractors it is printed as one multiple-choice line", () => {
    const listed = {
      ...q7,
      distractors: [{ text: "More car parks" }, { text: "Tarmac drives" }, { text: "Fewer trees" }],
    };
    const coded = codedSetSpec(entry("instructions", ["q7"]), with7(listed), "L:5");
    const steps = (coded?.spec as { steps: string[] } | undefined)?.steps ?? [];
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatch(/ A .+ {2}B .+ {2}C .+ {2}D /);
    expect(coded?.answers[0]).toMatch(/^[A-D] \(/);
  });
});

describe("seeded option order (r1, SYNTHESIS cause 6)", () => {
  test("the same seed gives the same order; across slides the answer is not always A", () => {
    expect(seededOrder(4, "lesson-1:5")).toEqual(seededOrder(4, "lesson-1:5"));
    expect([...seededOrder(4, "x")].sort()).toEqual([0, 1, 2, 3]);
    const spec = {
      kind: "multiple-choice" as const,
      factRefs: [],
      stem: "Which?",
      options: [
        { text: "right", correct: true },
        { text: "w1", correct: false },
        { text: "w2", correct: false },
        { text: "w3", correct: false },
      ],
    };
    const at = Array.from({ length: 20 }, (_, i) => {
      const out = withShuffledOptions(spec, `lesson-1:${i}`);
      return out.kind === "multiple-choice" ? out.options.findIndex((o) => o.correct) : -1;
    });
    expect(new Set(at).size).toBeGreaterThan(2);
    expect(at.filter((a) => a === 0).length).toBeLessThan(12);
    expect(withShuffledOptions(spec, "lesson-1:3")).toEqual(
      withShuffledOptions(spec, "lesson-1:3"),
    );
  });
});

describe("the retrieval starter (r2)", () => {
  const retrieval = [
    { question: "Which organ pumps blood around the body?", answer: "The heart" },
    {
      question: "What do we breathe in to stay alive: oxygen or carbon dioxide?",
      answer: "Oxygen",
    },
    { question: "Name one thing blood carries.", answer: "Oxygen (or food, or water)" },
  ];
  const withRetrieval = { ...facts, retrieval } as LessonFacts;

  test("a starter prints the three retrieval questions, answers shown, and none of the lesson's", () => {
    const coded = codedSetSpec(entry("starter", ["o1"]), withRetrieval, "L:2");
    const spec = coded?.spec as { kind: string; items: string[]; footnote: string; notes: string };
    expect(spec.kind).toBe("starter");
    expect(spec.items).toEqual(retrieval.map((r) => r.question));
    expect(coded?.answers).toEqual(retrieval.map((r) => r.answer));
    expect(spec.footnote).toBe(
      "Answers: 1 The heart  ·  2 Oxygen  ·  3 Oxygen (or food, or water)",
    );
    expect(spec.notes).toContain("3. Oxygen (or food, or water)");
    // A question ref on the entry (none is placed with a retrieval set) is still not printed.
    const refs = codedSetSpec(entry("starter", ["o1", "q1", "q2"]), withRetrieval, "L:2");
    expect((refs?.spec as { items?: string[] } | undefined)?.items).toEqual(
      retrieval.map((r) => r.question),
    );
    const slide = withAnswersReveal(
      materialiseSlide(coded?.spec as never, "chalk", {
        promptVersion: "code",
        model: "code",
        at: "2026-09-24T00:00:00.000Z",
      }),
    );
    // Each answer is revealed inside its question's card (row cards).
    const reveals = slide.elements.filter((e) => e.name === "Row reveal");
    expect(reveals).toHaveLength(retrieval.length);
    for (const r of reveals) expect(r.revealStep).toBeGreaterThanOrEqual(1);
    expect(plain(slide)).toContain("The heart");
    expect(plain(slide)).toContain("Which organ pumps blood");
  });

  test("the retrieval set never reaches a check or the exit quiz", () => {
    const check = codedSetSpec(entry("instructions", ["o1", "q1", "q2"]), withRetrieval, "s");
    const exit = codedSetSpec(entry("exit-ticket", ["o1", "q1", "q3"]), withRetrieval, "s");
    for (const coded of [check, exit]) {
      const text = JSON.stringify(coded?.spec);
      for (const r of retrieval) expect(text).not.toContain(r.question);
    }
  });

  test("without a retrieval set the starter is round 1's: its question refs, or the model's", () => {
    const coded = codedSetSpec(entry("starter", ["o1", "q1", "q2"]), facts, "s");
    expect((coded?.spec as { items?: string[] } | undefined)?.items).toHaveLength(2);
    expect(codedSetSpec(entry("starter", ["o1", "m1"]), facts, "s")).toBeUndefined();
  });
});

describe("sameQuestion (pw prompts-2)", () => {
  test("the same question reworded repeats; a new number or a new question does not", () => {
    const q = (stem: string, answer: string) => ({ stem, answer });
    expect(
      sameQuestion(
        q(
          "Why did the British government move children from cities such as London in 1939?",
          "To protect them from possible bombing by moving them to safer places",
        ),
        q(
          "Why did the government move children from a British city to the countryside in 1939?",
          "To protect them from possible bombing in the city",
        ),
      ),
    ).toBe(true);
    expect(
      sameQuestion(
        q("Simplify the ratio 8:12 by dividing both parts by their HCF.", "2:3"),
        q(
          "A shop has 15 red pens and 25 blue pens. Simplify the ratio by dividing both parts by their HCF.",
          "3:5",
        ),
      ),
    ).toBe(false);
    expect(
      sameQuestion(
        q("How can a sea wall reduce erosion of a cliff?", "It reflects wave energy"),
        q(
          "Why might a sea wall cause problems further along the coast?",
          "It can increase erosion elsewhere",
        ),
      ),
    ).toBe(false);
  });
});

/*
 * TEACH-172, UX ruling 108: an exit ticket holds at most three questions and fits one slide on
 * every theme with its answers, which are revealed under the list and never over it.
 */
const words = (n: number, seed: string) => {
  let s = "";
  while (s.length < n) s += `${seed} water vapour rises and cools `;
  return `${s.slice(0, n - 1).trim()}?`;
};
/** A multiple-choice question whose printed line is `len` characters, options of `opt`. */
const mcOf = (id: string, len: number, opt = 18) => {
  const options = ["right", "alpha", "beta", "gamma"].map((w) => words(opt, w).slice(0, -1));
  const stemLen = len - options.reduce((n, o) => n + o.length + 2, 0) - 6;
  return {
    id,
    stem: words(stemLen, `why ${id}`),
    answer: options[0] as string,
    reasoning: "",
    distractors: options.slice(1).map((text) => ({ text })),
    use: "exit" as const,
  };
};
const exitFacts = (qs: ReturnType<typeof mcOf>[]) =>
  ({ ...facts, questions: qs, misconceptions: [] }) as unknown as LessonFacts;
const exitSpec = (qs: ReturnType<typeof mcOf>[]) =>
  codedSetSpec(
    entry(
      "exit-ticket",
      qs.map((q) => q.id),
    ),
    exitFacts(qs),
    "L:9",
  );
const itemsOf = (coded: ReturnType<typeof codedSetSpec>) => {
  if (coded?.spec.kind !== "exit-ticket") throw new Error("no exit ticket");
  return coded.spec.items;
};
const meta = { promptVersion: "code", model: "code", at: "2026-09-27T00:00:00.000Z" };
const needOf = (slide: Slide, el: TextElement, themeId: string) => {
  const theme = THEMES.find((t) => t.id === themeId);
  const parts = textPartsOf(el, slide);
  if (!theme || !parts) throw new Error(themeId);
  return measureHeadless(theme)({ ...parts, width: el.w });
};

describe("the exit ticket: at most three, on one slide (TEACH-172, ruling 108)", () => {
  test("the cap is three; one prints a ticket", () => {
    expect(EXIT_QUIZ_MAX).toBe(3);
    expect(EXIT_QUIZ_MIN).toBe(1);
  });

  test("five short questions: the first three are kept, in order", () => {
    const qs = ["a", "b", "c", "d", "e"].map((id) => mcOf(id, 80, 8));
    const items = itemsOf(exitSpec(qs));
    expect(items).toHaveLength(3);
    expect(items.map((t) => t.slice(0, 20))).toEqual(
      qs.slice(0, 3).map((q) => q.stem.slice(0, 20)),
    );
  });

  test("three multiple-choice lines at the 240-character cap do not fit: fewer are kept, and they fit", () => {
    const qs = ["a", "b", "c"].map((id) => mcOf(id, MC_LINE_MAX, 40));
    const lines = qs.map((q) => questionLine(q, "s"));
    expect(lines.every((l) => l.text.length <= MC_LINE_MAX)).toBe(true);
    expect(fitsExitTicket(lines)).toBe(false);
    const kept = exitLines(lines);
    expect(kept.length).toBeGreaterThanOrEqual(1);
    expect(kept.length).toBeLessThan(3);
    expect(fitsExitTicket(kept)).toBe(true);
  });

  test("a line that does not fit is passed over for a later, shorter one", () => {
    const long = questionLine(mcOf("a", MC_LINE_MAX, 40), "s");
    const lines: Line[] = [long, long, questionLine(mcOf("c", 70, 8), "s")];
    const kept = exitLines(lines);
    expect(kept.at(-1)?.text).toBe(lines[2]?.text);
    expect(fitsExitTicket(kept)).toBe(true);
  });

  test("one line is always kept, even when nothing fits beside it", () => {
    const one = { text: "x".repeat(LINE_MAX), answer: "y ".repeat(300).trim() };
    expect(exitLines([one])).toEqual([one]);
  });

  // The maximum: the longest three lines the measure keeps, found by growing them together.
  let max = 60;
  while (fitsExitTicket(["a", "b", "c"].map((id) => questionLine(mcOf(id, max + 5), "s"))))
    max += 5;
  const atMax = ["a", "b", "c"].map((id) => mcOf(id, max));

  for (const theme of THEMES) {
    test(`${theme.id}: three questions at the maximum (${max} characters a line) fit with their answers under the list`, () => {
      const coded = exitSpec(atMax);
      expect(itemsOf(coded)).toHaveLength(3);
      const slide = withAnswersReveal(
        materialiseSlide(coded?.spec as never, theme.id, meta),
        theme.id,
      );
      const body = slide.elements.find(
        (e): e is TextElement => e.type === "text" && e.style.preset === "body",
      );
      const answers = slide.elements.find(
        (e): e is TextElement => e.type === "text" && e.name === "Answers",
      );
      if (!body || !answers) throw new Error("no list or answers");
      // The list's words fit its box, the answers start below it and hold their words, and all of
      // it stays inside the safe area: nothing overflows and no answer covers a question.
      expect(needOf(slide, body, theme.id)).toBeLessThanOrEqual(body.h + 0.5);
      expect(body.y + body.h).toBeLessThanOrEqual(answers.y);
      expect(needOf(slide, answers, theme.id)).toBeLessThanOrEqual(answers.h + 0.5);
      expect(answers.y + answers.h).toBeLessThanOrEqual(SAFE_BOTTOM);
      expect(answers.revealStep).toBe(1);
    });
  }
});

describe("a quick check whose answers would cover its questions gets an answers slide (prod-17)", () => {
  const answers = [
    "carbon dioxide + water → glucose + oxygen",
    "Light energy",
    "The atoms are rearranged to make glucose and oxygen; they are not created or destroyed.",
    "Chlorophyll absorbs and transfers light energy to the reactions that use carbon dioxide and water to make glucose and oxygen.",
  ];
  const steps = [
    "State the word equation for photosynthesis.",
    "In a lettuce leaf, what does chlorophyll absorb?",
    "What happens to the atoms of carbon dioxide and water in photosynthesis?",
    "Explain how chlorophyll helps a leaf make glucose.",
  ];
  const meta = { promptVersion: "prod-17", model: "test", at: "2026-10-10T10:00:00.000Z" };
  const check = (themeId: string) =>
    withAnswersReveal(
      materialiseSlide(
        {
          kind: "instructions",
          factRefs: [],
          heading: "Quick check",
          steps,
          footnote: `Answers: ${answers.map((a, i) => `${i + 1} ${a}`).join("  ·  ")}`,
        },
        themeId,
        meta,
      ),
      themeId,
    );
  const checkSlide = (themeId: string) => check(themeId);
  const withNotes = (slide: Slide, notes: string): Slide => ({ ...slide, notes });
  const after = (notes: string): Slide =>
    ({ ...check("studio"), id: "after", notes, elements: [] }) as Slide;

  test.each(THEMES.map((t) => [t.id]))("on %s the answers follow on their own slide", (themeId) => {
    const lesson = { themeId, slides: [check(themeId), after("Recap slide 1, then slide 2.")] };
    const out = withAnswersSlides(lesson);
    expect(out.slides).toHaveLength(3);
    const [questions, own, next] = out.slides as [Slide, Slide, Slide];
    expect(questions.elements.some((e) => e.name === "Answers")).toBe(false);
    expect(JSON.stringify(own.elements)).toContain("Quick check: answers");
    // A slide number said in words follows the slide it named.
    expect(next.notes).toBe("Recap slide 1, then slide 3.");
  });

  /** The fixture plan's facts, schema-valid, with a slide per outline entry; covering checks at `at`. */
  const SETS = new Set(["starter", "instructions", "exit-ticket"]);
  const heading = (text: string): TextElement =>
    ({
      id: `h-${text}`,
      type: "text",
      name: "Heading",
      x: 64,
      y: 46,
      w: 832,
      h: 54,
      doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
      style: { preset: "heading" },
    }) as TextElement;
  const headingOf = (s: Slide): string => {
    const h = s.elements.find((e) => e.name === "Heading");
    return h?.type === "text" ? richDocToPlainText(h.doc) : s.id;
  };
  const shortCheck = () =>
    withAnswersReveal(
      materialiseSlide(
        {
          kind: "instructions",
          factRefs: [],
          heading: "Quick check",
          steps: ["One?", "Two?"],
          footnote: "Answers: 1 Yes  ·  2 No",
        },
        "studio",
        meta,
      ),
      "studio",
    );
  const planned = (count: number) => {
    const facts = LessonFactsSchema.parse(
      assignFactIds(FIXTURES.planSkeleton, FIXTURES.planFacts, 60),
    );
    const at = facts.outline.flatMap((e, i) => (SETS.has(e.kind) ? [i] : [])).slice(0, count);
    const slides = facts.outline.map((e, i) =>
      at.includes(i)
        ? { ...check("studio"), id: `slide-${i}`, notes: `Answers for ${e.id}` }
        : ({
            ...after(i === facts.outline.length - 1 ? "Back to slide 1." : ""),
            id: `slide-${i}`,
            elements: [heading(`Slide ${i}`)],
          } as Slide),
    );
    return { themeId: "studio", facts, slides, at };
  };
  const pairs = (l: { slides: Slide[]; facts?: LessonFacts }) =>
    l.slides.map((s, i) => [s.id, l.facts?.outline[i]?.id]);

  test("answers slides get schema-valid entries, and every other slide keeps its own (two checks)", () => {
    const lesson = planned(2);
    const [c1 = 0, c2 = 0] = lesson.at;
    expect(lesson.at).toHaveLength(2);
    const out = withAnswersSlides(lesson);
    expect(out.slides).toHaveLength(lesson.slides.length + 2);
    const facts = LessonFactsSchema.parse(out.facts);
    expect(facts.outline).toHaveLength(out.slides.length);
    const before = new Map(pairs(lesson) as [string, string][]);
    for (const [slideId, entryId] of pairs(out) as [string, string][]) {
      const entry = facts.outline.find((e) => e.id === entryId);
      if (entry?.answersTo) continue;
      expect(entryId).toBe(before.get(slideId) as string);
    }
    const answers = facts.outline.filter((e) => e.answersTo);
    expect(answers.map((e) => e.answersTo)).toEqual([
      lesson.facts.outline[c1]?.id,
      lesson.facts.outline[c2]?.id,
    ]);
    expect(out.slides[c1 + 1]?.notes).toBe(`Answers for ${lesson.facts.outline[c1]?.id}`);
    expect(out.slides[c1 + 1]?.diagram).toBeUndefined();
  });

  test("a second run changes nothing", () => {
    const once = withAnswersSlides(planned(1));
    expect(withAnswersSlides(once)).toBe(once);
  });

  test("a regenerated check brings its answers slide up to date", () => {
    const lesson = planned(1);
    const c = lesson.at[0] ?? 0;
    const once = withAnswersSlides(lesson);
    // The new questions' answers fit under them: the answers slide and its entry go.
    const short = withAnswersReveal(
      materialiseSlide(
        {
          kind: "instructions",
          factRefs: [],
          heading: "Quick check",
          steps: ["One?", "Two?"],
          footnote: "Answers: 1 Yes  ·  2 No",
        },
        "studio",
        meta,
      ),
      "studio",
    );
    const fits = {
      ...once,
      slides: once.slides.map((s, i) => (i === c ? { ...short, id: s.id } : s)),
    };
    const dropped = withAnswersSlides(fits, undefined, new Set([`slide-${c}`]));
    expect(dropped.slides).toHaveLength(once.slides.length - 1);
    expect(LessonFactsSchema.parse(dropped.facts).outline.some((e) => e.answersTo)).toBe(false);
    // Long answers again: exactly one answers slide comes back.
    const again = {
      ...dropped,
      slides: dropped.slides.map((s, i) => (i === c ? { ...check("studio"), id: s.id } : s)),
    };
    const back = withAnswersSlides(again, undefined, new Set([`slide-${c}`]));
    expect(back.slides).toHaveLength(once.slides.length);
    expect(LessonFactsSchema.parse(back.facts).outline.filter((e) => e.answersTo)).toHaveLength(1);
  });

  test("a regenerated check with no answers drops its old answers slide and entry", () => {
    const lesson = planned(1);
    const c = lesson.at[0] ?? 0;
    const once = withAnswersSlides(lesson);
    const bare = { ...after(""), id: `slide-${c}`, kind: "instructions" } as Slide;
    const regen = { ...once, slides: once.slides.map((s, i) => (i === c ? bare : s)) };
    const out = withAnswersSlides(regen, undefined, new Set([`slide-${c}`]));
    expect(out.slides).toHaveLength(lesson.slides.length);
    expect(LessonFactsSchema.parse(out.facts).outline.some((e) => e.answersTo)).toBe(false);
  });

  /** A deck's invariants (ruling 200): entries line up, ids unique, answers only where needed. */
  const holds = (l: { slides: Slide[]; facts?: LessonFacts }) => {
    const facts = LessonFactsSchema.parse(l.facts);
    expect(entriesWritten(l.slides)).toBe(facts.outline.length);
    const at = outlineIndices(l.slides);
    facts.outline.forEach((e, k) => {
      if (!e.answersTo) return;
      expect(facts.outline[k - 1]?.id).toBe(e.answersTo);
      const check = l.slides[at.indexOf(k - 1)] as Slide;
      expect(check.elements.some((x) => x.name === "Answers" || (x.revealStep ?? 0) > 0)).toBe(
        false,
      );
    });
    for (const s of l.slides) {
      const panel = s.elements.find((x) => x.name === "Answers" && (x.revealStep ?? 0) > 0);
      if (panel) expect(JSON.stringify(s.elements)).not.toContain("Explain how chlorophyll");
    }
  };

  test("property: over decks with continuations, checks and regenerates, the invariants hold", () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let run = 0; run < 40; run++) {
      const base = planned(3);
      // A continuation after some teaching slides (same kind, "<heading> (continued)").
      const slides: Slide[] = [];
      for (const s of base.slides) {
        slides.push(s);
        if (!base.at.includes(Number(s.id.split("-")[1])) && s.kind !== "title" && rand() < 0.3) {
          slides.push({
            ...s,
            id: `${s.id}-c`,
            elements: [heading(`${headingOf(s)} (continued)`)],
          });
        }
      }
      // Each check covers its questions, or not, at random.
      const deck = {
        ...base,
        slides: slides.map((s) => {
          const k = Number(s.id.split("-")[1]);
          if (!base.at.includes(k) || s.id.endsWith("-c")) return s;
          return rand() < 0.5 ? s : { ...shortCheck(), id: s.id };
        }),
      };
      for (const s of deck.slides) if (s.kind !== "title") void s;
      const once = withAnswersSlides(deck);
      holds(once);
      expect(withAnswersSlides(once)).toBe(once);
      // Regenerate one check at random: covering, fitting or bare.
      const k = base.at[Math.floor(rand() * base.at.length)] ?? 0;
      const roll = rand();
      const fresh =
        roll < 0.34
          ? check("studio")
          : roll < 0.67
            ? shortCheck()
            : ({ ...after(""), kind: "instructions" } as Slide);
      const regen = {
        ...once,
        slides: once.slides.map((s) => (s.id === `slide-${k}` ? { ...fresh, id: s.id } : s)),
      };
      holds(withAnswersSlides(regen, undefined, new Set([`slide-${k}`])));
    }
  });

  test("a deck with no covering panel comes back as it was", () => {
    const lesson = { themeId: "studio", slides: [after("slide 1")] };
    expect(withAnswersSlides(lesson)).toBe(lesson);
  });
});
