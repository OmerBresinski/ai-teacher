import { describe, expect, test } from "bun:test";
import romans from "../fixtures/objective-facts.y4-history-romans.json";
import ratio from "../fixtures/question-demand.w1-h-y7-ratio-W.json";
import { type OutlineFacts, outlineFromFacts } from "../outline-from-facts";
import type { LessonShape } from "../shapes";
import { lessonShapeOf } from "../shapes";
import { EXIT_QUIZ_MAX, fitsLine, MC_LINE_MAX, questionLine, SET_CHARS } from "./coded-slides";
import {
  PLACEHOLDER_STEM_CHARS,
  PLACEHOLDERS_PER_OBJECTIVE,
  placeholderQuestions,
  questionDemand,
  SPARE,
  sketchTaught,
} from "./question-demand";

/*
 * Lab pw, wave 3: the outline's question demand per (objective, use), read off a fill over
 * placeholder questions. The numbers pinned here are what `outlineFromFacts` places today for the
 * Romans shape (Explain, some prior knowledge) at ten slides with a retrieval starter: a check set
 * after each cycle, and an exit quiz of one or two lines per objective. The placeholders are as
 * long as a real multiple-choice question may be (`MC_LINE_MAX`), so the set and quiz character
 * budgets read as they do on real questions: two lines to a set, three on the quiz. A change in
 * the outline that moves them is a change in what the lesson asks, to be read, not a broken test.
 */

const shape = lessonShapeOf(romans.answers, { yearGroup: romans.yearGroup });
const retrieval = [
  { question: "Who invaded Britain in AD 43?", answer: "The Romans" },
  { question: "What is an empire?", answer: "Lands ruled by one state" },
  { question: "Name one Roman road.", answer: "Watling Street" },
];
const objectivesOf = (n: number) => {
  const objectives = romans.objectives.slice(0, n).map((o) => ({ text: o.text }));
  while (objectives.length < n) objectives.push({ text: `Objective ${objectives.length + 1}` });
  return objectives;
};
const demandFor = (n: number, slideCount: 10 | 12 = 10, withRetrieval = true) => {
  const objectives = objectivesOf(n);
  return questionDemand({
    topic: romans.topic,
    objectives,
    facts: sketchTaught(
      objectives,
      objectives.map((_, i) => i === n - 1),
    ),
    shape,
    slideCount,
    retrieval: withRetrieval ? retrieval : undefined,
  });
};

