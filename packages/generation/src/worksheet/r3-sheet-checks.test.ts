import { describe, expect, test } from "bun:test";
import { fixNumberArticles, readsWithVowel } from "./articles";
import {
  challengeEasierThan,
  endsOnFraction,
  maskNumbers,
  nearDuplicates,
  workingSteps,
} from "./sheet-items";
import { inferLessonSubject, sheetSubject } from "./subject";

/* R3 (CRITIQUE-2, 12 Nov): code checks behind the Y5 Practice review findings. */
describe("a or an before a number", () => {
  test("numbers read with a vowel sound take an", () => {
    for (const n of ["8", "11", "18", "80", "84", "800", "8,000", "11,000", "18500", "8.5"])
      expect(readsWithVowel(n)).toBe(true);
    for (const n of ["1", "5", "10", "12", "100", "1,100", "110", "180", "1800", "19"])
      expect(readsWithVowel(n)).toBe(false);
  });
  test("the review's slip and its mirror are fixed; right ones stay", () => {
    expect(fixNumberArticles("A 11 m ribbon loses 2/5 of its length.")).toBe(
      "An 11 m ribbon loses 2/5 of its length.",
    );
    expect(fixNumberArticles("Cut a 8 cm strip and an 5 cm strip.")).toBe(
      "Cut an 8 cm strip and a 5 cm strip.",
    );
    expect(fixNumberArticles("an 18-sided shape, a 15 m rope, a 1,100 g bag")).toBe(
      "an 18-sided shape, a 15 m rope, a 1,100 g bag",
    );
    expect(fixNumberArticles("Banana 8 and data 11")).toBe("Banana 8 and data 11");
  });
});

describe("the same story with other numbers", () => {
  test("numbers are masked, fractions and mixed numbers included", () => {
    expect(maskNumbers("A 13 m ribbon loses 2/5. Then 1 m more?")).toEqual([
      "a",
      "qnum",
      "m",
      "ribbon",
      "loses",
      "qnum",
      "then",
      "qnum",
      "m",
      "more",
    ]);
  });
  test("the Y5 ribbon pair is caught; a different task and an exact repeat are not", () => {
    const qs = [
      "What is 3/4 of 12?",
      "A 11 m ribbon loses 2/5 of its length. Then 1 m more is cut off. How much remains?",
      "A 10 m length of string has 3/4 of its length used. How much remains?",
      "A 15 m ribbon loses 2/5 of its length. Then 2 m more is cut off. How much remains?",
      "What is 3/4 of 12?",
    ];
    expect(nearDuplicates(qs)).toEqual([[3, 1]]);
  });
});

describe("a challenge easier than the item before it", () => {
  const y5 = [
    { working: "12 ÷ 4 × 3 = 9" },
    { working: "11 − 11 ÷ 5 × 2 − 1 = 5 3/5 m" },
    { working: "15 − 15 ÷ 5 × 2 − 2 = 7 m" },
  ];
  test("steps and fraction endings are read from the working", () => {
    expect(workingSteps("11 − 11 ÷ 5 × 2 − 1 = 5 3/5 m")).toBe(4);
    expect(endsOnFraction("11 − 11 ÷ 5 × 2 − 1 = 5 3/5 m")).toBe(true);
    expect(endsOnFraction("15 − 15 ÷ 5 × 2 − 2 = 7 m")).toBe(false);
  });
  test("the review's Y5 challenge (same steps, whole answer after a fraction) is flagged", () => {
    expect(challengeEasierThan(y5)).toBe(1);
  });
  test("a harder challenge, or one with no working, is not", () => {
    expect(
      challengeEasierThan([...y5.slice(0, 2), { working: "15 − 15 ÷ 4 × 3 − 2 = 1 3/4 m" }]),
    ).toBeNull();
    expect(challengeEasierThan([...y5.slice(0, 2), { working: null }])).toBeNull();
    expect(
      challengeEasierThan([{ working: "2 + 3 + 4 = 9" }, { working: "5 × 3 + 1 + 2 = 18" }]),
    ).toBeNull();
  });
});

describe("sheet subject", () => {
  test("the stored subject passes; none stored and no inference yet means no subject", () => {
    expect(sheetSubject({ subject: "History" })).toBe("History");
    expect(sheetSubject({ subject: null, title: "The Great Fire of London" })).toBeUndefined();
    expect(inferLessonSubject({ title: "Photosynthesis" })).toBeUndefined();
  });
});
