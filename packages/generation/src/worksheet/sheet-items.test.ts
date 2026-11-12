import { describe, expect, test } from "bun:test";
import { explainsAMethod, workingFault, workingResult } from "./sheet-items";

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
    // Not an explain command: still a calculation.
    expect(explainsAMethod("What is 3/4 of 12 metres?", "Divide by 4, multiply by 3.")).toBe(false);
  });
});
