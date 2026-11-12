import { describe, expect, test } from "bun:test";
import { lessonDigest } from "@tj/slides/worksheet/digest";
import { fixtureLesson } from "@tj/slides/worksheet/fixtures";
import { numericMismatches } from "../numeric-check";
import {
  askedSumFault,
  explainsAMethod,
  isCalculation,
  keyFault,
  type PracticeItem,
  practiceFaults,
  workingFault,
  workingResult,
} from "./sheet-items";

/*
 * R4 (round 3, y5 practice sheet): "the working ends in = and its result" needed a digit straight
 * after "=", so a money or fraction result ("= £3.20", "= 1 1/4 m") was dropped as having none.
 */
describe("the working's result may be money, negative or a fraction", () => {
  test("a currency sign after = is a result", () => {
    expect(workingFault("q", "£8 ÷ 5 = £1.60; £1.60 × 2 = £3.20", "£3.20")).toBeNull();
    expect(workingFault("q", "$12 ÷ 4 = $3", "$3")).toBeNull();
    expect(workingFault("q", "£8 ÷ 5 × 2 = £3.20", "£3.40")).toContain("does not match");
  });
  test("a minus before or after the currency sign is a result", () => {
    // The result rule reads the signed result; the separate sum checker (numericMismatches) is
    // not part of this fix and may still query a subtraction below zero.
    for (const [w, k] of [
      ["3 − 7 = −4", "−4"],
      ["2 - 5 = -3 °C", "-3 °C"],
      ["£2 − £5 = −£3", "−£3"],
      ["owes £5, pays £2: balance = £-3", "£-3"],
    ] as const) {
      expect(workingFault("q", w, k) ?? "").not.toContain("does not end");
      expect(workingFault("q", w, k) ?? "").not.toContain("does not match");
      expect(workingResult(w)).toBe(-Number(k.replace(/[^\d.]/g, "")));
    }
    expect(workingFault("q", "3 − 7 = −4", "4")).toContain("does not match");
  });
  test("a mixed number or fraction is a result, compared by value", () => {
    expect(workingFault("q", "5 ÷ 4 = 1 1/4 m", "1 1/4 m")).toBeNull();
    expect(workingFault("q", "3 ÷ 4 = 3/4", "3/4")).toBeNull();
    expect(workingFault("q", "14 ÷ 4 × 3 = 10½ m", "10½ m")).toBeNull();
    expect(workingFault("q", "3 ÷ 4 = ¾", "¾")).toBeNull();
    expect(workingFault("q", "6 ÷ 4 = 1 1/2", "1.5")).toBeNull();
    // 3/4 is not 3: a fraction is never read as its numerator.
    expect(workingFault("q", "3 ÷ 4 = 3/4", "3")).toContain("does not match");
    expect(workingFault("q", "5 ÷ 4 = 1 1/4 m", "1 1/2 m")).toContain("does not match");
  });
  test("a working with no result is still refused", () => {
    expect(workingFault("q", "84 ÷ 28", "3")).toContain("does not end");
    expect(workingFault("q", "£8 ÷ 5 × 2 =", "£3.20")).toContain("does not end");
    expect(workingFault("q", "28 + 7 = thirty-five", "35")).toContain("does not end");
  });
  test("workingResult reads the same forms", () => {
    expect(workingResult("£8 ÷ 5 × 2 = £3.20")).toBe(3.2);
    expect(workingResult("5 ÷ 4 = 1 1/4 m")).toBe(1.25);
    expect(workingResult("3 − 7 = −4")).toBe(-4);
    expect(workingResult("84 ÷ 28")).toBeNull();
  });
});

/*
 * y5 fractions diag (12 Nov, live rounds ws-diag1..3): every dropped item was correct maths; the
 * checks were wrong. These are the real model items, verbatim.
 */
