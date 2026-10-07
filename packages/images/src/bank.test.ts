import { describe, expect, test } from "bun:test";
import { parseStorageKey } from "@tj/domain";
import {
  BANK_HIT_THRESHOLD,
  BANK_MISS_THRESHOLD,
  bankCard,
  bankStorageKey,
  bankSubject,
  bankZone,
  cosine,
  numbersAgree,
  numbersIn,
} from "./bank";

describe("picture library helpers", () => {
  test("the library key is a valid storage key outside any real Workspace", () => {
    const key = bankStorageKey("abc", "jpg");
    expect(key).toBe("00000000-0000-4000-8000-00000000ba4c/bank/abc.jpg");
    expect(parseStorageKey(key).ok).toBe(true);
  });

  test("the subject tag is the normalised query", () => {
    expect(bankSubject("  Ice  Cubes MELTING ")).toBe(bankSubject("ice cubes melting"));
  });

  test("the card is the subject, then the mustShow items", () => {
    expect(bankCard({ subject: " frog  on a lily pad", mustShow: ["frog", " lily pad "] })).toBe(
      "frog on a lily pad: frog, lily pad",
    );
    expect(bankCard({ subject: "volcano", mustShow: [] })).toBe("volcano");
  });

  test("zones follow the calibrated thresholds", () => {
    expect(BANK_HIT_THRESHOLD).toBe(0.76);
    expect(BANK_MISS_THRESHOLD).toBe(0.65);
    expect(bankZone(0.76)).toBe("hit");
    expect(bankZone(0.759)).toBe("grey");
    expect(bankZone(0.65)).toBe("grey");
    expect(bankZone(0.649)).toBe("miss");
  });

  test("numbers in digits and words must agree", () => {
    expect(numbersIn("Twenty-four counters in four groups of six")).toEqual([4, 6, 24]);
    expect(
      numbersAgree("24 counters, 4 groups of 6", "twenty-four counters in four groups of six"),
    ).toBe(true);
    expect(numbersAgree("three apples", "five apples")).toBe(false);
    expect(numbersAgree("frog", "a frog")).toBe(true);
  });

  test("cosine", () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 0])).toBe(0);
  });
});
