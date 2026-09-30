import { describe, expect, test } from "bun:test";
import {
  allocate,
  CYCLE_MIN,
  FIRST_CYCLE_SLIDE,
  FIXED_SLIDES,
  FIXED_SLIDES_OBJECTIVES_ON_TITLE,
  slotRolesFor,
  weightOf,
} from "./cycles";

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

  test("objectives on the title: three fixed slides, cycles from slide 3, exactly N", () => {
    const leans = ["explain", "worked-example", "photo", "list"];
    for (let n = 5; n <= 15; n++) {
      for (let k = 1; k <= 4; k++) {
        const a = allocate(n, leans.slice(0, k).map(lean), { objectivesOnTitle: true });
        const total = a.cycles.reduce((s, c) => s + c.count, 0);
        expect(total + FIXED_SLIDES_OBJECTIVES_ON_TITLE).toBe(n);
        expect(a.cycles[0]?.first).toBe(3);
        expect(a.exitSlide).toBe(n);
      }
    }
    expect(() => allocate(3, [undefined], { objectivesOnTitle: true })).toThrow();
  });

  test("objectives on the title: 3 objectives in 10 slides get 3/2/2, the extra to the neediest", () => {
    const counts = (leans: string[]) =>
      allocate(10, leans.map(lean), { objectivesOnTitle: true }).cycles.map((c) => c.count);
    // A heavier lean takes it (a method, a process, a structure) over an explanation or a photo.
    expect(counts(["explain", "photo", "worked-example"])).toEqual([2, 2, 3]);
    expect(counts(["explain", "photo", "sequence"])).toEqual([2, 2, 3]);
    expect(counts(["explain", "photo", "explain"])).toEqual([2, 3, 2]);
    // Tied weights: a method first, then a process or contrast (its third slot shows it).
    expect(counts(["figure", "compare", "worked-example"])).toEqual([2, 2, 3]);
    expect(counts(["figure", "figure", "sequence"])).toEqual([2, 2, 3]);
    // With no arcs, the first objective, as before.
    expect(
      allocate(10, [undefined, undefined, undefined], { objectivesOnTitle: true }).cycles.map(
        (c) => c.count,
      ),
    ).toEqual([3, 2, 2]);
  });

  test("a cycle of 3 or more whose arc wants a visual has a show slot", () => {
    expect(slotRolesFor(3, "figure")).toEqual(["show", "teach", "check"]);
    expect(slotRolesFor(3, "photo")).toEqual(["show", "teach", "check"]);
    expect(slotRolesFor(3, "sequence")).toEqual(["teach", "show", "check"]);
    expect(slotRolesFor(3, "compare")).toEqual(["teach", "show", "check"]);
    expect(slotRolesFor(4, "sequence")).toEqual(["teach", "show", "practise", "check"]);
    // No room for one in 2 slots; a method or an explanation is not given one.
    expect(slotRolesFor(2, "sequence")).toEqual(["teach", "check"]);
    expect(slotRolesFor(3, "worked-example")).toEqual(["teach", "practise", "check"]);
    expect(slotRolesFor(3, "explain")).toEqual(["teach", "teach", "check"]);
  });
});
