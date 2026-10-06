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
  for (const t of THEMES)
    test(`the y5 bar model spans most of its zone, as blocks not a strip (${t.id})`, () => {
      const el = diagramElement(BAR, t, HALF);
      const svg = decodeURIComponent(el?.src ?? "");
      const vb = (svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/) ?? []).slice(1).map(Number);
      const k = HALF.w / (vb[0] as number);
      const rects = [
        ...svg.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/g),
      ].map((m) => m.slice(1).map(Number));
      const x0 = Math.min(...rects.map((r) => r[0] as number));
      const x1 = Math.max(...rects.map((r) => (r[0] as number) + (r[2] as number)));
      const barH = Math.max(...rects.map((r) => r[3] as number));
      expect((x1 - x0) * k).toBeGreaterThan(HALF.w * 0.8);
      expect(barH * k).toBeGreaterThan(HALF.h * 0.25);
    });
});
