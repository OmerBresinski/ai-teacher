import { describe, expect, test } from "bun:test";
import { allocate, CYCLE_MIN, FIRST_CYCLE_SLIDE, FIXED_SLIDES, weightOf } from "./cycles";

const lean = (l: string) => ({ lean: l }) as { lean: "explain" };

describe("allocate", () => {
  test("every deck from 6 to 15 slides with 1 to 4 objectives: exactly N, contiguous, no overrun", () => {
    const leans = ["explain", "worked-example", "photo", "list"];
    for (let n = 6; n <= 15; n++) {
      for (let k = 1; k <= 4; k++) {
        const arcs = leans.slice(0, k).map(lean);
        const a = allocate(n, arcs);
        const total = a.cycles.reduce((s, c) => s + c.count, 0);
        expect(total + FIXED_SLIDES).toBe(n);
        expect(a.exitSlide).toBe(n);
        let next = FIRST_CYCLE_SLIDE;
        for (const c of a.cycles) {
          expect(c.first).toBe(next);
          expect(c.slideCount).toBe(n);
          next += c.count;
        }
        // The last cycle slot is the slide before the exit ticket.
        expect(next).toBe(n);
        if (n - FIXED_SLIDES >= CYCLE_MIN * k) {
          expect(a.short).toEqual([]);
          for (const c of a.cycles) expect(c.count).toBeGreaterThanOrEqual(CYCLE_MIN);
        } else {
          expect(a.short.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("the free slots follow the arc's weight", () => {
    const a = allocate(14, [lean("explain"), lean("worked-example")]);
    expect(a.cycles.map((c) => c.count)).toEqual([4, 6]);
    expect(allocate(10, [undefined, undefined, undefined]).cycles.map((c) => c.count)).toEqual([
      2, 2, 2,
    ]);
  });

  test("a deck too small for the minimums gives one slot each, heaviest first", () => {
    const a = allocate(6, [lean("explain"), lean("sequence"), lean("photo")]);
    expect(a.cycles.map((c) => c.count)).toEqual([0, 1, 1]);
    expect(a.short).toEqual([0, 1, 2]);
    const b = allocate(9, [lean("explain"), lean("sequence"), lean("photo")]);
    expect(b.cycles.map((c) => c.count)).toEqual([1, 2, 2]);
    expect(b.short).toEqual([0]);
  });

  test("weights and the guard rails", () => {
    expect(weightOf(undefined)).toBe(1);
    expect(weightOf({ lean: "figure" })).toBe(1.5);
    expect(weightOf({ lean: "photo" })).toBe(1.25);
    expect(() => allocate(4, [undefined])).toThrow();
    expect(() => allocate(10, [])).toThrow();
  });

  test("roles per slot: a method objective with 2 slots is taught then practised", () => {
    const a = allocate(10, [lean("worked-example"), lean("photo"), lean("explain")]);
    expect(a.cycles.map((c) => c.count)).toEqual([2, 2, 2]);
    expect(a.cycles.map((c) => c.roles)).toEqual([
      ["teach", "practise"],
      ["show", "check"],
      ["teach", "check"],
    ]);
    const b = allocate(14, [lean("worked-example"), lean("explain")]);
    for (const c of b.cycles) expect(c.roles).toHaveLength(c.count);
    expect(b.cycles[0]?.roles.at(-1)).toBe("check");
  });
});
