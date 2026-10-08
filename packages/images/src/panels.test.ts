import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  crop,
  decodePng,
  duplicatePanels,
  encodePng,
  gridShape,
  keepTop,
  panelBounds,
  splitGrid,
  splitPanels,
  subjectBox,
} from "./panels";

/** A grey strip of `widths` panels split by 8 px white gutters, each with a dark square of `sizes`. */
function strip(widths: number[], sizes: number[], h = 120) {
  const width = widths.reduce((a, b) => a + b, 0) + 8 * (widths.length - 1);
  const rgb = new Uint8Array(width * h * 3).fill(236);
  let x0 = 0;
  widths.forEach((w, k) => {
    const s = sizes[k] ?? 10;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const o = (y * width + x0 + x) * 3;
        const inside = Math.abs(x - w / 2) < s / 2 && Math.abs(y - h / 2) < s / 2;
        if (inside) rgb.fill(40, o, o + 3);
      }
    x0 += w;
    if (k < widths.length - 1) {
      for (let y = 0; y < h; y++) rgb.fill(255, (y * width + x0) * 3, (y * width + x0 + 8) * 3);
      x0 += 8;
    }
  });
  return { width, height: h, rgb };
}

describe("panels", () => {
  test("PNG round trip", () => {
    const r = strip([30, 30], [10, 10], 20);
    const back = decodePng(encodePng(r));
    expect(back.width).toBe(r.width);
    expect(Buffer.from(back.rgb).equals(Buffer.from(r.rgb))).toBe(true);
  });
  test("cuts at the gutters even when the panels are unequal", () => {
    expect(panelBounds(strip([90, 110, 130], [20, 30, 40]), 3)).toEqual([
      [0, 90],
      [98, 208],
      [216, 346],
    ]);
  });
  test("every panel is the slot's shape, cropped inside its panel, top kept", () => {
    const r = strip([90, 110, 130], [20, 30, 40]);
    const rs = splitPanels(encodePng(r), 3, 1.25).map(decodePng);
    const bounds = panelBounds(r, 3);
    for (const [k, p] of rs.entries()) {
      const [a, b] = bounds[k] ?? [0, 0];
      expect(Math.abs(p.width / p.height - 1.25)).toBeLessThan(0.03);
      expect(p.width).toBeLessThanOrEqual(b - a);
    }
  });
});

describe("no seams, no doubled panels", () => {
  test("a strip with a missing gutter is refused, never cut through a picture", () => {
    const r = strip([100, 100], [20, 20]);
    // paint over the gutter: the two panels now run into each other
    for (let y = 0; y < r.height; y++)
      r.rgb.fill(236, (y * r.width + 100) * 3, (y * r.width + 108) * 3);
    expect(() => panelBounds(r, 2)).toThrow(/no gutter/);
  });
  test("an off-white gutter is still found; a dark seam is not one", () => {
    const r = strip([100, 100], [20, 20]);
    for (let y = 0; y < r.height; y++)
      r.rgb.fill(242, (y * r.width + 100) * 3, (y * r.width + 108) * 3);
    const [[, end] = [0, 0], [start] = [0, 0]] = panelBounds(r, 2);
    expect(end).toBeGreaterThan(95);
    expect(start).toBeLessThan(113);
  });
  test("near-identical panels are caught; different stages are not", () => {
    const same = splitPanels(encodePng(strip([100, 100], [30, 30])), 2, 1.25);
    expect(duplicatePanels(same)).toEqual([[0, 1]]);
    const grow = splitPanels(encodePng(strip([100, 100], [16, 60])), 2, 1.25);
    expect(duplicatePanels(grow)).toEqual([]);
  });
  test("a solo picture is cropped to the slot shape without looking for gutters", () => {
    const one = decodePng(splitPanels(encodePng(strip([120], [30])), 1, 1.25)[0] as Uint8Array);
    expect(Math.abs(one.width / one.height - 1.25)).toBeLessThan(0.02);
  });
  test("a grid of 6 is cut row by row at its gutters; no row gutter refuses it", () => {
    const top = strip([60, 60, 60], [20, 24, 28], 60);
    const bottom = strip([60, 60, 60], [30, 22, 26], 60);
    const stack = (gap: number) => {
      const width = top.width;
      const rgb = new Uint8Array(width * (120 + gap) * 3).fill(255);
      rgb.set(top.rgb, 0);
      rgb.set(bottom.rgb, width * (60 + gap) * 3);
      return encodePng({ width, height: 120 + gap, rgb });
    };
    expect(gridShape(6)).toEqual({ cols: 3, rows: 2 });
    expect(gridShape(4)).toEqual({ cols: 4, rows: 1 });
    expect(splitGrid(stack(8), 6, 1)).toHaveLength(6);
    expect(() => splitGrid(stack(0), 6, 1)).toThrow(/no gutter/);
  });
});