describe("y5 fractions: correct items the checks dropped", () => {
  test("a working through pence (£9 = 900p) holds", () => {
    expect(
      workingFault(
        "A ribbon costs £9. Find 4/5 of its cost. Give your answer in pounds.",
        "£9 = 900p; 900p ÷ 5 = 180p; 180p × 4 = 720p; 720p = 7.20 pounds",
        "7.20 pounds",
      ),
    ).toBeNull();
    expect(
      workingFault(
        "A school bag costs £12. Find 6/5 of its price. Give your answer in pounds.",
        "£12 = 1200p; 1200p ÷ 5 = 240p; 240p × 6 = 1440p; 1440p = £14.40",
        "£14.40",
      ),
    ).toBeNull();
    expect(
      workingFault(
        "A book costs £9. What is 2/5 of its cost? Give your answer in pounds.",
        "£9 = 900p; 900p ÷ 5 = 180p; 180p × 2 = 360p = 3.60 pounds",
        "3.60 pounds",
      ),
    ).toBeNull();
  });
  test("a wrong pence sum is still caught", () => {
    expect(
      workingFault("q", "£9 = 900p; 900p ÷ 5 = 170p; 170p × 4 = 680p = 6.80 pounds", "6.80 pounds"),
    ).not.toBeNull();
    expect(workingFault("q", "£12 = 1000p; 1000p ÷ 5 = 200p", "200p")).not.toBeNull();
  });
  test("the key may lead with the question's own numbers before the result", () => {
    expect(
      workingFault(
        "A pupil says, “Six fifths of 25 must be less than 25 because it is a fraction.” Is the pupil right? Give the answer and explain why.",
        "25 ÷ 5 = 5; 5 × 6 = 30",
        "No. Six fifths of 25 is 30. Five fifths make one whole, and the sixth fifth takes the amount beyond the whole.",
      ),
    ).toBeNull();
    expect(
      workingFault(
        "A bag holds 30 counters. Which is greater: 6/5 of the counters in the bag, or the number of counters in the bag? Give the greater amount in counters.",
        "30 ÷ 5 = 6; 6 × 6 = 36",
        "6/5 of the counters in the bag is greater: 36 counters.",
      ),
    ).toBeNull();
  });
  test("a key whose first new number is not the result still fails", () => {
    expect(
      workingFault("Six fifths of 25?", "25 ÷ 5 = 5; 5 × 6 = 30", "No. Six fifths of 25 is 35."),
    ).toContain("does not match");
    // Every key number is the question's: the result must be one of them.
    expect(
      workingFault("Is 4/4 of 20 equal to 20?", "20 ÷ 4 = 5; 5 × 4 = 20", "Yes, 20."),
    ).toBeNull();
    expect(
      workingFault("Is 4/4 of 20 equal to 20?", "20 ÷ 4 = 5; 5 × 4 = 20", "No, 4/4."),
    ).toContain("does not match");
  });
  test("ws-fix2: quarters in the working and a key that names the fraction's parts first", () => {
    expect(
      workingFault(
        "A quantity is 28. Find 3/4 of 1¼ of the quantity. Give your answer.",
        "28 ÷ 4 = 7; 28 + 7 = 35; 35 ÷ 4 = 8¾; 8¾ × 3 = 26¼",
        "26¼",
      ),
    ).toBeNull();
    expect(workingFault("q", "35 ÷ 4 = 8¼; 8¼ × 3 = 24¾", "24¾")).not.toBeNull();
    expect(
      workingFault(
        "A pupil says, “To find 3/4 of 18 metres, I should multiply 18 by 3 first.” Is the pupil right? Explain the correct order and give the answer in metres.",
        "18 ÷ 4 = 4½; 4½ × 3 = 13½ m",
        "No. First divide 18 by 4 to find one quarter, then multiply by 3 to find three quarters. The answer is 13½ m.",
      ),
    ).toBeNull();
  });
  test("an explain item with no new number needs no working", () => {
    const q =
      "A pupil says, “To find 3/4 of 12 metres, I divide by 3 and then multiply by 4.” Is the pupil right? Explain the correct steps.";
    expect(
      explainsAMethod(
        q,
        "No. Divide 12 metres by 4 to find one quarter, then multiply that answer by 3 to find three quarters.",
      ),
    ).toBe(true);
    // A new number in the key is a result: it needs its working.
    expect(explainsAMethod(q, "No. Divide 12 by 4, then multiply by 3: 9 metres.")).toBe(false);
    // A method question whose fraction read as a sum (ws-diag2's first attempt, both warm-ups).
    expect(
      explainsAMethod(
        "When finding 6/5 of an amount, what does the denominator tell you to do first?",
        "Divide the amount into five equal parts.",
      ),
    ).toBe(true);
    // A calculate command, or a new number in the key: still a calculation that needs working.
    expect(explainsAMethod("Find 3/4 of 12 metres.", "Divide by 4, multiply by 3.")).toBe(false);
    expect(explainsAMethod("What is 3/4 of 12 metres?", "9 metres")).toBe(false);
  });
});

