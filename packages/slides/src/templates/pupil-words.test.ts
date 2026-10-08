import { describe, expect, test } from "bun:test";
import { pupilWordLimit } from "./pupil-words";

describe("pupilWordLimit", () => {
  test("is the objectives slide's measured room ÷ 6 (lab round 4: y1 is not 8 words)", () => {
    expect(pupilWordLimit("ks1", 2)).toBe(20); // 124 chars
    expect(pupilWordLimit("ks1", 3)).toBe(8); // 48
    expect(pupilWordLimit("ks2", 3)).toBe(16); // 100
    expect(pupilWordLimit("ks3", 2)).toBe(37); // 224
    expect(pupilWordLimit("ks5", 4)).toBe(10); // 64
    expect(pupilWordLimit("ks1", 3)).toBeLessThan(pupilWordLimit("ks1", 2));
  });
  test("throws on a count the catalogue does not measure", () => {
    expect(() => pupilWordLimit("ks2", 7)).toThrow(
      "no objectives capacity for 7 objectives at KS2",
    );
  });
});
