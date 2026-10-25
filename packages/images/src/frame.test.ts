import { describe, expect, test } from "bun:test";
import { FRAME_CUT_RUN, frameCut, frameCutOf } from "./frame";
import { encodePng, type Raster } from "./panels";

/** A `w`x`h` picture on a light grey backdrop with a dark rectangle (the subject) at x, y, sw, sh. */
function scene(w: number, h: number, sx: number, sy: number, sw: number, sh: number): Raster {
  const rgb = new Uint8Array(w * h * 3).fill(232);
  for (let y = Math.max(0, sy); y < Math.min(h, sy + sh); y++)
    for (let x = Math.max(0, sx); x < Math.min(w, sx + sw); x++)
      rgb.fill(120, (y * w + x) * 3, (y * w + x) * 3 + 3);
  return { width: w, height: h, rgb };
}

// The generation sizes (3:2, 1:1, 2:3, 16:9) and a panorama: the gate is the same at every shape.
const SHAPES: [number, number][] = [
  [300, 200],
  [200, 200],
  [200, 300],
  [320, 180],
  [400, 100],
];

describe("FRAME-CUT: a subject drawn past its own frame", () => {
  for (const [w, h] of SHAPES) {
    test(`${w}x${h}: a whole subject with a margin is not cut`, () => {
      const r = frameCut(scene(w, h, w * 0.2, h * 0.2, w * 0.6, h * 0.6));
      expect(r.plain).toBe(true);
      expect(r.cut).toBe(false);
      expect(r.bleed).toBe(0);
    });
    test(`${w}x${h}: a subject run off the top and left (the heart R3 arm) is cut`, () => {
      const r = frameCut(scene(w, h, -10, -10, w * 0.5, h * 0.5));
      expect(r.cut).toBe(true);
      expect(r.edges.top).toBeGreaterThan(0.3);
      expect(r.edges.left).toBeGreaterThan(0.3);
      expect(r.edges.right).toBe(0);
      expect(r.edges.bottom).toBe(0);
    });
    test(`${w}x${h}: a subject touching only the right edge is cut there`, () => {
      const r = frameCut(scene(w, h, w * 0.6, h * 0.3, w, h * 0.4));
      expect(r.cut).toBe(true);
      expect(r.edges.right).toBeGreaterThan(0.3);
    });
  }

  test("a speck at the edge below the run threshold is noise, not a cut", () => {
    const w = 300;
    const n = Math.floor(w * FRAME_CUT_RUN) - 2;
    const r = frameCut(scene(w, 200, 140, -5, n, 20));
    expect(r.edges.top).toBeGreaterThan(0);
    expect(r.cut).toBe(false);
  });

  test("a full-bleed scene (corners disagree) is never measured", () => {
    const r = scene(300, 200, 0, 0, 300, 60); // dark sky across the top, light ground below
    const out = frameCut(r);
    expect(out.plain).toBe(false);
    expect(out.cut).toBe(false);
  });

  test("of two cut pictures the one less run off has the smaller bleed", () => {
    const more = frameCut(scene(300, 200, -10, -10, 200, 150));
    const less = frameCut(scene(300, 200, -10, 40, 60, 60));
    expect(less.bleed).toBeLessThan(more.bleed);
  });

  test("reads PNG bytes, and anything else is undefined", () => {
    expect(frameCutOf(encodePng(scene(120, 80, -5, 10, 40, 40)))?.cut).toBe(true);
    expect(frameCutOf(new TextEncoder().encode("<svg/>"))).toBeUndefined();
  });
});
