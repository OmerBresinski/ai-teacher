import { describe, expect, test } from "bun:test";
import {
  askedOf,
  checkKey,
  checkNotesAnswers,
  checkWriterSlide,
  isMaths,
  solveLinear,
  statedValues,
} from "./answer-key";

describe("solveLinear", () => {
  test.each([
    ["3x + 5 = 20", 5],
    ["x/4 + 3 = 8", 20],
    ["2(x + 3) = 14", 4],
    ["5x − 4 = −24", -4],
    ["3 × x + 2 = 17", 5],
    ["x ÷ 2 − 1 = 0.5", 3],
    ["4x = 3", 0.75],
    ["2(x − 1) = 3(x + 2)", -8],
    ["0.5x + 1.2 = 2.7", 3],
    ["7 = 2y + 1", 3],
  ])("%s", (eq, value) => {
    expect(solveLinear(eq)?.value).toBeCloseTo(value, 9);
  });

  test.each([
    ["x² = 16"],
    ["x(x + 1) = 6"],
    ["2x + y = 7"],
    ["2(x + 1) = 2x + 2"],
    ["3/4x = 6"],
    ["x = 2 = 3"],
    ["3x + 5"],
    ["x / (x + 1) = 2"],
  ])("does not solve %s", (eq) => {
    expect(solveLinear(eq)).toBeUndefined();
  });
});

describe("askedOf", () => {
  test("a solve question", () => {
    expect(askedOf("Solve 5x + 4 = 24 and check by substitution.")).toEqual({
      kind: "solve",
      variable: "x",
      value: 4,
    });
  });
  test("an is-it-a-solution question", () => {
    expect(askedOf("Is x = 6 a solution to 3x + 2 = 17? Check.")).toEqual({
      kind: "is-solution",
      variable: "x",
      value: 6,
      holds: false,
    });
    expect(askedOf("Does x = −2 satisfy 3x + 10 = 4?")?.kind).toBe("is-solution");
    expect(askedOf("Does x = −2 satisfy 3x + 10 = 4?")).toMatchObject({ holds: true });
  });
  test.each([
    ["Sam solves 2x + 6 = 18 and gets x = 9. Check Sam’s answer."],
    ["Solve x² = 16."],
    ["Solve 2x + 3 > 7."],
    ["Solve 3x + 5 = 20 and 2x = 8."],
    ["Solve 3 = x²"],
    ["What is 3 × 4?"],
    ["Solve the puzzle."],
  ])("nothing it can answer: %s", (q) => {
    // Two solve cues in one question count only when exactly one can be read.
    const a = askedOf(q);
    if (q.includes("and 2x")) expect(a).toEqual({ kind: "solve", variable: "x", value: 5 });
    else expect(a).toBeUndefined();
  });
});

describe("statedValues", () => {
  test("chains, bare numbers, fractions, unicode minus", () => {
    expect(statedValues("x = 4; check: 5 × 4 + 4 = 24.", "x").map((s) => s.value)).toEqual([4]);
    expect(statedValues("x = 18 ÷ 3 = 6", "x").map((s) => s.value)).toEqual([6, 6]);
    expect(statedValues("−2", "x").map((s) => s.value)).toEqual([-2]);
    expect(statedValues("x = 5/2", "x").map((s) => s.value)).toEqual([2.5]);
    expect(statedValues("x = −2", "x").map((s) => s.value)).toEqual([-2]);
    expect(statedValues("2x = 12", "x")).toEqual([]);
    expect(statedValues("x = 3¾", "x")).toEqual([]);
  });
});

