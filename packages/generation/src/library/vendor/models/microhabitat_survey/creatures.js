// Minibeasts for the microhabitat survey: flat side views, facing right, base centre at (0, 0)
// on the ground line. Tokens only; one shaded face; `.body` keylines for themes that want them.
// Worm and frog come from the batch D organism library.
import { h } from '../../kit/index.js';
import { organism, ORGANISM_SIZE } from '../../kit/batch-D.js';

const B = 'body';
const ln = (g, x1, y1, x2, y2, col, w = 'var(--sw-lead)') => h('line', { x1, y1, x2, y2, stroke: col, 'stroke-width': w, 'stroke-linecap': 'round' }, g);
const cv = (g, d, col, w = 'var(--sw-lead)') => h('path', { d, fill: 'none', stroke: col, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);

const D = {
  woodlouse(g) {
    for (let x = -24; x <= 24; x += 8) ln(g, x, -4, x - 3, 0, 'var(--ink-2)', 'var(--sw-hair)');
    h('path', { d: 'M-31 -3 C -31 -22 -6 -26 10 -25 C 26 -23 34 -13 33 -3 Z', fill: 'var(--ink-3)', cls: B }, g);
    h('path', { d: 'M-31 -3 L 33 -3 L 32 -8 C 10 -10 -14 -10 -30 -8 Z', fill: 'var(--ink-2)' }, g);
    for (const x of [-20, -10, 0, 10, 20]) { const top = -3 - 21 * Math.sqrt(Math.max(0, 1 - Math.pow((x + 1) / 33, 2))); ln(g, x, -8, x + 1, top + 3, 'var(--ink-2)', 'var(--sw-hair)'); }
    h('ellipse', { cx: 33, cy: -8, rx: 5, ry: 5, fill: 'var(--ink-2)' }, g);
    cv(g, 'M36 -11 Q 44 -22 50 -16', 'var(--ink-2)');
  },
  slug(g) {
    h('path', { d: 'M-42 0 C -44 -6 -30 -12 -10 -14 C 6 -25 26 -25 34 -14 C 40 -10 44 -6 44 0 Z', fill: 'var(--trunk)', cls: B }, g);
    h('path', { d: 'M-42 0 L 44 0 C 40 -4 -30 -5 -42 0 Z', fill: 'var(--soil-deep)' }, g);
    h('ellipse', { cx: 14, cy: -16, rx: 17, ry: 6, fill: 'var(--wood-line)' }, g);
    cv(g, 'M36 -12 L 44 -30', 'var(--trunk)', 'var(--sw-struct)'); cv(g, 'M32 -13 L 36 -32', 'var(--trunk)', 'var(--sw-struct)');
    h('circle', { cx: 44, cy: -30, r: 3, fill: 'var(--ink)' }, g); h('circle', { cx: 36, cy: -32, r: 3, fill: 'var(--ink)' }, g);
  },
  snail(g) {
    h('path', { d: 'M-34 0 C -34 -6 -20 -10 0 -10 C 18 -10 30 -14 34 -7 L 38 0 Z', fill: 'var(--stone-shade)', cls: B }, g);
    cv(g, 'M32 -9 L 40 -26', 'var(--stone-shade)', 'var(--sw-struct)'); cv(g, 'M29 -10 L 33 -27', 'var(--stone-shade)', 'var(--sw-struct)');
    h('circle', { cx: 40, cy: -26, r: 3, fill: 'var(--ink)' }, g); h('circle', { cx: 33, cy: -27, r: 3, fill: 'var(--ink)' }, g);
    h('circle', { cx: -4, cy: -28, r: 20, fill: 'var(--wood-line)', cls: B }, g);
    cv(g, 'M-3 -28 a 4 4 0 1 1 5 4 a 9 9 0 1 1 -13 -10 a 14 14 0 1 1 22 14', 'var(--trunk)');
  },
  centipede(g) {
    for (let i = 0; i < 10; i++) { const x = -40 + i * 8; ln(g, x + 3, -7, x - 2, 0, 'var(--fox-shade)', 'var(--sw-hair)'); ln(g, x + 4, -7, x + 9, 0, 'var(--fox-shade)', 'var(--sw-hair)'); }
    h('rect', { x: -42, y: -14, width: 86, height: 9, rx: 4.5, fill: 'var(--fox-shade)' }, g);
    for (let i = 0; i < 10; i++) h('rect', { x: -41 + i * 8.4, y: -15, width: 7.4, height: 8, rx: 2, fill: 'var(--fox)' }, g);
    h('ellipse', { cx: 47, cy: -11, rx: 6, ry: 5, fill: 'var(--fox-shade)', cls: B }, g);
    cv(g, 'M51 -13 Q 58 -26 66 -24', 'var(--fox-shade)'); cv(g, 'M-42 -11 Q -50 -16 -56 -10', 'var(--fox-shade)');
  },
  millipede(g) {
    for (let i = 0; i < 11; i++) { const x = -40 + i * 8; ln(g, x - 2, -4, x - 3, 0, 'var(--ink-2)', 'var(--sw-hair)'); ln(g, x + 2, -4, x + 3, 0, 'var(--ink-2)', 'var(--sw-hair)'); }
    for (let i = 0; i < 11; i++) h('circle', { cx: -40 + i * 8, cy: -10, r: 6.5, fill: 'var(--ink-2)' }, g);
    h('circle', { cx: 46, cy: -9, r: 6, fill: 'var(--ink)', cls: B }, g);
    cv(g, 'M50 -12 Q 54 -20 58 -18', 'var(--ink-2)');
  },
  spider(g) {
    for (const sd of [-1, 1]) for (let i = 0; i < 4; i++) {
      const kx = sd * (12 + i * 5), ky = -32 + i * 2, fx = sd * (18 + i * 7);
      cv(g, `M${sd * 2} -18 L ${kx} ${ky} L ${fx} 0`, 'var(--ink)');
    }
    h('ellipse', { cx: -12, cy: -20, rx: 13, ry: 11, fill: 'var(--ink)', cls: B }, g);
    h('ellipse', { cx: 6, cy: -18, rx: 8, ry: 7, fill: 'var(--ink)', cls: B }, g);
  },
  beetle(g) {
    for (const [a, b] of [[-12, -18], [0, -2], [12, 18]]) cv(g, `M${a} -6 L ${(a + b) / 2} -2 L ${b} 0`, 'var(--ink)');
    h('path', { d: 'M-26 -5 C -26 -22 12 -24 17 -10 L 17 -5 Z', fill: 'var(--ink)', cls: B }, g);
    ln(g, -22, -13, 14, -14, 'var(--ink-2)', 'var(--sw-hair)');
    h('ellipse', { cx: 21, cy: -10, rx: 7, ry: 6, fill: 'var(--ink)', cls: B }, g);
    h('circle', { cx: 29, cy: -9, r: 4.5, fill: 'var(--ink)' }, g);
    cv(g, 'M31 -11 Q 38 -19 43 -15', 'var(--ink)');
  },
  ant(g) {
    for (const [a, b] of [[-2, -12], [2, 1], [5, 13]]) cv(g, `M${a} -10 L ${(a + b) / 2} -5 L ${b} 0`, 'var(--ink)', 'var(--sw-hair)');
    h('ellipse', { cx: -14, cy: -11, rx: 10, ry: 7, fill: 'var(--ink)' }, g);
    h('circle', { cx: -4, cy: -10, r: 2.5, fill: 'var(--ink)' }, g);
    h('ellipse', { cx: 3, cy: -11, rx: 6, ry: 4, fill: 'var(--ink)' }, g);
    h('circle', { cx: 14, cy: -13, r: 5, fill: 'var(--ink)' }, g);
    cv(g, 'M17 -16 L 21 -24 L 27 -21', 'var(--ink)', 'var(--sw-hair)');
  },
  ladybird(g) {
    for (const [a, b] of [[-10, -14], [0, 0], [10, 14]]) ln(g, a, -3, b, 0, 'var(--ink)', 'var(--sw-hair)');
    h('path', { d: 'M-18 -3 A 18 17 0 0 1 18 -3 Z', fill: 'var(--berry)', cls: B }, g);
    ln(g, 0, -3, 0, -20, 'var(--ink)', 'var(--sw-hair)');
    for (const [x, y, r] of [[-9, -10, 3.2], [8, -12, 3.2], [-4, -16, 2.6], [11, -6, 2.6], [-12, -5, 2.4]]) h('circle', { cx: x, cy: y, r, fill: 'var(--ink)' }, g);
    h('path', { d: 'M17 -3 A 7 7 0 0 1 24 -10 A 7 7 0 0 1 25 -3 Z', fill: 'var(--ink)' }, g);
  },
  earwig(g) {
    for (const [a, b] of [[-6, -12], [4, 2], [14, 20]]) ln(g, a, -5, b, 0, 'var(--trunk)', 'var(--sw-hair)');
    cv(g, 'M-28 -8 C -38 -8 -42 -13 -40 -18', 'var(--trunk)', 'var(--sw-struct)'); cv(g, 'M-28 -6 C -38 -3 -44 -5 -45 -10', 'var(--trunk)', 'var(--sw-struct)');
    h('path', { d: 'M-30 -4 C -30 -12 18 -14 24 -9 C 26 -6 24 -4 20 -4 Z', fill: 'var(--trunk)', cls: B }, g);
    h('path', { d: 'M-12 -11 L 6 -12 L 6 -6 L -12 -6 Z', fill: 'var(--wood-line)' }, g);
    h('circle', { cx: 27, cy: -8, r: 5, fill: 'var(--trunk)' }, g);
    cv(g, 'M31 -10 Q 39 -18 47 -16', 'var(--trunk)', 'var(--sw-hair)');
  },
  grasshopper(g) {
    ln(g, 18, -10, 22, 0, 'var(--life-shade)'); ln(g, 10, -10, 12, 0, 'var(--life-shade)');
    h('path', { d: 'M-34 -14 C -30 -22 18 -26 28 -18 C 32 -14 30 -9 24 -9 L -30 -10 Z', fill: 'var(--leaf)', cls: B }, g);
    h('path', { d: 'M23 -21 C 34 -27 40 -15 34 -8 L 24 -10 Z', fill: 'var(--leaf)', cls: B }, g);
    h('circle', { cx: 32, cy: -17, r: 2.6, fill: 'var(--ink)' }, g);
    h('path', { d: 'M2 -13 C -6 -28 -16 -40 -24 -39 C -21 -30 -12 -17 -5 -11 Z', fill: 'var(--life-shade)', cls: B }, g);
    ln(g, -24, -39, -36, 0, 'var(--life-shade)');
    cv(g, 'M34 -22 Q 46 -38 56 -40', 'var(--life-shade)', 'var(--sw-hair)');
  },
};
const SZ = {
  woodlouse: { w: 84, h: 26, cx: 8 }, slug: { w: 90, h: 32, cx: 1 }, snail: { w: 76, h: 48, cx: 2 }, centipede: { w: 124, h: 26, cx: 5 },
  millipede: { w: 100, h: 20, cx: 7 }, spider: { w: 74, h: 33, cx: 0 }, beetle: { w: 70, h: 24, cx: 8 }, ant: { w: 52, h: 24, cx: 2 },
  ladybird: { w: 46, h: 20, cx: 3 }, earwig: { w: 94, h: 18, cx: 1 }, grasshopper: { w: 94, h: 42, cx: 10 },
  worm: { w: ORGANISM_SIZE.worm.w, h: ORGANISM_SIZE.worm.h, cx: 0 }, frog: { w: ORGANISM_SIZE.frog.w, h: ORGANISM_SIZE.frog.h, cx: 0 },
};
// how big each is drawn beside the others (not to scale: all enlarged so each can be seen)
export const REL = { woodlouse: .9, slug: 1, snail: 1, centipede: .95, millipede: .95, spider: .9, beetle: .9, ant: .8, ladybird: .85, earwig: .9, grasshopper: 1, worm: .8, frog: .8 };
export const CREATURE_KINDS = Object.keys(SZ);
export const creatureSize = k => SZ[k];
/** Draw a creature, base centre at (x, y). Returns the outer group with .box. */
export function drawCreature(p, kind, x, y, s = 1, a = {}) {
  const z = SZ[kind];
  if (kind === 'worm' || kind === 'frog') { const el = organism(p, kind, x - z.cx * s, y, s, a); el.box = { x: x - z.w * s / 2, y: y - z.h * s, w: z.w * s, h: z.h * s }; return el; }
  const outer = h('g', a, p); const g = h('g', { transform: `translate(${x - z.cx * s} ${y}) scale(${s})` }, outer);
  D[kind](g); outer.box = { x: x - z.w * s / 2, y: y - z.h * s, w: z.w * s, h: z.h * s }; return outer;
}
