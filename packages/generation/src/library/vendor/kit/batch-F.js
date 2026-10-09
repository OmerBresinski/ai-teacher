// Batch F kit parts: Earth, space, weather and environment.
// Plain ES module on the kit core. Colours are existing tokens only; all words are real SVG text
// passed in by the caller (with an `edit` params path), never baked in.
//
// Exports and params
//   PLANETS                         [{id, name, periodDays, radiusKm, au, fill}] real values, Sun outwards
//   planet(p, id, x, y, r, a)       flat disc in the planet's token; Saturn gets a flat ring
//   globe(p, {cx, cy, r, sunAngle=0, tilt=23.4, axis=true, equator=false, land=true, seed=3, a})
//                                   Earth disc, night half as a flat shade plane, terminator line, tilted axis.
//                                   sunAngle: screen radians towards the Sun (0 = Sun to the right).
//                                   Returns {g, north:[x,y], south:[x,y], terminator:[[x,y],[x,y]]}
//   orbit(p, [cx,cy], r, period, {ry=r, th0=0, a, dash=true})
//                                   orbit path; at(days) gives [x,y], anticlockwise on screen (as seen
//                                   from above the North Pole). Returns {el, at, angleAt, period}
//   moonPhase(p, x, y, r, phase, a) phase 0..1 (0 new, .25 first quarter lit right, .5 full, .75 last quarter)
//   PHASE_NAMES                     [{phase, name}] the eight named phases (default wording for the caller)
//   earthInterior(ctx, p, cx, cy, r, {labels:[{text, edit}] x4 crust→inner core, a})
//                                   concentric layers at true radii (crust drawn thicker; returns notToScale:true)
//   LAYER_FILLS                     {soil, sediment, rock, rock2, crust, mantle, outerCore, innerCore, magma, ash}
//   crossSection(ctx, p, box, layers, {wave=10, seed=5, labels=true, a})
//                                   layers [{kind, thick, label, edit}] stacked top to bottom with wavy boundaries,
//                                   label on a paper ground inside each band. Returns [{top(x), bottom(x), y0, y1}]
//   volcano(p, {x, yBase, w=420, hgt=240, chamber={dy:120, rx:90, ry:34}, strata=3, conduit=true, ground=true, a})
//                                   cone in two flat planes, crater, strata bands, conduit, magma chamber, crust block.
//                                   Returns {vent:[x,y], chamber:[x,y], left:[x,y], right:[x,y]}
//   ashCloud(p, x, y, s=1, a)       grey two-plane puffs (no glow)
//   cloud(p, x, y, s=1, a)          north-star cloud: two flat planes
//   weatherIcon(p, kind, x, y, s=1, a)   kind in WEATHER: sun | cloud | rain | snow | wind | sun-cloud (about 90 u at s=1)
//   sunArc(p, {x0, x1, yH, peak, frac=.5, r=26, a})
//                                   the Sun's path across the sky, sun disc at frac. Returns {el, at(u)}
//   seasonTree(p, x, y, season, s=1, a, {snow=false})   one deciduous tree: spring | summer | autumn | winter
//   biomeObject(p, kind, x, y, s=1, a)   conifer | cactus | rainforest | acacia | grass | iceFloe | seasonTree
//   BIOME_TAGS, biomeSceneryFor(biome)   honest topic tags; biomeSceneryFor returns [] when nothing fits
//   riverProfile(ctx, p, box, {stages:[{text, edit}] x3, sea=true, a})
//                                   long profile, source high on the left, mouth at sea level on the right,
//                                   concave curve, upper/middle/lower course; stage labels sit up to 62 u below box.
//                                   Returns {at(u), seaY, labelsBottom}
//   riverPlan(p, pts, {w0=6, w1=26, a})  plan-view river through pts (smoothed), widening downstream; returns {el, d (centre path)}
import { PLANETS as PLANET_FACTS } from './facts.js'; // libdata
import { h, clamp, lerp, rng } from './svg.js';
import { textBlock, labelGround } from './components.js';

