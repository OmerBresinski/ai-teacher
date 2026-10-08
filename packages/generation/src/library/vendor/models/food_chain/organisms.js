// Food-chain organisms the batch D kit does not have. Same contract as kit organism():
// base centre at (0,0), up is negative y, flat planes with one shade, `.body` on main fills.
import { h } from '../../kit/index.js';
import { organism as kitOrganism, ORGANISM_SIZE, habitatObject } from '../../kit/batch-D.js';

const B = 'body';
const st = (c, w) => ({ fill: 'none', stroke: c, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
const eye = (g, x, y, r = 3) => h('circle', { cx: x, cy: y, r, fill: 'var(--ink)' }, g);
const shadow = (g, rx) => h('ellipse', { cx: 0, cy: 0, rx, ry: 6, fill: 'var(--ground-shadow)' }, g);

const D = {
  mouse(g) {
    shadow(g, 40);
    h('path', { d: 'M-30 -10 C -44 -8 -54 -2 -64 -10', ...st('var(--ear)', 3) }, g);
    h('ellipse', { cx: -4, cy: -18, rx: 30, ry: 18, fill: 'var(--stone)', cls: B }, g);
    h('path', { d: 'M-30 -14 C -26 -2 10 0 20 -6 C 6 -10 -14 -10 -30 -14 Z', fill: 'var(--stone-shade)' }, g);
    h('path', { d: 'M16 -32 C 30 -36 42 -26 46 -16 L 22 -8 Z', fill: 'var(--stone)', cls: B }, g);
    h('circle', { cx: 18, cy: -38, r: 10, fill: 'var(--stone)', cls: B }, g);
    h('circle', { cx: 18, cy: -38, r: 5.5, fill: 'var(--ear)' }, g);
    h('circle', { cx: 46, cy: -16, r: 3, fill: 'var(--ear)' }, g); eye(g, 32, -25, 2.6);
  },
  owl(g) {
    shadow(g, 30);
    for (const x of [-8, 8]) h('path', { d: `M${x} -10 L ${x} 0`, ...st('var(--sun)', 3) }, g);
    h('path', { d: 'M-28 -40 C -30 -76 -16 -96 0 -96 C 16 -96 30 -76 28 -40 C 26 -18 14 -8 0 -8 C -14 -8 -26 -18 -28 -40 Z', fill: 'var(--rabbit)', cls: B }, g);
    h('path', { d: 'M-16 -50 C -14 -30 14 -30 16 -50 C 16 -26 8 -12 0 -12 C -8 -12 -16 -26 -16 -50 Z', fill: 'var(--fur-light)' }, g);
    h('path', { d: 'M14 -64 C 30 -60 32 -28 20 -14 C 26 -30 24 -50 14 -64 Z', fill: 'var(--rabbit-shade)' }, g);
    h('path', { d: 'M-14 -64 C -30 -60 -32 -28 -20 -14 C -26 -30 -24 -50 -14 -64 Z', fill: 'var(--rabbit-shade)' }, g);
    for (const x of [-11, 11]) { h('circle', { cx: x, cy: -76, r: 11, fill: 'var(--fur-light)' }, g); eye(g, x, -76, 4.5); }
    h('polygon', { points: '-4,-70 4,-70 0,-60', fill: 'var(--sun)' }, g);
    h('polygon', { points: '-24,-92 -18,-104 -12,-94', fill: 'var(--rabbit)' }, g); h('polygon', { points: '24,-92 18,-104 12,-94', fill: 'var(--rabbit)' }, g);
  },
  pondweed(g) {
    for (const [x, hh, f] of [[-18, 90, 'var(--life-shade)'], [0, 112, 'var(--leaf)'], [18, 80, 'var(--life-shade)']]) {
      h('path', { d: `M${x} 0 C ${x - 10} ${-hh * .35} ${x + 10} ${-hh * .65} ${x} ${-hh}`, ...st(f, 4) }, g);
      for (let i = 1; i < 5; i++) { const y = -hh * i / 5, s = i % 2 ? 1 : -1;
        h('ellipse', { cx: x + s * 10, cy: y, rx: 11, ry: 5, transform: `rotate(${s * -25} ${x + s * 10} ${y})`, fill: f, cls: B }, g); }
    }
  },
  snail(g) {
    h('path', { d: 'M-34 0 C -36 -10 -20 -12 10 -10 L 30 -12 C 36 -22 40 -30 38 -36 M30 -12 C 32 -24 30 -32 26 -38', fill: 'var(--stone)', stroke: 'var(--stone-shade)', 'stroke-width': 3, 'stroke-linecap': 'round' }, g);
    h('path', { d: 'M-36 0 L 34 0 C 34 -8 30 -12 24 -12 L -30 -10 C -36 -8 -38 -4 -36 0 Z', fill: 'var(--stone)', cls: B }, g);
    h('circle', { cx: -4, cy: -30, r: 24, fill: 'var(--thatch)', cls: B }, g);
    h('path', { d: 'M-4 -30 m -3 0 a 3 3 0 1 1 6 0 a 9 9 0 1 1 -16 -4 a 16 16 0 1 1 30 8', ...st('var(--thatch-shade)', 3) }, g);
  },
  beetle(g) {
    for (const [x, d] of [[-14, -1], [0, 0], [14, 1]]) h('path', { d: `M${x} -14 L ${x + d * 10 - 6} 0`, ...st('var(--ink-2)', 3) }, g);
    h('ellipse', { cx: -2, cy: -22, rx: 34, ry: 15, fill: 'var(--life-shade)', cls: B }, g);
    h('path', { d: 'M-34 -22 C -24 -14 18 -12 32 -20 C 30 -10 16 -8 -2 -8 C -20 -8 -32 -12 -34 -22 Z', fill: 'var(--ink-2)' }, g);
    h('ellipse', { cx: 36, cy: -22, rx: 9, ry: 8, fill: 'var(--ink-2)', cls: B }, g);
    h('path', { d: 'M42 -26 L 52 -34 M42 -20 L 54 -22', ...st('var(--ink-2)', 2) }, g);
  },
  heron(g) {
    shadow(g, 30);
    for (const x of [-6, 6]) h('path', { d: `M${x} -70 L ${x + (x < 0 ? -4 : 2)} 0`, ...st('var(--ink-3)', 3.5) }, g);
    h('path', { d: 'M-40 -96 C -34 -120 10 -126 26 -104 C 30 -90 14 -72 -8 -70 C -26 -70 -42 -80 -40 -96 Z', fill: 'var(--stone)', cls: B }, g);
    h('path', { d: 'M-40 -96 C -20 -88 4 -86 26 -104 C 26 -88 10 -74 -8 -72 C -26 -72 -40 -82 -40 -96 Z', fill: 'var(--stone-shade)' }, g);
    h('path', { d: 'M18 -108 C 34 -120 12 -138 22 -152', ...st('var(--stone)', 10) }, g);
    h('circle', { cx: 24, cy: -156, r: 9, fill: 'var(--stone)', cls: B }, g);
    h('polygon', { points: '30,-160 62,-154 30,-150', fill: 'var(--sun)' }, g);
    h('path', { d: 'M18 -160 L 0 -166', ...st('var(--ink-2)', 3) }, g); eye(g, 26, -158, 2.4);
  },
  plankton(g) {
    const P = [[-30, -14, 9], [-10, -26, 7], [12, -12, 10], [30, -28, 7], [0, -40, 6], [-26, -36, 5]];
    for (const [x, y, r] of P) { h('circle', { cx: x, cy: y, r, fill: 'var(--leaf)', cls: B }, g); h('circle', { cx: x, cy: y, r: r * .45, fill: 'var(--life-shade)' }, g); }
    h('rect', { x: -44, y: -26, width: 18, height: 6, rx: 3, transform: 'rotate(-20 -35 -23)', fill: 'var(--life)' }, g);
    h('rect', { x: 18, y: -46, width: 20, height: 6, rx: 3, transform: 'rotate(30 28 -43)', fill: 'var(--life)' }, g);
  },
  zooplankton(g) {
    for (const [x, y, s] of [[-18, -14, 1], [16, -34, .8]]) {
      const k = h('g', { transform: `translate(${x} ${y}) scale(${s})` }, g);
      h('path', { d: 'M-24 0 C -20 -14 12 -16 22 -4 C 14 4 -8 6 -24 0 Z', fill: 'var(--berry)', cls: B }, k);
      h('path', { d: 'M-24 0 C -10 4 10 2 22 -4 C 14 6 -10 8 -24 0 Z', fill: 'var(--berry-shade)' }, k);
      h('path', { d: 'M-24 0 L -34 -6 L -32 4 Z', fill: 'var(--berry-shade)' }, k);
      for (const lx of [-8, 0, 8]) h('path', { d: `M${lx} 2 L ${lx - 3} 10`, ...st('var(--berry-shade)', 1.5) }, k);
      h('path', { d: 'M20 -6 C 30 -14 34 -22 36 -28', ...st('var(--berry-shade)', 1.5) }, k); eye(k, 16, -6, 2);
    }
  },
  seal(g) {
    shadow(g, 70);
    h('path', { d: 'M-72 -8 L -86 -22 L -88 0 Z', fill: 'var(--stone-shade)' }, g);
    h('path', { d: 'M-74 -10 C -60 -36 10 -44 40 -34 C 56 -30 62 -14 56 -4 C 30 2 -40 2 -74 -10 Z', fill: 'var(--stone)', cls: B }, g);
    h('path', { d: 'M-70 -8 C -40 -2 30 0 56 -4 C 40 -12 -30 -16 -70 -8 Z', fill: 'var(--fur-light)' }, g);
    h('path', { d: 'M4 -10 C 0 0 10 4 20 2 Z', fill: 'var(--stone-shade)' }, g);
    h('circle', { cx: 52, cy: -40, r: 18, fill: 'var(--stone)', cls: B }, g);
    eye(g, 58, -46, 3.5); h('circle', { cx: 69, cy: -38, r: 3, fill: 'var(--ink-2)' }, g);
    h('path', { d: 'M66 -34 L 80 -32 M66 -31 L 78 -26', ...st('var(--ink-3)', 1.5) }, g);
  },
  polarbear(g) {
    shadow(g, 84);
    for (const lx of [-58, -36, 34, 54]) h('rect', { x: lx, y: -46, width: 20, height: 46, rx: 8, fill: 'var(--cloud-shade)' }, g);
    h('path', { d: 'M-76 -54 C -72 -96 40 -100 64 -76 C 74 -64 70 -44 56 -40 L -60 -40 C -74 -42 -78 -48 -76 -54 Z', fill: 'var(--fur-light)', cls: B }, g);
    h('path', { d: 'M-60 -42 C -20 -36 30 -36 56 -40 C 40 -50 -20 -52 -60 -42 Z', fill: 'var(--cloud-shade)' }, g);
    h('path', { d: 'M56 -78 C 70 -84 86 -78 92 -68 C 96 -60 90 -54 80 -56 L 60 -56 Z', fill: 'var(--fur-light)', cls: B }, g);
    h('circle', { cx: 62, cy: -84, r: 6, fill: 'var(--cloud-shade)' }, g);
    eye(g, 76, -72, 2.8); h('circle', { cx: 94, cy: -64, r: 4, fill: 'var(--ink)' }, g);
  },
  zebra(g) {
    shadow(g, 70);
    for (const lx of [-50, -32, 30, 46]) { h('rect', { x: lx, y: -58, width: 10, height: 58, rx: 4, fill: 'var(--fur-light)', cls: B }, g); h('rect', { x: lx, y: -6, width: 10, height: 6, fill: 'var(--ink)' }, g); }
    h('path', { d: 'M-58 -60 C -60 -90 50 -94 58 -66 C 60 -54 52 -48 40 -48 L -48 -48 C -58 -50 -60 -54 -58 -60 Z', fill: 'var(--fur-light)', cls: B }, g);
    for (const x of [-40, -24, -8, 8, 24, 40]) h('path', { d: `M${x} -86 Q ${x + 6} -68 ${x} -50`, ...st('var(--ink)', 5) }, g);
    h('path', { d: 'M-58 -64 C -70 -62 -74 -50 -70 -40', ...st('var(--ink)', 3) }, g);
    h('path', { d: 'M44 -78 L 62 -118 L 78 -112 L 60 -70 Z', fill: 'var(--fur-light)', cls: B }, g);
    for (const y of [-106, -96, -86]) h('path', { d: `M${50 + (y + 106) * -.3} ${y + 12} L ${70 + (y + 106) * -.3} ${y + 4}`, ...st('var(--ink)', 4) }, g);
    h('path', { d: 'M58 -120 L 76 -116 L 92 -86 C 94 -78 84 -76 80 -82 Z', fill: 'var(--fur-light)', cls: B }, g);
    h('path', { d: 'M46 -80 L 60 -122', ...st('var(--ink)', 6) }, g);
    eye(g, 74, -108, 3); h('path', { d: 'M86 -82 L 92 -86', ...st('var(--ink)', 6) }, g);
  },
  giraffe(g) {
    shadow(g, 50);
    for (const lx of [-34, -20, 18, 30]) h('rect', { x: lx, y: -84, width: 9, height: 84, rx: 4, fill: 'var(--sun)', cls: B }, g);
    h('path', { d: 'M-40 -84 C -40 -112 30 -124 44 -100 C 48 -90 40 -80 30 -80 L -32 -80 C -40 -80 -42 -82 -40 -84 Z', fill: 'var(--sun)', cls: B }, g);
    h('path', { d: 'M26 -100 L 52 -176 L 66 -172 L 44 -94 Z', fill: 'var(--sun)', cls: B }, g);
    h('path', { d: 'M50 -184 C 60 -192 78 -186 84 -174 C 86 -168 80 -164 74 -166 L 54 -170 Z', fill: 'var(--sun)', cls: B }, g);
    for (const [x, y, r] of [[-22, -100, 8], [-2, -104, 9], [18, -98, 7], [-12, -88, 6], [8, -88, 6], [38, -120, 6], [46, -146, 6], [54, -164, 5]]) h('circle', { cx: x, cy: y, r, fill: 'var(--fox-shade)' }, g);
    h('path', { d: 'M56 -186 L 54 -198 M62 -188 L 62 -200', ...st('var(--fox-shade)', 3) }, g);
    eye(g, 68, -178, 2.8);
  },
  lion(g) {
    shadow(g, 80);
    h('path', { d: 'M-70 -60 C -92 -60 -96 -90 -84 -96', ...st('var(--thatch)', 5) }, g);
    h('circle', { cx: -84, cy: -96, r: 6, fill: 'var(--fox-shade)' }, g);
    for (const lx of [-58, -38, 34, 52]) h('rect', { x: lx, y: -50, width: 15, height: 50, rx: 6, fill: 'var(--thatch-shade)' }, g);
    h('path', { d: 'M-72 -62 C -70 -96 40 -100 58 -76 C 66 -62 58 -48 46 -46 L -60 -46 C -72 -48 -74 -54 -72 -62 Z', fill: 'var(--thatch)', cls: B }, g);
    h('circle', { cx: 56, cy: -86, r: 34, fill: 'var(--fox-shade)', cls: B }, g);
    h('circle', { cx: 64, cy: -84, r: 20, fill: 'var(--thatch)', cls: B }, g);
    h('path', { d: 'M74 -80 C 84 -80 88 -74 84 -68 L 70 -68 Z', fill: 'var(--fur-light)' }, g);
    eye(g, 70, -90, 3); h('circle', { cx: 84, cy: -78, r: 3.5, fill: 'var(--ink)' }, g);
  },
  acacia(g) { habitatObject(g, 'acacia', 0, 0, .9); },
};
const SIZE = {
  mouse: { w: 112, h: 48 }, owl: { w: 64, h: 106 }, pondweed: { w: 64, h: 118 }, snail: { w: 80, h: 56 }, beetle: { w: 96, h: 40 },
  heron: { w: 104, h: 166 }, plankton: { w: 92, h: 50 }, zooplankton: { w: 96, h: 56 }, seal: { w: 172, h: 60 },
  polarbear: { w: 180, h: 100 }, zebra: { w: 156, h: 124 }, giraffe: { w: 130, h: 202 }, lion: { w: 186, h: 122 }, acacia: { w: 126, h: 104 },
};
// x of the drawing's visual centre relative to its base centre
const CX = { mouse: -8, seal: -4, polarbear: 4, zebra: 14, giraffe: 22, lion: 4, heron: 10, beetle: 8 };

export const sizeOf = kind => SIZE[kind] || ORGANISM_SIZE[kind] || { w: 80, h: 80 };
export const cxOf = kind => CX[kind] || 0;
/** Draw any food-chain organism, base centre at (x, y), scaled by s. Returns the outer <g>. */
export function drawOrganism(p, kind, x, y, s = 1, a = {}) {
  if (!D[kind]) return kitOrganism(p, kind, x, y, s, a);
  const outer = h('g', a, p); const g = h('g', { transform: `translate(${x - cxOf(kind) * s} ${y}) scale(${s})` }, outer);
  D[kind](g); outer.dataset.organism = kind; return outer;
}
