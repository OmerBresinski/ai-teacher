import { describe, expect, test } from "bun:test";
import romans from "../fixtures/objective-facts.y4-history-romans.json";
import { lessonShapeOf } from "../shapes";
import { EXIT_QUIZ_MAX, SET_MAX } from "./coded-slides";
import {
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
 * after each cycle that P8 tops up to `SET_MAX`, and an exit quiz of one to three lines per
 * objective. A change in the outline that moves them is a change in what the lesson asks, to be
 * read, not a broken test.
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
  test("two objectives at ten slides: a set of four on each, three exit lines each", () => {
    const { demand, counts, outline } = demandFor(2);
    expect(demand).toEqual([
      { slide: SET_MAX, exit: 3 },
      { slide: SET_MAX, exit: 3 },
    ]);
    expect(counts).toEqual([
      { slide: SET_MAX + SPARE.slide, exit: 3 + SPARE.exit },
      { slide: SET_MAX + SPARE.slide, exit: 3 + SPARE.exit },
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
      { slide: SET_MAX, exit: 2 },
      { slide: SET_MAX, exit: 2 },
      { slide: 0, exit: 2 },
    ]);
    // No call for a set of none; the spare rides on the slide sets only.
    expect(counts).toEqual([
      { slide: SET_MAX + 1, exit: 2 },
      { slide: SET_MAX + 1, exit: 2 },
      { slide: 0, exit: 2 },
    ]);
    const exitLines = demand.reduce((n, d) => n + d.exit, 0);
    expect(exitLines).toBeLessThanOrEqual(EXIT_QUIZ_MAX);
  });

  test("without a retrieval set the round-1 starter takes one easy question per objective, so the slide demand rises by one", () => {
    const { demand } = demandFor(3, 10, false);
    expect(demand.map((d) => d.slide)).toEqual([SET_MAX + 1, SET_MAX + 1, 1]);
  });

  test("the placeholders pass every filter: fewer than the offer are placed only where the deck has no room", () => {
    const objectives = objectivesOf(3);
    const questions = placeholderQuestions(sketchTaught(objectives, [false, false, true]), 3);
    expect(questions).toHaveLength(
      3 * (PLACEHOLDERS_PER_OBJECTIVE.slide + PLACEHOLDERS_PER_OBJECTIVE.exit),
    );
    for (const q of questions) {
      expect(q.forms).toEqual(["multiple-choice", "open-response"]);
      expect(q.distractors).toHaveLength(3);
      expect(q.keyIdeaRefs?.length).toBe(2);
      expect(q.stem.length).toBeLessThan(60);
    }
    // Apply demand only where the objective carries a worked example (P1c models before practice).
    expect(
      questions.filter((q) => q.demand === "apply").every((q) => q.objectiveRefs[0]?.index === 2),
    ).toBe(true);
    // A twelve-slide deck places more of them than a ten-slide deck, never fewer.
    const ten = demandFor(3, 10).demand.reduce((n, d) => n + d.slide + d.exit, 0);
    const sixteen = demandFor(3, 12).demand.reduce((n, d) => n + d.slide + d.exit, 0);
    expect(sixteen).toBeGreaterThanOrEqual(ten);
  });
});
