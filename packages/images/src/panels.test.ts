import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  crop,
  decodePng,
  duplicatePanels,
  encodePng,
  gridShape,
  joinPanels,
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
  test("every panel comes out whole: its gutter and a thin inset go, nothing else", () => {
    const r = strip([90, 110, 130], [20, 30, 40]);
    const rs = splitPanels(encodePng(r), 3).map(decodePng);
    for (const [k, p] of rs.entries()) {
      const [a, b] = panelBounds(r, 3)[k] ?? [0, 0];
      const inset = Math.round((b - a) * 0.015);
      expect([p.width, p.height]).toEqual([b - a - 2 * inset, r.height]);
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
    const same = splitPanels(encodePng(strip([100, 100], [30, 30])), 2);
    expect(duplicatePanels(same)).toEqual([[0, 1]]);
    const grow = splitPanels(encodePng(strip([100, 100], [16, 60])), 2);
    expect(duplicatePanels(grow)).toEqual([]);
  });
  test("a solo picture is returned as it is, without looking for gutters", () => {
    const png = encodePng(strip([120], [30]));
    expect(splitPanels(png, 1)[0]).toBe(png);
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
    expect(splitGrid(stack(8), 6)).toHaveLength(6);
    expect(() => splitGrid(stack(0), 6)).toThrow(/no gutter/);
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
  test.each(cases)("%s: n whole panels, no stretched edge, no head cut", (f, n) => {
    const r = decodePng(load(f));
    const bounds = panelBounds(r, n);
    const tiles = splitPanels(load(f), n).map(decodePng);
    expect(tiles).toHaveLength(n);
    expect(duplicatePanels(splitPanels(load(f), n))).toEqual([]);
    for (const [k, t] of tiles.entries()) {
      const [a, b] = bounds[k] ?? [0, 0];
      const inset = Math.round((b - a) * 0.015);
      // The whole panel at full height: the top (heads) and the bottom (feet) both stay.
      expect([t.width, t.height]).toEqual([b - a - 2 * inset, r.height]);
      expect(streakShare(t)).toBeLessThan(0.02);
      const src = r.rgb.subarray((a + inset) * 3, (a + inset + t.width) * 3);
      expect(Buffer.from(t.rgb.subarray(0, t.width * 3)).equals(Buffer.from(src))).toBe(true);
    }
  });
  test("a grid whose gutters are off-white is cut, not refused", () => {
    // A real 2x2 grid (1536x1024, halved): its gutters average about 244, under the strict 248.
    const tiles = splitGrid(load("offwhite-grid-4.png"), 4, { cols: 2, rows: 2 }).map(decodePng);
    expect(tiles).toHaveLength(4);
    for (const t of tiles) {
      // A 2x2 grid at 1536x1024 gives 3:2 panels: inside every tile and compare range.
      expect(Math.abs(t.width / t.height - 1.5)).toBeLessThan(0.08);
      expect(streakShare(t)).toBeLessThan(0.02);
    }
  });
});

describe("joinPanels", () => {
  const solid = (width: number, height: number, v: number) =>
    encodePng({ width, height, rgb: new Uint8Array(width * height * 3).fill(v) });
  test("widths add up with the gaps; every panel is cut to the shortest height", () => {
    const { png, boxes } = joinPanels(
      [solid(30, 40, 10), solid(20, 50, 100), solid(10, 40, 200)],
      4,
    );
    const r = decodePng(png);
    expect([r.width, r.height]).toEqual([30 + 20 + 10 + 8, 40]);
    expect(boxes.map((b) => Math.round(b.left * r.width))).toEqual([0, 34, 58]);
    expect(boxes.map((b) => Math.round(b.right * r.width))).toEqual([30, 54, 68]);
    // each panel's own pixels, and white in the gap
    expect(r.rgb[(5 * r.width + 1) * 3]).toBe(10);
    expect(r.rgb[(5 * r.width + 40) * 3]).toBe(100);
    expect(r.rgb[(5 * r.width + 31) * 3]).toBe(255);
    expect(r.rgb[(5 * r.width + 60) * 3]).toBe(200);
  });
});