/* R4 review (12 Nov), finding A: wrong keys that passed as "rounded". */
describe("A: a key equals the working's result exactly unless rounding is asked", () => {
  test("a bare whole-number result is exact, not rounded", () => {
    expect(numericMismatches("20 ÷ 3 = 7", { exact: true })).toHaveLength(1);
    expect(numericMismatches("9 ÷ 2 = 4", { exact: true })).toHaveLength(1);
    expect(numericMismatches("5 × 1.5 = 8", { exact: true })).toHaveLength(1);
    expect(numericMismatches("9 ÷ 2 = 4.5", { exact: true })).toEqual([]);
    expect(numericMismatches("20 ÷ 3 = 6.67", { exact: true })).toEqual([]);
    // Slides and facts keep the old reading.
    expect(numericMismatches("20 ÷ 3 = 7")).toEqual([]);
  });
  test("a wrong rounded working fails; asked-for rounding passes", () => {
    expect(workingFault("Share 20 sweets between 3.", "20 ÷ 3 = 7", "7")).not.toBeNull();
    expect(workingFault("Halve 9.", "9 ÷ 2 = 4", "4")).not.toBeNull();
    expect(
      workingFault("Share 20 m between 3. Round to the nearest metre.", "20 ÷ 3 = 7 m", "7 m"),
    ).toBeNull();
  });
  test("the key is compared at the more decimal places of the two", () => {
    expect(workingFault("q", "18 ÷ 5 = 4", "3.6")).toContain("does not match");
    expect(workingFault("q", "33 ÷ 5 = 7", "6.6")).toContain("does not match");
    expect(workingFault("q", "16 ÷ 5 = 3.2", "3.20")).toBeNull();
    expect(workingFault("Give it to 1 decimal place.", "25 ÷ 7 = 3.57", "3.6")).toBeNull();
  });
  test("digit groups read as one number", () => {
    expect(workingFault("q", "4 × 2,500 = 10,000", "10,500")).toContain("does not match");
    expect(workingFault("q", "4 × 2,500 = 10,000", "10,000")).toBeNull();
    expect(
      workingFault(
        "A shop sells 12 boxes of 1,000 pins. How many pins?",
        "12 × 1,000 = 12,000",
        "12,000 pins",
      ),
    ).toBeNull();
    expect(workingResult("12 × 1,000 = 12,000")).toBe(12000);
  });
});

const digest = lessonDigest(fixtureLesson("rates"));
const year = (yearGroup: string) => ({
  digest: { ...digest, lesson: { ...digest.lesson, yearGroup } },
});
const slide = digest.taught[0]?.slide ?? 1;
const item = (question: string, answer: string, working: string | null = null): PracticeItem => ({
  slides: [slide],
  demand: "use",
  builds: "same-skill-new-numbers",
  question,
  method: [],
  working,
  answer,
});

