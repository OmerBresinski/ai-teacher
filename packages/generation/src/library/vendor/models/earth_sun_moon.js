// Earth, Sun and Moon: day and night (the Earth spins), a year (the Earth orbits the Sun),
// the phases of the Moon (sunlight on the Moon, seen from Earth) and the planets' orbits
// (true order, true orbit times). One model, four scenes, chosen by `phenomenon`.
// Everything is seen from above the North Pole, so every spin and orbit runs anticlockwise.
import {
  h, T, measure, clamp, eIO, GRID,
  textBlock, labelGround, line, arrow, headD,
  editable, computed, txt, TEXT_PARAM_FOR, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { PLANETS, planet, globe, moonPhase, PHASE_NAMES } from '../kit/batch-F.js';

export const meta = {
  id: 'earth_sun_moon', name: 'Earth, Sun and Moon', kind: 'scene', version: 1,
  subjects: ['Science'],
  years: ['Y5'],
  teaches: 'Why we have day and night, what a year is, why the Moon has phases, and how the planets orbit the Sun.',
};

const IDS = PLANETS.map(p => p.id), NAMES = PLANETS.map(p => p.name);
const byId = id => PLANETS.find(p => p.id === id);
const PHASE_KEYS = ['new', 'waxing-crescent', 'first-quarter', 'waxing-gibbous', 'full', 'waning-gibbous', 'last-quarter', 'waning-crescent'];

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Earth, Sun and Moon',
  properties: {
    title: TITLE_PARAM('Why we have day and night'),
    phenomenon: { type: 'string', title: 'What it shows', enum: ['day-night', 'year', 'moon-phases', 'planets'],
      'x-labels': ['Day and night (the Earth spins)', 'A year (the Earth orbits the Sun)', 'Phases of the Moon', 'The planets’ orbits'], default: 'day-night' },
    place: { type: 'string', title: 'Our place on the Earth', description: 'The dot that turns with the Earth (day and night).', default: 'Where we live', minLength: 1, maxLength: 30 },
    sunriseSunset: { type: 'boolean', title: 'Mark sunrise and sunset', default: true },
    phases: { type: 'string', title: 'Moon phases shown', enum: ['4', '8'], 'x-labels': ['The four main phases', 'All eight'], default: '8' },
    planets: { type: 'array', title: 'Planets, in order from the Sun', 'x-item': 'a planet', minItems: 2, maxItems: 8,
      default: ['mercury', 'venus', 'earth', 'mars'],
      items: { type: 'string', title: 'Planet', enum: IDS, 'x-labels': NAMES, default: 'earth' } },
    scaleMode: { type: 'string', title: 'What is to scale (planets)', enum: ['not-to-scale', 'true-sizes', 'true-distances'],
      'x-labels': ['Neither: sizes and distances squeezed', 'Planet sizes to scale', 'Distances from the Sun to scale'], default: 'not-to-scale',
      description: 'Sizes and distances can never both be to scale on one slide. The slide always says which are not.' },
    orbitTimes: { type: 'boolean', title: 'Compare orbit times (planets)', default: true },
    // names get the label cap; the view line, the key and the column heading get the phrase cap
    text: TEXT_PARAM_FOR(Object.assign(
      Object.fromEntries(['sun', 'earth', 'day', 'night', 'sunrise', 'sunset', 'sunlight', ...PHASE_KEYS, ...IDS].map(k => [k, 'label'])),
      { view: 'phrase', spin: 'phrase', spins: 'phrase', 'key-space': 'phrase', 'key-earth': 'phrase', times: 'phrase' })),
  },
};

export const presets = [
  { id: 'y5-day-night', name: 'Year 5: why we have day and night', params: { title: 'Why we have day and night', phenomenon: 'day-night', place: 'Where we live' } },
  { id: 'y5-moon-phases', name: 'Year 5: phases of the Moon', params: { title: 'Phases of the Moon', phenomenon: 'moon-phases', phases: '8' } },
  { id: 'y5-planets', name: 'Year 5: the planets’ orbits', params: { title: 'The inner planets', phenomenon: 'planets', planets: ['mercury', 'venus', 'earth', 'mars'] } },
  { id: 'y5-year-orbit', name: 'Year 5: a day and a year', params: { title: 'A day and a year', phenomenon: 'year' } },
];