let _n = 0; const uid = pfx => `bf-${pfx}-${++_n}`;
const P2 = ([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`;

/* ------------------------------------------------------------------ planets */
export const PLANETS = [
  { id: 'mercury', name: 'Mercury', periodDays: 88, radiusKm: 2440, au: 0.39, fill: 'var(--mercury)' },
  { id: 'venus', name: 'Venus', periodDays: 224.7, radiusKm: 6052, au: 0.72, fill: 'var(--venus)' },
  { id: 'earth', name: 'Earth', periodDays: 365.25, radiusKm: 6371, au: 1, fill: 'var(--earth)' },
  { id: 'mars', name: 'Mars', periodDays: 687, radiusKm: 3390, au: 1.52, fill: 'var(--mars)' },
  { id: 'jupiter', name: 'Jupiter', periodDays: 4333, radiusKm: 69911, au: 5.2, fill: 'var(--counter)' },
  { id: 'saturn', name: 'Saturn', periodDays: 10759, radiusKm: 58232, au: 9.54, fill: 'var(--seedhead)' },
  { id: 'uranus', name: 'Uranus', periodDays: 30687, radiusKm: 25362, au: 19.2, fill: 'var(--ice-side)' },
  { id: 'neptune', name: 'Neptune', periodDays: 60190, radiusKm: 24622, au: 30.1, fill: 'var(--water)' },
];
for (const p of PLANETS) { const f = PLANET_FACTS.rows[p.id]; if (f) Object.assign(p, { periodDays: f.periodDays, radiusKm: f.radiusKm, au: f.au }); } // libdata: NASA figures
export function planet(p, id, x, y, r, a = {}) {
  const pl = PLANETS.find(q => q.id === id) || PLANETS[2]; const g = h('g', a, p);
  const ring = (front) => { const d = front ? `M${x - r * 2} ${y} A${r * 2} ${r * .55} 0 0 0 ${x + r * 2} ${y}` : `M${x - r * 2} ${y} A${r * 2} ${r * .55} 0 0 1 ${x + r * 2} ${y}`;
    h('path', { d, fill: 'none', stroke: 'var(--seedhead)', 'stroke-width': Math.max(3, r * .22), 'stroke-linecap': 'round' }, g); };
  if (id === 'saturn') ring(false);
  h('circle', { cx: x, cy: y, r, fill: pl.fill, cls: 'body' }, g);
  if (id === 'earth') h('path', { d: `M${x - r * .5} ${y - r * .3} q ${r * .3} ${-r * .4} ${r * .6} ${-r * .1} q ${-r * .1} ${r * .5} ${-r * .6} ${r * .1} Z`, fill: 'var(--earth-land)' }, g);
  if (id === 'saturn') ring(true);
  return g;
}

/* ------------------------------------------------------------------ globe, orbit, moon */
export function globe(p, { cx, cy, r, sunAngle = 0, tilt = 23.4, axis = true, equator = false, land = true, seed = 3, a = {} } = {}) {
  const g = h('g', a, p); const cid = uid('gl');
  h('circle', { cx, cy, r, fill: 'var(--earth)', cls: 'body' }, g);
  const cp = h('clipPath', { id: cid }, h('defs', {}, g)); h('circle', { cx, cy, r }, cp);
  if (land) { // schematic land masses, seeded so they are stable; not a real map
    const R = rng(seed), lg = h('g', { 'clip-path': `url(#${cid})` }, g);
    for (let i = 0; i < 4; i++) {
      const ang = i * 1.6 + R() * .8, d0 = r * (.15 + .5 * R()), bx = cx + d0 * Math.cos(ang), by = cy + d0 * Math.sin(ang), s = r * (.2 + .16 * R());
      h('path', { d: `M${bx - s} ${by} C${bx - s} ${by - s * .9} ${bx + s * .2} ${by - s * 1.1} ${bx + s * .9} ${by - s * .3} C${bx + s * 1.2} ${by + s * .4} ${bx + s * .1} ${by + s * .8} ${bx - s * .4} ${by + s * .6} Z`, fill: 'var(--earth-land)' }, lg);
    }
  }
  // night half: a flat shade plane on the side away from the Sun
  const q = ang => [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  const t1 = q(sunAngle + Math.PI / 2), t2 = q(sunAngle - Math.PI / 2);
  h('path', { d: `M${P2(t1)} A${r} ${r} 0 0 1 ${P2(t2)} Z`, fill: 'var(--shade)', opacity: .5 }, g);
  h('line', { x1: t1[0], y1: t1[1], x2: t2[0], y2: t2[1], stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }, g);
  const tr = tilt * Math.PI / 180, ux = Math.sin(tr), uy = -Math.cos(tr);
  const north = [cx + ux * (r + 22), cy + uy * (r + 22)], south = [cx - ux * (r + 22), cy - uy * (r + 22)];
  if (equator) h('line', { x1: cx - uy * r, y1: cy + ux * r, x2: cx + uy * r, y2: cy - ux * r, stroke: 'var(--heat)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '8 6' }, g);
  if (axis) h('line', { x1: south[0], y1: south[1], x2: north[0], y2: north[1], stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g);
  return { g, north, south, terminator: [t1, t2] };
}

export function orbit(p, c, r, period, { ry = r, th0 = 0, a = {}, dash = true } = {}) {
  const [cx, cy] = c;
  const el = h('ellipse', Object.assign({ cx, cy, rx: r, ry, fill: 'none', stroke: 'var(--orbit)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': dash ? '2 9' : null, 'stroke-linecap': 'round' }, a), p);
  // anticlockwise on screen (y grows downwards, so +angle goes up)
  const angleAt = days => th0 + 2 * Math.PI * days / period;
  const at = days => { const t = angleAt(days); return [cx + r * Math.cos(t), cy - ry * Math.sin(t)]; };
  return { el, at, angleAt, period };
}

export const PHASE_NAMES = [
  { phase: 0, name: 'New Moon' }, { phase: .125, name: 'Waxing crescent' }, { phase: .25, name: 'First quarter' }, { phase: .375, name: 'Waxing gibbous' },
  { phase: .5, name: 'Full Moon' }, { phase: .625, name: 'Waning gibbous' }, { phase: .75, name: 'Last quarter' }, { phase: .875, name: 'Waning crescent' },
];
export function moonPhase(p, x, y, r, phase, a = {}) {
  const g = h('g', a, p); const ph = ((phase % 1) + 1) % 1;
  h('circle', { cx: x, cy: y, r, fill: 'var(--moon)', cls: 'body' }, g);
  h('circle', { cx: x, cy: y, r, fill: 'var(--shade)', opacity: .55 }, g); // unlit side: same flat shade plane as the globe
  const ex = Math.abs(Math.cos(2 * Math.PI * ph)) * r, top = `${x} ${y - r}`, bot = `${x} ${y + r}`;
  let d = null;
  if (Math.abs(ph - .5) < .01) h('circle', { cx: x, cy: y, r, fill: 'var(--moon)' }, g);
  else if (ph > .01 && ph < .99) {
    if (ph < .5) d = `M${top} A${r} ${r} 0 0 1 ${bot} A${ex} ${r} 0 0 ${ph < .25 ? 0 : 1} ${top} Z`; // waxing: lit on the right
    else d = `M${top} A${r} ${r} 0 0 0 ${bot} A${ex} ${r} 0 0 ${ph < .75 ? 0 : 1} ${top} Z`;        // waning: lit on the left
  }
  if (d) h('path', { d, fill: 'var(--moon)' }, g);
  h('circle', { cx: x, cy: y, r, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }, g);
  return g;
}

/* ------------------------------------------------------------------ the ground beneath */
export const LAYER_FILLS = {
  soil: 'var(--soil)', sediment: 'var(--sand)', rock: 'var(--stone)', rock2: 'var(--stone-shade)',
  crust: 'var(--stone-shade)', mantle: 'var(--tile)', outerCore: 'var(--counter)', innerCore: 'var(--sun)',
  magma: 'var(--heat)', ash: 'var(--neutral)',
};
const IR = [6371, 6336, 3480, 1220]; // km: surface, base of crust (typical), outer core top, inner core top
export function earthInterior(ctx, p, cx, cy, r, { labels = [], a = {} } = {}) {
  const g = h('g', a, p); const fills = [LAYER_FILLS.crust, LAYER_FILLS.mantle, LAYER_FILLS.outerCore, LAYER_FILLS.innerCore];
  const minCrust = Math.max(8, r * .045); // the crust is too thin to see at true scale
  const radii = IR.map((k, i) => i === 1 ? r - minCrust : r * k / IR[0]);
  radii.forEach((rr, i) => h('circle', { cx, cy, r: rr, fill: fills[i], cls: i ? null : 'body' }, g));
  // labels on the right, leader to the middle of each band along a shallow radial
  const mids = [(radii[0] + radii[1]) / 2, (radii[1] + radii[2]) / 2, (radii[2] + radii[3]) / 2, radii[3] * .5];
  const lx = cx + r + 40, step = Math.min(78, (2 * r) / 4), y0 = cy - step * 1.5;
  labels.slice(0, 4).forEach((L, i) => {
    const ang = -0.9 + i * 0.45, px = cx + mids[i] * Math.cos(ang), py = cy + mids[i] * Math.sin(ang), ly = y0 + i * step;
    const tb = textBlock(g, lx, ly + 9, L.text, { cls: 'ts-small', maxW: 1216 - lx, maxLines: 2, edit: L.edit });
    h('line', { x1: px, y1: py, x2: lx - 10, y2: ly, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-lead)' }, g);
    h('circle', { cx: px, cy: py, r: 5, fill: 'var(--ink)' }, g);
    if (lx + tb.w > 1216 && ctx && ctx.warn) ctx.warn('earthInterior: label ' + i + ' runs past the live area');
  });
  return { g, radii, notToScale: true };
}

function waveY(x0, w, y, amp, R) { const k = 1 + Math.floor(R() * 2), ph = R() * 6; return x => y + amp * Math.sin(ph + k * Math.PI * (x - x0) / w) * .5 + amp * .5 * Math.sin(ph * 1.7 + 3 * Math.PI * (x - x0) / w) * .4; }
export function crossSection(ctx, p, box, layers, { wave = 10, seed = 5, labels = true, a = {} } = {}) {
  const g = h('g', a, p); const R = rng(seed); const tot = layers.reduce((s, L) => s + (L.thick || 1), 0);
  const N = 24, xs = Array.from({ length: N + 1 }, (_, i) => box.x + box.w * i / N);
  let y = box.y; let top = x => box.y; const out = [];
  layers.forEach((L, i) => {
    const hh = box.h * (L.thick || 1) / tot, y1 = y + hh, last = i === layers.length - 1;
    const bottom = last ? (() => box.y + box.h) : waveY(box.x, box.w, y1, wave, R);
    const d = 'M' + xs.map(x => P2([x, top(x)])).join(' L ') + ' L ' + xs.slice().reverse().map(x => P2([x, bottom(x)])).join(' L ') + ' Z';
    h('path', { d, fill: LAYER_FILLS[L.kind] || L.fill || 'var(--stone)' }, g);
    out.push({ top, bottom, y0: y, y1, kind: L.kind });
    top = bottom; y = y1;
  });
  if (labels) out.forEach((o, i) => {
    const L = layers[i]; if (!L.label) return;
    const band = o.y1 - o.y0, lx = box.x + 24, cyb = (o.y0 + o.y1) / 2;
    const lg = h('g', {}, g); const tb = textBlock(lg, lx + 12, cyb + 8, L.label, { cls: 'ts-small', maxW: Math.min(360, box.w - 60), maxLines: 1, edit: L.edit });
    lg.insertBefore(labelGround(lg, { x: lx, y: cyb - 18, w: tb.w + 24, h: 36 }), tb.el);
    if (band < 44 + wave && ctx && ctx.warn) ctx.warn(`crossSection: layer "${L.label}" is too thin for its label`);
  });
  return out;
}

export function volcano(p, { x, yBase, w = 420, hgt = 240, chamber = { dy: 120, rx: 90, ry: 34 }, strata = 3, conduit = true, ground = true, a = {} } = {}) {
  const g = h('g', a, p); const cw = w * .1, ty = yBase - hgt, L = [x - w / 2, yBase], Rr = [x + w / 2, yBase];
  if (ground) { const gw = w * .75, gb = yBase + (chamber ? chamber.dy + chamber.ry + 30 : 60); // the crust the volcano sits on, in section
    h('rect', { x: x - gw, y: yBase, width: gw * 2, height: gb - yBase, fill: 'var(--stone-shade)' }, g);
    h('line', { x1: x - gw, y1: yBase, x2: x + gw, y2: yBase, stroke: 'var(--soil)', 'stroke-width': 'var(--sw-arrow)' }, g); }
  const cid = uid('vc'); const cp = h('clipPath', { id: cid }, h('defs', {}, g));
  const cone = `M${P2(L)} L${x - cw} ${ty} L${x + cw} ${ty} L${P2(Rr)} Z`; h('path', { d: cone }, cp);
  h('path', { d: cone, fill: 'var(--stone)', cls: 'body' }, g);
  h('path', { d: `M${x + cw * .2} ${ty} L${x + cw} ${ty} L${P2(Rr)} L${x + w * .12} ${yBase} Z`, fill: 'var(--stone-shade)' }, g);
  const sg = h('g', { 'clip-path': `url(#${cid})` }, g);
  for (let i = 1; i <= strata; i++) { const f = i / (strata + 1), yy = lerp(ty, yBase, f), half = lerp(cw, w / 2, f);
    h('path', { d: `M${x - half - 40} ${yy + 10} Q ${x} ${yy - 22} ${x + half + 40} ${yy + 10} L ${x + half + 40} ${yy + 24} Q ${x} ${yy - 8} ${x - half - 40} ${yy + 24} Z`, fill: 'var(--neutral)', opacity: .55 }, sg); }
  h('path', { d: `M${x - cw} ${ty} Q ${x} ${ty + 16} ${x + cw} ${ty} Z`, fill: 'var(--ink-3)' }, g);
  const ch = [x, yBase + chamber.dy];
  if (conduit) h('path', { d: `M${x - 9} ${ty + 6} L${x - 14} ${ch[1] - chamber.ry + 6} L${x + 14} ${ch[1] - chamber.ry + 6} L${x + 9} ${ty + 6} Z`, fill: 'var(--heat)' }, g);
  if (chamber) h('ellipse', { cx: ch[0], cy: ch[1], rx: chamber.rx, ry: chamber.ry, fill: 'var(--heat)', cls: 'body' }, g);
  return { g, vent: [x, ty], chamber: ch, left: L, right: Rr };
}
const puffs = (g, x, y, s, f1, f2) => { for (const [f, dy] of [[f2, 8], [f1, 0]]) { const k = h('g', { fill: f, transform: `translate(${x} ${y + dy * s}) scale(${s})` }, g);
  for (const [cx, cy, r] of [[-60, 4, 30], [-18, -22, 44], [34, -8, 36], [70, 10, 22]]) h('circle', { cx, cy, r }, k); h('rect', { x: -86, y: 0, width: 176, height: 36, rx: 18 }, k); } };
export function cloud(p, x, y, s = 1, a = {}) { const g = h('g', a, p); puffs(g, x, y, s, 'var(--cloud)', 'var(--cloud-shade)'); return g; }
export function ashCloud(p, x, y, s = 1, a = {}) { const g = h('g', a, p); puffs(g, x, y, s, 'var(--neutral)', 'var(--ink-3)'); return g; }

/* ------------------------------------------------------------------ weather */
export const WEATHER = ['sun', 'cloud', 'rain', 'snow', 'wind', 'sun-cloud'];
export function weatherIcon(p, kind, x, y, s = 1, a = {}) {
  const outer = h('g', a, p); const g = h('g', { transform: `translate(${x} ${y}) scale(${s})` }, outer);
  const sun = (sx, sy, r) => { for (let i = 0; i < 8; i++) { const t = i * Math.PI / 4; h('line', { x1: sx + Math.cos(t) * (r + 8), y1: sy + Math.sin(t) * (r + 8), x2: sx + Math.cos(t) * (r + 20), y2: sy + Math.sin(t) * (r + 20), stroke: 'var(--sun)', 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round' }, g); }
    h('circle', { cx: sx, cy: sy, r, fill: 'var(--sun)', cls: 'body' }, g); };
  const cl = (cx, cy, k) => puffs(g, cx, cy, k, 'var(--cloud)', 'var(--cloud-shade)');
  if (kind === 'sun') sun(0, -4, 26);
  else if (kind === 'sun-cloud') { sun(14, -22, 22); cl(-6, 6, .42); }
  else if (kind === 'cloud' || kind === 'rain' || kind === 'snow') {
    cl(0, -6, .46);
    if (kind === 'rain') for (const dx of [-24, 0, 24]) h('line', { x1: dx + 4, y1: 26, x2: dx - 4, y2: 44, stroke: 'var(--water)', 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round' }, g);
    if (kind === 'snow') for (const dx of [-24, 0, 24]) { const fy = 36 + (dx === 0 ? 8 : 0); for (let i = 0; i < 3; i++) { const t = i * Math.PI / 3; h('line', { x1: dx - 8 * Math.cos(t), y1: fy - 8 * Math.sin(t), x2: dx + 8 * Math.cos(t), y2: fy + 8 * Math.sin(t), stroke: 'var(--water)', 'stroke-width': 'var(--sw-rule)', 'stroke-linecap': 'round' }, g); } }
  } else if (kind === 'wind') {
    for (const [yy, l, c] of [[-20, 70, 1], [0, 54, 0], [20, 62, 1]]) h('path', { d: `M${-40} ${yy} H ${-40 + l}` + (c ? ` a 10 10 0 1 0 -10 -10` : ''), fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round' }, g);
  }
  return outer;
}

/** The Sun's path across the sky between sunrise x0 and sunset x1 on the horizon yH, highest at peak. */
export function sunArc(p, { x0, x1, yH, peak, frac = .5, r = 26, a = {} } = {}) {
  const g = h('g', a, p); const mx = (x0 + x1) / 2, cy = 2 * peak - yH; // quadratic control so the apex is at peak
  const at = u => { const m = 1 - u; return [m * m * x0 + 2 * m * u * mx + u * u * x1, m * m * yH + 2 * m * u * cy + u * u * yH]; };
  const el = h('path', { d: `M${x0} ${yH} Q ${mx} ${cy} ${x1} ${yH}`, fill: 'none', stroke: 'var(--sun)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '2 10', 'stroke-linecap': 'round' }, g);
  const [sx, sy] = at(clamp(frac)); h('circle', { cx: sx, cy: sy, r, fill: 'var(--sun)', cls: 'body' }, g);
  return { g, el, at };
}

/* ------------------------------------------------------------------ trees and biome scenery */
const BR = [[0, -40, -26, -78], [0, -50, 24, -86], [-10, -60, -34, -96], [8, -68, 12, -104], [-14, -72, -4, -108], [14, -60, 38, -90]];
export function seasonTree(p, x, y, season, s = 1, a = {}, { snow = false } = {}) {
  const outer = h('g', a, p); const g = h('g', { transform: `translate(${x} ${y}) scale(${s})` }, outer);
  h('path', { d: 'M-7 0 L-4 -60 L4 -60 L7 0 Z', fill: 'var(--trunk)' }, g);
  for (const [x1, y1, x2, y2] of BR) h('line', { x1, y1, x2, y2, stroke: 'var(--trunk)', 'stroke-width': 5, 'stroke-linecap': 'round' }, g);
  const blobs = [[-26, -84, 26], [20, -92, 28], [-4, -106, 30], [0, -76, 26]];
  if (season === 'summer') { for (const [cx, cy, r] of blobs) h('circle', { cx, cy, r: r + 4, fill: 'var(--canopy)', cls: 'body' }, g); h('path', { d: 'M4 -136 A34 34 0 0 1 48 -88 A28 28 0 0 1 4 -60 Z', fill: 'var(--canopy-shade)' }, g); }
  else if (season === 'spring') { for (const [cx, cy, r] of blobs) h('circle', { cx, cy, r: r * .72, fill: 'var(--hill-mid)' }, g);
    const R = rng(11); for (let i = 0; i < 14; i++) h('circle', { cx: -40 + R() * 80, cy: -126 + R() * 60, r: 4, fill: 'var(--ear)' }, g); }
  else if (season === 'autumn') { blobs.forEach(([cx, cy, r], i) => h('circle', { cx, cy, r: r * .82, fill: i % 2 ? 'var(--counter)' : 'var(--sun)' }, g));
    for (const [lx, ly, t] of [[-48, -4, 20], [34, -3, -30], [56, -2, 50], [-22, -2, 70]]) h('ellipse', { cx: lx, cy: ly, rx: 7, ry: 3.5, fill: 'var(--counter)', transform: `rotate(${t} ${lx} ${ly})` }, g); }
  else if (snow) for (const [x1, y1, x2, y2] of BR) h('line', { x1: x1 + (x2 - x1) * .3, y1: y1 + (y2 - y1) * .3 - 3, x2: x2, y2: y2 - 3, stroke: 'var(--snow)', 'stroke-width': 4, 'stroke-linecap': 'round' }, g);
  return outer;
}
const BOBJ = {
  conifer(g) { h('rect', { x: -5, y: -18, width: 10, height: 18, fill: 'var(--trunk)' }, g); for (const [w, y0, y1] of [[40, -18, -56], [32, -42, -78], [22, -64, -96]]) h('polygon', { points: `${-w},${y0} 0,${y1} ${w},${y0}`, fill: 'var(--hill-shade)', cls: 'body' }, g); },
  cactus(g) { h('rect', { x: -9, y: -84, width: 18, height: 84, rx: 9, fill: 'var(--life)', cls: 'body' }, g); h('path', { d: 'M-9 -40 H-24 V-62', fill: 'none', stroke: 'var(--life)', 'stroke-width': 12, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g); h('path', { d: 'M9 -30 H22 V-56', fill: 'none', stroke: 'var(--life-shade)', 'stroke-width': 12, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g); },
  rainforest(g) { h('rect', { x: -5, y: -120, width: 10, height: 120, fill: 'var(--trunk)' }, g); for (const [cx, cy, rx] of [[-26, -124, 34], [26, -128, 32], [0, -140, 36]]) h('ellipse', { cx, cy, rx, ry: 18, fill: 'var(--canopy)', cls: 'body' }, g); h('ellipse', { cx: 18, cy: -120, rx: 30, ry: 10, fill: 'var(--canopy-shade)' }, g); },
  acacia(g) { h('path', { d: 'M-4 0 L-2 -50 L-24 -72 M-2 -50 L20 -74', fill: 'none', stroke: 'var(--trunk)', 'stroke-width': 7, 'stroke-linecap': 'round' }, g); h('ellipse', { cx: 0, cy: -80, rx: 58, ry: 14, fill: 'var(--hill-mid)', cls: 'body' }, g); h('ellipse', { cx: 10, cy: -74, rx: 44, ry: 7, fill: 'var(--hill-shade)' }, g); },
  grass(g) { for (const [x2, y2] of [[-14, -26], [-4, -34], [6, -30], [16, -22]]) h('path', { d: `M0 0 Q ${x2 * .4} ${y2 * .6} ${x2} ${y2}`, fill: 'none', stroke: 'var(--field)', 'stroke-width': 4, 'stroke-linecap': 'round' }, g); },
  iceFloe(g) { h('polygon', { points: '-70,0 -52,-26 10,-34 62,-22 76,0', fill: 'var(--ice-top)', cls: 'body' }, g); h('polygon', { points: '10,-34 62,-22 76,0 30,0', fill: 'var(--ice-side)' }, g); },
  seasonTree(g) { seasonTree(g, 0, 0, 'summer'); },
};
/** Honest topic tags: an object is placed only in a biome it really belongs to. Cacti are native to the Americas only. */
export const BIOME_TAGS = {
  conifer: ['taiga', 'mountain', 'temperate'], cactus: ['desert-americas'], rainforest: ['rainforest'],
  acacia: ['savanna'], grass: ['grassland', 'savanna', 'temperate'], iceFloe: ['polar-north', 'polar-south'], seasonTree: ['temperate'],
};
export const BIOMES = ['none', 'rainforest', 'desert', 'desert-americas', 'savanna', 'grassland', 'temperate', 'taiga', 'mountain', 'polar-north', 'polar-south'];
export function biomeSceneryFor(biome) { if (!biome || biome === 'none') return []; return Object.keys(BIOME_TAGS).filter(k => BIOME_TAGS[k].includes(biome)); }
export function biomeObject(p, kind, x, y, s = 1, a = {}) { const outer = h('g', a, p); const g = h('g', { transform: `translate(${x} ${y}) scale(${s})` }, outer); (BOBJ[kind] || BOBJ.grass)(g); return outer; }

/* ------------------------------------------------------------------ rivers */
export function riverProfile(ctx, p, box, { stages = [], sea = true, a = {} } = {}) {
  const g = h('g', a, p); const seaW = sea ? box.w * .1 : 0, rw = box.w - seaW, seaY = box.y + box.h * .82;
  const at = u => [box.x + rw * u, seaY - (seaY - box.y) * Math.pow(1 - clamp(u), 2.2)]; // concave long profile
  const N = 40, pts = Array.from({ length: N + 1 }, (_, i) => at(i / N));
  h('path', { d: 'M' + pts.map(P2).join(' L ') + ` L ${box.x + rw} ${box.y + box.h} L ${box.x} ${box.y + box.h} Z`, fill: 'var(--hill-mid)' }, g);
  if (sea) { h('rect', { x: box.x + rw, y: seaY, width: seaW, height: box.y + box.h - seaY, fill: 'var(--sea-2)' }, g); h('line', { x1: box.x + rw, y1: seaY, x2: box.x + box.w, y2: seaY, stroke: 'var(--sea-3)', 'stroke-width': 'var(--sw-rule)' }, g); }
  for (let i = 0; i < 3; i++) { const seg = pts.slice(Math.round(i * N / 3), Math.round((i + 1) * N / 3) + 1);
    h('path', { d: 'M' + seg.map(P2).join(' L '), fill: 'none', stroke: 'var(--water)', 'stroke-width': 4 + i * 4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g); }
  [1 / 3, 2 / 3].forEach(u => h('line', { x1: box.x + rw * u, y1: box.y, x2: box.x + rw * u, y2: box.y + box.h, stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '6 8' }, g));
  stages.slice(0, 3).forEach((S, i) => {
    const cx = box.x + rw * (i + .5) / 3, y = box.y + box.h + 32; // below the section, so no label sits on the river
    textBlock(g, cx, y, S.text, { cls: 'ts-small', maxW: rw / 3 - 28, maxLines: 2, anchor: 'middle', edit: S.edit });
  });
  return { g, at, seaY, labelsBottom: box.y + box.h + 32 + 30 };
}
function smooth(P, k = 10) { // Catmull-Rom through the given points
  if (P.length < 3) return P; const out = [];
  for (let i = 0; i < P.length - 1; i++) { const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    for (let j = 0; j < k; j++) { const t = j / k, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(c => .5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3))); } }
  out.push(P[P.length - 1]); return out;
}
export function riverPlan(p, pts0, { w0 = 6, w1 = 26, a = {} } = {}) {
  const pts = smooth(pts0), n = pts.length, L = [], Rt = [];
  pts.forEach((pt, i) => { const q0 = pts[Math.max(0, i - 1)], q1 = pts[Math.min(n - 1, i + 1)]; const dx = q1[0] - q0[0], dy = q1[1] - q0[1], l = Math.hypot(dx, dy) || 1, w = lerp(w0, w1, i / (n - 1)) / 2;
    L.push([pt[0] - dy / l * w, pt[1] + dx / l * w]); Rt.push([pt[0] + dy / l * w, pt[1] - dx / l * w]); });
  const el = h('path', Object.assign({ d: 'M' + L.map(P2).join(' L ') + ' L ' + Rt.reverse().map(P2).join(' L ') + ' Z', fill: 'var(--water)', 'stroke-linejoin': 'round' }, a), p);
  return { el, d: 'M' + pts.map(P2).join(' L ') };
}
