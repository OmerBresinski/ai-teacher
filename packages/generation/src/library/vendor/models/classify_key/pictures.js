// Pictures for things to sort: the batch D kit organisms, the food-chain animals, and a few more
// a primary key needs (spider, ladybird, woodlouse, bee, whale, shark, snake, lizard, newt,
// penguin, bat). Flat planes, one shade, `.body` keylines; base centre at (0,0), up is -y.
import { h } from '../../kit/index.js';
import { organism, ORGANISM_SIZE } from '../../kit/batch-D.js';
import { drawOrganism, sizeOf as fcSize } from '../food_chain/organisms.js';
import { drawSubjectAt } from '../../kit/subjects.js'; // libdata: the shared picture library
const isLib = k => typeof k === 'string' && k.startsWith('lib:');

const B = 'body';
const st = (c, w) => ({ fill: 'none', stroke: c, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
const eye = (g, x, y, r = 3) => h('circle', { cx: x, cy: y, r, fill: 'var(--ink)' }, g);

const D = {
  spider(g) {
    for (const s of [-1, 1]) for (const [a, b, c] of [[-14, -36, -40], [-6, -26, -46], [4, -14, -44], [12, -4, -34]])
      h('path', { d: `M${s * 4} -24 Q ${s * (16 - a * .3)} ${a - 18} ${s * (30 + Math.abs(c) * .2)} ${b - 8} L ${s * (40 + Math.abs(a) * .2)} 0`, ...st('var(--ink-2)', 3.2) }, g);
    h('ellipse', { cx: 0, cy: -30, rx: 20, ry: 17, fill: 'var(--soil-deep)', cls: B }, g);
    h('circle', { cx: 0, cy: -50, r: 10, fill: 'var(--soil-deep)', cls: B }, g);
    h('path', { d: 'M-8 -32 Q 0 -22 8 -32', ...st('var(--rabbit)', 3) }, g);
    for (const x of [-4, 4]) h('circle', { cx: x, cy: -53, r: 2.4, fill: 'var(--fur-light)' }, g);
  },
  ladybird(g) {
    for (const x of [-18, -2, 14]) h('path', { d: `M${x} -8 L ${x - 6} 0`, ...st('var(--ink-2)', 3) }, g);
    h('circle', { cx: 32, cy: -16, r: 11, fill: 'var(--ink-2)', cls: B }, g);
    h('path', { d: 'M-36 -6 C -36 -42 30 -42 30 -6 Z', fill: 'var(--berry)', cls: B }, g);
    h('path', { d: 'M-3 -32 L -3 -6', ...st('var(--ink-2)', 2.5) }, g);
    for (const [x, y, r] of [[-20, -18, 5], [-12, -28, 4], [12, -27, 4], [18, -15, 5], [-26, -10, 3.5]]) h('circle', { cx: x, cy: y, r, fill: 'var(--ink-2)' }, g);
    for (const x of [30, 36]) eye(g, x, -19, 2.2);
  },
  woodlouse(g) {
    for (let i = 0; i < 7; i++) h('path', { d: `M${-30 + i * 10} -4 L ${-32 + i * 10} 0`, ...st('var(--ink-2)', 2.5) }, g);
    h('path', { d: 'M-44 -4 C -44 -34 40 -34 44 -6 Z', fill: 'var(--stone)', cls: B }, g);
    for (let i = 0; i < 6; i++) { const x = -30 + i * 12; h('path', { d: `M${x} -5 Q ${x + 4} -18 ${x} -29`, ...st('var(--stone-shade)', 2.5) }, g); }
    h('path', { d: 'M42 -10 L 52 -22 M40 -8 L 54 -12', ...st('var(--ink-2)', 2) }, g);
  },
  bee(g) {
    h('ellipse', { cx: -8, cy: -52, rx: 16, ry: 10, fill: 'var(--water-hi)', stroke: 'var(--glass-edge)', 'stroke-width': 'var(--sw-hair)', transform: 'rotate(-30 -8 -52)' }, g);
    h('ellipse', { cx: 8, cy: -54, rx: 14, ry: 9, fill: 'var(--water-hi)', stroke: 'var(--glass-edge)', 'stroke-width': 'var(--sw-hair)', transform: 'rotate(-60 8 -54)' }, g);
    for (const x of [-10, 0, 10]) h('path', { d: `M${x} -16 L ${x - 4} 0`, ...st('var(--ink-2)', 2.5) }, g);
    h('polygon', { points: '-30,-28 -40,-26 -30,-22', fill: 'var(--ink-2)' }, g);
    h('ellipse', { cx: -2, cy: -26, rx: 28, ry: 16, fill: 'var(--sun)', cls: B }, g);
    for (const x of [-12, 2]) h('path', { d: `M${x} ${-26 - 15} L ${x} ${-26 + 15}`, ...st('var(--ink-2)', 6) }, g);
    h('circle', { cx: 30, cy: -28, r: 10, fill: 'var(--ink-2)', cls: B }, g);
    h('path', { d: 'M34 -36 Q 38 -46 44 -48', ...st('var(--ink-2)', 2) }, g);
  },
  whale(g) {
    h('path', { d: 'M-80 -36 L -100 -54 L -92 -30 L -102 -10 L -78 -28 Z', fill: 'var(--sea-3)', cls: B }, g);
    h('path', { d: 'M-82 -30 C -60 -46 -10 -62 40 -58 C 84 -54 100 -30 96 -14 C 92 -2 70 2 30 0 C -20 -2 -60 -10 -82 -30 Z', fill: 'var(--sea-3)', cls: B }, g);
    h('path', { d: 'M96 -14 C 92 -2 70 2 30 0 C -10 -2 -40 -8 -60 -20 C -20 -12 40 -10 96 -14 Z', fill: 'var(--sea-hi)' }, g);
    h('path', { d: 'M20 -12 L 2 4 L 30 -6 Z', fill: 'var(--sea-2)' }, g);
    eye(g, 66, -24, 3);
  },
  shark(g) {
    h('path', { d: 'M-72 -26 L -92 -50 L -82 -24 L -94 -4 Z', fill: 'var(--metal-shade)', cls: B }, g);
    h('path', { d: 'M-4 -40 L 10 -66 L 24 -40 Z', fill: 'var(--metal-shade)', cls: B }, g);
    h('path', { d: 'M-80 -24 C -50 -42 30 -46 70 -34 C 86 -28 92 -20 88 -16 C 70 -6 20 -2 -20 -6 C -50 -10 -70 -16 -80 -24 Z', fill: 'var(--metal)', cls: B }, g);
    h('path', { d: 'M88 -16 C 70 -6 20 -2 -20 -6 C -40 -8 -56 -12 -66 -18 C -20 -14 40 -14 88 -16 Z', fill: 'var(--cloud)' }, g);
    h('path', { d: 'M10 -10 L -6 4 L 24 -8 Z', fill: 'var(--metal-shade)' }, g);
    for (const x of [44, 50, 56]) h('path', { d: `M${x} -30 L ${x - 2} -20`, ...st('var(--metal-shade)', 2) }, g);
    eye(g, 70, -30, 2.6);
  },
  snake(g) {
    h('path', { d: 'M-70 -10 C -54 -34 -30 -34 -16 -14 C -2 6 22 6 34 -16 C 42 -30 52 -36 60 -34', ...st('var(--leaf)', 13) }, g);
    h('path', { d: 'M-70 -10 C -54 -34 -30 -34 -16 -14 C -2 6 22 6 34 -16 C 42 -30 52 -36 60 -34', ...st('var(--life-shade)', 3), 'stroke-dasharray': '6 10' }, g);
    h('ellipse', { cx: 66, cy: -36, rx: 13, ry: 9, fill: 'var(--leaf)', cls: B }, g);
    h('path', { d: 'M78 -36 L 88 -36 L 92 -40 M88 -36 L 92 -32', ...st('var(--berry)', 2) }, g);
    eye(g, 70, -39, 2.4);
  },
  lizard(g) {
    h('path', { d: 'M-24 -16 C -50 -16 -70 -10 -76 -2 C -60 -8 -40 -8 -22 -8 Z', fill: 'var(--leaf)', cls: B }, g);
    for (const [x, s] of [[-14, -1], [26, 1]]) { h('path', { d: `M${x} -12 L ${x - 8} -2 L ${x - 14} 0`, ...st('var(--life-shade)', 4) }, g); h('path', { d: `M${x + 4} -12 L ${x + 10} -2 L ${x + 16} 0`, ...st('var(--life-shade)', 4) }, g); }
    h('ellipse', { cx: 6, cy: -14, rx: 32, ry: 9, fill: 'var(--leaf)', cls: B }, g);
    for (const x of [-8, 4, 16]) h('circle', { cx: x, cy: -16, r: 2.2, fill: 'var(--life-shade)' }, g);
    h('path', { d: 'M34 -20 C 46 -24 58 -20 60 -14 C 56 -8 44 -8 34 -10 Z', fill: 'var(--leaf)', cls: B }, g);
    eye(g, 50, -17, 2.2);
  },
  newt(g) {
    h('path', { d: 'M-24 -16 C -50 -22 -66 -16 -72 -6 C -56 -10 -40 -8 -22 -8 Z', fill: 'var(--soil-deep)', cls: B }, g);
    for (const x of [-14, 26]) { h('path', { d: `M${x} -12 L ${x - 6} -2 L ${x - 12} 0`, ...st('var(--soil-deep)', 4) }, g); h('path', { d: `M${x + 4} -12 L ${x + 10} -2 L ${x + 16} 0`, ...st('var(--soil-deep)', 4) }, g); }
    h('ellipse', { cx: 6, cy: -14, rx: 32, ry: 9, fill: 'var(--soil-deep)', cls: B }, g);
    h('path', { d: 'M-22 -8 C 0 -4 20 -4 36 -8', ...st('var(--fox)', 4) }, g);
    h('path', { d: 'M34 -20 C 46 -24 58 -20 60 -14 C 56 -8 44 -8 34 -10 Z', fill: 'var(--soil-deep)', cls: B }, g);
    h('circle', { cx: 50, cy: -17, r: 2.6, fill: 'var(--sun)' }, g);
  },
  penguin(g) {
    for (const x of [-10, 10]) h('ellipse', { cx: x, cy: -3, rx: 9, ry: 4, fill: 'var(--sun)' }, g);
    h('path', { d: 'M0 -92 C 22 -92 30 -60 28 -36 C 26 -12 16 -2 0 -2 C -16 -2 -26 -12 -28 -36 C -30 -60 -22 -92 0 -92 Z', fill: 'var(--soil-deep)', cls: B }, g);
    h('path', { d: 'M0 -70 C 16 -70 20 -48 18 -32 C 16 -14 10 -8 0 -8 C -10 -8 -16 -14 -18 -32 C -20 -48 -16 -70 0 -70 Z', fill: 'var(--cloud)' }, g);
    h('path', { d: 'M-26 -58 C -36 -46 -38 -30 -34 -22 C -30 -32 -28 -44 -26 -52 Z', fill: 'var(--soil-deep)' }, g);
    h('path', { d: 'M26 -58 C 36 -46 38 -30 34 -22 C 30 -32 28 -44 26 -52 Z', fill: 'var(--soil-deep)' }, g);
    h('polygon', { points: '-5,-76 5,-76 0,-68', fill: 'var(--sun)' }, g);
    for (const x of [-8, 8]) h('circle', { cx: x, cy: -82, r: 2.6, fill: 'var(--cloud)' }, g);
  },
  bat(g) {
    h('path', { d: 'M0 -40 C -20 -60 -46 -66 -64 -56 C -56 -50 -54 -42 -56 -34 C -48 -40 -40 -38 -34 -30 C -28 -38 -18 -38 -10 -30 Z', fill: 'var(--rabbit-shade)', cls: B }, g);
    h('path', { d: 'M0 -40 C 20 -60 46 -66 64 -56 C 56 -50 54 -42 56 -34 C 48 -40 40 -38 34 -30 C 28 -38 18 -38 10 -30 Z', fill: 'var(--rabbit-shade)', cls: B }, g);
    h('ellipse', { cx: 0, cy: -34, rx: 11, ry: 16, fill: 'var(--rabbit)', cls: B }, g);
    h('path', { d: 'M-8 -50 L -10 -62 L -2 -52 M8 -50 L 10 -62 L 2 -52', fill: 'var(--rabbit)', stroke: 'var(--rabbit)', 'stroke-width': 3, 'stroke-linejoin': 'round' }, g);
    for (const x of [-4, 4]) eye(g, x, -44, 1.8);
  },
};
const SIZE = { spider: { w: 100, h: 62 }, ladybird: { w: 84, h: 40 }, woodlouse: { w: 100, h: 30 }, bee: { w: 90, h: 66 }, whale: { w: 204, h: 62 },
  shark: { w: 186, h: 66 }, snake: { w: 164, h: 46 }, lizard: { w: 140, h: 26 }, newt: { w: 136, h: 26 }, penguin: { w: 76, h: 92 }, bat: { w: 132, h: 66 } };
const KIT = ['rabbit', 'fox', 'bird', 'hen', 'chick', 'fish', 'frog', 'butterfly', 'caterpillar', 'worm', 'flower', 'tree', 'grass'];
const FC = ['mouse', 'owl', 'snail', 'beetle', 'heron', 'seal', 'polarbear', 'zebra', 'giraffe', 'lion'];
export const PICTURES = [...KIT, ...FC, ...Object.keys(D)].sort();
const NAMES = { polarbear: 'polar bear', hen: 'hen (chicken)' };
export const PICTURE_LABEL = k => NAMES[k] || k;
export function pictureSize(kind) {
  if (isLib(kind)) return { w: 100, h: 100 }; // libdata
  if (SIZE[kind]) return SIZE[kind];
  if (FC.includes(kind)) return fcSize(kind);
  const z = ORGANISM_SIZE[kind]; return z ? { w: z.w, h: z.h } : null;
}
/** Draw `kind` fitted inside a w × hh box whose base centre is (x, y). Returns the <g>, or null for no picture. */
export function drawPicture(p, kind, x, y, w, hh, a = {}) {
  if (isLib(kind)) return drawSubjectAt(p, kind.slice(4), x, y, w, hh, { anchor: 'base', area: 1, a }); // libdata
  const z = pictureSize(kind); if (!z) return null;
  const s = Math.min(w / z.w, hh / z.h);
  if (D[kind]) { const outer = h('g', a, p); const g = h('g', { transform: `translate(${x} ${y}) scale(${s})` }, outer); D[kind](g); return outer; }
  if (FC.includes(kind)) return drawOrganism(p, kind, x, y, s, a);
  return organism(p, kind, x, y, s, a);
}

/** Draw `kind` centred on (cx, cy), fitted by its drawn outline (strokes included) inside a w × hh box,
 *  and no bigger than `area` of the box, so a long whale and a tall penguin look the same size.
 *  `cap`, when given, is the most area (units²) the outline may cover, so a row of pictures can match. */
export function drawPictureFit(p, kind, cx, cy, w, hh, area = .5, a = {}, cap = 0) {
  const z = pictureSize(kind); if (!z) return null;
  const outer = h('g', a, p); drawPicture(outer, kind, 0, 0, z.w, z.h);
  let bb = null; try { bb = outer.getBBox(); } catch (e) { bb = null; }
  const pad = 6; // strokes sit outside the outline getBBox reports
  bb = bb && bb.width > 0 ? { x: bb.x - pad, y: bb.y - pad, width: bb.width + 2 * pad, height: bb.height + 2 * pad } : { x: -z.w / 2, y: -z.h, width: z.w, height: z.h };
  let s = Math.min(w / bb.width, hh / bb.height, Math.sqrt(area * w * hh / (bb.width * bb.height)));
  if (cap > 0) s = Math.min(s, Math.sqrt(cap / (bb.width * bb.height)));
  outer.setAttribute('transform', `translate(${(cx - s * (bb.x + bb.width / 2)).toFixed(1)} ${(cy - s * (bb.y + bb.height / 2)).toFixed(1)}) scale(${s.toFixed(4)})`);
  outer.dataset.area = Math.round(s * s * bb.width * bb.height);
  return outer;
}
/** The most area (units²) `kind` can cover in a w × hh box under drawPictureFit, or 0. */
export function pictureArea(p, kind, w, hh, area = .5) {
  const g = drawPictureFit(p, kind, 0, 0, w, hh, area); if (!g) return 0; const A = +g.dataset.area; g.remove(); return A;
}