describe("checkKey", () => {
  const realQ = "Is x = 6 a solution to 3x + 2 = 17? Check.";
  const realA =
    "Yes. Substitution gives 3 × 6 + 2 = 20, which is not 17; so x = 6 is not a solution.";

  test("the Y9 equations key: yes means no, so the word is fixed", () => {
    expect(checkKey(realQ, realA)).toEqual([
      {
        kind: "yes-no",
        fixed:
          "No. Substitution gives 3 × 6 + 2 = 20, which is not 17; so x = 6 is not a solution.",
      },
    ]);
  });

  test("a right yes/no key is untouched", () => {
    expect(checkKey(realQ, "False: 20 ≠ 17", "3 × 6 + 2 = 20")).toEqual([]);
    expect(checkKey(realQ, "No. 3 × 6 + 2 = 20, not 17.")).toEqual([]);
    expect(checkKey("Is x = 5 a solution to 3x + 2 = 17?", "Yes: 3 × 5 + 2 = 17.")).toEqual([]);
  });

  test("a wrong yes with no reasoning is flagged, not rewritten", () => {
    expect(checkKey(realQ, "Yes, x = 6 works.")).toEqual([{ kind: "yes-no" }]);
  });

  test("a wrong no whose reasoning says it works is fixed", () => {
    expect(
      checkKey(
        "Is x = 5 a solution to 3x + 2 = 17?",
        "No. 3 × 5 + 2 = 17, so x = 5 is a solution.",
      ),
    ).toEqual([{ kind: "yes-no", fixed: "Yes. 3 × 5 + 2 = 17, so x = 5 is a solution." }]);
  });

  test("a wrong yes/no with wrong arithmetic is flagged only", () => {
    const c = checkKey(realQ, "Yes. 3 × 6 + 2 = 17, so it is not … wait");
    expect(c.map((x) => x.kind)).toEqual(["yes-no", "arithmetic"]);
    expect(c[0]?.fixed).toBeUndefined();
  });

  test("a wrong solved value is flagged", () => {
    expect(checkKey("Solve 3x + 5 = 20.", "x = 6")).toEqual([{ kind: "solution" }]);
    expect(checkKey("Solve x/4 + 3 = 8", "x = 5")).toEqual([{ kind: "solution" }]);
    expect(checkKey("Solve 2(x + 3) = 14.", "x = 5.5")).toEqual([{ kind: "solution" }]);
  });

  test("right solved values pass: fractions, negatives, brackets, decimals, rounding", () => {
    expect(checkKey("Solve 3x + 5 = 20.", "x = 5")).toEqual([]);
    expect(checkKey("Solve x/4 + 3 = 8", "x = 20")).toEqual([]);
    expect(checkKey("Solve 2(x + 3) = 14.", "x = 4")).toEqual([]);
    expect(checkKey("Solve 4x = 3.", "x = 3/4")).toEqual([]);
    expect(checkKey("Solve 4x = 3.", "x = 0.75")).toEqual([]);
    expect(checkKey("Solve 3x = 10.", "x = 3.33 (to 2 d.p.)")).toEqual([]);
    expect(checkKey("Solve 3x = 10.", "x ≈ 3")).toEqual([]);
    expect(checkKey("Solve 5x + 4 = −6", "x = −2")).toEqual([]);
    expect(checkKey("Solve 5x + 4 = -6", "−2")).toEqual([]);
    expect(checkKey("Solve 0.5x + 1.2 = 2.7", "x = 3")).toEqual([]);
  });

  test("a key that states no value is not judged", () => {
    expect(checkKey("Solve 3x + 5 = 20.", "Subtract 5, then divide by 3.")).toEqual([]);
  });

  test("an error-spotting key passes when it names the true value", () => {
    expect(
      checkKey(
        "Sam solves 2x + 6 = 18 and gets x = 9. Check Sam’s answer.",
        "Sam’s answer is incorrect: 2 × 9 + 6 = 24, not 18. The correct solution is x = 6.",
      ),
    ).toEqual([]);
  });

  test("wrong arithmetic in a key or its working is flagged", () => {
    expect(checkKey("Solve 5x + 4 = 24.", "x = 4", "24 − 4 = 20; 20 ÷ 5 = 5")).toEqual([
      { kind: "arithmetic" },
    ]);
    expect(checkKey("Work out 3 × 6 + 2.", "3 × 6 + 2 = 20")).toEqual([]);
    expect(checkKey("Work out 3 × 6 + 2.", "3 × 6 + 2 = 21")).toEqual([{ kind: "arithmetic" }]);
  });

  test("a ratio or a unit glued to a number is not read as a sum", () => {
    expect(checkKey("Simplify 3:4 compared with 6:8.", "3:4 = 6:8")).toEqual([]);
    expect(checkKey("Write £3.50 in pence.", "£3.50 = 350p")).toEqual([]);
    // Saved runs (sweep, 6 Nov): numeric-check reads the n in "3n" as newtons.
    expect(checkKey("Solve 3n + 5 = 26.", "n = 7", "3n = 26 − 5 = 21; n = 21 ÷ 3 = 7")).toEqual([]);
    expect(checkKey("Find 1/5 of 35.", "7", "1/5 of 35 = 7")).toEqual([]);
  });

  test("an error-spotting question's key may quote the wrong line", () => {
    expect(
      checkKey("Ali wrote 3 × 4 = 7. Find his mistake.", "He added: 3 × 4 = 7 is wrong."),
    ).toEqual([]);
  });

  test("non-maths text is left alone", () => {
    expect(checkKey("Why did the Romans build roads?", "To move armies quickly.")).toEqual([]);
    expect(isMaths("History")).toBe(false);
    expect(isMaths("Maths")).toBe(true);
    expect(isMaths("Mathematics")).toBe(true);
  });
});

