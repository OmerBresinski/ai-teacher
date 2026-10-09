// Rivers and coasts: three views on one model.
//   course:  a schematic map of a river from its source in the hills to its mouth at the sea,
//            with tributaries joining, a meander on the low land and an estuary, delta or plain mouth.
//   meander: a close-up of one bend: fastest water on the outside, erosion there (river cliff),
//            deposition on the inside (slip-off slope), an optional cross-section and, optionally,
//            the neck narrowing until the river cuts through and leaves an oxbow lake.
//   coast:   a headland seen from the sea: crack, cave, arch, stack and stump along it, the oldest
//            furthest out to sea.
// Truth by construction: water is only ever drawn running downhill to the sea, tributaries only
// ever join (a delta is the only place the river splits, and it is labelled), erosion is always on
// the outside of a bend and deposition on the inside. validate() refuses what a setting could get
// wrong: a source at or below sea level, real-river facts, and coastal features out of order.
import {
  h, T, measure, clamp, lerp, eIO, GRID, rng,
  textBlock, labelGround, flow, sky, water, overlaps,
  editable, computed, txt, TEXT_PARAM_FOR, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { REAL_PARAM, realRiver, realWarnings, renderRealCourse } from './rivers_coasts/real.js'; // libdata: real rivers
import { riverIdFor } from './river_real.js'; // libriver: named real rivers are river_real's

export const meta = {
  id: 'rivers_coasts', name: 'Rivers and coasts', kind: 'scene', version: 1,
  subjects: ['Geography', 'Science'],
  years: ['Y3', 'Y4', 'Y5', 'Y6', 'KS3'],
  teaches: 'How a river runs downhill from its source to the sea, how meanders and oxbow lakes form, and how waves wear a headland into caves, arches, stacks and stumps.',
};

const FEATURES = ['crack', 'cave', 'arch', 'stack', 'stump'];
const FEATURE_WORDS = { crack: 'Crack', cave: 'Cave', arch: 'Arch', stack: 'Stack', stump: 'Stump' };
const EXAMPLES = {
  thames: { name: 'the Thames', h: [80, 160], hText: 'about 110 m', mouth: 'estuary', sea: 'the North Sea' },
  severn: { name: 'the Severn', h: [450, 750], hText: 'about 610 m, on Plynlimon', mouth: 'estuary', sea: 'the Bristol Channel' },
};

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Rivers and coasts',
  properties: {
    title: TITLE_PARAM('The journey of a river'),
    view: { type: 'string', title: 'What to show', enum: ['course', 'meander', 'coast'], 'x-labels': ['A river from source to sea', 'How a meander forms', 'Erosion at the coast'], default: 'course' },
    river: {
      type: 'object', title: 'The river', description: 'Used when showing a river from source to sea.',
      default: { name: 'The river', source: 'A spring in the hills', sourceHeight: 400, sea: 'The sea', mouth: 'estuary' },
      properties: {
        name: { type: 'string', title: 'River name', maxLength: 40, default: 'The river' },
        source: { type: 'string', title: 'Where its source is', maxLength: 56 /* libfix: what the lane holds at the most items (tools/laneFit); longer is refused, never cut */, default: 'A spring in the hills' },
        sourceHeight: { type: 'integer', title: 'Height of the source (metres above sea level)', minimum: -500, maximum: 9000, default: 400 },
        sea: { type: 'string', title: 'The sea it flows into', maxLength: 40, default: 'The sea' },
        mouth: { type: 'string', title: 'Its mouth', enum: ['estuary', 'delta', 'mouth'], 'x-labels': ['An estuary (it widens into the sea)', 'A delta (it splits into channels)', 'A plain mouth'], default: 'estuary' },
      },
    },
    tributaries: {
      type: 'array', title: 'Tributaries (smaller rivers that join it)', 'x-item': 'a tributary', maxItems: 3, default: [],
      items: { type: 'object', required: ['name'], default: { name: 'A stream', joins: 'middle', bank: 'north' }, properties: {
        name: { type: 'string', title: 'Name', maxLength: 60, minLength: 1 },
        joins: { type: 'string', title: 'Where it joins', enum: ['upper', 'middle', 'lower'], 'x-labels': ['Near the source', 'Halfway along', 'Nearer the sea'], default: 'middle' },
        bank: { type: 'string', title: 'Comes from', enum: ['north', 'south'], 'x-labels': ['Above the river on the map', 'Below the river on the map'], default: 'north' },
      } },
    },
    showMeander: { type: 'boolean', title: 'Show a meander on the low land', default: true },
    example: { type: 'string', title: 'Check against a real river', description: 'Refuses settings that are wrong for that river, like a delta on the Thames.', enum: ['none', 'thames', 'severn'], 'x-labels': ['No real river', 'River Thames', 'River Severn'], default: 'none', 'x-panel': 'advanced' },
    meander: {
      type: 'object', title: 'The meander close-up', default: { section: true, stage: 'bend' },
      properties: {
        section: { type: 'boolean', title: 'Add a cross-section of the bend', default: true },
        stage: { type: 'string', title: 'How far the story goes', enum: ['bend', 'oxbow'], 'x-labels': ['Erosion and deposition on one bend', 'On to the neck and an oxbow lake'], default: 'bend' },
      },
    },
    coast: {
      type: 'array', title: 'Coastal features, in the order they form', 'x-item': 'a feature', minItems: 1, maxItems: 5,
      default: [{ feature: 'crack' }, { feature: 'cave' }, { feature: 'arch' }, { feature: 'stack' }, { feature: 'stump' }],
      items: { type: 'object', required: ['feature'], default: { feature: 'stack' }, properties: {
        feature: { type: 'string', title: 'Feature', enum: FEATURES, 'x-labels': ['Crack', 'Cave', 'Arch', 'Stack', 'Stump'], default: 'stack' },
        label: { type: 'string', title: 'Label (blank for the usual word)', maxLength: 60, default: '' },
      } },
    },
    // every drawn label is a short name in a lane, so each override takes the label cap
    text: TEXT_PARAM_FOR(Object.fromEntries(['source', 'sealevel', 'meander', 'estuary', 'delta', 'mouth', 'hills', 'lowland', 'nts', 'fast', 'erosion', 'deposition', 'a', 'b', 'section', 'shallow', 'deep', 'neck', 'oxbow', 'headland', 'older', 'crack', 'cave', 'arch', 'stack', 'stump'].map(k => [k, 'label']))),
  },
};

params.properties.real = REAL_PARAM; // libdata: real rivers

export const presets = [
  { id: 'y4-thames', name: 'Year 4: the course of a river', params: {
    title: 'The River Thames: source to sea', view: 'course', example: 'thames', showMeander: true,
    river: { name: 'River Thames', source: 'Thames Head, Gloucestershire', sourceHeight: 110, sea: 'North Sea', mouth: 'estuary' },
    tributaries: [{ name: 'River Cherwell', joins: 'upper', bank: 'north' }, { name: 'River Kennet', joins: 'middle', bank: 'south' }, { name: 'River Lea', joins: 'lower', bank: 'north' }],
  } },
  { id: 'y5-meander', name: 'Year 5: how a meander forms', params: {
    title: 'How a meander forms', view: 'meander', meander: { section: true, stage: 'bend' },
  } },
  { id: 'y6-oxbow', name: 'Year 6: from meander to oxbow lake', params: {
    title: 'From meander to oxbow lake', view: 'meander', meander: { section: false, stage: 'oxbow' },
  } },
  { id: 'y6-coast', name: 'Year 6: erosion at the coast', params: {
    title: 'Erosion at the coast', view: 'coast',
    coast: [{ feature: 'crack' }, { feature: 'cave' }, { feature: 'arch' }, { feature: 'stack' }, { feature: 'stump' }],
  } },
];

