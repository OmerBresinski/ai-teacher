import { describe, expect, test } from "bun:test";
import type { FigureRef, LessonFacts } from "@tj/domain/documents";
import {
  FIGURE_MESSAGE,
  figureAnswerMismatches,
  figureFindings,
  figureUnknownValue,
  statedNumber,
} from "./figure-check";
import { assignFactIds } from "./specs";
import { FIXTURES } from "./testing";

/* The figure check (TEACH-253, ADR 0034 decision 6). */

/** Legs 5 and 12, the hypotenuse unknown: the figure gives 13. */
const LEGS: FigureRef = {
  template: "triangle",
  values: {
    sides: { a: { value: 5, label: "5 cm" }, b: { value: 12, label: "12 cm" }, c: { label: "x" } },
    rightAngleAt: "C",
    unknown: "c",
  },
};

/** The fixture facts with the first question carrying `figure` and answering `answer`. */
const withQuestion = (answer: string, figure: FigureRef = LEGS): LessonFacts => {
  const facts = assignFactIds(FIXTURES.planSkeleton, FIXTURES.planFacts, 60);
  return {
    ...facts,
    questions: facts.questions.map((q, i) => (i === 0 ? { ...q, answer, figure } : q)),
  };
};

describe("statedNumber", () => {
  test.each([
    ["x = 5 cm", 5, 0],
    ["5 cm", 5, 0],
    ["3² + 4² = 25, so c = 5", 5, 0],
    ["The hypotenuse is 13.0 cm.", 13, 1],
    ["θ = 36.87°", 36.87, 2],
    ["40°", 40, 0],
    ["x ≈ 7.2 cm", 7.2, 1],
  ])("%p states %p", (answer, value, decimals) => {
    expect(statedNumber(answer)).toEqual({ value, decimals });
  });

  test.each(["about thirteen", "x = 5√3 cm", "c = 12/5", "x = √169", "c = x", "1,200 m"])(
    "%p states no number the check trusts",
    (answer) => {
      expect(statedNumber(answer)).toBeUndefined();
    },
  );
});

describe("figureAnswerMismatches", () => {
  test("TEACH-253 row 6: 13 cm agrees; 12 cm is one warning; 13.0 cm agrees; about thirteen is not checked", () => {
    expect(figureUnknownValue(LEGS)).toBeCloseTo(13, 9);
    expect(figureFindings(withQuestion("13 cm"))).toEqual([]);
    const wrong = withQuestion("12 cm");
    const id = wrong.questions[0]?.id ?? "";
    expect(figureFindings(wrong)).toEqual([
      {
        check: "fact-verify",
        severity: "warning",
        target: { factId: id },
        message: FIGURE_MESSAGE,
        evidence: "The answer states 12; the figure gives 13.",
      },
    ]);
    expect(figureFindings(withQuestion("13.0 cm"))).toEqual([]);
    expect(figureFindings(withQuestion("about thirteen"))).toEqual([]);
  });

  test("the rounding the stated number shows: 13.6 and 14 agree with 13.556, 13.5 does not", () => {
    // Legs 5 and 12.6: the hypotenuse is 13.556.
    const legs = {
      ...LEGS,
      values: { ...LEGS.values, sides: { a: { value: 5 }, b: { value: 12.6 }, c: { label: "x" } } },
    };
    expect(figureUnknownValue(legs)).toBeCloseTo(13.556, 3);
    expect(figureAnswerMismatches(withQuestion("x = 13.6 cm", legs))).toEqual([]);
    expect(figureAnswerMismatches(withQuestion("x = 14 cm", legs))).toEqual([]);
    expect(figureAnswerMismatches(withQuestion("x = 13.5 cm", legs))).toHaveLength(1);
  });

  test("an angle unknown keeps degrees; a worked example is checked like a question", () => {
    const angle: FigureRef = {
      template: "triangle",
      values: {
        angles: { A: { value: 50 }, B: { value: 60 }, C: { label: "θ" } },
        sides: { c: { value: 7 } },
        unknown: "C",
      },
    };
    const facts = assignFactIds(FIXTURES.planSkeleton, FIXTURES.planFacts, 60);
    const worked = {
      ...facts,
      workedExamples: facts.workedExamples.map((x) => ({ ...x, answer: "θ = 70°", figure: angle })),
    };
    expect(figureAnswerMismatches(worked)).toEqual([]);
    const off = {
      ...worked,
      workedExamples: worked.workedExamples.map((x) => ({ ...x, answer: "θ = 80°" })),
    };
    expect(figureAnswerMismatches(off)).toEqual([
      { factId: off.workedExamples[0]?.id ?? "", stated: 80, computed: expect.closeTo(70, 9) },
    ]);
  });

  test("not checked: no unknown named, a right triangle with all three lengths, values of the wrong shape, a template with no solver", () => {
    const { unknown: _u, ...noUnknown } = LEGS.values;
    expect(figureAnswerMismatches(withQuestion("99 cm", { ...LEGS, values: noUnknown }))).toEqual(
      [],
    );
    const allThree: FigureRef = {
      template: "right-triangle",
      values: {
        base: { length: 5, label: "5 cm" },
        height: { length: 12, label: "12 cm" },
        hypotenuse: { length: 13, label: "13 cm" },
      },
    };
    expect(figureUnknownValue(allThree)).toBeUndefined();
    expect(figureAnswerMismatches(withQuestion("99 cm", allThree))).toEqual([]);
    const broken: FigureRef = { template: "triangle", values: { sides: "three" } };
    expect(figureAnswerMismatches(withQuestion("99 cm", broken))).toEqual([]);
    const profile: FigureRef = {
      template: "energy-profile",
      values: { reactants: "A", products: "B", activationEnergy: 50, energyChange: -20 },
    };
    expect(figureAnswerMismatches(withQuestion("99 kJ", profile))).toEqual([]);
  });

  test("a right triangle with the side to find labelled and no length is checked", () => {
    const find: FigureRef = {
      template: "right-triangle",
      values: {
        base: { length: 6, label: "6 cm" },
        height: { length: 8, label: "8 cm" },
        hypotenuse: { label: "x" },
      },
    };
    expect(figureUnknownValue(find)).toBeCloseTo(10, 9);
    expect(figureAnswerMismatches(withQuestion("x = 10 cm", find))).toEqual([]);
    expect(figureAnswerMismatches(withQuestion("x = 14 cm", find))).toHaveLength(1);
  });

  test("the message carries no numbers and no model text (ADR 0015)", () => {
    expect(FIGURE_MESSAGE).not.toMatch(/\d/);
  });
});
