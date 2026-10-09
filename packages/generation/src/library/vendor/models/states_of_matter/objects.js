// Bench objects for states_of_matter (model-private). Flat planes, one shaded face, tokens only.
// Each draws with its base centre on the bench top at (x, y) and returns {spot:[x,y], top} where
// spot is where the lens looks and top is the highest point drawn (for layout).
import { h } from '../../kit/index.js';

const MIX = (a, b, k) => `color-mix(in oklab,${a} ${k}%,${b})`;
/** Body colours per substance: face, top, side, liquid, liquid surface. */
export const SUBSTANCE_COLS = {
  water: { face: 'var(--ice)', top: 'var(--ice-top)', side: 'var(--ice-side)', liq: 'var(--sea-1)', surf: 'var(--water-hi)', lens: 'var(--ice-top)' },
  chocolate: { face: MIX('var(--hue-brown)', 'var(--shade)', 72), top: 'var(--hue-brown)', side: MIX('var(--hue-brown)', 'var(--shade)', 52), liq: MIX('var(--hue-brown)', 'var(--shade)', 72), surf: 'var(--hue-brown)', lens: 'var(--lens-bg)' },
  butter: { face: 'var(--cheese)', top: MIX('var(--cheese)', 'var(--paper)', 70), side: MIX('var(--cheese)', 'var(--shade)', 78), liq: MIX('var(--cheese)', 'var(--hue-gold)', 70), surf: MIX('var(--cheese)', 'var(--paper)', 70), lens: 'var(--lens-bg)' },
  wax: { face: MIX('var(--paper)', 'var(--ink-3)', 88), top: 'var(--paper)', side: MIX('var(--paper)', 'var(--shade)', 76), liq: MIX('var(--paper)', 'var(--hue-gold)', 82), surf: 'var(--paper)', lens: 'var(--lens-bg)' },
};