/* ------------------------------------------------------------------ validate */
const seaOf = r => `the ${String((r && r.sea) || 'sea').replace(/^the\s+/i, '')}`;
const exampleOf = P => EXAMPLES[P.example] ? P.example : /thames/i.test((P.river && P.river.name) || '') ? 'thames' : /severn/i.test((P.river && P.river.name) || '') ? 'severn' : null;
const an = (w, cap) => `${/^[aeiou]/.test(w) ? (cap ? 'An' : 'an') : (cap ? 'A' : 'a')} ${w}`;
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const W = [];
  if (R.length) return result(R);
  if (P.view === 'course') {
    const r = P.river || {}; const hgt = r.sourceHeight;
    if (!(hgt > 0)) R.push({ path: 'river.sourceHeight', reason: `A river’s source has to be higher than the sea, because water only flows downhill. ${hgt} m would leave the water nowhere to flow: use a height above 0 m.` });
    else if (hgt > 6000) R.push({ path: 'river.sourceHeight', reason: `${hgt} m is higher than any river source on Earth. Use the real height of the source.` });
    const exK = exampleOf(P), ex = EXAMPLES[exK]; const byName = ex && !EXAMPLES[P.example];
    if (ex && !R.length) {
      const Ex = `${ex.name[0].toUpperCase()}${ex.name.slice(1)}`;
      if (hgt < ex.h[0] || hgt > ex.h[1]) R.push({ path: 'river.sourceHeight', reason: `The source of ${ex.name} is ${ex.hText} above sea level, not ${hgt} m. Use a height near that${byName ? ', or rename the river' : ', or set “Check against a real river” to none'}.` });
      if (r.mouth !== ex.mouth) R.push({ path: 'river.mouth', reason: r.mouth === 'delta' ? `${Ex} reaches ${ex.sea} through a wide estuary; it has no delta. Choose “An estuary”.` : `${Ex} widens into a wide estuary before it reaches ${ex.sea}. Choose “An estuary”.` });
    }
    const seen = {};
    (P.tributaries || []).forEach((t, i) => { const k = `${t.joins}`; seen[k] = (seen[k] || 0) + 1; if (seen[k] > 2) R.push({ path: `tributaries.${i}.joins`, reason: 'Three tributaries joining at the same stretch will not fit on one slide. Move one to another part of the river.' }); });
  }
  if (P.view === 'coast') {
    const list = (P.coast || []).map(c => c.feature);
    for (let i = 1; i < list.length && !R.length; i++) {
      const a = FEATURES.indexOf(list[i - 1]), b2 = FEATURES.indexOf(list[i]);
      if (b2 < a) R.push({ path: `coast.${i}.feature`, reason: `${an(list[i], true)} forms before ${an(list[i - 1])}, not after it: waves open a crack into a cave, the cave into an arch, the arch falls to leave a stack, and the stack wears down to a stump. Put the features in that order.` });
    }
    if (!R.length) list.forEach((f, i) => { if (list.indexOf(f) !== i) R.push({ path: `coast.${i}.feature`, reason: `${FEATURE_WORDS[f]} is in the list twice. Each feature appears once.` }); });
  }
  W.push(...realWarnings(P)); // libdata: real rivers
  const rid = P.view === 'course' && riverIdFor(P.river && P.river.name); // libriver
  if (rid) W.push(`${P.river.name} has a checked real map: draw it with river_real (river: ${rid}) rather than this schematic.`);
  return result(R, W);
}

