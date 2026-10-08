// Objects for the light model: flat side-view silhouettes. Each shape is defined in units of its
// height (bottom at y 0, top at y -1, left edge at x 0), so the same outline drives the drawing
// and the shadow geometry (the rays that just graze the outline set the shadow's edges).
import { h } from '../../kit/index.js';

const C = (cx, cy, r, role) => ({ type: 'circle', cx, cy, r, role });
const P = (pts, role) => ({ type: 'poly', pts, role });
const R = (x0, y0, x1, y1, role) => P([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], role);

export const SHAPES = {
  figure: { aspect: .44, parts: [R(.08, -.4, .19, 0, 'main'), R(.25, -.4, .36, 0, 'main'), P([[.07, -.74], [.37, -.74], [.42, -.36], [.02, -.36]], 'main'), C(.22, -.86, .13, 'main')] },
  ball: { aspect: 1, parts: [C(.5, -.5, .5, 'main')] },
  bottle: { aspect: .36, parts: [R(0, -.62, .36, 0, 'main'), P([[0, -.62], [.12, -.8], [.24, -.8], [.36, -.62]], 'main'), R(.12, -.95, .24, -.79, 'main'), R(.11, -1, .25, -.94, 'cap')] },
  tree: { aspect: .7, parts: [R(.3, -.42, .4, 0, 'trunk'), C(.35, -.67, .33, 'canopy')] },
  cup: { aspect: .9, parts: [P([[0, -.8], [.68, -.8], [.61, 0], [.07, 0]], 'main'), { type: 'ring', cx: .7, cy: -.42, r: .18, role: 'main' }] },
};
export const OBJECT_KINDS = Object.keys(SHAPES);
export const OBJECT_NAMES = { figure: 'Card figure', ball: 'Ball', bottle: 'Bottle', tree: 'Tree', cup: 'Cup' };

/** Outline points of a shape drawn `H` tall with its left edge at x0 and its bottom at yb. */
export function outline(kind, x0, yb, H) {
  const s = SHAPES[kind] || SHAPES.ball, out = [];
  for (const q of s.parts) {
    if (q.type === 'poly') q.pts.forEach(([x, y]) => out.push([x0 + x * H, yb + y * H]));
    else { const r = q.type === 'ring' ? q.r + .035 : q.r; for (let i = 0; i < 36; i++) { const a = i / 36 * 2 * Math.PI; out.push([x0 + (q.cx + r * Math.cos(a)) * H, yb + (q.cy + r * Math.sin(a)) * H]); } }
  }
  return out;
}
/** Convex outline (gift wrap) for ray hits: a ray meets the object at its nearest hull edge. */
export function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
/** Nearest distance t > 0 along unit direction d from o to the polygon's edge (null if missed). */
export function rayPoly(o, d, poly) {
  let best = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ex = b[0] - a[0], ey = b[1] - a[1], den = d[0] * ey - d[1] * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - o[0]) * ey - (a[1] - o[1]) * ex) / den, u = ((a[0] - o[0]) * d[1] - (a[1] - o[1]) * d[0]) / den;
    if (t > 1e-6 && u >= 0 && u <= 1 && (best == null || t < best)) best = t;
  }
  return best;
}

const FILL = {
  opaque: { main: 'var(--item)', cap: 'var(--ink-2)', trunk: 'var(--trunk)', canopy: 'var(--canopy)', edge: 'var(--ink-2)', dash: null },
  translucent: { main: 'color-mix(in oklab,var(--item) 38%,var(--paper))', cap: 'color-mix(in oklab,var(--ink-2) 40%,var(--paper))', trunk: 'color-mix(in oklab,var(--trunk) 40%,var(--paper))', canopy: 'color-mix(in oklab,var(--canopy) 40%,var(--paper))', edge: 'var(--ink-3)', dash: null },
  transparent: { main: 'var(--air)', cap: 'var(--air)', trunk: 'var(--air)', canopy: 'var(--air)', edge: 'var(--glass-edge)', dash: null },
};
/** Draw the object: flat planes, one edge colour, no lighting. Returns the group. */
export function drawObject(p, kind, x0, yb, H, material = 'opaque', a = {}) {
  const s = SHAPES[kind] || SHAPES.ball, f = FILL[material] || FILL.opaque; const g = h('g', a, p);
  const edge = { stroke: f.edge, 'stroke-width': 'var(--sw-rule)', 'stroke-linejoin': 'round' };
  for (const q of s.parts) {
    if (q.type === 'poly') h('path', Object.assign({ d: 'M' + q.pts.map(([x, y]) => `${(x0 + x * H).toFixed(1)} ${(yb + y * H).toFixed(1)}`).join(' L ') + ' Z', fill: f[q.role] }, edge), g);
    else if (q.type === 'circle') h('circle', Object.assign({ cx: x0 + q.cx * H, cy: yb + q.cy * H, r: q.r * H, fill: f[q.role] }, edge), g);
    else h('circle', { cx: x0 + q.cx * H, cy: yb + q.cy * H, r: q.r * H, fill: 'none', stroke: f[q.role], 'stroke-width': .07 * H }, g);
  }
  return g;
}
