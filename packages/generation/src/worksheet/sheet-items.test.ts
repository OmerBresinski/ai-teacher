import { describe, expect, test } from "bun:test";
import { workingFault, workingResult } from "./sheet-items";

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
