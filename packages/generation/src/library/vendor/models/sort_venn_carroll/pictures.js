// Picture cards for sort_venn_carroll: flat, one-plane icons of everyday things a class sorts by
// colour and shape ("red ball", "blue car", "banana"). Each is drawn in a 100 x 100 box centred
// on (0,0), with the kit's `.body` keyline, and scaled to the card. picFor() reads a card's words:
// an optional colour word and a thing it knows. A colour is only taken where the thing comes in
// that colour (a "blue ball", never a "blue banana"); anything else stays a word card.
import { findSubject, drawSubjectAt } from '../../kit/subjects.js'; // libdata
import { h } from '../../kit/index.js';

const B = 'body';
const COLOUR = {
  red: 'var(--hue-red)', blue: 'var(--hue-blue)', green: 'var(--hue-green)', yellow: 'var(--hue-gold)',
  orange: 'var(--hue-orange)', purple: 'var(--hue-purple)', brown: 'var(--hue-brown)', grey: 'var(--hue-grey)', gray: 'var(--hue-grey)',
  pink: 'color-mix(in oklab, var(--hue-red) 45%, var(--paper))', black: 'color-mix(in oklab, var(--ink) 88%, var(--paper))', white: 'var(--paper)',
};
const tint = (c, k) => `color-mix(in oklab, ${c} ${k}%, var(--paper))`;
const shade = (c, k = 72) => `color-mix(in oklab, ${c} ${k}%, var(--ink))`;
const line = (c, w) => ({ fill: 'none', stroke: c, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
const wheel = (g, x, y, r = 11) => { h('circle', { cx: x, cy: y, r, fill: 'var(--ink-2)', cls: B }, g); h('circle', { cx: x, cy: y, r: r * .4, fill: 'var(--metal)' }, g); };
const GLASS = 'color-mix(in oklab, var(--hue-blue) 26%, var(--paper))';

// kind: [draw(g, colour), default colour, colourable]
const K = {
  ball: [(g, c) => {
    h('circle', { cx: 0, cy: 0, r: 40, fill: c, cls: B }, g);
    h('path', { d: 'M-39 -9 Q 0 12 39 -9', ...line(tint(c, 45), 4) }, g);
    h('path', { d: 'M-12 -38 Q 10 0 -12 38', ...line(tint(c, 45), 4) }, g);
  }, 'var(--hue-blue)', true],
  button: [(g, c) => {
    h('circle', { cx: 0, cy: 0, r: 38, fill: c, cls: B }, g);
    h('circle', { cx: 0, cy: 0, r: 27, ...line(shade(c), 3) }, g);
    for (const [x, y] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) h('circle', { cx: x, cy: y, r: 4.5, fill: shade(c, 55) }, g);
  }, 'var(--hue-red)', true],
  'fire engine': [g => {
    const c = 'var(--hue-red)';
    h('rect', { x: -46, y: -14, width: 66, height: 32, rx: 4, fill: c, cls: B }, g);
    h('path', { d: 'M18 18 L 18 -30 L 34 -30 L 46 -10 L 46 18 Z', fill: c, cls: B }, g);
    h('path', { d: 'M24 -24 L 32 -24 L 40 -12 L 24 -12 Z', fill: GLASS }, g);
    h('path', { d: 'M-42 -22 L 12 -22 M-34 -26 L -34 -18 M-22 -26 L -22 -18 M-10 -26 L -10 -18 M2 -26 L 2 -18 M-42 -26 L 12 -26', ...line('var(--metal)', 3) }, g);
    h('rect', { x: -40, y: -4, width: 52, height: 6, fill: tint('var(--hue-gold)', 80) }, g);
    wheel(g, -28, 20); wheel(g, 30, 20);
  }, 'var(--hue-red)', false],
  brick: [(g, c) => {
    h('path', { d: 'M-46 -10 L -32 -26 L 48 -26 L 34 -10 Z', fill: tint(c, 78), cls: B }, g);
    h('path', { d: 'M34 -10 L 48 -26 L 48 10 L 34 26 Z', fill: shade(c, 78), cls: B }, g);
    h('rect', { x: -46, y: -10, width: 80, height: 36, fill: c, cls: B }, g);
  }, 'color-mix(in oklab, var(--hue-red) 78%, var(--hue-brown))', true],
  orange: [g => {
    h('circle', { cx: 0, cy: 4, r: 38, fill: 'var(--hue-orange)', cls: B }, g);
    h('path', { d: 'M2 -34 C 10 -46 26 -46 32 -40 C 24 -32 12 -30 2 -34 Z', fill: 'var(--leaf)', cls: B }, g);
    h('circle', { cx: 0, cy: -33, r: 3, fill: 'var(--trunk)' }, g);
  }, 'var(--hue-orange)', false],
  banana: [g => {
    h('path', { d: 'M-42 -14 C -30 30 22 34 44 -18 C 46 -24 40 -28 36 -24 C 18 8 -16 12 -32 -18 C -34 -24 -42 -22 -42 -14 Z', fill: 'var(--hue-gold)', cls: B }, g);
    h('path', { d: 'M36 -24 L 42 -32', ...line('var(--trunk)', 5) }, g);
  }, 'var(--hue-gold)', false],
  apple: [(g, c) => {
    h('path', { d: 'M0 -24 C -18 -38 -44 -26 -40 4 C -36 30 -14 42 0 34 C 14 42 36 30 40 4 C 44 -26 18 -38 0 -24 Z', fill: c, cls: B }, g);
    h('path', { d: 'M0 -24 Q 1 -36 6 -42', ...line('var(--trunk)', 4) }, g);
    h('path', { d: 'M6 -34 C 14 -46 28 -44 32 -40 C 24 -32 14 -30 6 -34 Z', fill: 'var(--leaf)', cls: B }, g);
  }, 'var(--hue-red)', true],
  leaf: [(g, c) => {
    h('path', { d: 'M-38 34 C -42 -8 -6 -40 40 -38 C 42 6 8 38 -38 34 Z', fill: c, cls: B }, g);
    h('path', { d: 'M-38 34 L 30 -28 M-14 12 L -14 -10 M2 -2 L 16 4 M8 -10 L 8 -26', ...line(shade(c, 60), 3) }, g);
  }, 'var(--hue-green)', true],
  car: [(g, c) => {
    h('path', { d: 'M-26 -6 L -16 -28 L 18 -28 L 30 -6 Z', fill: c, cls: B }, g);
    h('path', { d: 'M-18 -8 L -11 -23 L -1 -23 L -1 -8 Z M5 -8 L 5 -23 L 14 -23 L 22 -8 Z', fill: GLASS }, g);
    h('rect', { x: -46, y: -8, width: 92, height: 26, rx: 9, fill: c, cls: B }, g);
    wheel(g, -26, 18); wheel(g, 26, 18);
  }, 'var(--hue-blue)', true],
  cup: [(g, c) => {
    h('path', { d: 'M20 -16 C 44 -16 44 18 20 18', ...line(c, 9) }, g);
    h('rect', { x: -32, y: -32, width: 54, height: 64, rx: 7, fill: c, cls: B }, g);
    h('rect', { x: -32, y: -32, width: 54, height: 9, rx: 4, fill: tint(c, 70) }, g);
  }, 'var(--hue-teal)', true],
  sock: [(g, c) => {
    h('path', { d: 'M-20 -44 L 12 -44 L 12 8 L 34 20 C 48 28 42 46 26 44 L -8 40 C -24 38 -26 26 -20 16 Z', fill: c, cls: B }, g);
    h('rect', { x: -20, y: -44, width: 32, height: 12, fill: tint(c, 60) }, g);
  }, 'var(--hue-purple)', true],
  hat: [(g, c) => {
    h('ellipse', { cx: 0, cy: 18, rx: 46, ry: 11, fill: c, cls: B }, g);
    h('path', { d: 'M-26 18 C -28 -34 28 -34 26 18 Z', fill: c, cls: B }, g);
    h('path', { d: 'M-26.5 6 C -10 10 10 10 26.5 6 L 26.8 14 C 10 18 -10 18 -26.8 14 Z', fill: shade(c, 70) }, g);
  }, 'var(--hue-blue)', true],
  star: [(g, c) => {
    const p = Array.from({ length: 10 }, (_, i) => { const r = i % 2 ? 18 : 44, t = (-90 + i * 36) * Math.PI / 180; return `${(r * Math.cos(t)).toFixed(1)},${(r * Math.sin(t) + 4).toFixed(1)}`; }).join(' ');
    h('polygon', { points: p, fill: c, cls: B }, g);
  }, 'var(--hue-gold)', true],
  book: [(g, c) => {
    h('rect', { x: -32, y: -40, width: 64, height: 80, rx: 4, fill: c, cls: B }, g);
    h('rect', { x: -32, y: -40, width: 11, height: 80, fill: shade(c, 72) }, g);
    h('rect', { x: -10, y: -24, width: 32, height: 14, rx: 2, fill: tint(c, 30) }, g);
  }, 'var(--hue-blue)', true],
  pencil: [(g, c) => {
    const q = h('g', { transform: 'rotate(-35)' }, g);
    h('rect', { x: -40, y: -9, width: 60, height: 18, fill: c, cls: B }, q);
    h('path', { d: 'M20 -9 L 44 0 L 20 9 Z', fill: 'color-mix(in oklab, var(--hue-gold) 40%, var(--hue-brown))', cls: B }, q);
    h('path', { d: 'M36 -3 L 44 0 L 36 3 Z', fill: 'var(--ink)' }, q);
    h('rect', { x: -50, y: -9, width: 10, height: 18, rx: 3, fill: COLOUR.pink, cls: B }, q);
  }, 'var(--hue-gold)', true],
  plate: [(g, c) => {
    h('circle', { cx: 0, cy: 0, r: 42, fill: c, cls: B }, g);
    h('circle', { cx: 0, cy: 0, r: 29, ...line(c === 'var(--paper)' ? 'var(--ink-3)' : shade(c, 70), 2.5) }, g);
  }, 'var(--paper)', true],
  coin: [g => {
    const c = 'color-mix(in oklab, var(--hue-gold) 78%, var(--hue-brown))';
    h('circle', { cx: 0, cy: 0, r: 36, fill: c, cls: B }, g);
    h('circle', { cx: 0, cy: 0, r: 27, ...line(shade(c, 70), 2.5) }, g);
  }, '', false],
  fish: [(g, c) => {
    h('path', { d: 'M24 0 L 46 -18 L 46 18 Z', fill: c, cls: B }, g);
    h('ellipse', { cx: -6, cy: 0, rx: 36, ry: 22, fill: c, cls: B }, g);
    h('circle', { cx: -26, cy: -5, r: 4, fill: 'var(--ink)' }, g);
    h('path', { d: 'M-4 -14 Q 4 0 -4 14', ...line(shade(c, 70), 3) }, g);
  }, 'var(--hue-orange)', true],
  circle: [(g, c) => h('circle', { cx: 0, cy: 0, r: 40, fill: c, cls: B }, g), 'var(--hue-blue)', true],
  square: [(g, c) => h('rect', { x: -38, y: -38, width: 76, height: 76, rx: 3, fill: c, cls: B }, g), 'var(--hue-blue)', true],
  triangle: [(g, c) => h('path', { d: 'M0 -40 L 44 36 L -44 36 Z', fill: c, cls: B }, g), 'var(--hue-blue)', true],
  rectangle: [(g, c) => h('rect', { x: -46, y: -26, width: 92, height: 52, rx: 3, fill: c, cls: B }, g), 'var(--hue-blue)', true],
};
const ALIAS = { football: 'ball', 'beach ball': 'ball', 'fire truck': 'fire engine', mug: 'cup', counter: 'circle', disc: 'circle' };
export const PICTURE_THINGS = Object.keys(K);

/** The picture for a card's words, as { kind, col }, or null when there is none. */
export function picFor(label) {
  const ws = String(label).toLowerCase().replace(/[^a-z\s]/g, ' ').trim().split(/\s+/).filter(w => w && !/^(a|an|the|some)$/.test(w));
  let col = null;
  if (ws.length > 1 && COLOUR[ws[0]]) col = ws.shift();
  const find = n => K[n] ? n : ALIAS[n];
  const noun = ws.join(' '), kind = find(noun) || find(noun.replace(/s$/, '')) || find(noun.replace(/es$/, ''));
  if (!kind) { const s = col ? null : findSubject(noun); return s ? { kind: `lib:${s.id}`, col: null } : null; } // libdata: the shared picture library
  const [, def, colourable] = K[kind];
  if (col && !colourable) return null; // a colour the thing does not come in: a word card, never a wrong picture
  return { kind, col: col ? COLOUR[col] : def };
}
/** Draw a picture centred at (x, y), size s across. */
export function drawPic(p, pic, x, y, s) {
  if (String(pic.kind).startsWith('lib:')) return drawSubjectAt(p, pic.kind.slice(4), x, y, s, s, { area: .8 }); // libdata
  const g = h('g', { transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(s / 100).toFixed(3)})` }, p);
  K[pic.kind][0](g, pic.col);
  return g;
}
