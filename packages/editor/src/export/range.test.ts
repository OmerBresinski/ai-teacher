import { describe, expect, it } from "bun:test";
import { ALL_SLIDES, parseSlideRange, slideRangeParam } from "./range";

/*
 * TeachDeck `lib/export/__tests__/range.test.ts` restated (TEACH-110 row 11): the range grammar the
 * export dialog validates and the print route reads.
 */

const ok = (input: string, count = 7) => {
  const result = parseSlideRange(input, count);
  if (!result.ok) throw new Error(`expected "${input}" to parse, got: ${result.error}`);
  return result.indices;
};

const err = (input: string, count = 7) => {
  const result = parseSlideRange(input, count);
  if (result.ok) throw new Error(`expected "${input}" to fail, got: ${result.indices.join(",")}`);
  return result.error;
};

describe("parseSlideRange", () => {
  it("reads an empty field as every slide", () => {
    expect(ok("")).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(ok("   ")).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("reads 'All' in any case as every slide", () => {
    expect(ok(ALL_SLIDES)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(ok("all")).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(ok("  ALL  ")).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("reads a single slide number as one zero-based index", () => {
    expect(ok("3")).toEqual([2]);
    expect(ok("1")).toEqual([0]);
    expect(ok("7")).toEqual([6]);
  });

  it("reads the documented example", () => {
    expect(ok("1-3, 5")).toEqual([0, 1, 2, 4]);
  });

  it("ignores spaces anywhere, including around the dash", () => {
    expect(ok("  1 - 3 ,   5  ")).toEqual([0, 1, 2, 4]);
    expect(ok("1-3 5")).toEqual([0, 1, 2, 4]);
    expect(ok("2 , 4")).toEqual([1, 3]);
  });

  it("accepts an en dash or em dash as a span", () => {
    expect(ok("1–3")).toEqual([0, 1, 2]);
    expect(ok("1—3")).toEqual([0, 1, 2]);
  });

  it("reads a reversed span the same as a forward one", () => {
    expect(ok("5-3")).toEqual([2, 3, 4]);
    expect(ok("7-7")).toEqual([6]);
  });

  it("deduplicates and sorts overlapping parts", () => {
    expect(ok("3,1,3,2-3")).toEqual([0, 1, 2]);
    expect(ok("5, 1-2, 5, 2")).toEqual([0, 1, 4]);
  });

  it("tolerates empty parts from a stray or trailing comma", () => {
    expect(ok("1-3, 5,")).toEqual([0, 1, 2, 4]);
    expect(ok("1,,3")).toEqual([0, 2]);
    expect(ok(",")).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("refuses a slide past the end of the lesson, and says how many there are", () => {
    expect(err("9")).toBe("There is no slide 9. This lesson has 7 slides.");
    expect(err("5-9")).toBe("There is no slide 9. This lesson has 7 slides.");
    expect(err("1-3, 12")).toBe("There is no slide 12. This lesson has 7 slides.");
  });

  it("counts one slide in the singular", () => {
    expect(err("2", 1)).toBe("There is no slide 2. This lesson has 1 slide.");
    expect(ok("1", 1)).toEqual([0]);
  });

  it("refuses slide 0 and negative numbers", () => {
    expect(err("0")).toBe("Slides are numbered from 1.");
    expect(err("0-2")).toBe("Slides are numbered from 1.");
    expect(err("-2")).toBe("Use slide numbers like 1-3, 5.");
  });

  it("refuses anything that is not a number or a span", () => {
    expect(err("abc")).toBe("Use slide numbers like 1-3, 5.");
    expect(err("1-")).toBe("Use slide numbers like 1-3, 5.");
    expect(err("1-2-3")).toBe("Use slide numbers like 1-3, 5.");
    expect(err("1.5")).toBe("Use slide numbers like 1-3, 5.");
    expect(err("first three")).toBe("Use slide numbers like 1-3, 5.");
  });

  it("returns nothing for a lesson with no slides", () => {
    expect(ok("", 0)).toEqual([]);
    expect(err("1", 0)).toBe("There is no slide 1. This lesson has 0 slides.");
  });
});

describe("slideRangeParam", () => {
  it("drops 'all' so the print link stays short", () => {
    expect(slideRangeParam("")).toBeNull();
    expect(slideRangeParam("  ")).toBeNull();
    expect(slideRangeParam("All")).toBeNull();
    expect(slideRangeParam("all")).toBeNull();
  });

  it("passes a real range through, trimmed", () => {
    expect(slideRangeParam("  1-3, 5 ")).toBe("1-3, 5");
    expect(slideRangeParam("4")).toBe("4");
  });
});
