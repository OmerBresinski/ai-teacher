import { describe, expect, test } from "bun:test";
import type { LessonFacts, OutlineEntry } from "@tj/domain/documents";
import { LATER_QUESTIONS_MAX, laterQuestionsFor } from "./later-questions";

const q = (id: string, stem: string, answer: string, keyIdeaRefs: string[]) => ({
  id,
  stem,
  answer,
  reasoning: "",
  keyIdeaRefs,
});
const e = (kind: string, factRefs: string[], phase?: string) =>
  ({ kind, factRefs, ...(phase ? { phase } : {}) }) as unknown as OutlineEntry;

const facts = {
  objectives: [{ id: "o1", text: "Explain sharing in a ratio." }],
  keyIdeas: [
    { id: "k1", statement: "A ratio compares parts.", objectiveRefs: ["o1"] },
    { id: "k2", statement: "Add the parts to share.", objectiveRefs: ["o1"] },
  ],
  vocabulary: [],
  workedExamples: [{ id: "x1", problem: "p", steps: ["s"], answer: "a" }],
  misconceptions: [],
  questions: [
    q("q0", "Starter asks k1?", "s", ["k1"]),
    q("q1", "Simplify 8:12.", "2:3", ["k1"]),
    q("q2", "Share 20 in 1:3.", "5 and 15", ["k2"]),
    // Over the line cap: the check set drops it, so it never lands on a slide.
    q("q3", `Long ${"x".repeat(200)}?`, "a", ["k1"]),
    q("q4", "Which ratio is simplest, 2:4 or 1:2?", "1:2", ["k1"]),
    q("q5", "Share 36 in 1:2; how many parts in all?", "3 parts, 12 and 24", ["k1", "k2"]),
    q("q6", "Is 3:6 the same as 1:2?", "Yes", ["k1"]),
    q("q7", "Explain why 10:15 simplifies to 2:3 and not 3:2.", "Order stays: 10 is to 15", ["k1"]),
    q("q8", "Never placed k1?", "n", ["k1"]),
  ],
  outline: [
    e("title", []),
    e("starter", ["o1", "q0"], "starter"),
    e("content", ["o1", "k1"], "explain"),
    e("content", ["o1", "k2"], "explain"),
    e("instructions", ["o1", "q1", "q2", "q3"], "practise"),
    e("multiple-choice", ["o1", "q4"], "practise"),
    e("image-text", ["o1", "k1"], "explain"),
    e("worked-example", ["o1", "x1"], "explain"),
    e("exit-ticket", ["o1", "q5", "q6", "q7"], "check"),
  ],
  durationMin: 50,
} as unknown as LessonFacts;

const stems = (i: number) => laterQuestionsFor(facts, i, "lesson")?.map((x) => x.stem);

describe("laterQuestionsFor (lab r3, tested-not-taught)", () => {
  test("a teaching slide gets the later questions that land on a slide and test its key ideas, shortest first, capped", () => {
    // k1 is tested later by q1 (check set), q4 (model-written practise), q5, q6, q7 (exit quiz);
    // q0 is on the starter before it, q3 is dropped by the set's line cap, q8 is on no slide.
    // Five qualify; the longest (q7) goes.
    expect(stems(2)).toEqual([
      "Simplify 8:12.",
      "Is 3:6 the same as 1:2?",
      "Which ratio is simplest, 2:4 or 1:2?",
      "Share 36 in 1:2; how many parts in all?",
    ]);
    expect(stems(2)).toHaveLength(LATER_QUESTIONS_MAX);
    expect(laterQuestionsFor(facts, 2, "lesson")?.[0]).toEqual({
      stem: "Simplify 8:12.",
      answer: "2:3",
    });
  });

  test("only questions after the slide count, and only for its own key ideas", () => {
    expect(stems(3)).toEqual(["Share 20 in 1:3.", "Share 36 in 1:2; how many parts in all?"]);
    // The image-text slide after the check set sees only the exit quiz.
    expect(stems(6)).toEqual([
      "Is 3:6 the same as 1:2?",
      "Share 36 in 1:2; how many parts in all?",
      "Explain why 10:15 simplifies to 2:3 and not 3:2.",
    ]);
  });

  test("absent on a slide that is not teaching, names no key idea, or is never tested later", () => {
    expect(laterQuestionsFor(facts, 4, "lesson")).toBeUndefined();
    expect(laterQuestionsFor(facts, 7, "lesson")).toBeUndefined();
    const lastTaught = { ...facts, outline: facts.outline.slice(0, 3) } as LessonFacts;
    expect(laterQuestionsFor(lastTaught, 2, "lesson")).toBeUndefined();
  });
});
