import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extendRaster } from "./extend";
import { crop, decodePng, encodePng, type Raster } from "./panels";

/*
 * TEACH-25 part b, row 3: an extended crop is baked into a new image (picture.js `bakeExtended`):
 * each row or column past the picture takes its edge colour, averaged over a 6 px band and smoothed
 * along the edge, so noise never streaks.
 */
const load = (name: string): Raster =>
  decodePng(new Uint8Array(readFileSync(join(import.meta.dir, "fixtures/picture-fit", name))));
const at = (r: Raster, x: number, y: number) => {
  const o = (y * r.width + x) * 3;
  return [r.rgb[o] ?? 0, r.rgb[o + 1] ?? 0, r.rgb[o + 2] ?? 0];
};
/** Variance of the luminance down one column, rows y0..y1. */
function columnVariance(r: Raster, x: number, y0 = 0, y1 = r.height) {
  const v: number[] = [];
  for (let y = y0; y < y1; y++) {
    const [a = 0, b = 0, c = 0] = at(r, x, y);
    v.push(0.299 * a + 0.587 * b + 0.114 * c);
  }
  const m = v.reduce((t, q) => t + q, 0) / v.length;
  return v.reduce((t, q) => t + (q - m) ** 2, 0) / v.length;
}

describe("extendRaster", () => {
  const jar = load("jar-master.png");
  // the pilot's 16:9 crop of the padded canopic jar: wider than the picture, trimmed top and bottom
  const wide = { x: -0.25, y: 0.08, w: 1.5, h: 0.845 };

  test("the canvas is the crop's window, and the picture sits in it unchanged", () => {
    const out = extendRaster(jar, wide);
    expect(out.width).toBe(384);
    expect(out.height).toBe(216);
    const ox = 64;
    const oy = -20;
    for (const [x, y] of [
      [0, 20],
      [128, 128],
      [255, 235],
      [10, 100],
    ] as const)
      expect(at(out, x + ox, y + oy)).toEqual(at(jar, x, y));
  });

  test("the stretched backdrop has no streaks: the seam varies less than the backdrop's own edge", () => {
    const out = extendRaster(jar, wide);
    const own = Math.max(columnVariance(jar, 0, 20, 236), columnVariance(jar, 255, 20, 236));
    for (const x of [0, 32, 63, 320, 383])
      expect(columnVariance(out, x)).toBeLessThanOrEqual(own + 1e-9);
    // every stretched row is one colour across (an edge-stretch, not a mirror)
    for (const y of [0, 100, 215]) expect(at(out, 0, y)).toEqual(at(out, 63, y));
  });

  test("the extension reads as the backdrop: within a few levels of the picture's own edge", () => {
    const out = extendRaster(jar, wide);
    for (const y of [10, 108, 200]) {
      const ext = at(out, 63, y);
      const edge = at(jar, 0, y + 20);
      for (let k = 0; k < 3; k++)
        expect(Math.abs((ext[k] ?? 0) - (edge[k] ?? 0))).toBeLessThanOrEqual(8);
    }
  });

  test("noise on the edge does not streak: a speckled backdrop extends smooth", () => {
    const w = 60;
    const h = 80;
    const rgb = new Uint8Array(w * h * 3);
    let seed = 7;
    for (let i = 0; i < rgb.length; i += 3) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      rgb.fill(220 + (seed % 21) - 10, i, i + 3);
    }
    const noisy: Raster = { width: w, height: h, rgb };
    const out = extendRaster(noisy, { x: -0.5, y: 0, w: 2, h: 1 });
    expect(columnVariance(out, 5)).toBeLessThan(columnVariance(noisy, 0) / 4);
  });

  test("a crop inside the picture is a plain crop", () => {
    const c = { x: 0.25, y: 0.125, w: 0.5, h: 0.5 };
    expect(extendRaster(jar, c)).toEqual(crop(jar, 64, 32, 128, 128));
  });

  test("extends vertically and at the corners from the strips' ends", () => {
    const out = extendRaster(jar, { x: -0.1, y: -0.1, w: 1.2, h: 1.2 });
    expect(out.width).toBe(307);
    expect(out.height).toBe(307);
    expect(at(out, 0, 0)).toEqual(at(out, 0, 25)); // corner = the left strip's top end
    expect(encodePng(out).length).toBeGreaterThan(0);
  });
});
