// Layout grid for a 16:9 slide, in slide units (1280 x 720). Every model places marks
// on this grid so titles, content and captions line up across the library.
//
//   y 0–112    title band   (title baseline 78, optional subtitle baseline 112)
//   y 112–640  stage        (the model's content; scenes may bleed to the slide edges)
//   y 660      foot rule    (caption baseline 701, one line, shrinks to --fs-min if long)
//   x 64–1216  live area    12 columns of 72 with 24 gutters
import { W, H } from './svg.js';

export const GRID = {
  W, H,
  edge: 64,                 // side margin (--space-edge)
  left: 64, right: 1216,    // live area
  titleY: 78, subY: 112,
  top: 120,                 // first content line
  bottom: 640,              // last content line (keep 20 above the foot rule)
  foot: 660, captionY: 701,
  cols: 12, col: 72, gutter: 24,
  gap: 24,                  // standard gap between blocks
  labelGap: 14,             // label to the thing it names
};

/** x of the left edge of column i (0-based). */
export const colX = i => GRID.left + i * (GRID.col + GRID.gutter);
/** Box spanning columns [i, i+n) between y0 and y1: {x, y, w, h, cx, cy}. */
export function cols(i, n, y0 = GRID.top, y1 = GRID.bottom) {
  const x = colX(i), w = n * GRID.col + (n - 1) * GRID.gutter;
  return { x, y: y0, w, h: y1 - y0, cx: x + w / 2, cy: (y0 + y1) / 2 };
}
/** Split the live area into n equal panels with gutters (for side-by-side comparisons). */
export function panels(n, y0 = GRID.top, y1 = GRID.bottom, gutter = GRID.gutter * 2) {
  const w = (GRID.right - GRID.left - gutter * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => { const x = GRID.left + i * (w + gutter); return { x, y: y0, w, h: y1 - y0, cx: x + w / 2, cy: (y0 + y1) / 2 }; });
}
/** Linear scale: maps a domain value to slide units. Honest by construction. */
export function scale(d0, d1, r0, r1) {
  const f = v => r0 + (v - d0) / (d1 - d0) * (r1 - r0);
  f.invert = x => d0 + (x - r0) / (r1 - r0) * (d1 - d0);
  f.k = (r1 - r0) / (d1 - d0); f.domain = [d0, d1]; f.range = [r0, r1];
  return f;
}
