// Model-private art for evolution_adaptation. Flat planes, tokens only, `.body` keylines.
// Each draw function: base centre at (0,0), up is negative y; `t` is the trait value 0..1
// (0 = the first trait word, 1 = the second). Sizes in ART_SIZE.
import { h } from '../../kit/index.js';

const B = 'body';
const mix = (a, pa, b) => `color-mix(in oklab, ${a} ${Math.round(pa)}%, ${b})`;

export const ART_SIZE = { moth: { w: 70, h: 46 }, beetle: { w: 54, h: 56 }, finch: { w: 72, h: 52 }, giraffe: { w: 84, h: 106 } };

const DRAW = {
  // peppered moth from above, wings spread: pale with dark speckles, or dark (carbonaria)
  moth(g, t) {
    const wing = mix('var(--shade)', 8 + t * 80, 'var(--cloud)');
    const hind = mix('var(--shade)', 16 + t * 76, 'var(--cloud)');
    // a dark moth gets a faint pale rim, so on dark bark it reads as hidden, not missing
    if (t >= .5) for (const s of [-1, 1]) for (const d of [`M0 -16 C ${-10 * s} -14 ${-27 * s} -10 ${-25 * s} -2 C ${-15 * s} 2 ${-4 * s} -4 0 -8 Z`, `M0 -30 C ${-14 * s} -44 ${-35 * s} -43 ${-35 * s} -27 C ${-31 * s} -16 ${-14 * s} -14 0 -18 Z`])
      h('path', { d, fill: 'none', stroke: mix('var(--cloud)', 50, 'transparent'), 'stroke-width': 4, 'stroke-linejoin': 'round' }, g);
    for (const s of [-1, 1]) {
      h('path', { d: `M0 -16 C ${-10 * s} -14 ${-27 * s} -10 ${-25 * s} -2 C ${-15 * s} 2 ${-4 * s} -4 0 -8 Z`, fill: hind, cls: B }, g);
      h('path', { d: `M0 -30 C ${-14 * s} -44 ${-35 * s} -43 ${-35 * s} -27 C ${-31 * s} -16 ${-14 * s} -14 0 -18 Z`, fill: wing, cls: B }, g);
      if (t < .5) for (const [x, y, r] of [[-12, -31, 1.8], [-20, -34, 1.5], [-27, -29, 1.7], [-18, -24, 1.5], [-29, -22, 1.3], [-9, -23, 1.3], [-14, -7, 1.4], [-21, -5, 1.2]])
        h('circle', { cx: x * s, cy: y, r, fill: 'var(--shade)' }, g);
      h('path', { d: `M0 -34 Q ${-4 * s} -42 ${-10 * s} -45`, fill: 'none', stroke: 'var(--shade)', 'stroke-width': 'var(--sw-hair)', 'stroke-linecap': 'round' }, g);
    }
    h('ellipse', { cx: 0, cy: -19, rx: 3.6, ry: 14, fill: mix('var(--shade)', 70, 'var(--hue-brown)') }, g);
  },
  // beetle from above: shell colour from green to brown
  beetle(g, t) {
    const shell = mix('var(--hue-brown)', t * 100, 'var(--leaf)');
    for (const s of [-1, 1]) for (const y of [-34, -26, -18])
      h('path', { d: `M${6 * s} ${y} L${19 * s} ${y - 4} L${23 * s} ${y + 4}`, fill: 'none', stroke: 'var(--shade)', 'stroke-width': 'var(--sw-rule)', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
    h('ellipse', { cx: 0, cy: -22, rx: 16, ry: 21, fill: shell, cls: B }, g);
    h('path', { d: 'M0 -42 L0 -2', stroke: mix('var(--shade)', 45, shell), 'stroke-width': 'var(--sw-rule)' }, g);
    h('circle', { cx: 0, cy: -45, r: 7, fill: mix('var(--shade)', 75, shell), cls: B }, g);
  },
  // ground finch from the side, facing right: beak depth and length grow with t
  finch(g, t) {
    const d = 4 + t * 26, L = 5 + t * 22, hy = -35; // beak exaggerated so the two kinds read at a distance
    h('path', { d: 'M-18 -26 L-34 -16 L-30 -12 L-14 -18 Z', fill: 'var(--rabbit-shade)', cls: B }, g);
    for (const x of [-4, 4]) h('path', { d: `M${x} -12 L${x + 1} 0 M${x + 1} 0 l5 0`, fill: 'none', stroke: 'var(--trunk)', 'stroke-width': 'var(--sw-rule)', 'stroke-linecap': 'round' }, g);
    h('ellipse', { cx: -2, cy: -23, rx: 20, ry: 13, fill: 'var(--rabbit)', cls: B }, g);
    h('path', { d: 'M-16 -26 C -8 -32 6 -30 10 -22 C 2 -16 -10 -16 -16 -26 Z', fill: 'var(--rabbit-shade)' }, g);
    h('path', { d: `M21 ${hy - d / 2} L${21 + L} ${hy + d * .08} L21 ${hy + d / 2} Z`, fill: mix('var(--hue-gold)', 70, 'var(--shade)'), cls: B }, g);
    h('circle', { cx: 13, cy: hy, r: 10, fill: 'var(--rabbit)', cls: B }, g);
    h('circle', { cx: 16, cy: hy - 2, r: 2.2, fill: 'var(--shade)' }, g);
  },
  // giraffe from the side, facing right: neck length grows with t (exaggerated, so short-necked
  // ones look squat and long-necked ones tall). `pale` draws the same animal lighter (a fossil relative).
  giraffe(g0, t, pale) {
    const g = h('g', { transform: 'translate(-9 0)' }, g0);
    const L = 8 + t * 54, a = -68 * Math.PI / 180, nx = 14, ny = -34;
    const hx = nx + Math.cos(a) * L, hy = ny + Math.sin(a) * L;
    const coat = pale ? mix('var(--hue-gold)', 72, 'var(--cloud)') : 'var(--hue-gold)';
    const spot = pale ? mix('var(--hue-brown)', 72, 'var(--cloud)') : mix('var(--hue-brown)', 80, 'var(--hue-gold)');
    const leg = pale ? mix('var(--hue-gold)', 50, 'var(--hue-grey)') : mix('var(--hue-gold)', 82, 'var(--shade)');
    for (const x of [-18, -12, 8, 14]) h('path', { d: `M${x} -30 L${x} 0`, stroke: leg, 'stroke-width': 4.5, 'stroke-linecap': 'round' }, g);
    h('path', { d: `M${nx - 4} ${ny + 4} L${hx} ${hy}`, stroke: coat, 'stroke-width': 9, 'stroke-linecap': 'round' }, g);
    for (let i = 1; i <= Math.floor(L / 16); i++) { const u = i / (Math.floor(L / 16) + 1); h('circle', { cx: nx - 2 + (hx - nx + 2) * u, cy: ny + 2 + (hy - ny - 2) * u, r: 2.2, fill: spot }, g); }
    h('ellipse', { cx: -3, cy: -32, rx: 22, ry: 10, fill: coat, cls: B }, g);
    for (const [x, y] of [[-14, -34], [-4, -30], [6, -35], [-9, -27]]) h('circle', { cx: x, cy: y, r: 2.6, fill: spot }, g);
    h('path', { d: 'M-25 -34 L-31 -24', stroke: coat, 'stroke-width': 'var(--sw-rule)', 'stroke-linecap': 'round' }, g);
    h('path', { d: `M${hx - 2} ${hy - 3} l1 -6 M${hx + 3} ${hy - 3} l1 -6`, stroke: spot, 'stroke-width': 'var(--sw-rule)', 'stroke-linecap': 'round' }, g);
    h('ellipse', { cx: hx + 5, cy: hy, rx: 9, ry: 4.6, fill: coat, cls: B, transform: `rotate(18 ${hx + 5} ${hy})` }, g);
    h('circle', { cx: hx + 3, cy: hy - 1.5, r: 1.6, fill: 'var(--shade)' }, g);
  },
};

/** Draw one individual with trait value t, base centre at (x, y), scale s. */
export function individual(p, kind, t, x, y, s = 1, a = {}) {
  const outer = h('g', a, p);
  const g = h('g', { transform: `translate(${x} ${y}) scale(${s})` }, outer);
  DRAW[kind](g, t); return outer;
}

/** A fossil giraffe relative: the same spotted giraffe as the living ones, drawn lighter. */
export function fossilGiraffe(p, t, x, y, s = 1, a = {}) {
  const outer = h('g', a, p);
  const g = h('g', { transform: `translate(${x} ${y}) scale(${s})` }, outer);
  DRAW.giraffe(g, t, true);
  return outer;
}
