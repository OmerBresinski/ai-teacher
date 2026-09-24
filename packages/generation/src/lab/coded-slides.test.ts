import { describe, expect, test } from "bun:test";
import type { LessonFacts, OutlineEntry, Slide } from "@tj/domain/documents";
import { materialiseSlide } from "@tj/slides";
import {
  codedSetSpec,
  LINE_MAX,
  misconceptionLine,
  questionLine,
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