/* ------------------------------------------------------------------ planets layout (shared by validate and render) */
const PC = [580, 380], PR0 = 62, PR1 = 236, SUN_R = 40, CHIP_W = 132;
// drawn radii keep the real size order: Jupiter > Saturn > Uranus ≈ Neptune > Earth ≈ Venus > Mars > Mercury
const FIXED_R = { mercury: 9, venus: 14.5, earth: 15, mars: 12, jupiter: 22, saturn: 19, uranus: 16, neptune: 15.5 };
// the planets are always drawn in their real order from the Sun, each once, whatever order they were listed in
const planetIds = P => IDS.filter(id => (P.planets || []).includes(id));
function planetLayout(P) {
  const list = planetIds(P).map(byId); const n = list.length;
  const auMax = Math.max(...list.map(p => p.au));
  const radii = P.scaleMode === 'true-distances' ? list.map(p => PR1 * p.au / auMax) : list.map((_, i) => n > 1 ? PR0 + (PR1 - PR0) * i / (n - 1) : PR1);
  const gaps = radii.slice(1).map((r, i) => r - radii[i]); const gMin = gaps.length ? Math.min(...gaps) : 80;
  let sizes;
  if (P.scaleMode === 'true-sizes') { const kmMax = Math.max(...list.map(p => p.radiusKm)), big = Math.min(26, gMin * .45); sizes = list.map(p => big * p.radiusKm / kmMax); }
  else { const cap = Math.max(4, gMin / 2 - 3), rs = list.map(p => FIXED_R[p.id]);
    // one shrink for every planet: the biggest fits its gap, and Saturn's ring (2r each side) stays inside the next orbits
    const f = Math.min(1.4, cap / Math.max(...rs), list.some(p => p.id === 'saturn') ? (gMin - 4) / (2 * FIXED_R.saturn) : 1);
    sizes = rs.map(r => r * f); }
  return { list, n, radii, sizes, gMin };
}
const fmtPeriod = d => d < 1000 ? `${Math.round(d)} days` : `${(d / 365.25) < 20 ? (d / 365.25).toFixed(1) : Math.round(d / 365.25)} years`;
const scaleNote = P => P.phenomenon !== 'planets' ? 'Not to scale'
  : P.scaleMode === 'true-sizes' ? 'Planet sizes to scale; distances and the Sun are not'
    : P.scaleMode === 'true-distances' ? 'Distances to scale; sizes are not' : 'Not to scale: sizes and distances';

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const W = [];
  if (R.length) return result(R);
  const ids = P.planets, uniq = planetIds(P);
  // the planets are drawn in their real order from the Sun, each once: a repeat or a swap is a warning, not a refusal
  const twice = ids.findIndex((id, i) => ids.indexOf(id) !== i);
  if (twice >= 0) W.push({ path: `planets.${twice}`, reason: `${byId(ids[twice]).name} is in the list twice. Each planet has one orbit, so it is shown once.` });
  const swap = ids.findIndex((id, i) => i && IDS.indexOf(id) < IDS.indexOf(ids[i - 1]));
  if (swap > 0) W.push({ path: `planets.${swap}`, reason: `${byId(ids[swap]).name} is closer to the Sun than ${byId(ids[swap - 1]).name}, so the planets are shown in their real order from the Sun: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune.` });
  if (P.phenomenon === 'planets' && uniq.length < 2) R.push({ path: 'planets', reason: 'Choose at least two different planets, so their orbits can be compared.' });
  if (R.length) return result(R, W);
  if (P.phenomenon === 'planets') {
    const L = planetLayout(P);
    if (P.scaleMode === 'true-distances' && (L.radii[0] < SUN_R + 18 || L.gMin < 22)) {
      const far = L.list[L.n - 1].name;
      R.push({ path: 'scaleMode', reason: `At true distances with ${far} on the slide, the inner orbits squeeze into a blur next to the Sun. Show fewer of the outer planets, or choose “Neither”.` });
    }
    if (P.scaleMode === 'true-sizes' && Math.min(...L.sizes) < 3) {
      const small = L.list[L.sizes.indexOf(Math.min(...L.sizes))].name, big = L.list[L.sizes.indexOf(Math.max(...L.sizes))].name;
      R.push({ path: 'scaleMode', reason: `At true sizes, ${small} would be a speck too small to see next to ${big}. Show fewer planets, or choose “Neither”.` });
    }
  }
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
function plan(P) {
  const items = []; let summary = '';
  const ph = P.phenomenon;
  if (ph === 'day-night') {
    items.push({ key: 'sun', caption: 'The Sun gives out light. It stays still: it does not travel round the Earth.' });
    items.push({ key: 'light', caption: 'The half of the Earth facing the Sun has day. The other half has night.' });
    items.push({ key: 'spin', caption: 'The Earth spins anticlockwise, once every 24 hours. One full turn is one day.' });
    if (P.sunriseSunset) items.push({ key: 'sunrise', caption: 'Our place turns into the sunlight at sunrise, and out of it at sunset.' });
    summary = 'Day and night happen because the Earth spins, not because the Sun moves.';
  } else if (ph === 'year') {
    items.push({ key: 'sun', caption: 'The Sun stays at the centre. The Earth is a planet that travels round it.' });
    items.push({ key: 'orbit', caption: 'The Earth goes once round the Sun every 365¼ days. One orbit is one year.' });
    items.push({ key: 'spin', caption: 'All the way round, the Earth keeps spinning: one spin is one day, 365 in a year.' });
    summary = 'One spin of the Earth is a day. One orbit of the Sun is a year.';
  } else if (ph === 'moon-phases') {
    items.push({ key: 'light', caption: 'Sunlight comes from one side, so half the Earth and half the Moon are always lit.' });
    items.push({ key: 'orbit', caption: 'The Moon orbits the Earth about every 27 days. Its lit half always faces the Sun.' });
    items.push({ key: 'new', caption: 'New Moon: the Moon is between us and the Sun, so its lit half faces away from us.' });
    items.push({ key: 'first-quarter', caption: 'First quarter: a week later we see half of the lit half, on the right.' });
    items.push({ key: 'full', caption: 'Full Moon: the Moon is on the far side of the Earth. We see all of its lit half.' });
    items.push({ key: 'last-quarter', caption: 'Last quarter: again we see half the lit half, now on the left. Then back to new.' });
    if (P.phases === '8') items.push({ key: 'between', caption: 'In between: crescents (less than half lit) and gibbous Moons (more than half).' });
    summary = 'The Moon is always half lit. Its phases are how much of that lit half we see.';
  } else {
    const L = planetLayout(P); const a = L.list[0], z = L.list[L.n - 1];
    items.push({ key: 'sun', caption: 'The Sun is at the centre. Everything in the solar system orbits it.' });
    items.push({ key: 'order', caption: `${L.n} planets orbit the Sun, always in this order from ${a.name} to ${z.name}.` });
    items.push({ key: 'orbit', caption: `Closer planets orbit faster: ${a.name} takes ${fmtPeriod(a.periodDays)}, ${z.name} ${fmtPeriod(z.periodDays)}.` });
    if (P.orbitTimes) items.push({ key: 'times', caption: 'The further a planet is from the Sun, the longer its year.' });
    summary = `Trails show ${trailDays(L)} days of travel: closer planets go further.`;
  }
  return { items, summary };
}
const trailDays = L => Math.max(10, Math.round(Math.min(...L.list.map(p => p.periodDays)) * .34));
export function builds(P) { const { items, summary } = plan(P); return { steps: items.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }

export function notes(P) {
  const { items } = plan(P); const ph = P.phenomenon;
  const N = {
    'day-night': {
      sun: 'The Sun is a star. Ask: does the Sun really move across the sky? It looks that way because we are turning.',
      light: 'At any moment, half of the Earth is in daylight and half is in darkness. Not to scale: the Sun is about 109 times wider than the Earth and 150 million km away.',
      spin: 'Seen from above the North Pole the Earth spins anticlockwise (west to east). That is why the Sun rises in the east and sets in the west.',
      sunrise: 'Ask: where on the drawing is it midday for our place? Where is it midnight?',
      summary: 'Common misconception: the Sun goes round the Earth. Ask the class to act it out with a torch and a ball.',
    },
    year: {
      sun: 'Not to scale: the Sun is far bigger and further away than any slide can show.',
      orbit: 'An orbit takes 365¼ days, which is why we add a leap day every four years.',
      spin: 'Two motions at once: the spin makes day and night, the orbit makes the year.',
      summary: 'Ask: how many times has the Earth spun since your last birthday? (about 365)',
    },
    'moon-phases': {
      light: 'The Moon makes no light of its own. We see it because it reflects sunlight.',
      orbit: 'About 27 days to go round once; about 29½ days from one new Moon to the next, because the Earth has moved on round the Sun.',
      new: 'Common misconception: phases are the Earth’s shadow. They are not. The Earth’s shadow only falls on the Moon in an eclipse, which is rare.',
      'first-quarter': 'Called a “quarter” because the Moon is a quarter of the way round its orbit, even though we see half its face lit.',
      full: 'The Moon is behind the Earth but usually just above or below its shadow, so it is fully lit.',
      'last-quarter': 'From the UK the lit part grows from the right and shrinks to the left. From Australia it is the other way round.',
      between: 'Waxing means growing; waning means shrinking. Crescent: less than half lit. Gibbous: more than half.',
      summary: 'Ask the class to draw what the Moon looks like from Earth at each position, then check against the ring.',
    },
    planets: {
      sun: 'The planets are all much smaller than the Sun: about 1,300,000 Earths would fit inside it.',
      order: 'A rhyme helps remember the order: My Very Easy Method Just Speeds Up Naming (Mercury to Neptune).',
      orbit: 'Speeds are in true proportion: Mercury 88 days, Venus 225, Earth 365, Mars 687. ' + (P.scaleMode === 'not-to-scale' ? 'Sizes and distances are squeezed to fit the slide.' : P.scaleMode === 'true-sizes' ? 'Planet sizes are to scale with each other; the gaps between orbits and the Sun are not.' : 'Gaps between orbits are to scale; the planets are drawn much bigger than true size.'),
      times: 'Ask: why does a planet further out take longer? (further to travel, and it moves more slowly)',
      summary: 'All the planets orbit in the same direction, in nearly the same flat plane.',
    },
  }[ph];
  return { steps: items.map(it => N[it.key] || ''), summary: N.summary };
}

/* ------------------------------------------------------------------ render */
// screen angle: x = cx + r cos t, y = cy - r sin t (t grows anticlockwise, as seen from above the North Pole)
const at = (c, r, t) => [c[0] + r * Math.cos(t), c[1] - r * Math.sin(t)];
const deg = t => t * 180 / Math.PI;
/** A ball lit from the left (the Sun's side): the view from space, not from Earth. */
function litFromLeft(p, x, y, r, fill, a = {}) {
  const g = h('g', a, p);
  h('circle', { cx: x, cy: y, r, fill, cls: 'body' }, g);
  h('path', { d: `M${x} ${y - r} A${r} ${r} 0 0 1 ${x} ${y + r} Z`, fill: 'var(--shade)', opacity: .55 }, g);
  h('circle', { cx: x, cy: y, r, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }, g);
  return g;
}
/** A wrapped label in a fixed box. `up` is the share of any extra lines that go above y (0: grow down,
 *  .5: stay centred, 1: grow up); `ground` puts it on a solid ground sized to the wrapped text. */
function fitText(p, x, y, s, o, { up = 0, ground = false } = {}) {
  let b = textBlock(p, x, y, s, o);
  if (up && b.lines.length > 1) { b.el.remove(); b = textBlock(p, x, y - up * (b.lines.length - 1) * b.lh, s, o); }
  if (ground) { const bb = b.el.getBBox(); p.insertBefore(labelGround(p, { x: bb.x - 12, y: bb.y - 5, w: bb.width + 24, h: bb.height + 10 }), b.el); }
  return b;
}
/** A curved anticlockwise arrow round (cx, cy) from angle t0 to t1. */
function turnArrow(ctx, p, c, R, t0, t1, col, a) {
  const n = 24, pts = Array.from({ length: n + 1 }, (_, i) => at(c, R, t0 + (t1 - t0) * i / n));
  const d = 'M' + pts.map(q => q.map(v => v.toFixed(1)).join(' ')).join(' L ');
  const [ex, ey] = pts[n]; const ang = Math.atan2(-Math.cos(t1), -Math.sin(t1));
  return arrow(ctx, p, d, ex, ey, ang, col, 'var(--sw-struct)', Object.assign({ k: .8 }, a || {}));
}

export function render(root, P, ctx) {
  const b = ctx.b, N = ctx.N; const bi = k => b[k] ?? 0;
  // subtitle row: the view on the left, what is not to scale on the right (computed, so it can't be edited away)
  const viewT = txt(P, 'label:view', 'Seen from above the North Pole');
  const vt = textBlock(root, GRID.left, GRID.subY, viewT, { cls: 'ts-cap', maxW: 560, maxLines: 1, edit: 'text.label:view' });
  const sn = computed(T(root, GRID.right, GRID.subY, scaleNote(P), 'ts-cap', { 'text-anchor': 'end' }), P.phenomenon === 'planets' ? 'scaleMode' : 'phenomenon');
  if (GRID.left + vt.w + 28 > GRID.right - sn.getComputedTextLength()) ctx.warn('The view label runs into the scale note.');
  const scene = { 'day-night': dayNight, year: yearScene, 'moon-phases': moonScene, planets: planetsScene }[P.phenomenon];
  return scene(root, P, ctx, bi, N);
}

/* --- day and night: the Earth from above the North Pole, the Sun to the left */
function dayNight(root, P, ctx, bi, N) {
  const C = [680, 384], r = 168; const kS = bi('spin'), kL = bi('light');
  // the Sun: a big flat disc off the left edge (it is far bigger than the Earth)
  const sg = h('g', { s: bi('sun'), cls: 'rise' }, root);
  h('circle', { cx: -120, cy: C[1], r: 330, fill: 'var(--sun)', opacity: .2 }, sg);
  h('circle', { cx: -120, cy: C[1], r: 304, fill: 'var(--sun)', opacity: .3 }, sg);
  h('circle', { cx: -120, cy: C[1], r: 290, fill: 'var(--sun-body)', cls: 'body' }, sg);
  fitText(sg, 64, C[1] + 10, txt(P, 'label:sun', 'Sun'), { cls: 'ts-label', maxW: 96, maxLines: 3, lh: 30, a: { fill: 'var(--on-gold)', cls: 'strong' }, edit: 'text.label:sun' }, { up: .5 });
  // sunlight: parallel rays that stop at the Earth's edge
  const rays = h('g', {}, root);
  [-128, -64, 0, 64, 128].forEach((dy, i) => {
    const xe = C[0] - Math.sqrt(r * r - dy * dy) - 14;
    line(ctx, rays, 236, C[1] + dy, xe, C[1] + dy, 'var(--sun)', 'var(--sw-struct)', { draw: bi('sun'), delay: 300 + i * 90, k: .8 });
  });
  // the Earth: a fixed day/night shade over land that turns
  const eg = h('g', { s: bi('sun'), cls: 'pop', delay: 200 }, root);
  const G = globe(eg, { cx: C[0], cy: C[1], r, sunAngle: Math.PI, axis: false, seed: 5 });
  for (const el of G.g.querySelectorAll(':scope > path, :scope > line')) { el.dataset.s = kL; }
  const land = G.g.querySelector('g[clip-path]');
  const spinG = h('g', {}, G.g); G.g.insertBefore(spinG, land); spinG.appendChild(land);
  const t0 = Math.PI * 150 / 180, pr = r * .74; const [px, py] = at(C, pr, t0);
  const dot = h('g', { s: kL }, spinG);
  h('circle', { cx: px, cy: py, r: 11, fill: 'var(--focus)', stroke: 'var(--paper)', 'stroke-width': 3 }, dot);
  h('circle', { cx: C[0], cy: C[1], r: 5, fill: 'var(--ink-2)' }, G.g); // the North Pole
  // Day and Night names on solid grounds
  // three lanes under the Earth: Day | Sunset | Night; each wraps inside its own lane
  const name = (x, anchor, maxW, key, def) => { const g = h('g', { s: kL, cls: 'rise', delay: 500 }, root);
    fitText(g, x, C[1] + r + 40, txt(P, key, def), { cls: 'ts-label', maxW, maxLines: 2, lh: 30, anchor, a: { fill: 'var(--ink)' }, edit: 'text.' + key }, { ground: true }); return g; };
  const laneL = C[0] - 120, laneR = C[0] + 120;
  name(laneL, 'end', laneL - GRID.left - 24, 'label:day', 'Day'); name(laneR, 'start', GRID.right - laneR - 24, 'label:night', 'Night');
  // right column: the place key, the spin arrow and its label
  const xR = C[0] + r + 52, wR = GRID.right - xR;
  const key = h('g', { s: kL, cls: 'rise', delay: 700 }, root);
  h('circle', { cx: xR + 11, cy: C[1] - 150, r: 11, fill: 'var(--focus)' }, key);
  textBlock(key, xR + 32, C[1] - 140, P.place, { cls: 'ts-label', maxW: wR - 32, maxLines: 2, a: { fill: 'var(--ink)' }, edit: 'place' });
  const spinA = h('g', { s: kS }, root);
  turnArrow(ctx, spinA, C, r + 30, -0.62, 0.62, 'var(--ink-2)', { draw: kS });
  textBlock(spinA, xR, C[1] - 44, txt(P, 'label:spin', 'One spin is one day'), { cls: 'ts-label', maxW: wR, maxLines: 4, lh: 34, a: { fill: 'var(--ink)' }, edit: 'text.label:spin' });
  const clock = computed(T(root, xR, C[1] + 136, '0 hours', 'ts-num', { s: kS, hide: kS + 1, fill: 'var(--ink)' }), 'phenomenon');
  // sunrise and sunset sit where the turning Earth crosses the edge of the light
  if (P.sunriseSunset) {
    const k = bi('sunrise'); const g = h('g', { s: k, cls: 'rise' }, root);
    const sa = { fill: 'var(--ink)', cls: 'strong' };
    fitText(g, C[0], C[1] - r - 16, txt(P, 'label:sunrise', 'Sunrise'), { cls: 'ts-label', maxW: 2 * r, maxLines: 2, lh: 30, anchor: 'middle', a: sa, edit: 'text.label:sunrise' }, { up: 1 });
    fitText(g, C[0], C[1] + r + 40, txt(P, 'label:sunset', 'Sunset'), { cls: 'ts-label', maxW: laneR - laneL - 40, maxLines: 2, lh: 30, anchor: 'middle', a: sa, edit: 'text.label:sunset' });
    for (const s of [-1, 1]) h('circle', { cx: C[0], cy: C[1] + s * r, r: 6, fill: 'var(--ink)' }, g);
  }
  const turn = a => spinG.setAttribute('transform', `rotate(${(-deg(a)).toFixed(2)} ${C[0]} ${C[1]})`);
  return {
    dur: { spin: 4200 },
    still() { turn(0); },
    reset() { turn(0); clock.textContent = '0 hours'; },
    tick(k, u) { if (k === kS) { const e = eIO(u); turn(2 * Math.PI * e); clock.textContent = `${Math.round(24 * e)} hours`; } else turn(0); },
  };
}

/* --- a year: the Earth's orbit, seen straight down from above the North Pole (nearly a circle) */
function yearScene(root, P, ctx, bi, N) {
  const C = [620, 380], RX = 230, RY = 230, er = 48, kO = bi('orbit'), kP = bi('spin');
  const pos = t => [C[0] + RX * Math.cos(t), C[1] - RY * Math.sin(t)];
  const og = h('g', { s: kO }, root);
  h('ellipse', { cx: C[0], cy: C[1], rx: RX, ry: RY, fill: 'none', stroke: 'var(--orbit)', 'stroke-width': 'var(--sw-struct)', 'stroke-dasharray': '2 10', 'stroke-linecap': 'round', cls: 'draw', pathLength: 1 }, og);
  for (const t of [Math.PI / 2, 3 * Math.PI / 2]) { const [x, y] = pos(t); h('path', { d: headD(x, y, Math.atan2(-RY * Math.cos(t), -RX * Math.sin(t)), 18), fill: 'var(--ink-2)', s: kO, delay: 900 }, root); }
  const sg = h('g', { s: bi('sun'), cls: 'pop' }, root);
  h('circle', { cx: C[0], cy: C[1], r: 104, fill: 'var(--sun)', opacity: .2 }, sg);
  h('circle', { cx: C[0], cy: C[1], r: 92, fill: 'var(--sun-body)', cls: 'body' }, sg);
  fitText(sg, C[0], C[1] + 10, txt(P, 'label:sun', 'Sun'), { cls: 'ts-label', maxW: 128, maxLines: 3, lh: 30, anchor: 'middle', a: { fill: 'var(--on-gold)', cls: 'strong' }, edit: 'text.label:sun' }, { up: .5 });
  // the Earth: lit on the Sun's side wherever it is; its axis keeps one tilt all year
  const outer = h('g', { s: bi('sun'), cls: 'rise', delay: 300 }, root);
  const mover = h('g', {}, outer); const turnG = h('g', {}, mover);
  globe(turnG, { cx: 0, cy: 0, r: er, sunAngle: 0, axis: false, seed: 4 });
  const tr = 23.4 * Math.PI / 180; h('line', { x1: -Math.sin(tr) * (er + 12), y1: Math.cos(tr) * (er + 12), x2: Math.sin(tr) * (er + 12), y2: -Math.cos(tr) * (er + 12), stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, mover);
  // the Earth tag sits below and outside the Earth, clear of the orbit line
  const lab = h('g', {}, mover); { const lx = er * .5 + 18;
    fitText(lab, lx, er + 56, txt(P, 'label:earth', 'Earth'), { cls: 'ts-label', maxW: GRID.right - (C[0] + RX) - lx - 16, maxLines: 2, lh: 30, a: { fill: 'var(--ink)', cls: 'strong' }, edit: 'text.label:earth' }, { ground: true }); }
  const place = t => { const [x, y] = pos(t); mover.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`); turnG.setAttribute('transform', `rotate(${deg(Math.atan2(C[1] - y, C[0] - x)).toFixed(1)})`); };
  // a day counter while it orbits; the totals stay
  const count = computed(T(root, GRID.right, 622, 'Day 0', 'ts-num', { 'text-anchor': 'end', fill: 'var(--ink)', s: kO, hide: kP }), 'phenomenon');
  computed(T(root, GRID.right, 622, '365¼ days = 1 year', 'ts-num', { 'text-anchor': 'end', fill: 'var(--ink)', s: kP, cls: 'rise' }), 'phenomenon');
  // the spin: a ring round the Earth at its resting place (right of the Sun)
  const [ex, ey] = pos(0); const sp = h('g', { s: kP }, root);
  // the spin arc runs round the outer side only, so it never crosses the orbit line
  turnArrow(ctx, sp, [ex, ey], er + 22, -Math.PI * .3, Math.PI * .3, 'var(--focus)', { draw: kP });
  textBlock(sp, ex + 26, ey - er - 44, txt(P, 'label:spins', 'One spin is one day'), { cls: 'ts-label', maxW: GRID.right - ex - 26, maxLines: 2, lh: 34, a: { fill: 'var(--ink)', cls: 'strong' }, edit: 'text.label:spins' });
  return {
    dur: { orbit: 5200 },
    still() { place(0); },
    reset() { place(0); count.textContent = 'Day 0'; },
    tick(k, u) { if (k === kO) { const e = eIO(u); place(2 * Math.PI * e); count.textContent = `Day ${Math.round(365 * e)}`; } else place(0); },
  };
}

/* --- phases of the Moon: sunlight from the left, the Moon at eight places round the Earth */
function moonScene(root, P, ctx, bi, N) {
  const C = [600, 380], RO = 142, RI = 222, mr = 24, ir = 32;
  const kx = 1036, ky = 160, kw = GRID.right - kx - 40;
  const all = P.phases === '8'; const idx = all ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 2, 4, 6];
  const kO = bi('orbit');
  // sunlight
  const rg = h('g', { s: bi('light') }, root);
  [-120, -60, 60, 120].forEach((dy, i) => line(ctx, rg, 40, C[1] + dy, 300, C[1] + dy, 'var(--sun)', 'var(--sw-struct)', { draw: bi('light'), delay: i * 90, k: .8 }));
  textBlock(rg, GRID.left, C[1] - 82, txt(P, 'label:sunlight', 'Sunlight'), { cls: 'ts-small', maxW: 300 - GRID.left - 6, maxLines: 1, a: { fill: 'var(--ink)', cls: 'strong' }, edit: 'text.label:sunlight' });
  // the Earth
  const eg = h('g', { s: bi('light'), cls: 'pop' }, root);
  globe(eg, { cx: C[0], cy: C[1], r: 62, sunAngle: Math.PI, axis: false, seed: 6 });
  textBlock(eg, C[0], C[1] + 92, txt(P, 'label:earth', 'Earth'), { cls: 'ts-small', maxW: 2 * (RO * Math.SQRT1_2 - mr) - 16, maxLines: 1, // between the two lower diagonal Moons
      anchor: 'middle', a: { fill: 'var(--ink)', cls: 'strong halo' }, edit: 'text.label:earth' });
  // the orbit and the Moon in space, lit from the left at every place
  h('circle', { cx: C[0], cy: C[1], r: RO, fill: 'none', stroke: 'var(--orbit)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '2 9', 'stroke-linecap': 'round', s: kO }, root);
  turnArrow(ctx, h('g', { s: kO, delay: 1200 }, root), C, RO, Math.PI * 1.08, Math.PI * 1.18, 'var(--ink-2)');
  const keyOf = j => PHASE_KEYS[j];
  const buildOf = j => j % 2 ? bi('between') : bi(keyOf(j));
  for (const j of idx) {
    const t = Math.PI + j * Math.PI / 4; const [x, y] = at(C, RO, t);
    litFromLeft(root, x, y, mr, 'var(--moon)', { s: kO, cls: 'pop', delay: 200 + j * 110 });
    h('circle', { cx: x, cy: y, r: mr + 8, fill: 'none', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)', s: buildOf(j), hide: buildOf(j) + 1 }, root);
  }
  // the ring outside: the Moon as we see it from Earth at each place, and its name
  for (const j of idx) {
    const t = Math.PI + j * Math.PI / 4; const [x, y] = at(C, RI, t); const k = buildOf(j);
    const g = h('g', { s: k, cls: 'pop' }, root);
    h('circle', { cx: x, cy: y, r: ir + 6, fill: 'var(--panel)', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)' }, g);
    moonPhase(g, x, y, ir, j / 8);
    const cx = Math.cos(t), left = cx < -.3, top = y < C[1] - RO / 2;
    // names in the top half stop short of the key, and grow upwards (clear of the sunlight and the next ring)
    const nx = left ? x - ir - 14 : x + ir + 14, maxW = left ? nx - 200 : (top ? kx - 20 : GRID.right) - nx;
    fitText(h('g', { s: k, cls: 'rise', c: ctx.rc(k, N, 'soft') }, root), nx, y + 8, txt(P, `label:${keyOf(j)}`, PHASE_NAMES[j].name),
      { cls: 'ts-small', maxW, maxLines: 2, lh: 26, anchor: left ? 'end' : 'start', a: { fill: 'var(--ink)', cls: 'strong' }, edit: `text.label:${keyOf(j)}` }, { up: top ? 1 : 0 });
  }
  // a two-line key: which ring is which
  const k1 = h('g', { s: kO, cls: 'rise', delay: 1100 }, root); litFromLeft(k1, kx + 14, ky - 8, 14, 'var(--moon)');
  textBlock(k1, kx + 40, ky + 8, txt(P, 'label:key-space', 'The Moon in space'), { cls: 'ts-small', maxW: kw, maxLines: 2, lh: 28, edit: 'text.label:key-space' });
  const k2 = h('g', { s: bi('new'), cls: 'rise', delay: 600 }, root);
  h('circle', { cx: kx + 14, cy: ky + 70, r: 20, fill: 'var(--panel)', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)' }, k2); moonPhase(k2, kx + 14, ky + 70, 14, .3);
  textBlock(k2, kx + 40, ky + 78, txt(P, 'label:key-earth', 'As we see it from Earth'), { cls: 'ts-small', maxW: kw, maxLines: 3, lh: 28, edit: 'text.label:key-earth' });
  return {};
}

/* --- the planets: true order and true orbit times, sizes and distances as the teacher chose */
function planetsScene(root, P, ctx, bi, N) {
  const L = planetLayout(P); const C = PC; const kO = bi('order'), kM = bi('orbit');
  const D = Math.max(...L.list.map(p => p.periodDays).filter(d => d < 700), L.list[0].periodDays); // the run lasts one orbit of the slowest planet that can show it
  // resting places (after the run, and in the still) are spread round the Sun; the start is worked back from them
  const TH0 = [200, 320, 30, 130, 250, 10, 170, 290].map((d, i) => d * Math.PI / 180 - (L.list[i] ? 2 * Math.PI * D / L.list[i].periodDays : 0));
  const posAt = (i, days) => at(C, L.radii[i], TH0[i] + 2 * Math.PI * days / L.list[i].periodDays);
  h('circle', { cx: C[0], cy: C[1], r: L.radii[L.n - 1] + 20, fill: 'var(--panel)', s: kO }, root);
  L.radii.forEach((r, i) => h('circle', { cx: C[0], cy: C[1], r, fill: 'none', stroke: 'var(--orbit)', 'stroke-width': 'var(--sw-rule)', s: kO, delay: i * 100 }, root));
  // trails (the still only): the same number of days for every planet
  const TD = trailDays(L); const tr = h('g', { cls: 'ghost' }, root);
  L.list.forEach((p, i) => { const r = L.radii[i], a1 = TH0[i] + 2 * Math.PI * D / p.periodDays, span = Math.min(2 * Math.PI * .98, 2 * Math.PI * TD / p.periodDays), a0 = a1 - span;
    const [x0, y0] = at(C, r, a0), [x1, y1] = at(C, r, a1);
    h('path', { d: `M${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${span > Math.PI ? 1 : 0} 0 ${x1.toFixed(1)} ${y1.toFixed(1)}`, fill: 'none', stroke: p.fill, 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round', opacity: .4 }, tr); });
  // the Sun
  const sg = h('g', { s: bi('sun'), cls: 'pop' }, root);
  h('circle', { cx: C[0], cy: C[1], r: SUN_R + 10, fill: 'var(--sun)', opacity: .25 }, sg);
  h('circle', { cx: C[0], cy: C[1], r: SUN_R, fill: 'var(--sun-body)', cls: 'body' }, sg);
  fitText(sg, C[0], C[1] + 8, txt(P, 'label:sun', 'Sun'), { cls: 'ts-small', maxW: SUN_R * 1.35, maxLines: 2, lh: 22, anchor: 'middle', a: { fill: 'var(--on-gold)', cls: 'strong' }, edit: 'text.label:sun' }, { up: .5 });
  // the planets: an outer group takes the build fade; the inner one moves each frame
  // each planet carries its name on a small chip beside it, on the side away from the Sun (straight text, off the rings)
  const bodies = L.list.map((p, i) => { const w = h('g', { s: kO, cls: 'pop', delay: 500 + i * 100 }, root); const m = h('g', {}, w); planet(m, p.id, 0, 0, L.sizes[i]);
    const chip = h('g', { cls: 'rise', delay: 300 + i * 100 }, m);
    const cw = fitText(chip, 0, 7, txt(P, `label:${p.id}`, p.name), { cls: 'ts-small', maxW: CHIP_W, maxLines: 2, lh: 22, a: { fill: 'var(--ink)', cls: 'strong' }, edit: `text.label:${p.id}` }, { up: .5, ground: true }).w;
    const gap = L.sizes[i] * (p.id === 'saturn' ? 2 : 1) + 14; return { m, chip, cw, gap }; });
  const place = days => bodies.forEach(({ m, chip, cw, gap }, i) => { const [x, y] = posAt(i, days); m.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    // outward side; a chip that would run into the orbit-times column sits just under its planet instead
    const blocked = x >= C[0] && x + gap + cw + 8 >= 860, r = L.sizes[i];
    chip.setAttribute('transform', blocked ? `translate(${(-cw / 2).toFixed(1)} ${(r + 30).toFixed(1)})` : `translate(${(x >= C[0] ? gap : -gap - cw).toFixed(1)} 0)`); });
  // orbit times on one honest scale (bars only while the shortest bar can still be seen)
  const x0 = 880, x1 = GRID.right; const n = L.n;
  const maxP = Math.max(...L.list.map(p => p.periodDays)), minP = Math.min(...L.list.map(p => p.periodDays)); const bars = maxP / minP <= 60;
  const step = Math.min(66, 400 / n);
  const kT = P.orbitTimes ? bi('times') : null;
  if (P.orbitTimes) {
    const tg = h('g', { s: kT, cls: 'rise' }, root);
    textBlock(tg, x0, 168, txt(P, 'label:times', 'Time for one orbit'), { cls: 'ts-small', maxW: x1 - x0, maxLines: 1, a: { fill: 'var(--ink)', cls: 'strong' }, edit: 'text.label:times' });
    L.list.forEach((p, i) => {
      const y0 = 222 + i * step; const r = h('g', { s: kT, cls: 'rise', delay: 200 + i * 120 }, root);
      const vw = measure(r, fmtPeriod(p.periodDays), 'ts-small', { cls: 'strong' });
      textBlock(r, x0, y0, txt(P, `label:${p.id}`, p.name), { cls: 'ts-small', maxW: x1 - x0 - vw - 24, maxLines: 1, a: { fill: 'var(--ink)' }, edit: `text.label:${p.id}` });
      computed(T(r, x1, y0, fmtPeriod(p.periodDays), 'ts-small', { 'text-anchor': 'end', fill: 'var(--ink)', cls: 'strong' }), `planets.${P.planets.indexOf(p.id)}`);
      if (bars) { h('rect', { x: x0, y: y0 + 12, width: x1 - x0, height: 12, rx: 6, fill: 'var(--rule)' }, r);
        h('rect', { x: x0, y: y0 + 12, width: (x1 - x0) * p.periodDays / maxP, height: 12, rx: 6, fill: p.fill, cls: 'body' }, r); }
    });
  }
  const count = computed(T(root, x0, C[1] + 14, 'Day 0', 'ts-num', { fill: 'var(--ink)', s: kM, hide: kM + 1 }), 'planets');
  return {
    dur: { orbit: 7000 },
    still() { place(D); },
    reset() { place(0); count.textContent = 'Day 0'; },
    tick(k, u) { if (k === kM) { const d = D * eIO(u); place(d); count.textContent = `Day ${Math.round(d)}`; } else place(k > kM ? D : 0); },
  };
}