describe("keepTop", () => {
  test("a wide picture loses only its sides; a narrow one keeps the subject's top", () => {
    const r = strip([200], [40], 100);
    const wide = keepTop(r, 1);
    expect([wide.width, wide.height]).toEqual([100, 100]);
    expect(
      Buffer.from(wide.rgb.subarray(0, 300)).equals(Buffer.from(r.rgb.subarray(150, 450))),
    ).toBe(true);
    const tall = keepTop(crop(r, 0, 0, 50, 100), 1);
    expect([tall.width, tall.height]).toEqual([50, 50]);
    const below = crop(r, 0, 0, 50, 100);
    expect(Buffer.from(keepTop(below, 1, 30).rgb.subarray(0, 150))).toEqual(
      Buffer.from(below.rgb.subarray(30 * 150, 31 * 150)),
    );
    // never past the bottom
    expect(keepTop(below, 1, 90).height).toBe(50);
  });
});

/** Rows whose first or last 8 columns repeat one pixel: what edge padding leaves behind. */
function streakShare(r: { width: number; height: number; rgb: Uint8Array }): number {
  let streaks = 0;
  for (let y = 0; y < r.height; y++)
    for (const x0 of [0, r.width - 8]) {
      const o = (y * r.width + x0) * 3;
      let same = true;
      for (let x = 1; x < 8 && same; x++)
        for (let c = 0; c < 3; c++) if (r.rgb[o + x * 3 + c] !== r.rgb[o + c]) same = false;
      if (same) streaks++;
    }
  return streaks / (2 * r.height);
}

/**
 * Real strips the image model returned at 2048x1152 (halved for the repo; the gutters and subjects
 * are the model's own): a 4-panel compare strip (cow, calf, sheep, lamb) and 3- and 4-panel stage
 * strips on grass. Their panels are tall (about 0.45 to 0.6 wide for each unit of height).
 */
describe("real strips: never a stretched edge, never a head cut off", () => {
  const load = (f: string) => new Uint8Array(readFileSync(join(import.meta.dir, "fixtures", f)));
  const cases = [
    ["compare-4.png", 4],
    ["stages-3.png", 3],
    ["stages-4.png", 4],
  ] as const;
  test("base4's window was wider than every panel, so it padded with edge pixels", () => {
    // Base4 sized one window to hold the largest subject at the slot's shape and filled the part
    // past the panel with the nearest edge pixel. On these strips that window is over twice as
    // wide as a panel: most of each picture would have been stretched edge.
    for (const [f, n] of cases) {
      const r = decodePng(load(f));
      const bounds = panelBounds(r, n);
      const boxes = bounds.map(([a, b]) => subjectBox(crop(r, a, 0, b - a, r.height)));
      const need = Math.max(...boxes.map((x) => (x ? Math.max(x.w * 1.12, x.h * 1.12 * 1.4) : 0)));
      const widest = Math.max(...bounds.map(([a, b]) => b - a));
      expect(need).toBeGreaterThan(1.9 * widest);
    }
  });
  test.each(cases)("%s: n panels at the slot shape, each a crop of its panel's top", (f, n) => {
    const r = decodePng(load(f));
    const bounds = panelBounds(r, n);
    const tiles = splitPanels(load(f), n, 1.4).map(decodePng);
    expect(tiles).toHaveLength(n);
    expect(duplicatePanels(splitPanels(load(f), n, 1.4))).toEqual([]);
    for (const [k, t] of tiles.entries()) {
      const [a, b] = bounds[k] ?? [0, 0];
      expect(Math.abs(t.width / t.height - 1.4)).toBeLessThan(0.02);
      expect(t.width).toBeLessThanOrEqual(b - a);
      expect(streakShare(t)).toBeLessThan(0.02);
      // The window starts at or above the subject's top: a head is never cut off.
      const inset = Math.round((b - a) * 0.015);
      const panel = crop(r, a + inset, 0, b - a - 2 * inset, r.height);
      const box = subjectBox(panel);
      const row0 = Buffer.from(t.rgb.subarray(0, t.width * 3));
      let y0 = -1;
      for (let y = 0; y < panel.height && y0 < 0; y++)
        if (
          row0.equals(
            Buffer.from(panel.rgb.subarray(y * panel.width * 3, (y + 1) * panel.width * 3)),
          )
        )
          y0 = y;
      expect(y0).toBeGreaterThanOrEqual(0);
      expect(y0).toBeLessThanOrEqual(box?.y ?? 0);
    }
  });
  test("a grid whose gutters are off-white is cut, not refused", () => {
    // A real 2x2 grid (1536x1024, halved): its gutters average about 244, under the strict 248.
    const tiles = splitGrid(load("offwhite-grid-4.png"), 4, 4 / 3, { cols: 2, rows: 2 }).map(
      decodePng,
    );
    expect(tiles).toHaveLength(4);
    for (const t of tiles) {
      expect(Math.abs(t.width / t.height - 4 / 3)).toBeLessThan(0.02);
      expect(streakShare(t)).toBeLessThan(0.02);
    }
  });
});
