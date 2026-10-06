import { describe, expect, test } from "bun:test";
import { THEMES } from "../themes";
import { DIAGRAM_ZONES, diagramElement, diagramFaults, diagramZoom } from "./index";

/** FIX1: a drawing fills its zone (FULL-RUN y5 bar models and y11 table drew at a third of it). */
const BAR = {
  bars: [
    {
      label: "Counters",
      parts: [
        { value: 4, label: "4", shaded: true },
        { value: 4, label: "4", shaded: true },
        { value: 4, label: "4", shaded: true },
        { value: 4, label: "4", shaded: false },
        { value: 4, label: "4", shaded: false },
      ],
      total: "20",
    },
  ],
  kind: "bar-model",
  alt: "Three fifths of 20: Counters, 4, 4, 4, 4, 4, 20",
  title: "Three fifths of 20",
};
const HALF = { x: 58, y: 119, w: 363, h: 378 };

describe("diagram zoom", () => {
  for (const t of THEMES)
    test(`a bar model grows to fill the half zone, clean at its zoom (${t.id})`, () => {
      const z = diagramZoom(BAR, t, HALF);
      expect(z).toBeGreaterThan(1.3);
      expect(diagramFaults(BAR, t, { w: HALF.w / z, h: HALF.h / z })).toEqual([]);
      const el = diagramElement(BAR, t, HALF);
      const svg = decodeURIComponent(el?.src ?? "");
      // The zone keeps its size; the drawing's own box is the zoomed-down one, same shape.
      expect(el?.w).toBe(HALF.w);
      expect(svg).toContain(`width="${HALF.w}" height="${HALF.h}"`);
      expect(svg).toMatch(/viewBox="0 0 2\d\d /);
    });
  test("a drawing that already fills its box is not zoomed", () => {
    const t = THEMES[0] as (typeof THEMES)[number];
    expect(
      diagramZoom(
        { kind: "pie", title: "x", slices: [{ label: "a", value: 1 }] },
        t,
        DIAGRAM_ZONES.full,
      ),
    ).toBe(1);
  });
});