/** A block of solid on a saucer (ice cube, chocolate bar, butter, wax block). */
export function solidBlock(p, x, y, sub) {
  const c = SUBSTANCE_COLS[sub] || SUBSTANCE_COLS.water;
  const [w, hh] = sub === 'chocolate' ? [128, 34] : sub === 'butter' ? [112, 54] : sub === 'wax' ? [84, 84] : [76, 72];
  const d = 22, by = y - 6, x0 = x - w / 2 - 8;
  h('ellipse', { cx: x, cy: y + 4, rx: w / 2 + 34, ry: 15, fill: 'var(--ground-shadow)' }, p);
  h('ellipse', { cx: x, cy: y, rx: w / 2 + 30, ry: 15, fill: 'var(--plate-rim)', cls: 'body' }, p);
  h('ellipse', { cx: x, cy: y - 1, rx: w / 2 + 6, ry: 10, fill: 'var(--plate-well)' }, p);
  h('polygon', { points: `${x0},${by - hh} ${x0 + w},${by - hh} ${x0 + w},${by} ${x0},${by}`, fill: c.face, cls: 'body' }, p);
  h('polygon', { points: `${x0},${by - hh} ${x0 + w},${by - hh} ${x0 + w + d},${by - hh - d * .8} ${x0 + d},${by - hh - d * .8}`, fill: c.top, cls: 'body' }, p);
  h('polygon', { points: `${x0 + w},${by - hh} ${x0 + w + d},${by - hh - d * .8} ${x0 + w + d},${by - d * .8} ${x0 + w},${by}`, fill: c.side, cls: 'body' }, p);
  if (sub === 'chocolate') for (let i = 1; i < 4; i++) h('line', { x1: x0 + w * i / 4, x2: x0 + w * i / 4, y1: by - hh, y2: by, stroke: c.side, 'stroke-width': 'var(--sw-rule)' }, p);
  if (sub === 'water') h('path', { d: `M${x0 + 12} ${by - hh + 12} h 18 M${x0 + 12} ${by - hh + 24} h 10`, stroke: 'var(--ice-top)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, p);
  if (sub === 'wax') h('line', { x1: x0 + w / 2 + d / 2, x2: x0 + w / 2 + d / 2, y1: by - hh - d * .4, y2: by - hh - d * .4 - 22, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, p);
  return { spot: [x0 + w * .45, by - hh * .5], top: by - hh - d - 22 };
}

/** A glass bowl holding the liquid. */
export function liquidBowl(p, x, y, sub) {
  const c = SUBSTANCE_COLS[sub] || SUBSTANCE_COLS.water;
  h('ellipse', { cx: x, cy: y + 4, rx: 108, ry: 13, fill: 'var(--ground-shadow)' }, p);
  h('path', { d: `M${x - 102} ${y - 50} C ${x - 96} ${y - 8}, ${x - 56} ${y + 4}, ${x} ${y + 4} C ${x + 56} ${y + 4}, ${x + 96} ${y - 8}, ${x + 102} ${y - 50} Z`, fill: c.liq }, p);
  h('ellipse', { cx: x, cy: y - 50, rx: 102, ry: 13, fill: c.surf }, p);
  h('path', { d: `M${x - 106} ${y - 62} C ${x - 100} ${y - 6}, ${x - 58} ${y + 7}, ${x} ${y + 7} C ${x + 58} ${y + 7}, ${x + 100} ${y - 6}, ${x + 106} ${y - 62}`, fill: 'none', stroke: 'var(--glass-edge)', 'stroke-width': 'var(--sw-struct)' }, p);
  h('ellipse', { cx: x, cy: y - 62, rx: 106, ry: 15, fill: 'none', stroke: 'var(--glass-edge)', 'stroke-width': 'var(--sw-struct)' }, p);
  return { spot: [x, y - 24], top: y - 78 };
}

/** Visible steam: a puff of tiny droplets (the vapour itself cannot be seen). */
function puff(p, cx, cy, s) {
  for (const [f, dy] of [['var(--cloud-shade)', 4], ['var(--cloud)', 0]]) {
    const k = h('g', { fill: f, transform: `translate(${cx} ${cy + dy}) scale(${s})` }, p);
    for (const [px, py, r] of [[-22, 0, 16], [0, -10, 20], [22, 0, 15]]) h('circle', { cx: px, cy: py, r }, k);
    h('rect', { x: -36, y: -2, width: 72, height: 16, rx: 8 }, k);
  }
}

/** A pan of boiling water on a hob; the lens looks at the clear gap above the water. */
export function panOnHob(p, x, y, sub, { steam = true } = {}) {
  const c = SUBSTANCE_COLS[sub] || SUBSTANCE_COLS.water;
  h('ellipse', { cx: x, cy: y + 4, rx: 118, ry: 12, fill: 'var(--hob)', cls: 'body' }, p);
  for (const r of [86, 60]) h('ellipse', { cx: x, cy: y + 4, rx: r, ry: r * .1, fill: 'none', stroke: 'var(--heat)', 'stroke-width': 'var(--sw-struct)' }, p);
  h('path', { d: `M${x - 86} ${y - 70} L${x + 86} ${y - 70} L${x + 76} ${y - 8} Q${x + 74} ${y} ${x + 64} ${y} L${x - 64} ${y} Q${x - 74} ${y} ${x - 76} ${y - 8} Z`, fill: 'var(--metal)', cls: 'body' }, p);
  h('path', { d: `M${x + 44} ${y - 70} L${x + 86} ${y - 70} L${x + 76} ${y - 8} Q${x + 74} ${y} ${x + 64} ${y} L${x + 38} ${y} Z`, fill: 'var(--metal-shade)' }, p);
  h('path', { d: `M${x + 84} ${y - 68} L${x + 130} ${y - 74} Q${x + 140} ${y - 74} ${x + 140} ${y - 66} Q${x + 140} ${y - 58} ${x + 130} ${y - 58} L${x + 82} ${y - 52} Z`, fill: 'var(--metal-shade)', cls: 'body' }, p);
  h('ellipse', { cx: x, cy: y - 70, rx: 86, ry: 13, fill: 'var(--metal-in)', cls: 'body' }, p);
  h('ellipse', { cx: x, cy: y - 66, rx: 76, ry: 8, fill: c.liq }, p);
  for (const [dx, r] of [[-38, 5], [-8, 4], [30, 6], [52, 4]]) h('circle', { cx: x + dx, cy: y - 66, r, fill: 'none', stroke: c.surf, 'stroke-width': 'var(--sw-rule)' }, p);
  if (steam) { puff(p, x + 92, y - 114, .6); puff(p, x + 118, y - 142, .65); }
  return { spot: [x - 14, y - 94], top: y - 150 };
}

/** A shallow dish of water in a warm room, evaporating; the lens looks at the air above it. */
export function dish(p, x, y, sub) {
  const c = SUBSTANCE_COLS[sub] || SUBSTANCE_COLS.water;
  h('ellipse', { cx: x, cy: y + 4, rx: 104, ry: 14, fill: 'var(--ground-shadow)' }, p);
  h('path', { d: `M${x - 98} ${y - 22} L${x - 86} ${y} H${x + 86} L${x + 98} ${y - 22} Z`, fill: 'var(--plate-rim)', cls: 'body' }, p);
  h('ellipse', { cx: x, cy: y - 22, rx: 98, ry: 14, fill: 'var(--plate-rim)', cls: 'body' }, p);
  h('ellipse', { cx: x, cy: y - 20, rx: 84, ry: 9, fill: c.liq }, p);
  return { spot: [x, y - 92], top: y - 120 };
}

/** A mug of hot water: warm, damp air above it (the source of vapour before condensing). */
export function mug(p, x, y, sub) {
  const c = SUBSTANCE_COLS[sub] || SUBSTANCE_COLS.water, mh = 66;
  h('ellipse', { cx: x, cy: y + 4, rx: 62, ry: 10, fill: 'var(--ground-shadow)' }, p);
  h('path', { d: `M${x + 40} ${y - mh + 12} C ${x + 74} ${y - mh + 12}, ${x + 74} ${y - 14}, ${x + 40} ${y - 14}`, fill: 'none', stroke: 'var(--plate-rim)', 'stroke-width': 'var(--sw-lens)', 'stroke-linecap': 'round' }, p);
  h('rect', { x: x - 46, y: y - mh, width: 92, height: mh, rx: 10, fill: 'var(--plate-rim)', cls: 'body' }, p);
  h('rect', { x: x + 16, y: y - mh, width: 30, height: mh, rx: 10, fill: MIX('var(--plate-rim)', 'var(--shade)', 82) }, p);
  h('ellipse', { cx: x, cy: y - mh, rx: 46, ry: 9, fill: 'var(--plate-well)' }, p);
  h('ellipse', { cx: x, cy: y - mh + 2, rx: 38, ry: 6, fill: c.liq }, p);
  puff(p, x + 92, y - 104, .7);
  return { spot: [x - 10, y - mh - 26], top: y - mh - 60 };
}

/** A kettle of just-boiled water: warm, damp air above it (the source of vapour before condensing). */
export function kettle(p, x, y) {
  h('ellipse', { cx: x, cy: y + 4, rx: 66, ry: 10, fill: 'var(--ground-shadow)' }, p);
  h('path', { d: `M${x - 30} ${y - 70} Q${x} ${y - 112} ${x + 30} ${y - 70}`, fill: 'none', stroke: 'var(--metal-shade)', 'stroke-width': 'var(--sw-lens)', 'stroke-linecap': 'round' }, p);
  h('path', { d: `M${x + 40} ${y - 38} L${x + 76} ${y - 74} L${x + 84} ${y - 70} L${x + 48} ${y - 18} Z`, fill: 'var(--metal-shade)', cls: 'body' }, p);
  h('path', { d: `M${x - 44} ${y - 70} L${x + 44} ${y - 70} L${x + 54} ${y - 6} Q${x + 54} ${y} ${x + 46} ${y} L${x - 46} ${y} Q${x - 54} ${y} ${x - 54} ${y - 6} Z`, fill: 'var(--metal)', cls: 'body' }, p);
  h('path', { d: `M${x + 18} ${y - 70} L${x + 44} ${y - 70} L${x + 54} ${y - 6} Q${x + 54} ${y} ${x + 46} ${y} L${x + 22} ${y} Z`, fill: 'var(--metal-shade)' }, p);
  h('ellipse', { cx: x, cy: y - 70, rx: 44, ry: 8, fill: 'var(--metal-in)', cls: 'body' }, p);
  h('circle', { cx: x, cy: y - 80, r: 6, fill: 'var(--metal-shade)' }, p);
  puff(p, x + 64, y - 100, .42);
  return { spot: [x + 6, y - 116], top: y - 140 };
}

/** A cold window hung on the wall, its glass misted with condensed droplets. */
export function coldWindow(p, x, y) {
  const w = 150, hh = 80, x0 = x - w / 2, y0 = y - 8 - hh;
  h('rect', { x: x0 - 8, y: y0 - 8, width: w + 16, height: hh + 8, fill: 'var(--board)', cls: 'body' }, p);
  h('rect', { x: x0, y: y0, width: w, height: hh, fill: 'var(--sky-bot)' }, p);
  h('line', { x1: x, x2: x, y1: y0, y2: y0 + hh, stroke: 'var(--board)', 'stroke-width': 'var(--sw-struct)' }, p);
  h('rect', { x: x0 - 16, y: y - 8, width: w + 32, height: 10, rx: 3, fill: 'var(--board)', cls: 'body' }, p);
  // droplets mist the cold glass
  const drops = [[-60, -22, 4], [-46, -40, 3], [-28, -24, 5], [-56, -62, 3], [-16, -52, 4], [-36, -74, 3], [20, -24, 4], [36, -46, 3], [58, -26, 5], [26, -70, 3], [60, -64, 3], [12, -42, 2.5], [-8, -78, 2.5], [44, -80, 2.5]];
  for (const [dx, dy, r] of drops) { h('circle', { cx: x + dx, cy: y + dy, r, fill: 'var(--water)' }, p); h('circle', { cx: x + dx - r * .3, cy: y + dy - r * .3, r: r * .35, fill: 'var(--water-hi)' }, p); }
  return { spot: [x - 28, y - 40], top: y0 - 8 };
}
