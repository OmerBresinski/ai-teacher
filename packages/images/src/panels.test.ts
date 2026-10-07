import { describe, expect, test } from "bun:test";
import { decodePng, encodePng, panelBounds, splitPanels, subjectBox } from "./panels";

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
    const b = panelBounds(strip([90, 110, 130], [20, 30, 40]), 3);
    expect(b).toEqual([
      [0, 90],
      [98, 208],
      [216, 346],
    ]);
  });
  test("every panel is the slot's shape, one scale, the subject whole and centred", () => {
    const parts = splitPanels(encodePng(strip([90, 110, 130], [20, 30, 40])), 3, 1.25);
    const rs = parts.map(decodePng);
    expect(new Set(rs.map((r) => `${r.width}x${r.height}`)).size).toBe(1);
    expect(Math.abs((rs[0]?.width ?? 0) / (rs[0]?.height ?? 1) - 1.25)).toBeLessThan(0.02);
    const boxes = rs.map((r) => subjectBox(r));
    // one scale: the subjects keep their sizes 20 < 30 < 40
    expect((boxes[0]?.w ?? 0) < (boxes[1]?.w ?? 0)).toBe(true);
    expect((boxes[1]?.w ?? 0) < (boxes[2]?.w ?? 0)).toBe(true);
    for (const [k, r] of rs.entries()) {
      const bx = boxes[k];
      expect(bx).toBeDefined();
      expect(Math.abs((bx?.x ?? 0) + (bx?.w ?? 0) / 2 - r.width / 2)).toBeLessThan(4);
    }
  });
});

describe("no seams, no doubled panels (round 5)", () => {
  test("a strip with a missing gutter is refused, never cut through a picture", () => {
    const r = strip([100, 100], [20, 20]);
    // paint over the gutter: the two panels now run into each other
    for (let y = 0; y < r.height; y++)
      r.rgb.fill(236, (y * r.width + 100) * 3, (y * r.width + 108) * 3);
    expect(() => panelBounds(r, 2)).toThrow();
  });
  test("near-identical panels are caught; different stages are not", () => {
    const { duplicatePanels } = require("./panels");
    const same = splitPanels(encodePng(strip([100, 100], [30, 30])), 2, 1.25);
    expect(duplicatePanels(same)).toEqual([[0, 1]]);
    const grow = splitPanels(encodePng(strip([100, 100], [16, 60])), 2, 1.25);
    expect(duplicatePanels(grow)).toEqual([]);
  });
  test("a solo panel is cropped to the slot shape without looking for gutters", () => {
    const one = decodePng(splitPanels(encodePng(strip([120], [30])), 1, 1.25)[0] as Uint8Array);
    expect(Math.abs(one.width / one.height - 1.25)).toBeLessThan(0.02);
  });
});