/* ------------------------------------------------------------------ builds and notes */
function plan(P) {
  const items = []; const v = P.view;
  if (v === 'course') {
    const r = P.river; const nm = r.name || 'The river'; const sea = seaOf(r);
    items.push({ key: 'source', caption: `${nm} begins at its source, high in the hills.` });
    items.push({ key: 'downhill', caption: `Water always flows downhill: from ${r.sourceHeight} m at the source to 0 m at the sea.` });
    if ((P.tributaries || []).length) items.push({ key: 'tributaries', caption: 'Smaller rivers called tributaries join it, so it grows bigger.' });
    if (P.showMeander) items.push({ key: 'meander', caption: 'On flat low land the river swings side to side in bends called meanders.' });
    items.push({ key: 'mouth', caption: r.mouth === 'estuary' ? `At its mouth the river widens into an estuary and meets ${sea}.` : r.mouth === 'delta' ? `At its mouth the river drops sand and mud and splits up: a delta.` : `At its mouth the river flows into ${sea}.` });
    return { items, summary: `${nm} flows downhill from its source all the way to ${sea}.` };
  }
  if (v === 'meander') {
    const m = P.meander;
    items.push({ key: 'bend', caption: 'A meander is a big bend in a river, usually on flat, low land.' });
    items.push({ key: 'fast', caption: 'The fastest, deepest water swings to the outside of the bend.' });
    items.push({ key: 'erosion', caption: 'Outside the bend, fast water erodes the bank into a steep river cliff.' });
    items.push({ key: 'deposition', caption: 'Inside the bend, slow water drops sand: deposition makes a slip-off slope.' });
    if (m.section) items.push({ key: 'section', caption: 'From the side: deep and steep outside, shallow and gentle inside.' });
    if (m.stage === 'oxbow') {
      items.push({ key: 'neck', caption: 'Year after year the bend grows, and the neck of land gets narrower.' });
      items.push({ key: 'oxbow', caption: 'A flood cuts through the neck. The old loop is left as an oxbow lake.' });
    }
    return { items, summary: m.stage === 'oxbow' ? 'The bend grows until the river cuts through and leaves an oxbow lake.' : 'Erosion outside, deposition inside: so the bend slowly moves and grows.' };
  }
  items.push({ key: 'headland', caption: 'Waves crash against a headland: rock that sticks out into the sea.' });
  const C = {
    crack: 'Waves force water and air into a crack in the rock and wear it wider.',
    cave: 'The crack is worn bigger and bigger until it becomes a cave.',
    arch: 'The cave is worn right through the headland to make an arch.',
    stack: 'The top of the arch falls in, leaving a stack standing on its own.',
    stump: 'Waves wear the stack down until only a low stump is left.',
  };
  P.coast.forEach(c => items.push({ key: `f:${c.feature}`, caption: C[c.feature] }));
  return { items, summary: 'The further out to sea a feature is, the older it is.' };
}
export function builds(P) { const { items, summary } = plan(P); return { steps: items.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }

export function notes(P) {
  const { items } = plan(P); const ex = EXAMPLES[exampleOf(P)];
  const N = {
    source: 'A source can be a spring, a bog or melting snow. ' + (ex ? `The source of ${ex.name} is ${ex.hText} above sea level.` : 'Ask: why are sources usually high up?'),
    downhill: 'Gravity pulls water downhill, so the river always flows from high land to low land and ends at sea level (0 m). This map is a plan, not to scale.',
    tributaries: 'Where a tributary joins is called a confluence. Rivers join, they do not split, except at a delta near the sea. Ask: where does all this water come from?',
    meander: 'Meanders form where the land is flat: the river erodes sideways rather than downwards.',
    mouth: P.river && P.river.mouth === 'delta' ? 'A delta forms where the sea cannot carry away all the sand and mud the river drops (the Nile, the Mississippi). The UK has no large deltas.' : 'An estuary is where fresh river water mixes with salty sea water, and the tide comes in and out.',
    bend: 'The plan view looks down from above. Ask: which side of the bend do you think the water goes fastest?',
    fast: 'Water keeps moving in a straight line, so it is flung to the outside of the bend, where the channel is deepest.',
    erosion: 'The dashed line shows where the bank used to be. The water throws stones and sand at the bank (abrasion) and its force wears the bank away.',
    deposition: 'Slow water has less energy, so it cannot carry its load and drops it. This builds the slip-off slope (also called a point bar).',
    section: 'Read the cross-section from A (inside) to B (outside). Not to scale: the depth is stretched so you can see it.',
    neck: 'The outside of each bend keeps eroding, so the two ends of the loop creep towards each other.',
    oxbow: 'The ends of the old loop are sealed with deposited sand. Oxbow lakes slowly dry out and fill with plants.',
    headland: 'Headlands are made of hard rock, which wears away slowly; the softer rock either side wears back into bays. Not to scale, and the changes take thousands of years.',
    'f:crack': 'Hydraulic action: waves squeeze air into cracks and the pressure breaks the rock.',
    'f:cave': 'Abrasion: waves throw pebbles and sand at the cliff and wear it away.',
    'f:arch': 'Durdle Door in Dorset is a real arch.',
    'f:stack': 'Old Harry Rocks in Dorset are chalk stacks.',
    'f:stump': 'A stump may be covered by the sea at high tide.',
  };
  return { steps: items.map(it => N[it.key] || ''), summary: P.view === 'coast' ? 'Ask: which feature formed first, and which is oldest? What will the stack become?' : 'Ask the class to retell the story using “erosion”, “deposition” and “downhill”.' };
}

/* ------------------------------------------------------------------ geometry helpers */
const P2 = ([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`;
function smooth(P, k = 8) {
  if (P.length < 3) return P; const out = [];
  for (let i = 0; i < P.length - 1; i++) { const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    for (let j = 0; j < k; j++) { const t = j / k, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(c => .5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3))); } }
  out.push(P[P.length - 1]); return out;
}
const cubic = (a, b, c, d, n) => Array.from({ length: n }, (_, i) => { const t = i / n, m = 1 - t; return [0, 1].map(k => m * m * m * a[k] + 3 * m * m * t * b[k] + 3 * m * t * t * c[k] + t * t * t * d[k]); });
/** Ribbon around a centre line. wf(i) = full width at point i; off(i) = [extra left, extra right]. upto = fraction drawn. */
function ribbonD(pts, wf, upto = 1, off) {
  const n = pts.length, m = Math.max(2, Math.round(clamp(upto) * (n - 1)) + 1); const L = [], R = [];
  for (let i = 0; i < m; i++) { const q0 = pts[Math.max(0, i - 1)], q1 = pts[Math.min(n - 1, i + 1)]; const dx = q1[0] - q0[0], dy = q1[1] - q0[1], l = Math.hypot(dx, dy) || 1;
    const w = wf(i) / 2, [ol, or] = off ? off(i) : [0, 0]; const nx = -dy / l, ny = dx / l;
    L.push([pts[i][0] + nx * (w + ol), pts[i][1] + ny * (w + ol)]); R.push([pts[i][0] - nx * (w + or), pts[i][1] - ny * (w + or)]); }
  return 'M' + L.map(P2).join(' L ') + ' L ' + R.reverse().map(P2).join(' L ') + ' Z';
}
const polyD = pts => 'M' + pts.map(P2).join(' L ');
const ptsBox = (pts, pad) => pts.map(([x, y]) => ({ x: x - pad, y: y - pad, w: 2 * pad, h: 2 * pad }));

/** A wording block on a paper ground: heading (optional) over a wrapped body. Returns its box. */
function block(p, x, y, parts, { anchor = 'start', maxW = 300, ground = true, maxLines = 3 } = {}) {
  const g = h('g', {}, p); const gr = ground ? h('rect', { rx: 'var(--r-mark)', fill: 'var(--paper)', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-hair)' }, g) : null;
  let yy = y, w = 0;
  for (const it of parts) {
    if (it.computed != null) { const t = T(g, x, yy + 22, it.text, it.cls || 'ts-tiny', { 'text-anchor': anchor, fill: it.fill }); computed(t, it.computed); w = Math.max(w, t.getComputedTextLength()); yy += 28; continue; }
    const tb = textBlock(g, x, yy + 22, it.text, { cls: it.cls || 'ts-small', maxW, maxLines, lh: 28, anchor, edit: it.edit, a: it.fill ? { fill: it.fill } : {} });
    w = Math.max(w, tb.w); yy += tb.h + 2;
  }
  const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  const box = { x: x0 - 10, y: y - 4, w: w + 20, h: yy - y + 12 };
  if (gr) { gr.setAttribute('x', box.x); gr.setAttribute('y', box.y); gr.setAttribute('width', box.w); gr.setAttribute('height', box.h); }
  g.box = box; return g;
}
/** Try candidate anchor points until the block's box meets no obstacle; moves the block there. */
function placeBlock(ctx, g, cands, obstacles, what, bounds = { x: GRID.left, y: GRID.top, w: GRID.right - GRID.left, h: GRID.bottom - GRID.top }, quiet = false, ok = null) {
  const b0 = g.box;
  for (const [dx, dy] of cands) {
    const bb = { x: b0.x + dx, y: b0.y + dy, w: b0.w, h: b0.h };
    if (bb.x < bounds.x || bb.y < bounds.y || bb.x + bb.w > bounds.x + bounds.w || bb.y + bb.h > bounds.y + bounds.h) continue;
    if (obstacles.some(o => o.r != null ? Math.hypot(clamp(o.cx, bb.x, bb.x + bb.w) - o.cx, clamp(o.cy, bb.y, bb.y + bb.h) - o.cy) < o.r + 4 : overlaps(bb, o, 4))) continue;
    if (ok && !ok(bb)) continue;
    g.setAttribute('transform', `translate(${dx} ${dy})`); g.box = bb; obstacles.push(bb); return bb;
  }
  if (quiet) return null;
  ctx.warn(`No room for the label “${what}”.`); g.style.display = 'none'; return null;
}
/** Candidate offsets around a point for a block drawn at origin (0,0)-anchored at its top-left. */
function around(px, py, box, r = 18) {
  const c = []; const W0 = box.w, H0 = box.h;
  for (const d of [0, 30, 60, 100, 150, 210]) {
    c.push([px + r + d - box.x, py - H0 / 2 - box.y], [px - r - d - W0 - box.x, py - H0 / 2 - box.y],
      [px - W0 / 2 - box.x, py - r - d - H0 - box.y], [px - W0 / 2 - box.x, py + r + d - box.y],
      [px + r + d - box.x, py - r - d - H0 - box.y], [px + r + d - box.x, py + r + d - box.y],
      [px - r - d - W0 - box.x, py + r + d - box.y], [px - r - d - W0 - box.x, py - r - d - H0 - box.y]);
  }
  return c;
}

/** Fallback candidates: every grid position for the box's top-left in a region, nearest to (tx, ty) first. */
function sweep(box, x0, x1, y0, y1, tx, ty, step = 12) {
  const c = []; for (let x = x0; x <= x1; x += step) for (let y = y0; y <= y1; y += step) c.push([x - box.x, y - box.y]);
  const d = ([dx, dy]) => Math.hypot(clamp(tx, box.x + dx, box.x + dx + box.w) - tx, clamp(ty, box.y + dy, box.y + dy + box.h) - ty);
  return c.sort((p, q) => d(p) - d(q));
}

/** A leader from p to the nearest edge of bb, and a test that it never passes through a placed box (other labels). */
const nearOn = (p, bb) => [clamp(p[0], bb.x, bb.x + bb.w), clamp(p[1], bb.y, bb.y + bb.h)];
function leaderClear(p, boxes) {
  return bb => { const q = nearOn(p, bb), n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 5);
    for (const o of boxes) { if (o.r != null || o === bb) continue; if (p[0] >= o.x && p[0] <= o.x + o.w && p[1] >= o.y && p[1] <= o.y + o.h) continue;
      for (let i = 1; i < n; i++) { const x = lerp(p[0], q[0], i / n), y = lerp(p[1], q[1], i / n); if (x > o.x - 3 && x < o.x + o.w + 3 && y > o.y - 3 && y < o.y + o.h + 3) return false; } }
    return true; };
}
/** Place near the preferred spots; failing that, the nearest free spot anywhere, with a leader back to the point it names. */
function placeNear(ctx, g, cands, obstacles, what, p, col, bounds) {
  let bb = placeBlock(ctx, g, cands, obstacles, what, bounds, true);
  if (bb) return bb;
  const B = bounds || { x: GRID.left, y: GRID.top, w: GRID.right - GRID.left, h: GRID.bottom - GRID.top };
  bb = placeBlock(ctx, g, sweep(g.box, B.x, B.x + B.w - g.box.w, B.y, B.y + B.h - g.box.h, p[0], p[1], 10), obstacles, what, bounds, false, leaderClear(p, obstacles));
  if (bb) { const q = nearOn(p, bb); if (Math.hypot(q[0] - p[0], q[1] - p[1]) > 14) g.parentNode.insertBefore(h('line', { x1: p[0], y1: p[1], x2: q[0], y2: q[1], stroke: col || 'var(--ink-3)', 'stroke-width': 'var(--sw-lead)' }), g); }
  return bb;
}

/* ------------------------------------------------------------------ render */
export function render(root, P, ctx) {
  if (P.view === 'meander') return renderMeander(root, P, ctx);
  if (P.view === 'coast') return renderCoast(root, P, ctx);
  if (realRiver(P)) return renderRealCourse(root, P, ctx); // libdata: real rivers
  return renderCourse(root, P, ctx);
}

/* ---------- course: source to sea, as a schematic map */
function renderCourse(root, P, ctx) {
  const b = ctx.b, bi = k => b[k] ?? 0, r = P.river; const MT = 124, MB = 572;
  const delta = r.mouth === 'delta', estuary = r.mouth === 'estuary';
  const COAST = 1060; const BD = { x: GRID.left, y: MT + 4, w: GRID.right - GRID.left, h: MB - MT - 8 };
  // land: low land everywhere, the hills as a darker plane on the left
  // earlier labels leave fully after their build (one focal point), and come back for the summary
  h('style', {}, root).textContent = '.slide .rc-gone{opacity:0;transition:opacity var(--t-recede) var(--ease-out)}';
  h('rect', { x: 0, y: MT, width: 1280, height: MB - MT, fill: 'var(--hill-far)' }, root);
  const rr = rng(11); const up = [];
  for (let y = MT; y <= MB; y += 54) up.push([400 + 50 * Math.sin(y / 70) + 24 * rr(), y]);
  up.push([400, MB]);
  const upS = smooth(up, 6);
  h('path', { d: `M0 ${MT} L` + polyD(upS).slice(1) + ` L0 ${MB} Z`, fill: 'var(--hill-mid)' }, root);
  // sea along the right edge, a wavy coastline
  const cl = []; for (let y = MT; y <= MB; y += 30) cl.push([COAST + 10 * Math.sin(y / 37), y]); cl.push([COAST + 10 * Math.sin(MB / 37), MB]);
  h('path', { d: polyD(smooth(cl, 4)) + ` L1280 ${MB} L1280 ${MT} Z`, fill: 'var(--sea-1)' }, root);
  h('rect', { x: 1196, y: MT, width: 84, height: MB - MT, fill: 'var(--sea-2)' }, root);

  // the main river: centre line from the source to the coast
  const S = [120, 330];
  const raw = [S, [186, 300], [256, 302], [318, 326], [380, 330], [440, 356], [506, 364], [566, 390], [632, 398], [700, 428]];
  const tail = P.showMeander ? [[744, 462], [760, 520], [812, 548], [866, 520], [876, 466], [922, 440], [980, 452], [1020, 464], [COAST - 4, 466]]
    : [[800, 446], [900, 456], [990, 462], [COAST - 4, 466]];
  if (delta) tail[tail.length - 1] = [COAST - 34, 466];
  const pts = smooth(raw.concat(tail), 8); const n = pts.length;
  const wf = i => { const t = i / (n - 1); return lerp(5, 24, t) + (estuary && t > .86 ? Math.pow((t - .86) / .14, 2) * 46 : 0); };
  const at = u => pts[Math.round(clamp(u) * (n - 1))];
  const obstacles = pts.map((p, i) => ({ cx: p[0], cy: p[1], r: wf(i) / 2 + 12 }));
  if (P.title) obstacles.push({ x: GRID.left, y: 30, w: measure(root, P.title, 'ts-title') + 8, h: 96 });

  // tributaries: each joins at its stretch, flowing in from higher ground
  const JU = { upper: .2, middle: .4, lower: .58 }, DX = { upper: -10, middle: -90, lower: -120 }; const used = {};
  const tribs = (P.tributaries || []).map((t, i) => {
    const k = used[t.joins] = (used[t.joins] || 0) + 1; const u = JU[t.joins] + (k - 1) * .08; const J = at(u);
    const sgn = t.bank === 'south' ? 1 : -1;
    const st = [clamp(J[0] + DX[t.joins] - 40 * (k - 1), 40, 1000), clamp(J[1] + sgn * (170 + 16 * (k - 1)), MT + 30, MB - 30)];
    const mid = [lerp(st[0], J[0], .5) - 10, lerp(st[1], J[1], .5) + sgn * 6];
    const tp = smooth([st, [lerp(st[0], mid[0], .5) + 14, lerp(st[1], mid[1], .5)], mid, [lerp(mid[0], J[0], .6), lerp(mid[1], J[1], .6) - sgn * 4], J], 8);
    obstacles.push(...ptsBox(tp, 12));
    return { t, i, J, st, tp, sgn };
  });

  /* the river (drawn on in its build) */
  const k0 = bi('downhill');
  const riverEl = h('path', { d: ribbonD(pts, wf, 1), fill: 'var(--water)', s: k0 }, root);
  const tribG = h('g', { s: bi('tributaries') }, root);
  const tribEls = tribs.map(tr => { const m = tr.tp.length; return h('path', { d: ribbonD(tr.tp, i => lerp(4, 11, i / (m - 1)), 1), fill: 'var(--water)' }, tribG); });
  // delta: a fan of sand into the sea, split into channels (the one place a river splits)
  if (delta) {
    const D0 = [COAST - 34, 466]; const dg = h('g', { s: bi('mouth'), cls: 'rise' }, root);
    h('path', { d: polyD(smooth([[COAST - 44, 416], [COAST + 36, 392], [COAST + 92, 426], [COAST + 108, 470], [COAST + 88, 526], [COAST + 26, 548], [COAST - 44, 516]], 6)) + ' Z', fill: 'var(--sand)' }, dg);
    for (const e of [[COAST + 66, 406], [COAST + 104, 468], [COAST + 70, 534]]) { const cp = smooth([D0, [lerp(D0[0], e[0], .5), lerp(D0[1], e[1], .4)], e], 8); h('path', { d: ribbonD(cp, i => lerp(14, 9, i / (cp.length - 1)), 1), fill: 'var(--water)' }, dg); }
    obstacles.push({ x: COAST - 44, y: 392, w: 156, h: 160 });
  }

  /* labels: source */
  const W0 = 'var(--water-text)';
  const srcG = h('g', { s: 0, c: ctx.rc('source', null, 'rc-gone') }, root);
  h('circle', { cx: S[0], cy: S[1], r: 10, fill: 'var(--water)', stroke: 'var(--paper)', 'stroke-width': 3 }, srcG);
  obstacles.push({ x: S[0] - 14, y: S[1] - 14, w: 28, h: 28 });
  const sb = block(srcG, 0, 0, [{ text: txt(P, 'label:source', 'Source'), cls: 'ts-label', edit: 'text.label:source', fill: W0 }, { text: r.source, edit: 'river.source' }], { maxW: 250 });
  placeBlock(ctx, sb, [[GRID.left - sb.box.x, S[1] - 26 - sb.box.h - sb.box.y], [GRID.left - sb.box.x, S[1] + 26 - sb.box.y], ...around(S[0], S[1], sb.box, 22)], obstacles, r.source, BD);
  /* downhill: a side view under the map, at the same x, from the source height to sea level */
  const PY0 = 594, PY1 = 636, prof = u => [lerp(S[0], COAST, u), PY1 - (PY1 - PY0) * Math.pow(1 - u, 2.2)];
  const pp = Array.from({ length: 31 }, (_, i) => prof(i / 30));
  h('path', { d: polyD(pp) + ` L${COAST} ${PY1 + 6} L${S[0]} ${PY1 + 6} Z`, fill: 'var(--hill-mid)' }, root);
  h('rect', { x: COAST, y: PY1, width: 1264 - COAST, height: 6, fill: 'var(--sea-1)' }, root);
  const dg = h('g', { s: k0 }, root);
  flow(ctx, dg, pp.filter((_, i) => i % 3 === 0).map(([x, y]) => [x, y - 5]).concat([[COAST + 40, PY1 - 3]]), 'var(--water)', { w: 'var(--sw-struct)', k: .7, draw: k0 });
  computed(T(dg, S[0] - 16, PY0 + 16, `${r.sourceHeight} m`, 'ts-small', { 'text-anchor': 'end', fill: 'var(--ink)', cls: 'strong' }), 'river.sourceHeight');
  { const sl = h('g', {}, dg); const gr = labelGround(sl, { x: 0, y: 0, w: 0, h: 0 });
    const tb = textBlock(sl, GRID.right - 8, 0, txt(P, 'label:sealevel', 'Sea level: 0 m'), { cls: 'ts-small', maxW: 300, maxLines: 2, lh: 26, anchor: 'end', edit: 'text.label:sealevel', a: { fill: W0 } });
    const y0 = PY1 - 14 - (tb.lines.length - 1) * tb.lh; tb.el.setAttribute('transform', `translate(0 ${y0})`);
    const gb = { x: GRID.right - 16 - tb.w, y: y0 - 22, w: tb.w + 16, h: tb.h + 4 }; for (const [k, v] of Object.entries({ x: gb.x, y: gb.y, width: gb.w, height: gb.h })) gr.setAttribute(k, v); }
  /* tributary names at their upstream ends */
  // each name stays on its own bank of the river, clear of the hills edge, with a leader to its stream
  const tribBoxes = [], leaderOf = (st, bb) => [st, [clamp(st[0], bb.x, bb.x + bb.w), clamp(st[1], bb.y, bb.y + bb.h)]];
  const crosses = ([a, c], bx) => { const n = Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / 5); for (let i = 0; i <= n; i++) { const x = lerp(a[0], c[0], i / Math.max(1, n)), y = lerp(a[1], c[1], i / Math.max(1, n)); if (x > bx.x - 4 && x < bx.x + bx.w + 4 && y > bx.y - 4 && y < bx.y + bx.h + 4) return true; } return false; };
  const edge = ptsBox(upS, 6), BDT = { x: GRID.left, y: MT + 14, w: COAST - 8 - GRID.left, h: MB - MT - 28 };
  tribs.forEach(tr => {
    const g = h('g', { s: bi('tributaries'), c: ctx.rc('tributaries', null, 'rc-gone') }, root);
    const tb = block(g, 0, 0, [{ text: tr.t.name, edit: `tributaries.${tr.i}.name`, fill: W0 }], { maxW: 300 });
    const B0 = tb.box, side = ([dx, dy]) => (B0.y + dy + B0.h / 2 - tr.J[1]) * tr.sgn > 30;
    const grid = []; for (let x = GRID.left; x < 1040; x += 16) for (let y = MT + 14; y < MB; y += 12) grid.push([x - B0.x, y - B0.y]);
    const dist = ([dx, dy]) => Math.hypot(clamp(tr.st[0], B0.x + dx, B0.x + dx + B0.w) - tr.st[0], clamp(tr.st[1], B0.y + dy, B0.y + dy + B0.h) - tr.st[1]);
    const cands = around(tr.st[0], tr.st[1], B0, 12).concat(grid.sort((p, q) => dist(p) - dist(q))).filter(side);
    const obs = obstacles.concat(edge);
    const ok = bb => !tribBoxes.some(o => crosses(leaderOf(tr.st, bb), o));
    let bb = placeBlock(ctx, tb, cands, obs, tr.t.name, BDT, true, ok);
    if (!bb) bb = placeBlock(ctx, tb, cands, obstacles, tr.t.name, BDT, true, ok);
    if (!bb) bb = placeBlock(ctx, tb, around(tr.st[0], tr.st[1], B0, 12).concat(grid), obstacles, tr.t.name, BDT, false, ok);
    if (bb) { obstacles.push(bb); tribBoxes.push(bb); { const [a, c] = leaderOf(tr.st, bb); const n = Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / 8); for (let i = 1; i < n; i++) obstacles.push({ cx: lerp(a[0], c[0], i / n), cy: lerp(a[1], c[1], i / n), r: 3 }); }
      const qx = clamp(tr.st[0], bb.x, bb.x + bb.w), qy = clamp(tr.st[1], bb.y, bb.y + bb.h);
      if (Math.hypot(qx - tr.st[0], qy - tr.st[1]) > 10) g.insertBefore(h('line', { x1: tr.st[0], y1: tr.st[1], x2: qx, y2: qy, stroke: 'var(--water-text)', 'stroke-width': 'var(--sw-lead)' }), g.firstChild);
    }
  });
  /* meander */
  if (P.showMeander) {
    const g = h('g', { s: bi('meander'), c: ctx.rc('meander', null, 'rc-gone') }, root);
    const mc = [818, 494];
    h('ellipse', { cx: mc[0], cy: mc[1] + 4, rx: 100, ry: 80, fill: 'none', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-lead)', 'stroke-dasharray': '7 7' }, g);
    obstacles.push({ x: mc[0] - 108, y: mc[1] - 86, w: 216, h: 180 });
    const mb = block(g, 0, 0, [{ text: txt(P, 'label:meander', 'Meander'), edit: 'text.label:meander', fill: 'var(--focus-text)' }], { maxW: 260 });
    const mbb = placeBlock(ctx, mb, around(mc[0], mc[1], mb.box, 96).concat(sweep(mb.box, GRID.left, COAST - 20, MT + 8, MB - 8, mc[0], mc[1])), obstacles, 'meander', BD, false, leaderClear(mc, obstacles));
    if (mbb) { const qx = clamp(mc[0], mbb.x, mbb.x + mbb.w), qy = clamp(mc[1], mbb.y, mbb.y + mbb.h), dd = Math.hypot(qx - mc[0], (qy - mc[1]) * 100 / 80);
      if (dd > 140) { const e = [mc[0] + (qx - mc[0]) * 100 / dd, mc[1] + 4 + (qy - mc[1]) * 100 / dd]; g.insertBefore(h('line', { x1: e[0], y1: e[1], x2: qx, y2: qy, stroke: 'var(--focus)', 'stroke-width': 'var(--sw-lead)' }), g.firstChild); } }
  }
  /* mouth and sea */
  const mg = h('g', { s: bi('mouth') }, root);
  const mw = estuary ? txt(P, 'label:estuary', 'Estuary') : delta ? txt(P, 'label:delta', 'Delta') : txt(P, 'label:mouth', 'Mouth');
  const mk = estuary ? 'estuary' : delta ? 'delta' : 'mouth';
  const mlb = block(mg, 0, 0, [{ text: mw, edit: `text.label:${mk}`, cls: 'ts-label', fill: W0 }], { maxW: GRID.right - COAST - 34, maxLines: 6 });
  const SB = { x: COAST + 6, y: MT + 4, w: GRID.right - COAST - 6, h: MB - MT - 8 };
  const mc2 = (bl, ys) => ys.map(y => [COAST + 12 - bl.box.x, y - bl.box.y]);
  placeNear(ctx, mlb, mc2(mlb, delta ? [330, 290, 250] : [500, 520, 380, 330]).concat(sweep(mlb.box, COAST + 12, COAST + 12, MT + 8, MB - 8, COAST + 40, 466, 8)), obstacles, mw, [COAST + 20, 466], W0, BD);
  const snb = block(mg, 0, 0, [{ text: r.sea, edit: 'river.sea', fill: W0 }], { maxW: GRID.right - COAST - 34, maxLines: 6 });
  placeNear(ctx, snb, mc2(snb, [160, 200, 250, 290]).concat(sweep(snb.box, COAST + 12, COAST + 12, MT + 8, MB - 8, COAST + 40, MT, 8)), obstacles, r.sea, [COAST + 70, 200], W0, BD);
  /* the land: "Hills" and "Low land"; "not to scale" in the side view */
  /* the land: "Hills" and "Low land" are placed last, so the river names win the space */
  const land = (id, def, cands) => { const g = h('g', {}, root); const lb = block(g, 0, 0, [{ text: txt(P, `label:${id}`, def), edit: `text.label:${id}`, cls: 'ts-small', fill: 'var(--ink)' }], { maxW: 240, ground: false }); placeBlock(ctx, lb, cands.map(([x, y]) => [x - lb.box.x, y - lb.box.y]).concat(sweep(lb.box, cands[0][0] - 80, cands[0][0] + 300, MT + 8, MB - 8, cands[0][0], cands[0][1])), obstacles.concat(edge), def, BDT); if (lb.box && lb.style.display !== 'none') obstacles.push(lb.box); };
  land('hills', 'Hills', [[GRID.left, 524], [GRID.left, 140], [200, 524], [250, 140]]);
  land('lowland', 'Low land', [[540, 524], [600, 140], [460, 524], [700, 140], [900, 140]]);
  textBlock(root, 600, 601, txt(P, 'label:nts', 'Not to scale'), { cls: 'ts-small', maxW: 280, maxLines: 1, anchor: 'middle', edit: 'text.label:nts', a: { fill: 'var(--ink-2)' } });

  const setRiver = u => riverEl.setAttribute('d', ribbonD(pts, wf, Math.max(.02, u)));
  const setTribs = u => tribs.forEach((tr, j) => { const m = tr.tp.length; tribEls[j].setAttribute('d', ribbonD(tr.tp, i => lerp(4, 11, i / (m - 1)), Math.max(.03, u))); });
  return {
    dur: { downhill: 1600, tributaries: 1300 },
    still() { setRiver(1); setTribs(1); },
    reset() { setRiver(0); setTribs(0); },
    tick(k, u) {
      setRiver(k === bi('downhill') ? eIO(u) : 1);
      if (tribs.length) setTribs(k === bi('tributaries') ? eIO(u) : 1);
    },
  };
}

/* ---------- meander close-up */
function meanderState(C, R, th0, th1, entry, exit) {
  const rad = d => d * Math.PI / 180;
  const A0 = [C[0] + R * Math.cos(rad(th0)), C[1] + R * Math.sin(rad(th0))], A1 = [C[0] + R * Math.cos(rad(th1)), C[1] + R * Math.sin(rad(th1))];
  const tg0 = [Math.sin(rad(th0)), -Math.cos(rad(th0))], tg1 = [Math.sin(rad(th1)), -Math.cos(rad(th1))];
  const E = entry[entry.length - 1], X = exit[0];
  const pts = [], arc = [];
  entry.slice(0, -1).forEach(p => { pts.push(p); arc.push(0); });
  cubic(E, [E[0] + 110, E[1]], [A0[0] - tg0[0] * 90, A0[1] - tg0[1] * 90], A0, 14).forEach(p => { pts.push(p); arc.push(0); });
  const na = 48; for (let i = 0; i <= na; i++) { const th = rad(lerp(th0, th1, i / na)); pts.push([C[0] + R * Math.cos(th), C[1] + R * Math.sin(th)]); arc.push(Math.pow(Math.sin(Math.PI * i / na), 1.4)); }
  cubic(A1, [A1[0] + tg1[0] * 90, A1[1] + tg1[1] * 90], [X[0] - 110, X[1]], X, 14).slice(1).forEach(p => { pts.push(p); arc.push(0); });
  exit.forEach(p => { pts.push(p); arc.push(0); });
  // which side of the ribbon faces away from the centre (the outside of the bend)
  const outSide = pts.map((p, i) => { const q0 = pts[Math.max(0, i - 1)], q1 = pts[Math.min(pts.length - 1, i + 1)]; const dx = q1[0] - q0[0], dy = q1[1] - q0[1]; const nx = -dy, ny = dx; return ((p[0] + nx) - C[0]) ** 2 + ((p[1] + ny) - C[1]) ** 2 > (p[0] - C[0]) ** 2 + (p[1] - C[1]) ** 2 ? 'L' : 'R'; });
  return { C, R, pts, arc, outSide, A0, A1 };
}
function renderMeander(root, P, ctx) {
  const b = ctx.b, bi = k => b[k] ?? 0; const m = P.meander; const oxbow = m.stage === 'oxbow';
  const WR = 46, MIG = 26; const MT = 124, MB = 660;
  h('rect', { x: 0, y: MT, width: 1280, height: MB - MT, fill: 'var(--hill-far)' }, root);
  const entry = [[-30, 212], [150, 212]], exit = [[930, 212], [1310, 212]];
  const A = meanderState([540, 384], 160, 205, -25, entry, exit);
  const W0 = 'var(--water-text)';
  const obstacles = []; if (P.title) obstacles.push({ x: GRID.left, y: 30, w: measure(root, P.title, 'ts-title') + 8, h: 96 });
  const kE = bi('erosion'), kD = bi('deposition');
  const off = (S, e1, e2) => i => { const a = S.arc[i]; const o = MIG * a * e1, inn = -MIG * a * e2; return S.outSide[i] === 'L' ? [o, inn] : [inn, o]; };
  const hideA = oxbow ? bi('neck') : null;
  const gA = h('g', { hide: hideA }, root);
  // deposition: sand on the inside, uncovered as the inner bank moves out
  const arcIdx = A.arc.map((a, i) => a > .02 ? i : -1).filter(i => i >= 0);
  // sand band: between the first inner bank and where it ends up
  const innerAt = d => arcIdx.map(i => { const p = A.pts[i], q0 = A.pts[i - 1], q1 = A.pts[i + 1]; const dx = q1[0] - q0[0], dy = q1[1] - q0[1], l = Math.hypot(dx, dy); const toC = [A.C[0] - p[0], A.C[1] - p[1]]; const nx = -dy / l, ny = dx / l; const s = nx * toC[0] + ny * toC[1] > 0 ? 1 : -1; const dd = d(i); return [p[0] + nx * s * dd, p[1] + ny * s * dd]; });
  const sandIn = innerAt(i => WR / 2 + 4), sandOut = innerAt(i => WR / 2 - MIG * A.arc[i] - 2);
  h('path', { d: polyD(sandIn.concat(sandOut.slice().reverse())) + ' Z', fill: 'var(--sand)', s: kD }, gA);
  const riverA = h('path', { d: ribbonD(A.pts, () => WR, 1, off(A, 1, 1)), fill: 'var(--water)' }, gA);
  // erosion: the old outside bank stays as a dashed ghost; a steep earth bank (river cliff) on the new one
  const outerAt = d => arcIdx.map(i => { const p = A.pts[i], q0 = A.pts[i - 1], q1 = A.pts[i + 1]; const dx = q1[0] - q0[0], dy = q1[1] - q0[1], l = Math.hypot(dx, dy); const toC = [A.C[0] - p[0], A.C[1] - p[1]]; const nx = -dy / l, ny = dx / l; const s = nx * toC[0] + ny * toC[1] > 0 ? -1 : 1; const dd = d(i); return [p[0] + nx * s * dd, p[1] + ny * s * dd]; });
  const cliff = outerAt(i => WR / 2 + MIG * A.arc[i] + 5);
  h('path', { d: polyD(cliff.filter((_, j) => A.arc[arcIdx[j]] > .25)), fill: 'none', stroke: 'var(--soil)', 'stroke-width': 10, 'stroke-linecap': 'round', s: kE, delay: 900 }, gA);
  h('path', { d: polyD(outerAt(i => WR / 2)), fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '6 7', s: kE }, gA);
  // fastest water: a dashed line swinging to the outside
  const thal = A.pts.map((p, i) => { const q0 = A.pts[Math.max(0, i - 1)], q1 = A.pts[Math.min(A.pts.length - 1, i + 1)]; const dx = q1[0] - q0[0], dy = q1[1] - q0[1], l = Math.hypot(dx, dy) || 1; const s = A.outSide[i] === 'L' ? 1 : -1; const d = 13 * A.arc[i] + 6 * A.arc[i] * 1; return [p[0] - dy / l * d * s, p[1] + dx / l * d * s]; });
  const fastG = h('g', { s: bi('fast'), c: ctx.rc('fast', null, 'soft') }, gA);
  flow(ctx, fastG, thal.filter((_, i) => i % 3 === 0).slice(4, -3), 'var(--energy)', { w: 'var(--sw-struct)', k: .7, dash: '10 9' });
  // obstacles: the river and its banks
  obstacles.push(...A.pts.map((p, i) => ({ cx: p[0], cy: p[1], r: WR / 2 + MIG * A.arc[i] + 6 })));
  const lab = (g, id, def, x, y, anchor, maxW, col) => { const bl = block(g, x, y, [{ text: txt(P, `label:${id}`, def), edit: `text.label:${id}`, fill: col || 'var(--ink)' }], { anchor, maxW }); return bl; };
  const LB = { x: GRID.left, y: GRID.top, w: (m.section ? 838 : GRID.right) - GRID.left, h: GRID.bottom - GRID.top }; // clear of the section card
  const fit = (bl, cands, what, p) => p ? placeNear(ctx, bl, cands, obstacles, what, p, null, LB) : placeBlock(ctx, bl, cands, obstacles, what, LB);
  const C = A.C;
  // labels: meander (upper inside), fastest water (left, outside), erosion (left below), deposition (lower inside)
  const sh = [[0, 0], [0, -24], [0, 24], [-30, 0], [30, 0], [0, -48], [0, 48]];
  const l1 = lab(h('g', { s: 0, c: ctx.rc('bend', null, 'soft') }, gA), 'meander', 'Meander', C[0], C[1] - 108, 'middle', 220, 'var(--focus-text)'); fit(l1, sh, 'meander', [C[0], C[1] - 60]);
  const l2 = lab(h('g', { s: bi('fast'), c: ctx.rc('fast', null, 'soft') }, gA), 'fast', 'Fastest water', C[0] - A.R - 60, C[1] - 40, 'end', 230, 'var(--ink)'); fit(l2, sh, 'fastest water');
  const l3 = lab(h('g', { s: kE, c: ctx.rc('erosion', null, 'soft') }, gA), 'erosion', 'Erosion: river cliff', C[0] - A.R - 52, C[1] + 110, 'end', 250, 'var(--ink)'); fit(l3, sh, 'erosion');
  const l4 = lab(h('g', { s: kD, c: ctx.rc('deposition', null, 'soft') }, gA), 'deposition', 'Deposition: slip-off slope', C[0], C[1] - 40, 'middle', 200, 'var(--ink)'); fit(l4, sh, 'deposition', sandIn[Math.round(sandIn.length / 2)]);
  // leaders from the outside labels to the bank they name
  if (l3 && l3.box && l3.style.display !== "none") { const g = l3.parentNode, B3 = l3.box; const tgt = outerAt(i => WR / 2 + MIG * A.arc[i] + 10)[Math.round(arcIdx.length * .22)]; g.insertBefore(h('line', { x1: B3.x + B3.w, y1: B3.y + B3.h / 2, x2: tgt[0], y2: tgt[1], stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-lead)' }), g.firstChild); }

  // the cross-section A to B
  if (m.section) {
    const ks = bi('section'); const ia = Math.round(arcIdx.length * .7);
    const pin = innerAt(i => WR / 2 + 18)[ia], pout = outerAt(i => WR / 2 + MIG * A.arc[i] + 26)[ia];
    const sg = h('g', { s: ks, c: ctx.rc('section', null, 'soft') }, gA);
    h('line', { x1: pin[0], y1: pin[1], x2: pout[0], y2: pout[1], stroke: 'var(--ink)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '5 5' }, sg);
    const dv = [pout[0] - pin[0], pout[1] - pin[1]], dl = Math.hypot(...dv); const ux = dv[0] / dl, uy = dv[1] / dl;
    // the card: the bed from A (inside, shallow and gentle) to B (outside, deep and steep). Laid out
    // top-down so long wording pushes the drawing down, and the card grows upwards from its foot.
    const cx0 = 846, cw = 370, foot = 630; const bx0 = cx0 + 30, bx1 = cx0 + cw - 30;
    const cg = h('g', { s: ks, cls: 'rise', c: ctx.rc('section', null, 'soft') }, root);
    const card = h('rect', { x: cx0, rx: 'var(--r-card)', fill: 'var(--paper)', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)', cls: 'lift body' }, cg);
    const inner = h('g', {}, cg);
    const hd = textBlock(inner, cx0 + 22, 38, txt(P, 'label:section', 'Cross-section A to B'), { cls: 'ts-small', maxW: cw - 44, maxLines: 2, lh: 26, edit: 'text.label:section', a: { cls: 'muted' } });
    const abY = 38 + hd.h + 12, abW = (cw - 60) / 2 - 12;
    const ta = textBlock(inner, bx0 - 4, abY, txt(P, 'label:a', 'A'), { cls: 'ts-label', maxW: abW, maxLines: 4, lh: 28, edit: 'text.label:a', a: { cls: 'strong', fill: 'var(--ink)' } });
    const tbB = textBlock(inner, bx1 + 4, abY, txt(P, 'label:b', 'B'), { cls: 'ts-label', maxW: abW, maxLines: 4, lh: 28, anchor: 'end', edit: 'text.label:b', a: { cls: 'strong', fill: 'var(--ink)' } });
    const wy = abY + Math.max(ta.h, tbB.h) - 28 + 46;
    const bed = [[bx0, wy - 26], [bx0 + 70, wy - 4], [bx0 + 150, wy + 22], [bx0 + 220, wy + 52], [bx0 + 268, wy + 86], [bx0 + 290, wy + 92], [bx1 - 18, wy + 70], [bx1 - 14, wy - 20], [bx1, wy - 40]];
    const bedS = smooth(bed, 6); const art = h('g', {}, inner);
    h('path', { d: polyD([[bx0 + 40, wy]].concat(bedS.filter(p => p[1] >= wy)).concat([[bx1 - 14, wy]])) + ' Z', fill: 'var(--water)' }, art);
    h('path', { d: polyD(bedS) + ` L${bx1} ${wy + 130} L${bx0} ${wy + 130} Z`, fill: 'var(--soil)' }, art);
    h('path', { d: polyD(bedS.filter(p => p[0] < bx0 + 200)) + ` L${bx0 + 200} ${wy + 40} L${bx0} ${wy - 10} Z`, fill: 'var(--sand)' }, art);
    inner.appendChild(ta.el); inner.appendChild(tbB.el);
    const ts = textBlock(inner, bx0, wy + 166, txt(P, 'label:shallow', 'Inside: shallow, slow'), { cls: 'ts-small', maxW: 150, maxLines: 4, lh: 26, edit: 'text.label:shallow', a: { fill: 'var(--ink)' } });
    const td = textBlock(inner, bx1, wy + 166, txt(P, 'label:deep', 'Outside: deep, fast'), { cls: 'ts-small', maxW: 150, maxLines: 4, lh: 26, anchor: 'end', edit: 'text.label:deep', a: { fill: 'var(--ink)' } });
    const ch = wy + 166 + Math.max(ts.h, td.h) - 26 + 18; const cy0 = Math.min(300, foot - ch);
    inner.setAttribute('transform', `translate(0 ${cy0})`); card.setAttribute('y', cy0); card.setAttribute('width', cw); card.setAttribute('height', ch);
    obstacles.push({ x: cx0, y: cy0, w: cw, h: ch });
    // A and B on the plan: tags sized to their wording, just beyond each end of the line
    const tag = (p, s, dir, path) => {
      const tg = h('g', {}, sg); const gr = h('rect', { rx: 'var(--r-pill)', fill: 'var(--paper)', stroke: 'var(--ink)', 'stroke-width': 'var(--sw-hair)' }, tg);
      const tb = textBlock(tg, 0, 0, s, { cls: 'ts-small', maxW: 220, maxLines: 3, lh: 26, anchor: 'middle', edit: path, a: { cls: 'strong', fill: 'var(--ink)' } });
      const hh = tb.h + 14, w = Math.max(hh, tb.w + 20); const box = { x: -w / 2, y: -20 - 7, w, hh };
      gr.setAttribute('x', box.x); gr.setAttribute('y', box.y); gr.setAttribute('width', w); gr.setAttribute('height', hh); tg.box = { x: box.x, y: box.y, w, h: hh };
      const cands = []; for (const d of [0, 16, 40, 70]) { const r = Math.abs(dir[0]) * w / 2 + Math.abs(dir[1]) * hh / 2 + 6 + d; cands.push([p[0] + dir[0] * r - box.x - w / 2, p[1] + dir[1] * r - box.y - hh / 2]); }
      const bb = placeBlock(ctx, tg, cands.concat(around(p[0], p[1], tg.box, 10)), obstacles, s, undefined, true) || placeBlock(ctx, tg, sweep(tg.box, GRID.left, GRID.right - tg.box.w, GRID.top, GRID.bottom - tg.box.h, p[0], p[1], 10), obstacles, s, undefined, false, leaderClear(p, obstacles));
      if (bb) { const qx = clamp(p[0], bb.x, bb.x + bb.w), qy = clamp(p[1], bb.y, bb.y + bb.h); if (Math.hypot(qx - p[0], qy - p[1]) > 4) sg.insertBefore(h('line', { x1: p[0], y1: p[1], x2: qx, y2: qy, stroke: 'var(--ink)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '5 5' }), sg.firstChild); }
    };
    obstacles.push(...Array.from({ length: 9 }, (_, i) => { const t = i / 8; return { cx: lerp(pin[0], pout[0], t), cy: lerp(pin[1], pout[1], t), r: 6 }; }));
    tag(pin, txt(P, 'label:a', 'A'), [-ux, -uy], 'text.label:a'); tag(pout, txt(P, 'label:b', 'B'), [ux, uy], 'text.label:b');
  }

  // the neck narrows, then the river cuts through and leaves an oxbow lake
  let gB = null;
  if (oxbow) {
    const B = meanderState([540, 404], 196, 238, -58, entry, exit);
    gB = h('g', { s: bi('neck'), hide: bi('oxbow') }, root);
    h('path', { d: ribbonD(B.pts, () => WR, 1), fill: 'var(--water)' }, gB);
    const nk = h('g', {}, gB); const ny = (B.A0[1] + B.A1[1]) / 2 - 2;
    h('line', { x1: B.A0[0] + 30, y1: ny, x2: B.A1[0] - 30, y2: ny, stroke: 'var(--focus)', 'stroke-width': 'var(--sw-lead)' }, nk);
    for (const x of [B.A0[0] + 30, B.A1[0] - 30]) h('line', { x1: x, y1: ny - 12, x2: x, y2: ny + 12, stroke: 'var(--focus)', 'stroke-width': 'var(--sw-lead)' }, nk);
    // its label sits beside the marker, above the neck, never inside the loop
    const bl = block(nk, 540, 0, [{ text: txt(P, 'label:neck', 'The neck gets narrower'), edit: 'text.label:neck', fill: 'var(--focus-text)' }], { anchor: 'middle', maxW: 300 });
    const nObs = B.pts.map(p => ({ cx: p[0], cy: p[1], r: WR / 2 + 4 })); if (P.title) nObs.push(obstacles[0]);
    placeBlock(ctx, bl, [ny - 28, ny - 44, ny - 60, ny - 76, ny - 92].map(y => [0, y - bl.box.h - bl.box.y]).concat([[0, ny + 22 - bl.box.y]]), nObs, 'neck');
    // oxbow: straight river through the neck; the old loop is a lake sealed at both ends with sand
    const gC = h('g', { s: bi('oxbow') }, root);
    const straight = smooth([[-30, 212], [150, 212], [B.A0[0] - 10, B.A0[1] + 4], [B.A1[0] + 10, B.A1[1] + 4], [930, 212], [1310, 212]], 10);
    const lakeIdx = B.arc.map((a, i) => a > .16 ? i : -1).filter(i => i >= 0); const lake = lakeIdx.map(i => B.pts[i]);
    // sand fills the old channel from each lake end up to the new channel's bank
    const a0 = B.arc.findIndex(a => a > 0) - 1, a1 = B.arc.length - 1 - B.arc.slice().reverse().findIndex(a => a > 0) + 1;
    for (const seg of [B.pts.slice(a0 + 2, lakeIdx[0] + 3), B.pts.slice(lakeIdx[lakeIdx.length - 1] - 2, a1 - 1)]) h('path', { d: ribbonD(seg, () => WR * .9), fill: 'var(--sand)' }, gC);
    h('path', { d: ribbonD(lake, i => WR * .9 * Math.pow(Math.sin(Math.PI * (i + .5) / lake.length), .35)), fill: 'var(--water)' }, gC);
    h('path', { d: ribbonD(straight, () => WR), fill: 'var(--water)' }, gC);
    const lb = block(gC, 540, 404, [{ text: txt(P, 'label:oxbow', 'Oxbow lake'), edit: 'text.label:oxbow', cls: 'ts-label', fill: W0 }], { anchor: 'middle', maxW: 240 });
    void lb;
  }
  const setA = (e1, e2) => riverA.setAttribute('d', ribbonD(A.pts, () => WR, 1, off(A, e1, e2)));
  return {
    dur: { erosion: 1600, deposition: 1600 },
    still() { setA(1, 1); },
    reset() { setA(0, 0); },
    tick(k, u) { setA(k > kE ? 1 : k === kE ? eIO(u) : 0, k > kD ? 1 : k === kD ? eIO(u) : 0); },
  };
}

/* ---------- coast: a headland seen from the sea */
function renderCoast(root, P, ctx) {
  const b = ctx.b, bi = k => b[k] ?? 0; const SL = 562, TOP = 272, MT = 124;
  // features are drawn at a base size and scaled up from the waterline so the headland fills the frame
  const F = (SL - TOP) / 202, TOP0 = SL - 202;
  const has = f => P.coast.some(c => c.feature === f);
  sky(root, ctx, SL);
  // far coast: a hazy headland behind
  h('path', { d: `M560 ${SL} L600 ${SL - 120 * F} Q700 ${SL - 140 * F} 820 ${SL - 132 * F} L1010 ${SL - 116 * F} Q1040 ${SL - 60 * F} 1060 ${SL} Z`, fill: 'var(--haze)' }, root);
  h('path', { d: `M560 ${SL} L600 ${SL - 120 * F} Q700 ${SL - 140 * F} 820 ${SL - 132 * F} L1010 ${SL - 116 * F} Q1040 ${SL - 60 * F} 1060 ${SL} Z`, fill: 'var(--hill-far)', opacity: .5 }, root);
  const kh = bi('headland');
  // the headland: cliff face (stone), a shaded seaward end, grass on top
  const land = h('g', {}, root);
  const X = { crack: 150, cave: 300, arch: 500, stack: 742, stump: 922 };
  const endX = has('arch') ? 640 : has('cave') ? 440 : 300;
  h('path', { d: `M-10 ${SL} L-10 ${TOP} L${endX - 30} ${TOP + 6} Q${endX} ${TOP + 12} ${endX + 6} ${TOP + 40} L${endX + 14} ${SL} Z`, fill: 'var(--stone)' }, land);
  h('path', { d: `M${endX - 6} ${TOP + 10} Q${endX + 2} ${TOP + 16} ${endX + 6} ${TOP + 40} L${endX + 14} ${SL} L${endX - 14} ${SL} Z`, fill: 'var(--stone-shade)' }, land);
  h('path', { d: `M-10 ${TOP - 10} L${endX - 30} ${TOP - 4} Q${endX - 6} ${TOP} ${endX - 4} ${TOP + 10} L-10 ${TOP + 8} Z`, fill: 'var(--hill-near)' }, land);
  for (const y of [TOP + 70 * F, TOP + 132 * F]) h('line', { x1: 0, x2: endX - 4, y1: y, y2: y + 4, stroke: 'var(--stone-shade)', 'stroke-width': 'var(--sw-hair)', opacity: .7 }, land);
  const skyFill = `url(#${ctx.uid}-sky)`;
  const feat = {};
  // crack
  feat.crack = g => { const x = X.crack; h('path', { d: `M${x} ${SL} L${x + 6} ${SL - 30} L${x - 4} ${SL - 58} L${x + 4} ${SL - 90} L${x - 2} ${SL - 112}`, fill: 'none', stroke: 'var(--stone-shade)', 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g); return [x, SL - 112]; };
  feat.cave = g => { const x = X.cave; h('path', { d: `M${x - 44} ${SL} L${x - 40} ${SL - 52} Q${x} ${SL - 104} ${x + 40} ${SL - 52} L${x + 44} ${SL} Z`, fill: 'var(--stone-shade)' }, g); return [x, SL - 90]; };
  feat.arch = g => { const x = X.arch; const d = `M${x - 56} ${SL} L${x - 52} ${SL - 74} Q${x} ${SL - 142} ${x + 52} ${SL - 74} L${x + 56} ${SL} Z`;
    // see-through: sky, the far coast and the sea behind show through the arch
    const id = ctx.uid + '-arch'; h('path', { d }, h('clipPath', { id }, h('defs', {}, g)));
    const hole = h('g', { 'clip-path': `url(#${id})` }, g);
    h('rect', { x: x - 60, y: SL - 150, width: 120, height: 150, fill: skyFill }, hole);
    h('rect', { x: x - 60, y: SL - 44, width: 120, height: 44, fill: 'var(--hill-far)' }, hole);
    h('rect', { x: x - 60, y: SL - 14, width: 120, height: 14, fill: 'var(--sea-1)' }, hole);
    return [x, SL - 140]; };
  feat.stack = g => { const x = X.stack, t = TOP0 + 24;
    h('path', { d: `M${x - 46} ${SL} L${x - 38} ${t + 10} Q${x - 30} ${t} ${x - 10} ${t} L${x + 24} ${t + 2} Q${x + 38} ${t + 8} ${x + 40} ${t + 22} L${x + 50} ${SL} Z`, fill: 'var(--stone)' }, g);
    h('path', { d: `M${x + 18} ${t + 2} Q${x + 38} ${t + 8} ${x + 40} ${t + 22} L${x + 50} ${SL} L${x + 22} ${SL} Z`, fill: 'var(--stone-shade)' }, g);
    h('path', { d: `M${x - 40} ${t + 8} Q${x - 30} ${t - 6} ${x - 8} ${t - 6} L${x + 26} ${t - 4} Q${x + 36} ${t} ${x + 38} ${t + 10} L${x - 40} ${t + 14} Z`, fill: 'var(--hill-near)' }, g);
    for (const [dx, s] of [[-64, 14], [64, 12], [78, 9]]) h('ellipse', { cx: x + dx, cy: SL - 4, rx: s * 1.4, ry: s, fill: 'var(--stone-shade)' }, g);
    return [x, t - 6]; };
  feat.stump = g => { const x = X.stump; h('path', { d: `M${x - 44} ${SL + 6} L${x - 34} ${SL - 26} Q${x} ${SL - 38} ${x + 34} ${SL - 24} L${x + 46} ${SL + 6} Z`, fill: 'var(--stone)' }, g);
    h('path', { d: `M${x + 12} ${SL - 34} Q${x + 30} ${SL - 28} ${x + 34} ${SL - 24} L${x + 46} ${SL + 6} L${x + 16} ${SL + 6} Z`, fill: 'var(--stone-shade)' }, g); return [x, SL - 36]; };
  // sea in front, waves on it
  water(root, -10, 1290, SL, 660);
  const waves = h('g', { s: kh }, root);
  const wv = [];
  // the time line under the sea: its wording wraps upwards from the foot, the arrow stays on the grid
  const ty = 634, tl = txt(P, 'label:older', 'Older features further out to sea'), tcx = 715, TMAX = 2 * (GRID.right - 100 - tcx);
  const tmp = h('g', {}, root); const tm = textBlock(tmp, 0, 0, tl, { cls: 'ts-label', maxW: TMAX, maxLines: 2, lh: 30 }); tmp.remove();
  const tw = tm.w, ty0 = ty - (tm.lines.length - 1) * tm.lh;
  const tBox = { x: tcx - tw / 2 - 14, y: ty0 - 32, w: tw + 28, h: 44 + ty - ty0 };
  for (const [x, y] of [[700, SL + 18], [860, SL + 44], [1040, SL + 22], [1160, SL + 56], [600, SL + 60], [420, SL + 32], [240, SL + 64]]) if (!overlaps({ x: x - 36, y: y - 10, w: 72, h: 20 }, { x: tBox.x, y: tBox.y, w: Math.max(1190, tcx + tw / 2 + 90) - tBox.x, h: tBox.h }, 8)) wv.push(h('path', { d: `M${x - 34} ${y} q17 -12 34 0 q17 12 34 0`, fill: 'none', stroke: 'var(--sea-hi)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, waves));
  // labels above the cliff top, in a lane; leaders end at the label's edge
  const lane = [], leads = []; const rows = [MT + 34, MT + 104, MT + 6, MT + 70];
  const crossSeg = (a, b, c, d) => { const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])); return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0; };
  const segHits = (a, c, o) => { const n = Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / 5); for (let i = 1; i < n; i++) { const x = lerp(a[0], c[0], i / n), y = lerp(a[1], c[1], i / n); if (x > o.x - 3 && x < o.x + o.w + 3 && y > o.y - 3 && y < o.y + o.h + 3) return true; } return false; };
  const place = (g, text, edit, px0, py, cls, col, slide = null) => {
    const tmp = h('g', {}, g); const tb = textBlock(tmp, 0, 0, text, { cls, maxW: 260, maxLines: 3, lh: 28 }); tmp.remove();
    const w = tb.w + 20, hh = tb.h + 12;
    for (let d = 0; d <= 1100; d += 6) for (const ry of rows) {
      for (const cx of d ? [px0 - d, px0 + d] : [px0]) {
        const px = slide ? clamp(cx, slide[0], slide[1]) : px0;
        const bb = { x: cx - w / 2, y: ry, w, h: hh };
        if (bb.x < GRID.left || bb.x + bb.w > GRID.right) continue;
        if (lane.some(q => overlaps(bb, q, 28)) || (P.title && overlaps(bb, { x: GRID.left, y: 30, w: measure(root, P.title, 'ts-title') + 8, h: 70 }, 6))) continue;
        if (bb.y + bb.h > py - 10) continue;
        if (lane.some(q => segHits([cx, bb.y + bb.h], [px, py], q)) || leads.some(([a, c]) => segHits(a, c, bb) || crossSeg(a, c, [cx, bb.y + bb.h], [px, py]))) continue;
        lane.push(bb); leads.push([[cx, bb.y + bb.h], [px, py]]);
        h('line', { x1: cx, y1: bb.y + bb.h, x2: px, y2: py, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-lead)' }, g);
        labelGround(g, bb);
        textBlock(g, cx, ry + 28, text, { cls, maxW: 260, maxLines: 3, lh: 28, anchor: 'middle', edit, a: { fill: col || 'var(--ink)' } });
        return bb;
      }
    }
    ctx.warn(`No room for the label “${text}”.`); return null;
  };
  // headland label first (it is the first build), at the cliff top
  const hg = h('g', { s: kh, c: ctx.rc('headland', null, 'soft') }, root);
  // headland first (its build comes first); it may point at any part of the cliff top
  place(hg, txt(P, 'label:headland', 'Headland'), 'text.label:headland', 400, TOP - 4, 'ts-label', 'var(--ink)', [GRID.left + 30, endX - 40]);
  const order = P.coast.map(c => c.feature); const last = order[order.length - 1];
  P.coast.forEach((c, i) => {
    const key = `f:${c.feature}`, k = bi(key);
    const g = h('g', { s: k, cls: 'rise' }, land.parentNode === root ? root : root);
    const fg = h('g', { transform: `translate(${X[c.feature]} ${SL}) scale(${F.toFixed(4)}) translate(${-X[c.feature]} ${-SL})` }, g);
    const a0 = feat[c.feature](fg), anchor = [a0[0], SL - (SL - a0[1]) * F];
    root.insertBefore(g, waves.previousSibling); // behind the sea, in front of the headland
    const lg = h('g', { s: k, c: c.feature === last ? null : ctx.rc(key, null, 'soft') }, root);
    place(lg, c.label || txt(P, `label:${c.feature}`, FEATURE_WORDS[c.feature]), c.label ? `coast.${i}.label` : `coast.${i}.label`, X[c.feature], anchor[1], 'ts-label', 'var(--ink)');
  });
  // time: the further out to sea, the older (summary)
  const tg = h('g', { s: ctx.N }, root);
  const tx1 = 1180;
  h('rect', { x: tBox.x, y: tBox.y, width: tBox.w, height: tBox.h, rx: 'var(--r-mark)', fill: 'var(--knockout)' }, tg);
  textBlock(tg, tcx, ty0, tl, { cls: 'ts-label', maxW: TMAX, maxLines: 2, lh: 30, anchor: 'middle', edit: 'text.label:older', a: { fill: 'var(--ink)' } });
  flow(ctx, tg, [[tcx + tw / 2 + 24, ty - 10], [Math.max(tx1, tcx + tw / 2 + 80), ty - 10]], 'var(--ink-2)', { w: 'var(--sw-rule)', k: .6 });
  return {
    dur: { headland: 1600 },
    tick(k, u, t) { const s = Math.sin((t || 0) * 1.2); wv.forEach((w, i) => w.setAttribute('transform', `translate(${(i % 2 ? 1 : -1) * 4 * s} 0)`)); },
  };
}
