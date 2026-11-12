import { describe, expect, test } from "bun:test";
import { proofChecks, workedRestates } from "./proof-checks";

/* v5.2-gold BUILDER B7: the proof's counts, logged only. Cases from the 11 Nov Year 5 run. */

const RESTATED = {
  template: "worked",
  heading: "Find 1/3 of 21.",
  lines: [
    { move: "Divide by the denominator.", eq: "21 ÷ 3 = 7", answer: false },
    { move: "State the fraction found.", eq: "1/3 of 21 = 7", answer: true },
  ],
};
const CLEAN = {
  template: "worked",
  heading: "Find 3/5 of 40.",
  lines: [
    { move: "Divide by the denominator.", eq: "40 ÷ 5 = 8", answer: false },
    { move: "Multiply by the numerator.", eq: "8 × 3 = 24", answer: true },
  ],
};

describe("workedRestates", () => {
  test("a closing row that restates the problem and the last result counts", () =>
    expect(workedRestates(RESTATED)).toBe(1));
  test("rows that each make a move do not", () => expect(workedRestates(CLEAN)).toBe(0));
  test("other slides count nothing", () =>
    expect(workedRestates({ template: "explain", lines: RESTATED.lines })).toBe(0));
});

describe("proofChecks", () => {
  test("flow against the range, restates over the deck, exit items against objectives", () => {
    const exit = { template: "exit-ticket", items: [{ question: "a" }, { question: "b" }] };
    expect(
      proofChecks(
        { flow: new Array(10).fill({}), slides: [RESTATED, CLEAN, RESTATED, exit] },
        { min: 10, max: 12 },
        3,
      ),
    ).toEqual({
      flowCount: { planned: 10, min: 10, max: 12 },
      workedRestate: 2,
      exitObjectives: { questions: 2, objectives: 3 },
    });
  });
  test("no exit ticket on the slides: null", () =>
    expect(proofChecks({ slides: [CLEAN] }, { min: 9, max: 12 }, 2).exitObjectives).toBeNull());
});