/* Finding B: items with no working were never checked. */
describe("B: every calculation's key is checked, working or not", () => {
  test("a one-sum question is worked out, in symbols or words", () => {
    expect(askedSumFault("What is 3 + 4?", "8")).not.toBeNull();
    expect(askedSumFault("What is 3 + 4?", "7")).toBeNull();
    expect(askedSumFault("What is 7 times 8?", "54")).not.toBeNull();
    expect(askedSumFault("What is 7 times 8?", "56")).toBeNull();
    expect(askedSumFault("Work out 45 - 18.", "27")).toBeNull();
    expect(askedSumFault("What is 12 divided by 3?", "5")).not.toBeNull();
    expect(askedSumFault("What is 9 ÷ 2?", "4")).not.toBeNull();
    expect(askedSumFault("What is 9 ÷ 2?", "4.5")).toBeNull();
    // Not one sum: not judged here.
    expect(askedSumFault("What is 3/4 of 12 metres?", "10")).toBeNull();
  });
  test("Years 1-2: no working is asked, the key is still checked", () => {
    const y1 = year("Year 1");
    expect(practiceFaults(item("What is 3 + 4?", "8"), y1).join()).toContain("is not");
    expect(practiceFaults(item("What is 7 times 8?", "54"), y1).join()).toContain("is not");
    expect(practiceFaults(item("What is 3 + 4?", "7"), y1)).toEqual([]);
    expect(practiceFaults(item("What is 7 times 8?", "56"), y1)).toEqual([]);
    expect(practiceFaults(item("What is 7 times 8?", "7 × 8 = 54"), y1).length).toBeGreaterThan(0);
  });
  test("Years 3+: a worked item whose working computes the wrong sum is caught", () => {
    expect(
      practiceFaults(item("What is 7 × 8?", "63", "7 × 9 = 63"), year("Year 4")).join(),
    ).toContain("is not");
  });
  test("non-calculation items are not newly rejected", () => {
    const y1 = year("Year 1");
    expect(practiceFaults(item("Name an animal that lives in water.", "A fish"), y1)).toEqual([]);
    expect(keyFault("Which is bigger, 7 or 9?", "9")).toBeNull();
  });
});

/* Finding C: year ranges and scores read as sums. */
describe("C: year ranges and scores are not calculations", () => {
  test("history and sport text is not a sum", () => {
    expect(isCalculation("Between 1914-1918, which countries fought on the Western Front?")).toBe(
      false,
    );
    expect(isCalculation("What happened in Britain 1939 – 1945?")).toBe(false);
    expect(isCalculation("The team won 3-1. Who scored?")).toBe(false);
    expect(isCalculation("Which topics are in KS3-4 geography?")).toBe(false);
    expect(isCalculation("Find the capital of France on the map.")).toBe(false);
  });
  test("real sums still are", () => {
    expect(isCalculation("Work out 45 - 18.")).toBe(true);
    expect(isCalculation("What is 45 - 18?")).toBe(true);
    expect(isCalculation("What is 12 − 5?")).toBe(true);
    expect(isCalculation("What is 7 × 8?")).toBe(true);
    expect(isCalculation("What is 7 times 8?")).toBe(true);
    expect(isCalculation("Find 3/4 of 12.")).toBe(true);
    expect(isCalculation("What is 2000 - 1500?")).toBe(true);
  });
  test("a correct history item with a year and no working ships; a maths one without working does not", () => {
    const y8 = year("Year 8");
    expect(
      practiceFaults(
        item("The First World War lasted 1914-1918. In which year did it end?", "1918"),
        y8,
      ),
    ).toEqual([]);
    expect(
      practiceFaults(
        item(
          "Between 1914-1918, who was the British prime minister in 1917?",
          "David Lloyd George, from 1916",
        ),
        y8,
      ),
    ).toEqual([]);
    expect(practiceFaults(item("Work out 45 - 18.", "27"), y8)).toContain(
      "calculates but gives no working",
    );
  });
});
