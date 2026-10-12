/**
 * Bake an extended crop (TEACH-25 part b, ruling 217): a port of the layout pilot's
 * `northstars/picture.js` `bakeExtended`. `@tj/slides` `cropFor` returns a crop that runs past the
 * picture only where its backdrop is plain on both edges of that axis (never on a scene, ruling 210:
 * never outpaint real things); this paints that window as a new picture. The picture is copied in
 * place and every row or column past it takes its edge colour: the mean of a 6 px band at the edge,
 * smoothed along the edge (eighth resolution, then stretched back), so pixel noise and texture do
 * not turn into streaks. Corners take the side strips' end colours. The caller stores the result
 * and places it with no crop: it is exactly the crop's window, so the editor, Present and
 * PowerPoint all show the same pixels.
 */
import { crop as cropRaster, type Raster } from "./panels";

/** The band averaged at each edge, px. */
const BAND = 6;
/** The strip is smoothed at this fraction of its length. */
const SMOOTH = 8;

/** Mean colour across a band at one edge, at each position along it, then smoothed along it. */
function strip(r: Raster, side: "left" | "right" | "top" | "bottom"): Float64Array {
  const along = side === "left" || side === "right" ? r.height : r.width;
  const band = Math.max(1, Math.min(BAND, r.width, r.height));
  const raw = new Float64Array(along * 3);
  for (let p = 0; p < along; p++)
    for (let b = 0; b < band; b++) {
      const x = side === "left" ? b : side === "right" ? r.width - 1 - b : p;
      const y = side === "top" ? b : side === "bottom" ? r.height - 1 - b : p;
      const o = (y * r.width + x) * 3;
      for (let k = 0; k < 3; k++)
        raw[p * 3 + k] = (raw[p * 3 + k] ?? 0) + (r.rgb[o + k] ?? 0) / band;
    }
  // down to n blocks (area mean), then back up by linear interpolation between block centres
  const n = Math.max(2, Math.round(along / SMOOTH));
  const blocks = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p0 = Math.floor((i * along) / n);
    const p1 = Math.max(p0 + 1, Math.floor(((i + 1) * along) / n));
    for (let p = p0; p < p1; p++)
      for (let k = 0; k < 3; k++)
        blocks[i * 3 + k] = (blocks[i * 3 + k] ?? 0) + (raw[p * 3 + k] ?? 0) / (p1 - p0);
  }
  const out = new Float64Array(along * 3);
  for (let p = 0; p < along; p++) {
    const u = Math.min(n - 1, Math.max(0, ((p + 0.5) * n) / along - 0.5));
    const i = Math.floor(u);
    const j = Math.min(n - 1, i + 1);
    const t = u - i;
    for (let k = 0; k < 3; k++)
      out[p * 3 + k] = (blocks[i * 3 + k] ?? 0) * (1 - t) + (blocks[j * 3 + k] ?? 0) * t;
  }
  return out;
}

/**
 * The crop's window (fractions of the picture, `@tj/slides` `PictureCrop`) as a new picture, the
 * backdrop stretched wherever the window runs past the picture. A window inside the picture is a
 * plain crop.
 */
export function extendRaster(r: Raster, c: { x: number; y: number; w: number; h: number }): Raster {
  const width = Math.max(1, Math.round(c.w * r.width));
  const height = Math.max(1, Math.round(c.h * r.height));
  const ox = Math.round(-c.x * r.width);
  const oy = Math.round(-c.y * r.height);
  if (ox <= 0 && oy <= 0 && width - ox <= r.width && height - oy <= r.height)
    return cropRaster(r, -ox, -oy, width, height);
  const L = strip(r, "left");
  const R = strip(r, "right");
  const T = strip(r, "top");
  const B = strip(r, "bottom");
  const rgb = new Uint8Array(width * height * 3);
  for (let Y = 0; Y < height; Y++) {
    const y = Y - oy;
    const yc = Math.min(r.height - 1, Math.max(0, y));
    for (let X = 0; X < width; X++) {
      const x = X - ox;
      const o = (Y * width + X) * 3;
      if (x >= 0 && x < r.width && y >= 0 && y < r.height) {
        const s = (y * r.width + x) * 3;
        rgb[o] = r.rgb[s] ?? 0;
        rgb[o + 1] = r.rgb[s + 1] ?? 0;
        rgb[o + 2] = r.rgb[s + 2] ?? 0;
        continue;
      }
      // past the picture sideways: the left or right strip at this row (its end at a corner);
      // past it above or below only: the top or bottom strip at this column
      const [src, p] = x < 0 ? [L, yc] : x >= r.width ? [R, yc] : y < 0 ? [T, x] : [B, x];
      for (let k = 0; k < 3; k++) rgb[o + k] = Math.round(src[p * 3 + k] ?? 0);
    }
  }
  return { width, height, rgb };
}
