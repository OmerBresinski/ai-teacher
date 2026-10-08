import { describe, expect, test } from "bun:test";
import { atKeyStage, getTheme } from "../themes";
import { diagramElement, diagramFaults, drawsAtBodySize, shownLabelSize } from "./index";

/**
 * fix-bars (FULL-RUN y5 s3, s5-s8): a bar model spans its zone, its numbers at body size. Where
 * they cannot stand at body size in the half zone, it takes the full-width zone instead.
 */
const HALF = { x: 58, y: 126, w: 363, h: 371 };
const FULL = { x: 58, y: 200, w: 844, h: 300 };
const bar = (cells: number, label: string, name = "Ribbon", total = "40 cm") => ({
  kind: "bar-model",
  alt: "bar",
  bars: [
    {
      label: name,
      parts: Array.from({ length: cells }, (_, i) => ({ value: 1, label, shaded: i < 3 })),
      total,
    },
  ],
});
const drawn = (spec: unknown, rect: typeof HALF) => {
  const t = getTheme("splash");
  const el = diagramElement(spec, t, rect);
  const svg = decodeURIComponent(el?.src ?? "");
  const [vw] = (svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/) ?? []).slice(1).map(Number);
  const k = rect.w / (vw as number);
  const rects = [
    ...svg.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/g),
  ].map((m) => m.slice(1).map(Number) as [number, number, number, number]);
  const x0 = Math.min(...rects.map((r) => r[0]));
  const x1 = Math.max(...rects.map((r) => r[0] + r[2]));
  return { span: ((x1 - x0) * k) / rect.w, barH: Math.max(...rects.map((r) => r[3])) * k, svg };
};

describe("bar models fill their zone at body size (KS2, Splash)", () => {
  test("a part label that does not fit its part is a fault, not a silent drop", () => {
    const t = getTheme("splash");
    expect(diagramFaults(bar(8, "5 cm"), t, { w: 202, h: 206 })).toContain(
      'the part label "5 cm" does not fit its part',
    );
  });
  for (const cells of [2, 3, 4, 5, 6, 8, 10, 12])
    for (const label of ["6", "5 cm"])
      test(`${cells} parts of "${label}": half zone at body size, else the full width`, () => {
        const t = atKeyStage(getTheme("splash"), "ks2");
        const spec = bar(cells, label);
        const zone = drawsAtBodySize(spec, t, HALF) ? HALF : FULL;
        // Ten or more parts of "5 cm" are past body size even across the slide: every label is
        // still drawn, a step smaller (the largest zoom at which they all fit).
        const body = cells >= 10 && label === "5 cm" ? 0.8 : 0.95;
        if (body === 0.95) expect(drawsAtBodySize(spec, t, zone)).toBe(true);
        const d = drawn(spec, zone);
        // Spans most of its zone, every part labelled, labels at body size, bars readable.
        expect(d.span).toBeGreaterThan(0.85);
        expect(d.span).toBeLessThanOrEqual(1);
        expect(d.svg.split(`>${label}</tspan>`).length - 1).toBe(cells);
        expect(shownLabelSize(spec, t, zone)).toBeGreaterThanOrEqual(t.sizes.body * body);
        expect(d.barH).toBeGreaterThan(t.sizes.body * 1.8);
      });
  test("the y5 ribbon (eight parts of 5 cm) does not fit the half zone; the y5 counters do", () => {
    const t = atKeyStage(getTheme("splash"), "ks2");
    expect(drawsAtBodySize(bar(8, "5 cm"), t, HALF)).toBe(false);
    expect(drawsAtBodySize(bar(4, "6", "Counters", "24"), t, HALF)).toBe(true);
  });
});
