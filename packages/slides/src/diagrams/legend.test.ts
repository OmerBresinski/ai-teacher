import { describe, expect, test } from "bun:test";
import { packRows, planLegend } from "./legend";

describe("the shared legend plan", () => {
  const items = [
    { w: 160, h: 40 },
    { w: 220, h: 40 },
    { w: 250, h: 40 },
  ];
  test("beside when the figure is wide enough to keep its plot", () => {
    const p = planLegend({
      size: { w: 844, h: 226 },
      column: items,
      rows: items,
      reserved: 0,
      gap: 16,
    });
    expect(p).toEqual({ mode: "beside", colW: 250, plotW: 578 });
  });
  test("in rows when it is not, packed in order", () => {
    const p = planLegend({
      size: { w: 422, h: 540 },
      column: items,
      rows: items,
      reserved: 200,
      gap: 16,
    });
    expect(p.mode).toBe("below");
    if (p.mode === "below") {
      expect(p.rows.map((r) => r.items.map((i) => i.i))).toEqual([[0, 1], [2]]);
      expect(p.h).toBe(80);
    }
    expect(packRows(items.slice(0, 2), 400, 16)).toEqual([
      {
        items: [
          { i: 0, x: 0 },
          { i: 1, x: 176 },
        ],
        h: 40,
      },
    ]);
  });
  test("none, never a clipped legend or a throw, when the rows cannot fit", () => {
    expect(
      planLegend({ size: { w: 160, h: 60 }, column: items, rows: items, reserved: 40, gap: 16 }),
    ).toEqual({ mode: "none" });
    expect(
      planLegend({
        size: { w: 0, h: 0 },
        column: [],
        rows: [{ w: Number.NaN, h: Number.NaN }],
        reserved: 0,
        gap: 0,
      }).mode,
    ).toBe("none");
  });
});
