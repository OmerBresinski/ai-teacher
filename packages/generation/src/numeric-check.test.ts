import { describe, expect, test } from "bun:test";
import { LessonFactsSchema } from "@tj/domain/documents";
import { numericFactMismatches, numericFindings, numericMismatches } from "./numeric-check";
import { assignFactIds } from "./specs";
import { FIXTURES } from "./testing";

describe("numericMismatches", () => {
  test("the w0 trig-2 lab answer is flagged: sin 40° is 0.643, not 6 ÷ 10", () => {
    const [m, ...rest] = numericMismatches("Use sine: sin(40°) = 6 cm ÷ 10 cm.");
    expect(rest).toEqual([]);
    expect(m?.text).toBe("sin(40°) = 6 cm ÷ 10 cm");
    expect(m?.left).toBeCloseTo(0.6428, 4);
    expect(m?.right).toBeCloseTo(0.6, 6);
  });

  test.each([
    "3 × 4 = 12",
    "3 x 4 = 12",
    "sin(40°) = 0.643",
    "sin 40° ≈ 0.64",
    "tan(35°) = 0.7",
    "12 × 0.423 = 5.07 cm",
    "Opposite = 10 × sin(40°) = 6.4 cm",
    "h = 8 cm ÷ sin(35°) = 13.9 cm",
    "150 cm = 1.5 m",
    "2.5 m = 250 cm",
    "5 kg = 5000 g",
    "1 h = 60 min",
    "50% = 0.5",
    "sin⁻¹(0.5) = 30°",
    "√16 = 4",
    "4² = 16",
    "1,200 ÷ 4 = 300",
    "Area = 3 cm × 4 cm = 12 cm²",
  ])("correct: %s", (text) => {
    expect(numericMismatches(text)).toEqual([]);
  });

  test.each([
    ["3 × 4 = 13", "3 × 4 = 13"],
    ["150 cm = 15 m", "150 cm = 15 m"],
    ["It is 3 x 4 = 12 and 7 - 2 = 6.", "7 - 2 = 6"],
    ["cos(60°) = 0.6", "cos(60°) = 0.6"],
    ["sin(40°) = 6 ÷ 10 ≈ 0.6", "sin(40°) = 6 ÷ 10"],
  ])("wrong: %s", (text, flagged) => {
    expect(numericMismatches(text).map((m) => m.text)).toEqual([flagged]);
  });

  test.each([
    "sin(25°) = opposite side ÷ 12 cm",
    "x = 5 cm",
    "a + 2 × 3 = 7",
    "x² = 16, so x = 4",
    "£3 × 4 = £13",
    "Year 10: 2 = 3",
  ])("not plain arithmetic on both sides, so not judged: %s", (text) => {
    expect(numericMismatches(text)).toEqual([]);
  });
});

describe("numericFactMismatches / numericFindings", () => {
  const trig = () => {
    const facts = assignFactIds(FIXTURES.planSkeleton, FIXTURES.planFacts, 60);
    const q = facts.questions[0];
    const x = facts.workedExamples[0];
    if (!q || !x) throw new Error("fixture has no question or worked example");
    // The w0 trig-2 lab facts: q5's answer and x1's steps.
    q.answer = "Use sine: sin(40°) = 6 cm ÷ 10 cm.";
    q.stem = "True or false: sin(40°) = 6 ÷ 10?";
    q.distractors = [{ text: "sin(40°) = 7 ÷ 10" }];
    x.steps = ["Write sin(35°) = 8 cm ÷ h.", "Rearrange: h = 8 cm ÷ sin(35°).", "h = 13.9 cm."];
    return LessonFactsSchema.parse(facts);
  };

  test("an answer is checked; a stem and a distractor, which may be wrong on purpose, are not", () => {
    const facts = trig();
    const found = numericFactMismatches(facts);
    expect(found.map((m) => [m.factId, m.field])).toEqual([
      [facts.questions[0]?.id ?? "", "answer"],
    ]);
  });

  test("the finding is a content-free fact-verify warning on the fact, the equality as evidence", () => {
    const facts = trig();
    expect(numericFindings(facts)).toEqual([
      {
        check: "fact-verify",
        severity: "warning",
        target: { factId: facts.questions[0]?.id ?? "" },
        message: "A calculation in this fact does not work out: its two sides differ.",
        evidence: "sin(40°) = 6 cm ÷ 10 cm",
      },
    ]);
  });

  test("the fixture facts are clean", () => {
    expect(numericFindings(assignFactIds(FIXTURES.planSkeleton, FIXTURES.planFacts, 60))).toEqual(
      [],
    );
  });
});
