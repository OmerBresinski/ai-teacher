import { describe, expect, test } from "bun:test";
import type { LessonFacts, OutlineEntry, Slide } from "@tj/domain/documents";
import { materialiseSlide } from "@tj/slides";
import {
  codedSetSpec,
  LINE_MAX,
  misconceptionLine,
  questionLine,
  sameQuestion,
  seededOrder,
  withAnswersReveal,
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
  slide.elements.flatMap((e) => (e.type === "text" ? [JSON.stringify(e.doc ?? e)] : [])).join(" ");

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
    expect(questionLine(open)).toEqual({ text: open.stem, answer: "the left ventricle" });
  });
  test("a misconception is a true/false line on its belief, answered false with its correction", () => {
    expect(misconceptionLine(facts.misconceptions?.[0] ?? { belief: "", correction: "" })).toEqual({
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
