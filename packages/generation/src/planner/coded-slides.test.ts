import { describe, expect, test } from "bun:test";
import {
  type LessonFacts,
  type OutlineEntry,
  type Slide,
  SlideSchema,
  slideStepCount,
  type TextElement,
} from "@tj/domain/documents";
import { materialiseSlide, measureHeadless, SAFE_BOTTOM, THEMES, textPartsOf } from "@tj/slides";
import { labAi, recordingDeps, romansLesson } from "../testing";
import { runLessonPipeline } from "../workflow";
import {
  codedSetSpec,
  EXIT_QUIZ_MAX,
  EXIT_QUIZ_MIN,
  exitLines,
  fitsExitTicket,
  isCodeBuilt,
  LINE_MAX,
  type Line,
  MC_LINE_MAX,
  misconceptionLine,
  questionLine,
  sameQuestion,
  seededOrder,
  withAnswersReveal,
  withSetQuestion,
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
    expect(slide.elements.find((e) => e.name === "Answers")?.revealStep).toBe(1);
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

describe("coded sets carry their answers as a set question (TEACH-101)", () => {
  test("row 1: every coded Do now, Quick check and Exit ticket of a fake-AI objectives-first lesson has a set question, one item per line", async () => {
    const final = await runLessonPipeline({ lesson: romansLesson() }, recordingDeps(labAi()), {
      planner: "objectives-first",
    });
    const sets = final.lesson.slides.filter(isCodeBuilt);
    expect(sets.map((s) => s.kind)).toEqual(
      expect.arrayContaining(["starter", "instructions", "exit-ticket"]),
    );
    final.lesson.facts?.outline.forEach((entry, i) => {
      const slide = final.lesson.slides[i] as Slide;
      if (!isCodeBuilt(slide)) return;
      const coded = codedSetSpec(
        entry,
        final.lesson.facts as LessonFacts,
        `${final.lesson.id}:${i}`,
      );
      const q = slide.question;
      if (q?.type !== "set") throw new Error(`slide ${i} (${slide.kind}) has no set question`);
      expect(q.items.map((it) => it.answer)).toEqual(coded?.answers ?? []);
      expect(q.items.map((it) => it.lineIndex)).toEqual(q.items.map((_, j) => j));
      const box = slide.elements.find((e) => e.id === q.answersId);
      expect(box?.revealStep).toBe(1);
      // The reveal is the answers box's own step: no extra step for the question.
      expect(slideStepCount(slide)).toBe(1);
      expect(SlideSchema.safeParse(slide).success).toBe(true);
    });
  });

  test("the strip names every answer by its line; a slide with no answers box is left as it is", () => {
    const slide = withAnswersReveal(
      materialiseSlide(
        {
          kind: "exit-ticket",
          heading: "Exit ticket",
          items: ["One?", "Two?"],
          footnote: "Answers: 1 a  ·  2 b c",
          factRefs: [],
        },
        "chalk",
        { promptVersion: "fit", model: "fit", at: "1970-01-01T00:00:00.000Z" },
      ),
    );
    const q = withSetQuestion(slide, ["a", "b c"]).question;
    expect(q).toEqual({
      type: "set",
      answersId: expect.any(String),
      items: [
        { lineIndex: 0, answer: "a" },
        { lineIndex: 1, answer: "b c" },
      ],
    });
    const bare = { ...slide, elements: slide.elements.filter((e) => e.name !== "Answers") };
    expect(withSetQuestion(bare, ["a"])).toBe(bare);
  });
});