describe("questionDemand", () => {
  test("two objectives at ten slides: a set of two on each, three exit lines across them", () => {
    const { demand, counts, outline } = demandFor(2);
    expect(demand).toEqual([
      { slide: 2, exit: 2 },
      { slide: 2, exit: 1 },
    ]);
    expect(counts).toEqual([
      { slide: 2 + SPARE.slide, exit: 2 + SPARE.exit },
      { slide: 2 + SPARE.slide, exit: 1 + SPARE.exit },
    ]);
    expect(outline.skeleton.outline.map((e) => e.kind)).toEqual([
      "title",
      "objectives",
      "starter",
      "vocabulary",
      "content",
      "instructions",
      "content",
      "worked-example",
      "instructions",
      "exit-ticket",
    ]);
  });

  test("three objectives at ten slides: the last objective's only check is the exit quiz, so no slide set for it", () => {
    const { demand, counts } = demandFor(3);
    expect(demand).toEqual([
      { slide: 2, exit: 1 },
      { slide: 2, exit: 1 },
      { slide: 0, exit: 1 },
    ]);
    // No call for a set of none; the spare rides on the slide sets only.
    expect(counts).toEqual([
      { slide: 3, exit: 1 },
      { slide: 3, exit: 1 },
      { slide: 0, exit: 1 },
    ]);
    const exitLines = demand.reduce((n, d) => n + d.exit, 0);
    expect(exitLines).toBeLessThanOrEqual(EXIT_QUIZ_MAX);
  });

  test("without a retrieval set the round-1 starter takes one easy question per objective, so the slide demand rises by one", () => {
    const { demand } = demandFor(3, 10, false);
    expect(demand.map((d) => d.slide)).toEqual([3, 3, 1]);
  });

  test("a placeholder is as long as a real question: an 80-character stem, a multiple-choice line at the cap", () => {
    const objectives = objectivesOf(3);
    const questions = placeholderQuestions(sketchTaught(objectives, [false, false, true]), 3);
    expect(questions).toHaveLength(
      3 * (PLACEHOLDERS_PER_OBJECTIVE.slide + PLACEHOLDERS_PER_OBJECTIVE.exit),
    );
    for (const q of questions) {
      expect(q.forms).toEqual(["multiple-choice", "open-response"]);
      expect(q.distractors).toHaveLength(3);
      expect(q.keyIdeaRefs?.length).toBe(2);
      expect(q.stem.length).toBe(PLACEHOLDER_STEM_CHARS);
      const line = questionLine(q);
      expect(line.mc).toBe(true);
      expect(line.text.length).toBe(MC_LINE_MAX);
      expect(fitsLine(line)).toBe(true);
    }
    // So a set holds two of them within its budget, never four.
    expect(Math.floor(SET_CHARS / MC_LINE_MAX)).toBe(2);
    // Apply demand only where the objective carries a worked example (P1c models before practice).
    expect(
      questions.filter((q) => q.demand === "apply").every((q) => q.objectiveRefs[0]?.index === 2),
    ).toBe(true);
    // A twelve-slide deck places more of them than a ten-slide deck, never fewer.
    const ten = demandFor(3, 10).demand.reduce((n, d) => n + d.slide + d.exit, 0);
    const twelve = demandFor(3, 12).demand.reduce((n, d) => n + d.slide + d.exit, 0);
    expect(twelve).toBeGreaterThanOrEqual(ten);
  });

  test("regression (pw w1-h-y7-ratio-W): the demand asks what the outline placed from the real questions, plus at most one spare a set", () => {
    // The saved run: Year 7 ratio, two objectives, ten slides, a retrieval starter. Its waves asked
    // 16 questions (5/3 an objective) and the outline placed 8 of them.
    const facts = ratio.facts as unknown as OutlineFacts;
    const base = {
      topic: ratio.topic,
      objectives: ratio.objectives,
      shape: ratio.shape as unknown as LessonShape,
      slideCount: ratio.slideCount as 10,
      retrieval: ratio.retrieval ?? undefined,
    };
    const real = outlineFromFacts({ ...base, facts });
    const placedIndex = new Set(
      real.outlineFactRefs.flatMap((e) =>
        e.factRefs.flatMap((r) => (r.type === "question" ? [r.index] : [])),
      ),
    );
    const placed = ratio.objectives.map(() => ({ slide: 0, exit: 0 }));
    facts.questions.forEach((q, i) => {
      if (!placedIndex.has(i)) return;
      const o = q.objectiveRefs[0]?.index ?? 0;
      (placed[o] as { slide: number; exit: number })[q.use === "exit" ? "exit" : "slide"] += 1;
    });
    // What the real questions achieved: a set of three and two exit lines on objective 1, one
    // open-response slide and three exit lines on objective 2.
    expect(placed).toEqual([
      { slide: 3, exit: 2 },
      { slide: 1, exit: 3 },
    ]);
    // The demand from the count-only sketch, before any question existed.
    const { demand, counts } = questionDemand({
      ...base,
      facts: sketchTaught(ratio.objectives, [false, true]),
    });
    expect(demand).toEqual([
      { slide: 2, exit: 2 },
      { slide: 2, exit: 1 },
    ]);
    const asked = counts.reduce((n, c) => n + c.slide + c.exit, 0);
    const got = placed.reduce((n, c) => n + c.slide + c.exit, 0);
    const sets = counts.flatMap((c) => [c.slide, c.exit]).filter((n) => n > 0).length;
    // Asked ≈ placed + at most one spare a set (here 9 asked for 9 placed, over 4 sets).
    expect(asked).toBeLessThanOrEqual(got + sets);
    expect(asked).toBeGreaterThanOrEqual(got - 1);
    // Every slide set asked for is at least the two lines a check needs, plus the spare.
    for (const c of counts) if (c.slide > 0) expect(c.slide).toBeGreaterThanOrEqual(3);
  });
});
