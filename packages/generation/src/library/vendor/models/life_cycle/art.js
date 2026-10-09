// life_cycle private art: the few stages the kit's organism library does not draw
// (eggs on a leaf, a bee at a flower, a seed head, a bean plant and its pods).
// Flat planes, one shaded face, tokens only. Base centre at (0,0), up is negative y.
import { h } from '../../kit/index.js';
import { organism, organismBox, ORGANISM_SIZE } from '../../kit/batch-D.js';

const B = 'body';
const stem = (g, d, w = 5) => h('path', { d, fill: 'none', stroke: 'var(--life-shade)', 'stroke-width': w, 'stroke-linecap': 'round' }, g);
const leafAt = (g, x, y, rot, rx = 16, ry = 9, shade = false) =>
  h('ellipse', { cx: x, cy: y, rx, ry, transform: `rotate(${rot} ${x} ${y})`, fill: shade ? 'var(--life-shade)' : 'var(--leaf)', cls: B }, g);
function bee(g, x, y) {
  h('ellipse', { cx: x - 2, cy: y - 12, rx: 9, ry: 6, fill: 'var(--cloud)', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)', transform: `rotate(-24 ${x - 2} ${y - 12})` }, g);
  h('ellipse', { cx: x + 7, cy: y - 12, rx: 8, ry: 5, fill: 'var(--cloud)', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)', transform: `rotate(22 ${x + 7} ${y - 12})` }, g);
  h('ellipse', { cx: x, cy: y, rx: 14, ry: 9, fill: 'var(--sun)', cls: B }, g);
  for (const dx of [-3, 5]) h('line', { x1: x + dx, y1: y - 8, x2: x + dx, y2: y + 8, stroke: 'var(--ink)', 'stroke-width': 4 }, g);
  h('circle', { cx: x - 15, cy: y - 1, r: 6, fill: 'var(--ink)' }, g);
}

const PRIV = {
  leafEggs: { w: 124, h: 60, draw(g) {
    h('path', { d: 'M-60 -12 C -34 -56 30 -62 62 -26 C 34 -8 -22 2 -60 -12 Z', fill: 'var(--leaf)', cls: B }, g);
    h('path', { d: 'M-60 -12 C -22 2 34 -8 62 -26 C 30 -20 -24 -16 -60 -12 Z', fill: 'var(--life-shade)' }, g);
    stem(g, 'M-60 -12 L -66 -6', 4);
    for (const [x, y] of [[-24, -30], [-10, -35], [4, -38], [18, -38], [-4, -27], [10, -29]]) h('ellipse', { cx: x, cy: y, rx: 5.5, ry: 6.5, fill: 'var(--seed)', cls: B }, g);
  } },
  flowerBee: { w: 96, h: 136, kit: 'flower', extra(g) { bee(g, 30, -126); } },
  seedhead: { w: 112, h: 156, draw(g) {
    stem(g, 'M0 0 Q 4 -50 0 -96');
    h('path', { d: 'M1 -34 C -14 -50 -34 -48 -38 -38 C -26 -30 -12 -28 1 -34 Z', fill: 'var(--leaf)', cls: B }, g);
    for (let i = 0; i < 14; i++) { const a = -Math.PI / 2 + (i - 6.5) * .42, x2 = Math.cos(a) * 30, y2 = -104 + Math.sin(a) * 30;
      h('line', { x1: 0, y1: -104, x2, y2, stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }, g); h('circle', { cx: x2, cy: y2, r: 3.2, fill: 'var(--seedhead)' }, g); }
    h('circle', { cx: 0, cy: -104, r: 7, fill: 'var(--seedhead)', cls: B }, g);
    for (const [x, y] of [[40, -142], [52, -108], [44, -76]]) { h('line', { x1: x, y1: y, x2: x - 6, y2: y + 12, stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }, g);
      h('circle', { cx: x, cy: y, r: 6, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }, g); h('ellipse', { cx: x - 6, cy: y + 13, rx: 2.5, ry: 3.5, fill: 'var(--seedhead)' }, g); }
  } },
  beanPlant: { w: 84, h: 156, draw(g) { beanPlant(g, false); } },
  beanFlowers: { w: 84, h: 156, draw(g) { beanPlant(g, true); } },
  pods: { w: 96, h: 150, draw(g) {
    h('line', { x1: 12, y1: 0, x2: 12, y2: -150, stroke: 'var(--wood-1)', 'stroke-width': 5, 'stroke-linecap': 'round' }, g);
    stem(g, 'M4 -150 C -8 -136 20 -126 6 -112');
    leafAt(g, -16, -136, -30, 18, 10); leafAt(g, 30, -128, 30, 16, 9, true);
    for (const [x, len, f] of [[-12, 96, 'var(--leaf)'], [20, 80, 'var(--life-shade)']]) {
      const top = -112, bot = top + len;
      h('path', { d: `M${x - 3} ${top} C ${x - 14} ${top + len * .3} ${x - 14} ${top + len * .7} ${x - 4} ${bot} C ${x} ${bot + 8} ${x + 8} ${bot + 6} ${x + 8} ${bot - 4} C ${x + 12} ${top + len * .6} ${x + 10} ${top + len * .3} ${x + 3} ${top} Z`, fill: f, cls: B }, g);
      for (let k = 1; k <= 3; k++) h('ellipse', { cx: x - 2, cy: top + len * k / 4.2, rx: 5, ry: 7, fill: f === 'var(--leaf)' ? 'var(--life-shade)' : 'var(--leaf)' }, g);
    }
    for (const x of [-40, 40]) { h('ellipse', { cx: x, cy: -8, rx: 13, ry: 8, fill: 'var(--seed)', cls: B }, g); h('path', { d: `M${x} -16 A13 8 0 0 1 ${x} 0 A6 8 0 0 0 ${x} -16 Z`, fill: 'var(--seedhead)' }, g); }
  } },
};
function beanPlant(g, flowers) {
  h('line', { x1: 12, y1: 0, x2: 12, y2: -156, stroke: 'var(--wood-1)', 'stroke-width': 5, 'stroke-linecap': 'round' }, g);
  stem(g, 'M0 0 C -12 -30 24 -48 8 -80 C -6 -106 26 -122 12 -150');
  leafAt(g, -20, -40, -24); leafAt(g, 34, -66, 28, 16, 9, true); leafAt(g, -14, -100, -20); leafAt(g, 34, -124, 24, 15, 9, true);
  if (flowers) for (const [x, y] of [[-4, -70], [28, -98], [-2, -134]]) for (const [dx, dy] of [[0, 0], [7, -6], [-6, -7]]) h('circle', { cx: x + dx, cy: y + dy, r: 5, fill: 'var(--berry)', cls: B }, g);
}

/** Box and centring of any stage kind (kit organism or private art), at scale 1. */
export function artSize(kind) {
  const pv = PRIV[kind]; if (pv) return { w: pv.w, h: pv.h, below: 0, cx: 0 };
  const z = ORGANISM_SIZE[kind] || ORGANISM_SIZE.seed, bx = organismBox(kind, 0, 0, 1);
  return { w: z.w, h: z.h, below: z.below || 0, cx: bx.x + z.w / 2 };
}
/** Draw a stage kind with its base centre at (x, y), scale s. Attributes go on the outer group. */
export function drawArt(p, kind, x, y, s, a = {}) {
  const pv = PRIV[kind];
  if (!pv) return organism(p, kind, x, y, s, a);
  const outer = h('g', a, p);
  if (pv.kit) { organism(outer, pv.kit, x, y, s); const g = h('g', { transform: `translate(${x} ${y}) scale(${s})` }, outer); pv.extra(g); }
  else { const g = h('g', { transform: `translate(${x} ${y}) scale(${s})` }, outer); pv.draw(g); }
  return outer;
}
