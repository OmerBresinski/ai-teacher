import { describe, expect, test } from "bun:test";
import { allocateR6, fitBookends, maxObjectives, R6_CYCLE_MIN, r6RolesFor } from "./cycles";

describe("r6 allocation: the title is the only fixed slide", () => {
  test("max objectives = floor((N - 1 - bookends) / 3)", () => {
    expect(maxObjectives(10)).toBe(3);
    expect(maxObjectives(10, 1)).toBe(2);
    expect(maxObjectives(10, 2)).toBe(2);
    expect(maxObjectives(13, 0)).toBe(4);
    expect(maxObjectives(4, 2)).toBe(1);
  });

  test("10 slides, 3 objectives, no bookends: title then 3 cycles of 3, no starter or exit", () => {
    const a = allocateR6(10, [undefined, undefined, undefined], { objectivesOnTitle: true });
    expect(a.fixed).toBe(1);
    expect(a.cycles.map((c) => c.count)).toEqual([3, 3, 3]);
    expect(a.cycles.map((c) => c.first)).toEqual([2, 5, 8]);
    expect(a.exitSlide).toBe(0);
    expect(a.openingSlide).toBeUndefined();
    expect(a.short).toEqual([]);
    expect(a.cycles[0]?.roles).toEqual(["teach", "show", "check"]);
  });

  test("an opening and a closing take a slot each; the cycles sit between them", () => {
    const a = allocateR6(10, [undefined, undefined], {
      objectivesOnTitle: true,
      bookends: { opening: { kind: "hook" }, closing: { kind: "debate" } },
    });
    expect(a.openingSlide).toBe(2);
    expect(a.closingSlide).toBe(10);
    expect(a.cycles.map((c) => c.count)).toEqual([4, 3]);
    expect(a.cycles.map((c) => c.first)).toEqual([3, 7]);
    expect(a.cycles[0]?.roles).toEqual(["teach", "show", "practise", "check"]);
  });

  test("a bookend that would leave an objective under 3 slots is dropped, closing first", () => {
    const b = { opening: { kind: "retrieval" as const }, closing: { kind: "plenary" as const } };
    const fitted = fitBookends(10, 3, b);
    expect(fitted.dropped).toEqual(["closing", "opening"]);
    expect(fitBookends(11, 3, b).dropped).toEqual(["closing"]);
    const a = allocateR6(11, [undefined, undefined, undefined], {
      objectivesOnTitle: true,
      bookends: b,
    });
    expect(a.cycles.every((c) => c.count >= R6_CYCLE_MIN)).toBe(true);
    expect(a.dropped).toEqual(["closing"]);
  });

  test("objectives off the title: a second fixed slide", () => {
    const a = allocateR6(10, [undefined, undefined], { objectivesOnTitle: false });
    expect(a.fixed).toBe(2);
    expect(a.cycles[0]?.first).toBe(3);
    expect(a.cycles.reduce((n, c) => n + c.count, 0)).toBe(8);
  });

  test("roles: teach first, then show, check last; extra slots teach; a method's worked example is a teach slot", () => {
    expect(r6RolesFor(3)).toEqual(["teach", "show", "check"]);
    expect(r6RolesFor(5)).toEqual(["teach", "teach", "show", "practise", "check"]);
    expect(r6RolesFor(3, "worked-example")).toEqual(["teach", "teach", "check"]);
    expect(r6RolesFor(2)).toEqual(["teach", "check"]);
  });
});
