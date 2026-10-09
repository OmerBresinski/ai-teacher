// Model-private drawing parts for mixtures_separating: heaps, grains, a bowl, an evaporating
// dish and a hot plate. Tokens only; no text here (every word is drawn by the model).
import { h, rng } from '../../kit/index.js';

/** A heap (mound) of a powder or grains: base from x0 to x1 at y, peak hgt above it. */
export const moundD = (x0, x1, y, hgt) => `M${x0} ${y} C ${x0 + (x1 - x0) * .22} ${y - hgt * 1.25} ${x1 - (x1 - x0) * .22} ${y - hgt * 1.25} ${x1} ${y} Z`;
/** Height of the mound surface above the base at x (matches moundD closely enough to place grains). */
export const moundAt = (x0, x1, hgt, x) => { const u = (x - x0) / (x1 - x0); return u <= 0 || u >= 1 ? 0 : hgt * 4 * u * (1 - u) * .94; };

const BASE = { sand: 'var(--sand)', flour: 'var(--marble)' };
export const baseFill = k => BASE[k] || 'var(--sand)';

/** One grain of a kind at (x,y). Returns the element. */
export function grain(p, kind, x, y, rot = 0, a = {}) {
  const t = `rotate(${rot.toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})`;
  if (kind === 'iron') return h('rect', Object.assign({ x: x - 10, y: y - 3, width: 20, height: 6, rx: 2, fill: 'var(--ink-2)', transform: t }, a), p);
  if (kind === 'rice') return h('ellipse', Object.assign({ cx: x, cy: y, rx: 8, ry: 3.4, fill: 'var(--seed)', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)', transform: t }, a), p);
  if (kind === 'pebble') return h('ellipse', Object.assign({ cx: x, cy: y, rx: 13, ry: 9, fill: 'var(--stone)', stroke: 'var(--stone-shade)', 'stroke-width': 'var(--sw-hair)', transform: t }, a), p);
  if (kind === 'crystal') return h('rect', Object.assign({ x: x - 4.5, y: y - 4.5, width: 9, height: 9, rx: 1, fill: 'var(--marble)', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)', transform: t }, a), p);
  return h('circle', Object.assign({ cx: x, cy: y, r: 3, fill: 'var(--sand-shade)' }, a), p);
}
/** n seeded points inside a test function over a box, kept apart by gap. */
export function scatter(box, inside, n, seed, gap = 10) {
  const R = rng(seed), out = [];
  for (let t = 0; out.length < n && t < n * 300; t++) {
    const q = [box.x + R() * box.w, box.y + R() * box.h];
    if (inside(q[0], q[1]) && out.every(o => Math.hypot(o[0] - q[0], o[1] - q[1]) >= gap)) out.push(q);
  }
  return out.map(q => [q[0], q[1], (R() - .5) * 140]);
}

/** A bowl in side view, base centre (x,y), rim at y-hh. Draw its contents first, then this. */
export function bowl(p, x, y, w, hh, a = {}) {
  const g = h('g', a, p);
  h('path', { d: `M${x - w / 2} ${y - hh} C ${x - w / 2} ${y - hh * .15} ${x - w * .3} ${y} ${x} ${y} C ${x + w * .3} ${y} ${x + w / 2} ${y - hh * .15} ${x + w / 2} ${y - hh} Z`, fill: 'var(--bowl)', stroke: 'color-mix(in oklab,var(--hue-teal) 70%,var(--ink-3))', 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round', cls: 'body' }, g);
  h('line', { x1: x - w / 2 - 5, x2: x + w / 2 + 5, y1: y - hh, y2: y - hh, stroke: 'color-mix(in oklab,var(--hue-teal) 70%,var(--ink-3))', 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round' }, g);
  return g;
}
/** Evaporating dish: rim at y (top), depth d. Returns {g, clipId, path}. */
export function dishD(x, y, w, d) { return `M${x - w / 2} ${y} C ${x - w / 2 + 10} ${y + d * .9} ${x - w * .2} ${y + d} ${x} ${y + d} C ${x + w * .2} ${y + d} ${x + w / 2 - 10} ${y + d * .9} ${x + w / 2} ${y} Z`; }
/** Hot plate: body from y-hh to y, a heating ring along its top. */
export function hotPlate(p, x, y, w, hh, a = {}) {
  const g = h('g', a, p);
  h('rect', { x: x - w / 2, y: y - hh, width: w, height: hh, rx: 'var(--r-mark)', fill: 'color-mix(in oklab,var(--hue-grey) 42%,var(--shade))', cls: 'body' }, g);
  h('rect', { x: x - w / 2 + 16, y: y - hh, width: w - 32, height: 8, fill: 'var(--heat)' }, g);
  h('circle', { cx: x + w / 2 - 28, cy: y - hh / 2 + 4, r: 9, fill: 'var(--metal)' }, g);
  return g;
}