describe("checkWriterSlide", () => {
  test("the Y9 practice slide's own keys are right", () => {
    expect(
      checkWriterSlide({
        template: "practice",
        items: [
          {
            question: "Solve 5x + 4 = 24 and check by substitution.",
            answer: "x = 4",
            working: "24 − 4 = 20; 20 ÷ 5 = 4; 5 × 4 + 4 = 24",
          },
          {
            question: "Solve x/3 + 2 = 7 and check by substitution.",
            answer: "x = 15",
            working: "7 − 2 = 5; 5 × 3 = 15; 15 ÷ 3 + 2 = 7",
          },
          {
            question: "Is x = 6 a solution to 3x + 2 = 17? Check.",
            answer: "False: 20 ≠ 17",
            working: "3 × 6 + 2 = 20",
          },
        ],
      }),
    ).toEqual([]);
  });

  test("a practice item with a wrong key", () => {
    expect(
      checkWriterSlide({
        template: "exit-ticket",
        items: [{ question: "Solve 3x − 4 = 11.", answer: "x = 7" }],
      }),
    ).toEqual([{ kind: "solution", where: "item", index: 0 }]);
  });

  test("worked rows keep the equation's solution", () => {
    const worked = (eqs: string[], check?: string) => ({
      template: "worked",
      heading: "Solve 3x + 5 = 20",
      lines: eqs.map((eq, i) => ({ move: "", eq, answer: i === eqs.length - 1 })),
      ...(check ? { check } : {}),
    });
    expect(checkWriterSlide(worked(["3x = 15", "x = 5"], "3 × 5 + 5 = 20"))).toEqual([]);
    expect(checkWriterSlide(worked(["3x = 25", "x = 5"]))).toEqual([
      { kind: "step", where: "worked", index: 0 },
    ]);
    expect(checkWriterSlide(worked(["3x = 15", "x = 5"], "3 × 5 + 5 = 21"))).toEqual([
      { kind: "arithmetic", where: "worked" },
    ]);
  });

  test("a hinge whose correct option is not the solution", () => {
    const hinge = (correct: number) => ({
      template: "hinge",
      heading: "Solve 2x + 3 = 11",
      options: [{ text: "x = 4" }, { text: "x = 7" }, { text: "x = 5.5" }],
      correct,
    });
    expect(checkWriterSlide(hinge(1))).toEqual([]);
    expect(checkWriterSlide(hinge(2))).toEqual([{ kind: "solution", where: "hinge", index: 1 }]);
    // Options that are steps, not values, are not judged.
    expect(
      checkWriterSlide({
        template: "hinge",
        heading: "What is the first step to solve 4x + 7 = 19?",
        options: [{ text: "Subtract 7 from both sides." }, { text: "Divide both sides by 4." }],
        correct: 2,
      }),
    ).toEqual([]);
  });
});

describe("saved-run catches (sweep, 6 Nov)", () => {
  test.each([
    [
      "Is x = 4 a solution to x/2 + 1 = 4? Show your substitution.",
      "Yes. Substitute 4: 4/2 + 1 = 2 + 1 = 3, not 4. No; the left-hand side is 3 and the right-hand side is 4.",
      "No.",
    ],
    [
      "Is x = 6 a solution of 3x + 2 = 20? Show your check by substitution.",
      "No. Substituting 6 gives 3 × 6 + 2 = 20, which equals the right side. So x = 6 is a solution.",
      "Yes.",
    ],
    [
      "Is x = −2 a solution of 2x + 3 = −3?",
      "Yes. 2 × (−2) + 3 = −1, which is not −3, so no.",
      "No.",
    ],
  ])("%s is fixed", (q, a, lead) => {
    const [c, ...rest] = checkKey(q, a);
    expect(rest).toEqual([]);
    expect(c?.fixed?.startsWith(lead)).toBe(true);
  });

  test.each([
    [
      "Is x = −1 a solution to 4x + 7 = 3?",
      "No. Substituting x = 3 gives 3 × 3 + 2 = 11, and 11 ≠ 8.",
    ],
    [
      "Is x = 3/2 a solution of 6x − 4 = 5? Show your substitution.",
      "No. Substitute 3/2: 6 × 3/2 − 4 = 9 − 4 = 5, not 5? Both sides are 5, so yes, x = 3/2 is a solution.",
    ],
  ])("%s is flagged, not rewritten", (q, a) => {
    expect(checkKey(q, a)).toEqual([{ kind: "yes-no" }]);
  });

  test("wrong solved values", () => {
    expect(checkKey("Solve x/3 + 4 = 10.", "x = 15.")).toEqual([{ kind: "solution" }]);
    expect(
      checkKey(
        "Solve x ÷ (−2) + 5 = 1 and check your answer by substitution.",
        "x = −8; check: (−8) ÷ (−2) + 5 = 1.",
      ),
    ).toEqual([{ kind: "solution" }, { kind: "arithmetic" }]);
  });
});

describe("checkNotesAnswers", () => {
  test("the Y9 notes: answer 3 caught, 1 and 2 untouched", () => {
    expect(
      checkNotesAnswers(
        [
          "Solve 5x + 4 = 24 and check by substitution.",
          "Solve x/3 + 2 = 7 and check by substitution.",
          "Is x = 6 a solution to 3x + 2 = 17? Check.",
        ],
        [
          "x = 4; check: 5 × 4 + 4 = 24.",
          "x = 15; check: 15/3 + 2 = 7.",
          "Yes. Substitution gives 3 × 6 + 2 = 20, which is not 17; so x = 6 is not a solution.",
        ],
      ),
    ).toEqual([
      {
        index: 2,
        catches: [
          {
            kind: "yes-no",
            fixed:
              "No. Substitution gives 3 × 6 + 2 = 20, which is not 17; so x = 6 is not a solution.",
          },
        ],
      },
    ]);
  });

  test("answers that do not line up with the questions are not read", () => {
    expect(checkNotesAnswers(["Solve 3x + 5 = 20."], ["x = 6", "x = 5"])).toEqual([]);
  });
});
