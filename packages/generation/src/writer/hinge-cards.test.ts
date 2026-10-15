import { describe, expect, test } from "bun:test";
import { fitTable } from "./fixes";
import cards from "./hinge-cards.gen.json" with { type: "json" };

/*
 * TEACH-110 part r: the hinge caps by card are opt-in per writer bundle. Without the option the
 * table is the lab's (production's base4f-p123 keeps every number); with it only the hinge rows
 * change, to 2, 3 and 4 options at the measured card caps.
 */
describe("fitTable hinge cards", () => {
  test("default: the lab's hinge rows, unchanged (3 and 4 options; KS2 3 options 100)", () => {
    const h = fitTable().KS2?.layouts.hinge?.variants ?? [];
    expect(h.map((v) => v.counts.options)).toEqual([3, 4]);
    expect(h.map((v) => v.limit?.item)).toEqual([100, 80]);
  });

  test("opted in: 2, 3 and 4 options at the card caps; every other layout identical", () => {
    const on = fitTable({ hingeCards: true });
    const off = fitTable();
    for (const [g, c] of Object.entries(cards.groups)) {
      const h = on[g]?.layouts.hinge?.variants ?? [];
      expect(h.map((v) => v.counts.options)).toEqual([2, 3, 4]);
      for (const v of h) {
        const item = c.options[String(v.counts.options) as "2"];
        expect(v.limit?.item).toBe(item);
        expect(v.chars).toBe(item);
        expect(v.stem).toBe(c.stem);
        expect(v.label).toBe(`${v.counts.options} options`);
      }
      const { hinge: _a, ...restOn } = on[g]?.layouts ?? {};
      const { hinge: _b, ...restOff } = off[g]?.layouts ?? {};
      expect(restOn).toEqual(restOff);
    }
    // Re-measured on the TEACH-256 part b layout (rows of up to 2 lines replace 3-across cards).
    expect(cards.groups.KS2.options["3"]).toBe(44);
  });
});
