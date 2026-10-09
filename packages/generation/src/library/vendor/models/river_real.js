// A real river, drawn from the geo database in the north-star map style (Greg, 8 Oct 2026).
// The river is a filled ribbon that widens downstream, on land zones cut from real heights (low land,
// hills, mountains for a whole river; flood plain and higher ground in a close-up), with cards and
// leaders that never collide, flow arrows, and a long profile from real heights.
// Views: the whole river; a close-up of one named feature (a meander, a town, a confluence, the
// source, the estuary, an ox-bow lake); or a box around two or more named towns. A close-up can
// start on the whole river and zoom in as a build.
// Truth by construction: the model never takes coordinates. The river, its tributaries, towns and
// features are IDs from the baked gazetteer (kit/rivers/index.js, made by tools/riverbake.ts from
// geo.sqlite), every camera comes from a feature's box, and an ID the data does not hold is refused.
// A river that is not in the index (unknown, unvalidated or failing a bake gate) is refused with
// fallback 'rivers_coasts', so the writer draws the schematic instead.
import { h, clamp, lerp, eIO, txt, TITLE_PARAM, TEXT_PARAM_FOR, schemaCheck, withDefaults, result } from '../kit/index.js';
import { RIVERS } from '../kit/rivers/index.js';
import { landRings } from '../kit/geo.js';

export const meta = {
  id: 'river_real', name: 'A real river', kind: 'scene', version: 1,
  subjects: ['Geography'], years: ['Y3', 'Y4', 'Y5', 'Y6', 'KS3'],
  teaches: 'A named real river from source to sea on real land heights: its tributaries, towns, meanders, ox-bow lakes and estuary, with a close-up of one feature.',
};

/* ------------------------------------------------------------------ data */
const DATA = new Map();
/** Loads the river's baked geometry (and the label font). The library awaits this before mounting. */
export async function prepare(raw) {
  // the national view draws several rivers: load each one
  for (const id of [raw && raw.river, ...((raw && raw.view && raw.view.kind === 'national' && raw.rivers) || [])]) { const R = RIVERS[id];
    if (R && !DATA.has(id)) DATA.set(id, (await import(`../kit/rivers/${R.file}`)).default); }
  if (typeof document !== 'undefined' && document.fonts) await Promise.race([Promise.all(['500', '600', '700'].map(w => document.fonts.load(`${w} 24px Lexend`))), new Promise(r => setTimeout(r, 3000))]);
}
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\b(the|river|afon|rio)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
/** A validated river's ID from a name ("the Severn" -> gb.river-severn), longest first; null when none passed. */
export function riverIdFor(name) {
  const k = norm(name); if (!k) return null;
  const hits = Object.entries(RIVERS).filter(([, r]) => [r.name, ...(r.aliases || [])].some(n => norm(n) === k));
  hits.sort((a, b) => b[1].km - a[1].km);
  return hits.length ? hits[0][0] : null;
}
export const RIVER_IDS = Object.keys(RIVERS);
/** A title from the river itself ("The River Severn: source to sea"), for callers that want one. */
export function titleFor(P) { const I = RIVERS[P.river]; if (!I) return ''; const n = /^river |river$/i.test(I.name) ? I.name.replace(/^River /, 'River ') : I.name; return isCloseUp(P) ? `The ${n}` : `The ${n}: source to sea`; }
const DELTAS = new Set(['w.mississippi', 'w.nile', 'w.ganges', 'w.niger', 'w.mekong', 'w.danube', 'w.volga', 'w.indus', 'w.lena', 'w.po', 'w.rhone', 'w.ebro', 'w.irrawaddy', 'w.orinoco', 'w.mackenzie', 'w.yukon', 'w.rhine']);
const dec = (a) => { const o = []; let x = 0, y = 0; for (let i = 0; i < a.length; i += 2) { x += a[i]; y += a[i + 1]; o.push([x / 1e5, y / 1e5]); } return o; };
const DEC = new WeakMap();
const D_ = (arr) => { if (!arr) return []; let v = DEC.get(arr); if (!v) { v = dec(arr); DEC.set(arr, v); } return v; };

/* ------------------------------------------------------------------ params */
const CALLOUTS = ['source', 'mouth', 'estuary', 'sea', 'flow', 'meander', 'neck', 'oxbow'];
const CALLOUT_WORDS = ['Source', 'Mouth', 'Estuary', 'Sea name', 'Flow arrows', 'Meander', 'Neck of the meander', 'Ox-bow lakes'];
export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'A real river',
  properties: {
    // No river-specific default: a fill that leaves the title out got the Thames title on every river (ab-rivers).
    title: TITLE_PARAM(''),
    river: { type: 'string', title: 'River (an ID from the river index)', description: 'Only rivers whose map data passed our checks can be drawn. Others use the schematic river.', default: 'gb.river-thames', 'x-ref': 'river' },
    view: {
      type: 'object', title: 'What the map shows', default: { kind: 'whole', zoom: true },
      properties: {
        kind: { type: 'string', title: 'View', enum: ['whole', 'feature', 'places', 'national'], 'x-labels': ['The whole river', 'A close-up of one feature', 'The river between named towns', 'Several rivers across a country'], default: 'whole' },
        feature: { type: 'string', title: 'Feature to zoom in on (an ID from this river)', default: '', 'x-ref': 'river-feature' },
        places: { type: 'array', title: 'Towns to frame (IDs from this river)', maxItems: 4, default: [], items: { type: 'string', 'x-ref': 'river-town' } },
        zoom: { type: 'boolean', title: 'Start on the whole river, then zoom in', default: true },
      },
    },
    callouts: { type: 'array', title: 'Labels to show', 'x-item': 'a label', maxItems: 8, default: ['source', 'mouth', 'sea', 'flow'], items: { type: 'string', enum: CALLOUTS, 'x-labels': CALLOUT_WORDS } },
    tributaries: { type: 'array', title: 'Tributaries to draw (IDs from this river)', maxItems: 4, default: [], items: { type: 'string', 'x-ref': 'river-trib' } },
    towns: { type: 'array', title: 'Towns to mark (IDs from this river)', maxItems: 5, default: [], items: { type: 'string', 'x-ref': 'river-town' } },
    rivers: { type: 'array', title: 'More rivers to draw (the national view)', maxItems: 7, default: [], items: { type: 'string', 'x-ref': 'river' } },
    flood: { type: 'boolean', title: 'Show the low land beside the river that floods first', default: false },
    zones: { type: 'string', title: 'Land heights', enum: ['auto', 'none'], 'x-labels': ['Show the land zones', 'Plain land'], default: 'auto' },
    profile: { type: 'boolean', title: 'Show the height profile (source to sea)', default: true },
    sourceHeight: { type: 'integer', title: 'Height of the source in metres (0: use our checked fact, or show no number)', minimum: 0, maximum: 6000, default: 0 },
    question: {
      type: 'object', title: 'Ask the class first', default: { on: false, ask: 'Where do you think the meander is?', hide: ['meander', 'neck'], reveal: true },
      properties: {
        on: { type: 'boolean', title: 'Add a question step', default: false },
        ask: { type: 'string', title: 'The question', maxLength: 90, 'x-role': 'sentence', default: 'Where do you think the meander is?' },
        hide: { type: 'array', title: 'Answers hidden until the reveal', maxItems: 10, default: ['meander', 'neck'], items: { type: 'string', enum: [...CALLOUTS, 'tributaries', 'towns'] } },
        reveal: { type: 'boolean', title: 'Reveal the answer on this slide', default: true },
      },
    },
    text: TEXT_PARAM_FOR({ source: 'label', mouth: 'label', estuary: 'label', meander: 'label', neck: 'label', oxbow: 'label', flow: 'label', zone0: 'label', zone1: 'label', zone2: 'label', from: 'label', to: 'label', thismap: 'label', sealevel: 'label', heights: 'label' }),
  },
};

export const presets = [
  { id: 'y4-thames', name: 'Year 4: the Thames, source to sea', params: {
    title: 'The River Thames: source to sea', river: 'gb.river-thames', view: { kind: 'whole' },
    callouts: ['source', 'estuary', 'sea', 'flow'], tributaries: ['gb.river-kennet', 'gb.river-thame'], towns: ['gb.oxford', 'gb.reading', 'gb.london'],
  } },
  { id: 'y5-shrewsbury', name: 'Year 5: a meander on the Severn', params: {
    title: 'A meander on the River Severn at Shrewsbury', river: 'gb.river-severn', view: { kind: 'feature', feature: 'town:gb.shrewsbury', zoom: true },
    callouts: ['source', 'estuary', 'sea', 'flow', 'meander', 'neck'], tributaries: ['gb.river-vyrnwy', 'gb.river-teme'], towns: ['gb.shrewsbury', 'gb.worcester'],
  } },
  { id: 'y6-question', name: 'Year 6: find the meander (question)', params: {
    title: 'Where has the Severn made a loop?', river: 'gb.river-severn', view: { kind: 'feature', feature: 'town:gb.shrewsbury', zoom: false },
    callouts: ['flow', 'meander', 'neck'], towns: ['gb.shrewsbury'], question: { on: true, ask: 'Where has the river nearly made a full loop?', hide: ['meander', 'neck'], reveal: true },
  } },
  { id: 'ks3-mississippi', name: 'KS3: ox-bow lakes on the Mississippi', params: {
    title: 'Meanders and ox-bow lakes on the Mississippi', river: 'w.mississippi', view: { kind: 'feature', feature: 'oxbow:lake-chicot', zoom: true },
    callouts: ['source', 'mouth', 'sea', 'flow', 'oxbow'], towns: ['w.st-louis.us', 'w.memphis.us', 'w.new-orleans.us'], sourceHeight: 450,
  } },
];

/* ------------------------------------------------------------------ validate */
const isCloseUp = P => P.view.kind !== 'whole';
// Natural Earth world rivers have about 3 km between points: a "meander" found on them is a drawing artefact,
// so it is never offered (Mississippi meanders come from the NHD channel and stay).
const realFeat = (rid, f) => !(f[1] === 'meander' && rid.startsWith('w.') && rid !== 'w.mississippi');
const featsOf = (rid, R) => (R.feats || []).filter(f => realFeat(rid, f));
const featOf = (R, id, rid) => featsOf(rid || '', R).find(f => f[0] === id);
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R0 = schemaCheck(params, P); if (R0.length) return result(R0);
  const R = [], W = [];
  const I = RIVERS[P.river];
  if (!I) {
    return result([{ path: 'river', fallback: 'rivers_coasts', reason: `“${P.river}” is not a river whose real map we have checked, so it could be drawn wrong. Use the schematic river instead${riverIdFor(P.river) ? `, or the river ID ${riverIdFor(P.river)}` : ''}.` }]);
  }
  if (P.view.kind === 'national') { // several rivers on one map: each must be a checked river
    P.rivers.forEach((r, i) => { if (!RIVERS[r]) R.push({ path: `rivers.${i}`, reason: `${r} is not a river whose real map we have checked.` }); });
    if (!P.rivers.length) R.push({ path: 'rivers', reason: 'A national view needs at least one more river.' });
    if (new Set([P.river, ...P.rivers]).size < P.rivers.length + 1) R.push({ path: 'rivers', reason: 'A river is listed twice. List each once.' });
    return result(R, W);
  }
  const nm = I.name.replace(/^River /, 'the River ').replace(/^(?!the )/, 'the ');
  const tribIds = new Set(I.tribs.map(t => t[0])), townIds = new Set(I.towns.map(t => t[0]));
  P.tributaries.forEach((t, i) => { if (!tribIds.has(t)) R.push({ path: `tributaries.${i}`, reason: `${t} does not join ${nm} in our map data. Its tributaries are: ${I.tribs.slice(0, 6).map(x => `${x[1]} (${x[0]})`).join(', ')}.` }); });
  P.towns.forEach((t, i) => { if (!townIds.has(t)) R.push({ path: `towns.${i}`, reason: `${t} is not a town on ${nm} in our map data. Towns on it include: ${I.towns.slice(0, 6).map(x => `${x[1]} (${x[0]})`).join(', ')}.` }); });
  if (new Set(P.tributaries).size < P.tributaries.length || new Set(P.towns).size < P.towns.length) R.push({ path: 'towns', reason: 'A tributary or town is listed twice. List each once.' });
  const v = P.view;
  if (v.kind === 'feature') {
    if (!featOf(I, v.feature, P.river)) R.push({ path: 'view.feature', reason: `${v.feature || 'No feature'} is not a feature we can zoom in on for ${nm}. Choose one of: ${featsOf(P.river, I).slice(0, 10).map(f => `${f[2]} (${f[0]})`).join(', ')}.` });
  } else if (v.kind === 'places') {
    if (v.places.length < 2) R.push({ path: 'view.places', reason: 'Name at least two towns on the river to frame the map between them.' });
    v.places.forEach((t, i) => { if (!townIds.has(t)) R.push({ path: `view.places.${i}`, reason: `${t} is not a town on ${nm} in our map data. Towns on it include: ${I.towns.slice(0, 6).map(x => `${x[1]} (${x[0]})`).join(', ')}.` }); });
  }
  const C = new Set(P.callouts);
  if (C.size < P.callouts.length) R.push({ path: 'callouts', reason: 'A label is listed twice. List each once.' });
  if (C.has('estuary') && (I.mouth !== 'sea' || DELTAS.has(P.river))) R.push({ path: 'callouts', reason: DELTAS.has(P.river) ? `${nm[0].toUpperCase()}${nm.slice(1)} reaches ${I.sea || 'the sea'} through a delta, not an estuary. Use the “Mouth” label.` : `${nm[0].toUpperCase()}${nm.slice(1)} does not flow into the sea, so it has no estuary. Use the “Mouth” label.` });
  if (C.has('sea') && I.mouth !== 'sea') R.push({ path: 'callouts', reason: `${nm[0].toUpperCase()}${nm.slice(1)} flows into another river or a lake, not the sea, so there is no sea to name.` });
  const meanders = featsOf(P.river, I).filter(f => f[1] === 'meander');
  if ((C.has('meander') || C.has('neck')) && !meanders.length) R.push({ path: 'callouts', reason: `Our map data finds no tight meander on ${nm}, so a meander label would point at nothing. Take “Meander” and “Neck” off the labels.` });
  if (C.has('neck') && !C.has('meander')) R.push({ path: 'callouts', reason: 'The neck is part of a meander: add the “Meander” label too.' });
  if (C.has('oxbow') && !I.feats.some(f => f[1] === 'oxbow')) R.push({ path: 'callouts', reason: `Our map data has no ox-bow lakes on ${nm}. Take “Ox-bow lakes” off the labels.` });
  if (C.has('oxbow') && !isCloseUp(P)) R.push({ path: 'callouts', reason: 'Ox-bow lakes are too small to see on a map of the whole river. Zoom in on one (a close-up view).' });
  if (P.question.on) {
    const shown = new Set([...P.callouts, ...(P.tributaries.length ? ['tributaries'] : []), ...(P.towns.length ? ['towns'] : [])]);
    P.question.hide.forEach((k, i) => { if (!shown.has(k)) R.push({ path: `question.hide.${i}`, reason: `“${k}” is hidden as the answer, but it is not on the map. Add it to the labels, or take it off the hidden answers.` }); });
    if (!P.question.hide.length) R.push({ path: 'question.hide', reason: 'A question needs at least one answer to hide until the reveal.' });
  }
  if (P.sourceHeight && I.sourceHeight && Math.abs(P.sourceHeight - I.sourceHeight) > Math.max(30, I.sourceHeight * 0.15)) R.push({ path: 'sourceHeight', reason: `The source of ${nm} is about ${I.sourceHeight} m above sea level (Wikidata), not ${P.sourceHeight} m.` });
  if (!R.length && P.zones === 'auto' && !isCloseUp(P) && !I.zones) W.push(`${I.name}: the land around it is all low, so the map shows one zone.`);
  return result(R, W);
}

/* ------------------------------------------------------------------ builds and notes */
function plan(P) {
  const I = RIVERS[P.river] || { name: 'The river', tribs: [], towns: [], feats: [] };
  const name = I.name, sea = I.sea ? `the ${I.sea.replace(/^the /i, '')}` : 'the sea';
  const close = isCloseUp(P), zoom = close && P.view.zoom;
  const F = close ? (P.view.kind === 'feature' ? (featOf(I, P.view.feature, P.river) || [0, 0, 'this stretch'])[2] : `between ${P.view.places.map(t => (I.towns.find(x => x[0] === t) || [0, t])[1]).join(' and ')}`) : null;
  const nameOf = (list, id) => (list.find(x => x[0] === id) || [0, id])[1];
  const items = [];
  if (P.view.kind === 'national') { const ns = [P.river, ...P.rivers].map(r => (RIVERS[r] || { name: r }).name.replace(/^River /, ''));
    return { items: [{ key: 'rivers', caption: `Main rivers: ${ns.join(', ')}.` }], summary: 'Each river flows from high land down to the sea.' }; }
  items.push({ key: 'river', caption: !close || zoom ? `The ${name.replace(/^River /, 'River ')} flows downhill from its source to ${I.mouth === 'sea' ? sea : 'its mouth'}.` : `The ${name.replace(/^River /, 'River ')}: ${F.replace(/^The /, 'the ')}.` });
  if (P.tributaries.length) items.push({ key: 'tributaries', caption: `Tributaries join it: ${P.tributaries.map(t => nameOf(I.tribs, t)).join(', ')}.` });
  if (P.towns.length) items.push({ key: 'towns', caption: `Towns grew up beside it: ${P.towns.map(t => nameOf(I.towns, t)).join(', ')}.` });
  const C = new Set(P.callouts);
  const secret = new Set(P.question.on ? P.question.hide : []);
  const closeWords = C.has('meander') && !secret.has('meander') ? 'The river swings round in a tight loop called a meander.' : C.has('oxbow') && !secret.has('oxbow') ? 'Old loops cut off from the river are left as ox-bow lakes.' : `A closer look: ${String(F).replace(/^The /, 'the ')}.`;
  if (zoom) items.push({ key: 'zoom', caption: `Zoom in on ${F.replace(/^The /, 'the ')}. ${closeWords}` });
  else if (close && !P.question.on && (C.has('meander') || C.has('oxbow'))) items.push({ key: 'closeup', caption: closeWords });
  else if (!close && !P.question.on && C.has('meander')) items.push({ key: 'closeup', caption: 'On low, flat land the river swings from side to side in meanders.' });
  if (P.flood) items.push({ key: 'flood', caption: 'The low land beside the river floods first.' });
  if (P.question.on) {
    items.push({ key: 'ask', caption: P.question.ask });
    if (P.question.reveal) items.push({ key: 'answer', caption: 'Here is the answer.' });
  }
  const len = I.lengthKm ? ` It is about ${Math.round(I.lengthKm)} km long.` : '';
  return { items, summary: `The ${name.replace(/^River /, 'River ')} flows from its source to ${I.mouth === 'sea' ? sea : 'its mouth'}.${len}` };
}
export function builds(P) { const { items, summary } = plan(P); return { steps: items.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }
export function notes(P) {
  const { items } = plan(P);
  const N = {
    rivers: 'Ask: where does each river start, and which sea does it reach? Rivers start on high land and flow down to the sea.',
    flood: 'The shaded land is only a few metres above the river. When the river overtops its banks, this land floods first.',
    river: 'Trace the river with a finger from the source (the dot) to the sea. Ask: which way is the water flowing, and how do you know? The ribbon gets wider downstream as more water joins it.',
    tributaries: 'A tributary is a smaller river that joins a bigger one. The place where they meet is a confluence. Ask: where does all the extra water come from?',
    towns: 'Ask: why might a town grow up beside a river? (Water, food, transport, a crossing point.)',
    zoom: 'The small map in the corner shows where this close-up sits on the whole river. The red box on the profile shows the same stretch.',
    closeup: 'A meander is a bend. Water erodes the outside of the bend and drops sand on the inside, so the loop grows. When the neck is cut through, the old loop becomes an ox-bow lake.',
    ask: 'Give the class time to point before you reveal it. The answer is hidden on this step.',
    answer: 'Check: did they find it? Ask them to explain how they knew.',
  };
  return { steps: items.map(it => N[it.key] || ''), summary: 'Ask the class to retell the river’s journey using “source”, “tributary”, “meander” and “mouth”.' };
}

/* ------------------------------------------------------------------ geometry helpers */
function rdp(p, eps) { if (p.length < 3) return p; let dm = 0, idx = 0; const a = p[0], b = p[p.length - 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-9;
  for (let i = 1; i < p.length - 1; i++) { const d = Math.abs(dy * p[i][0] - dx * p[i][1] + b[0] * a[1] - b[1] * a[0]) / L; if (d > dm) { dm = d; idx = i; } }
  return dm > eps ? rdp(p.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(p.slice(idx), eps)) : [a, b]; }
function chaikin(p, n) { for (let k = 0; k < n; k++) { const o = [p[0]]; for (let i = 0; i < p.length - 1; i++) { const a = p[i], b = p[i + 1]; o.push([.75 * a[0] + .25 * b[0], .75 * a[1] + .25 * b[1]], [.25 * a[0] + .75 * b[0], .25 * a[1] + .75 * b[1]]); } o.push(p[p.length - 1]); p = o; } return p; }
function resample(p, step) { const o = [p[0]]; let carry = 0; for (let i = 1; i < p.length; i++) { const a = p[i - 1], b = p[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); let t = step - carry;
  while (t <= L) { o.push([a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L]); t += step; } carry = L - (t - step); } return o; }
const plen = p => { let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return s; };
const inRect = (p, r, m = 0) => p[0] >= r.x - m && p[0] <= r.x + r.w + m && p[1] >= r.y - m && p[1] <= r.y + r.h + m;
const kmB = (a, b) => { const k = Math.cos((a[1] + b[1]) / 2 * Math.PI / 180); return Math.hypot((a[0] - b[0]) * 111.32 * k, (a[1] - b[1]) * 110.57); };
const cumKm = l => { const o = [0]; for (let i = 1; i < l.length; i++) o.push(o[i - 1] + kmB(l[i - 1], l[i])); return o; };
const pd = pts => pts.length ? 'M' + pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L') : '';
const ringD = pts => pts.length > 2 ? pd(pts) + 'Z' : '';
function runsInside(pts, r, m) { const runs = []; let cur = null; pts.forEach((p, i) => { if (inRect(p, r, m)) { if (!cur) { cur = []; if (i > 0) cur.push(i - 1); } cur.push(i); } else if (cur) { cur.push(i); runs.push(cur); cur = null; } }); if (cur) runs.push(cur); return runs; }
const mean = (a, f) => a.reduce((s, x) => s + f(x), 0) / a.length;
const polyContains = (poly, [x, y]) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };

/** Camera: a lon/lat box fitted (aspect kept) into the map rect M. */
function camera(box, M) {
  const k = Math.cos((box[1] + box[3]) / 2 * Math.PI / 180), cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
  const s = Math.min(M.w / ((box[2] - box[0]) * k || 1e-9), M.h / ((box[3] - box[1]) || 1e-9));
  const P = ([lo, la]) => [M.x + M.w / 2 + (lo - cx) * k * s, M.y + M.h / 2 - (la - cy) * s];
  const inv = (x, y) => [cx + (x - M.x - M.w / 2) / (k * s), cy - (y - M.y - M.h / 2) / s];
  return { P, inv, mPerUnit: 110570 / s, box };
}

/* ------------------------------------------------------------------ text and labels */
const FS = 24, FONT = 'Lexend, sans-serif';
let MC = null;
const tw = (t, w = 600, s = FS) => { if (!MC) MC = document.createElement('canvas').getContext('2d'); MC.font = `${w} ${s}px Lexend, sans-serif`; return MC.measureText(t).width; };
const hit = (a, b, m = 6) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
const circRect = (c, r) => { const x = Math.max(r.x, Math.min(c.x, r.x + r.w)), y = Math.max(r.y, Math.min(c.y, r.y + r.h)); return Math.hypot(c.x - x, c.y - y) < c.r; };

function labeller(B, ctx) {
  const placed = [], obstacles = [];
  /** A card with a leader, placed greedily where it hits nothing. L: {lines:[{t,w,size,color,edit,computed}], anchor, g, ...}. */
  function card(L) {
    const padX = 12, padY = 7, lh = L.lines.map(l => (l.size || FS) * 1.22);
    const w = Math.max(...L.lines.map(l => tw(l.t, l.w || 600, l.size || FS))) + padX * 2, hh = lh.reduce((a, b) => a + b, 0) + padY * 2 - 4;
    const radii = L.radii || [0, 34, 60, 95, 140, 190, 240], dirs = L.dirs || [-90, -60, -120, -30, -150, 0, 180, 30, 150, 60, 120, 90];
    let best = null;
    for (const r of radii) for (const [di, deg] of dirs.entries()) {
      if (r === 0 && !L.allowCentre) continue;
      const a = deg * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
      const cx0 = L.anchor[0] + ux * (r + w / 2 * Math.abs(ux) ** .6), cy0 = L.anchor[1] + uy * (r + hh / 2 * Math.abs(uy) ** .6);
      const shifts = Math.abs(uy) > .5 ? [[0, 0], [w / 2 - 22, 0], [-(w / 2 - 22), 0]] : [[0, 0], [0, hh / 2 - 12], [0, -(hh / 2 - 12)]];
      for (const [si, [sx, sy]] of shifts.entries()) {
        const R = { x: cx0 + sx - w / 2, y: cy0 + sy - hh / 2, w, h: hh };
        if (!Number.isFinite(R.x + R.y + w + hh) || R.x < B.x + 6 || R.y < B.y + 6 || R.x + w > B.x + B.w - 6 || R.y + hh > B.y + B.h - 6) continue;
        if (placed.some(p => hit(p, R))) continue;
        { // the leader must not cross a card already placed
          const nx = Math.max(R.x, Math.min(L.anchor[0], R.x + R.w)), ny = Math.max(R.y, Math.min(L.anchor[1], R.y + R.h)), dl = Math.hypot(nx - L.anchor[0], ny - L.anchor[1]);
          let cross = false; if (dl > 10 && !L.noLeader) for (let t = 0; t <= 1 && !cross; t += 6 / dl) { const q = { x: L.anchor[0] + (nx - L.anchor[0]) * t - 1, y: L.anchor[1] + (ny - L.anchor[1]) * t - 1, w: 2, h: 2 }; cross = placed.some(p => hit(p, q, 2)); }
          if (cross) continue; }
        let pen = 0, bad = false; for (const o of obstacles) if (circRect(o, R)) { if (o.hard) { bad = true; break; } pen += 1; }
        if (bad) continue;
        const score = r + di * 6 + pen * 40 + si * 8; if (!best || score < best.score) best = { R, score };
      }
    }
    if (!best) { ctx.warn && ctx.warn(`no room for “${L.lines[0].t}”`); return null; }
    const { R } = best; placed.push(R);
    const g = h('g', { cls: 'rr-lbl', s: L.s, delay: L.delay }, L.g);
    const nx = Math.max(R.x, Math.min(L.anchor[0], R.x + R.w)), ny = Math.max(R.y, Math.min(L.anchor[1], R.y + R.h));
    if (Math.hypot(nx - L.anchor[0], ny - L.anchor[1]) > 10 && !L.noLeader) {
      const d = Math.hypot(nx - L.anchor[0], ny - L.anchor[1]);
      for (let t = 0; t <= 1; t += 12 / Math.max(12, d)) obstacles.push({ x: L.anchor[0] + (nx - L.anchor[0]) * t, y: L.anchor[1] + (ny - L.anchor[1]) * t, r: 3, hard: true });
      h('line', { x1: L.anchor[0], y1: L.anchor[1], x2: nx, y2: ny, stroke: L.leader || 'var(--ink-3)', 'stroke-width': 2.5, 'stroke-linecap': 'round' }, g);
      if (L.dot !== false) h('circle', { cx: L.anchor[0], cy: L.anchor[1], r: 4, fill: L.leader || 'var(--ink-3)' }, g);
    }
    const c = h('g', { cls: 'rr-card' }, g);
    h('rect', { x: R.x, y: R.y, width: R.w, height: R.h, rx: 8, fill: 'var(--paper)', stroke: L.dashed || 'color-mix(in oklab, var(--ink) 14%, transparent)', 'stroke-width': L.dashed ? 2 : 1.5, 'stroke-dasharray': L.dashed ? '6 5' : null }, c);
    let y = R.y + padY;
    L.lines.forEach((l, i) => { y += lh[i]; const t = h('text', { x: R.x + padX, y: y - (l.size || FS) * .3, 'font-size': l.size || FS, 'font-weight': l.w || 600, fill: l.color || 'var(--ink)', style: `font-family:${FONT}`, text: l.t }, c);
      if (l.edit) t.setAttribute('data-edit', l.edit); if (l.computed) t.setAttribute('data-computed', l.computed); });
    return R;
  }
  /** Plain text centred on x,y (zone names, the town in its loop, Flow). */
  function plain(g, t, x, y, o = {}) {
    const w = tw(t, o.w || 600, o.size || FS), R = { x: x - w / 2, y: y - (o.size || FS) * .8, w, h: (o.size || FS) * 1.1 }; placed.push(R);
    const gg = h('g', { cls: 'rr-lbl', s: o.s, delay: o.delay }, g);
    if (o.halo) h('text', { x, y, 'text-anchor': 'middle', 'font-size': o.size || FS, 'font-weight': o.w || 600, fill: 'none', stroke: 'var(--hill-far)', 'stroke-width': 5, 'stroke-linejoin': 'round', style: `font-family:${FONT}`, text: t }, gg);
    const el = h('text', { x, y, 'text-anchor': 'middle', 'font-size': o.size || FS, 'font-weight': o.w || 600, fill: o.color || 'var(--ink)', style: `font-family:${FONT}`, text: t }, gg);
    if (o.edit) el.setAttribute('data-edit', o.edit); if (o.computed) el.setAttribute('data-computed', o.computed);
    return R;
  }
  return { card, plain, placed, obstacles };
}

/* ------------------------------------------------------------------ one map plate (a camera on the river) */
function plate(root, D, I, P, cam, M, o, ctx) {
  const { P: Pj } = cam; const C = new Set(P.callouts); const WT = 'var(--water-text)';
  const whole = o.whole, Sx = o.S; // Sx(key, base): build index for a key (question steps hide answers)
  const g = h('g', {}, root);
  const L = labeller(M, ctx);
  const uid = ctx.uid + o.tag;
  const defs = h('defs', {}, g);
  const ah = h('marker', { id: `ah${uid}`, viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 3.4, markerHeight: 3.4, orient: 'auto-start-reverse' }, defs);
  h('path', { d: 'M0,0 L10,5 L0,10 z', fill: 'var(--water-text)' }, ah);
  // land, sea and zones
  h('rect', { x: M.x - 2, y: M.y - 2, width: M.w + 4, height: M.h + 4, fill: 'var(--sea-1)' }, g);
  const landD = (D.land || []).map(r => ringD(D_(r).map(Pj))).join('');
  const landClip = h('clipPath', { id: `land${uid}` }, defs); h('path', { d: landD, 'clip-rule': 'evenodd' }, landClip);
  const zg = h('g', { 'clip-path': `url(#land${uid})` }, g);
  h('rect', { x: M.x, y: M.y, width: M.w, height: M.h, fill: 'var(--hill-far)' }, zg);
  const Z = P.zones === 'none' ? null : o.zones; const zoneD = [];
  const fills = Z && Z.thr.length === 2 ? ['var(--hill-mid)', 'var(--hill-near)'] : ['var(--hill-mid)'];
  if (Z) Z.rings.forEach((rs, ti) => { const d = rs.map(r => ringD(D_(r).map(Pj))).join(''); zoneD.push(d); h('path', { d, fill: fills[ti] || 'var(--hill-near)', 'fill-rule': 'evenodd' }, zg); });
  const hasZones = Z && zoneD.some(d => d.length);
  let floodPt = null; // the flood layer is drawn once the river's runs are known (below)
  // rivers: simplified per zoom, a ribbon that widens downstream
  const tol = whole ? 3.2 : .8;
  const fullStem = o.stem, kmS = cumKm(fullStem), total = kmS[kmS.length - 1] || 1, base = o.kmOffset || 0, wholeKm = o.wholeKm || total;
  function cleanLineF(ll, fOf) { const pp = ll.map(Pj), out = [];
    for (const run of runsInside(pp, M, 0)) { if (run.length < 2) continue; const kept = rdp(run.map(i => [pp[i][0], pp[i][1], i]), tol);
      const sm = chaikin(kept.map(p => [p[0], p[1]]), 3); const ks = kept.map(p => p[2]);
      out.push(sm.map((p, j) => [p[0], p[1], fOf(ks[Math.min(ks.length - 1, Math.round(j / Math.max(1, sm.length - 1) * (ks.length - 1)))])])); }
    return out; }
  const widthAt = f => whole ? 4.5 + 9 * f ** 1.2 : 9 + 7 * f;
  const funnel = I.mouth === 'sea' && !DELTAS.has(D.id); // an estuary widens into the sea
  const wMain = f => funnel && f > .92 ? widthAt(f) + (whole ? 30 : 46) * ((f - .92) / .08) ** 1.3 : widthAt(f);
  function ribbon(gp, pts, wOf, color) {
    const rs = [pts[0]]; for (let i = 1; i < pts.length; i++) { const a = rs[rs.length - 1], b = pts[i], Ln = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (Ln < 2.5) continue; const n = Math.floor(Ln / 2.5); for (let t = 1; t <= n; t++) rs.push([a[0] + (b[0] - a[0]) * t / n, a[1] + (b[1] - a[1]) * t / n, a[2] + (b[2] - a[2]) * t / n]); }
    if (rs.length < 3) return; const Lp = [], Rp = [];
    for (let i = 0; i < rs.length; i++) { const a = rs[Math.max(0, i - 6)], b = rs[Math.min(rs.length - 1, i + 6)], Ln = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / Ln, ny = (b[0] - a[0]) / Ln, w = wOf(rs[i][2]) / 2;
      Lp.push([rs[i][0] + nx * w, rs[i][1] + ny * w]); Rp.push([rs[i][0] - nx * w, rs[i][1] - ny * w]); }
    h('path', { d: pd(Lp.concat(Rp.reverse())) + 'Z', fill: color, stroke: color, 'stroke-width': 1, 'stroke-linejoin': 'round' }, gp);
    h('circle', { cx: rs[0][0], cy: rs[0][1], r: wOf(rs[0][2]) / 2, fill: color }, gp);
  }
  /** A group drawn on along its centre lines through a mask (u = 0..1). */
  function drawOn(parent, runs, width, s) {
    const id = `m${uid}${Math.random().toString(36).slice(2, 7)}`;
    const mk = h('mask', { id, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: 1280, height: 720 }, defs);
    const lens = runs.map(plen), tot = lens.reduce((a, b) => a + b, 0) || 1; let acc = 0;
    const paths = runs.map((r, i) => { const p = h('path', { d: pd(r), fill: 'none', stroke: '#fff', 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: 1, 'stroke-dasharray': '1 1.1' /* gap past the path end: no round-cap dot while undrawn */, 'stroke-dashoffset': 0 }, mk); const a0 = acc / tot; acc += lens[i]; return { p, a0, a1: acc / tot }; });
    const gg = h('g', { mask: `url(#${id})`, s }, parent);
    return { g: gg, set(u) { for (const { p, a0, a1 } of paths) p.setAttribute('stroke-dashoffset', String((1 - clamp((u - a0) / Math.max(1e-6, a1 - a0))) * 1.05)); } };
  }
  // tributaries (only the ones asked for)
  const tribG = h('g', {}, g); const tribRuns = [];
  for (const [i, tid] of P.tributaries.entries()) { const T = D.tribs.find(t => t.id === tid); if (!T) continue; const ll = D_(T.line);
    const runs = cleanLineF(ll, j => .15 + .5 * j / ll.length).filter(r => plen(r) > 12); if (!runs.length) continue;
    const dr = drawOn(tribG, runs.map(r => r.map(p => [p[0], p[1]])), 16, Sx('tributaries', o.sTrib));
    for (const r of runs) ribbon(dr.g, r, f => 3 + 2.5 * f, 'var(--water)');
    tribRuns.push({ T, i, runs, dr }); }
  // ox-bow lakes
  const oxb = [];
  if (!whole) for (const ox of D.oxbows || []) { const p = rdp(D_(ox.ring).map(Pj), .5); if (p.length < 3 || !inRect([mean(p, q => q[0]), mean(p, q => q[1])], M, -20)) continue;
    h('path', { d: ringD(chaikin(p.concat([p[0]]), 2)), fill: 'var(--water)', opacity: .9 }, g); oxb.push({ ...ox, p }); }
  // main stem
  const kmAt = i => base + kmS[i];
  let mainRuns = cleanLineF(fullStem, i => kmAt(i) / wholeKm);
  if (mainRuns.length > 1) mainRuns = mainRuns.filter(r => plen(r.filter(p => inRect(p, M))) >= 90);
  // the estuary reach is one clean funnel: refit the last 8% as a smooth curve through a few of its points
  if (whole) for (const run of mainRuns) { const i0 = run.findIndex(p => p[2] >= .92); if (i0 < 0 || run.length - i0 < 6) continue;
    const tail = run.slice(i0), ctrl = [0, 1, 2, 3, 4, 5].map(t => tail[Math.round(t / 5 * (tail.length - 1))]), sm = chaikin(ctrl.map(p => [p[0], p[1]]), 4), f0 = tail[0][2], f1 = tail[tail.length - 1][2];
    run.splice(i0, run.length - i0, ...sm.map((p, j) => [p[0], p[1], f0 + (f1 - f0) * j / (sm.length - 1)])); }
  // the mouth (north-star funnel): the river runs on to the coast, widening, then on into the sea, fading into it
  let fade = null;
  if (I.mouth === 'sea' && o.isMouthStem && mainRuns.length && inRect(Pj(fullStem[fullStem.length - 1]), M, 2)) {
    const lc = document.createElement('canvas'); lc.width = 1280; lc.height = 720; const lg = lc.getContext('2d'); lg.fill(new Path2D(landD || 'M0,0'), 'evenodd'); const ld = lg.getImageData(0, 0, 1280, 720).data;
    const onLand = (x, y) => x >= 0 && y >= 0 && x < 1280 && y < 720 && ld[(Math.round(y) * 1280 + Math.round(x)) * 4 + 3] > 128;
    const run = mainRuns[mainRuns.length - 1], a = run[Math.max(0, run.length - 12)], b = run[run.length - 1], Ln = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / Ln, uy = (b[1] - a[1]) / Ln;
    let coast = null;
    if (onLand(b[0], b[1])) { for (let t = 4; t <= 260; t += 4) { const q = [b[0] + ux * t, b[1] + uy * t, 1]; run.push(q); if (!onLand(q[0], q[1])) { coast = q; break; } } }
    else { let i = run.length - 1; while (i > 0 && !onLand(run[i][0], run[i][1])) i--; coast = run[Math.min(run.length - 1, i + 1)]; }
    if (coast) { const e = run[run.length - 1], reach = whole ? 46 : 70;
      for (let t = 6; t <= reach; t += 6) run.push([e[0] + ux * t, e[1] + uy * t, 1]);
      const end = run[run.length - 1], id = `fd${uid}`;
      const gr = h('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1: coast[0] - ux * 8, y1: coast[1] - uy * 8, x2: end[0], y2: end[1] }, defs);
      h('stop', { offset: 0, 'stop-color': 'var(--water)' }, gr); h('stop', { offset: 1, 'stop-color': 'var(--sea-1)' }, gr);
      fade = { coast: [coast[0], coast[1]], fill: `url(#${id})` }; }
  }
  const riverDr = drawOn(g, mainRuns.map(r => r.map(p => [p[0], p[1]])), whole ? 110 : 120, o.sRiver);
  mainRuns.forEach((r, i) => ribbon(riverDr.g, r, wMain, fade && i === mainRuns.length - 1 ? fade.fill : 'var(--water)'));
  const mainRun = mainRuns.slice().sort((a, b) => b.length - a.length)[0] || [];
  // flood layer: land within a few metres of the river (the baked height-above-river band) and near it
  // (a band along the main river, so far-off valleys of the same height are not shaded), water blue
  if (P.flood && o.floodZ && o.floodZ.rings && o.floodZ.rings[0] && mainRuns.length) {
    const fm = `fl${uid}`, mk = h('mask', { id: fm, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: 1280, height: 720 }, defs);
    for (const r of mainRuns) h('path', { d: pd(r.map(p => [p[0], p[1]])), fill: 'none', stroke: '#fff', 'stroke-width': whole ? 70 : 260, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, mk);
    h('path', { d: o.floodZ.rings[0].map(r => ringD(D_(r).map(Pj))).join(''), fill: '#000', 'fill-rule': 'evenodd' }, mk);
    h('rect', { x: M.x, y: M.y, width: M.w, height: M.h, fill: 'var(--water)', opacity: .4, mask: `url(#${fm})`, s: Sx('flood', o.sFlood), cls: 'rr-mark' }, zg);
    floodPt = true;
  }
  for (const r of mainRuns) resample(r.map(p => [p[0], p[1]]), 10).forEach(p => L.obstacles.push({ x: p[0], y: p[1], r: wMain(.5) / 2 + 4, hard: true }));
  for (const { runs } of tribRuns) for (const r of runs) resample(r.map(p => [p[0], p[1]]), 10).forEach(p => L.obstacles.push({ x: p[0], y: p[1], r: 6, hard: true }));
  for (const ox of oxb) for (const p of resample([...ox.p, ox.p[0]], 8)) L.obstacles.push({ x: p[0], y: p[1], r: 5, hard: true });
  const marks = h('g', {}, g), labels = h('g', {}, g);
  const mainPx = mainRun.length > 1 ? resample(mainRun.map(p => [p[0], p[1]]), 4) : [];
  const fAtPx = i => { const fr = mainRun.map(p => p[2]); return fr[Math.min(fr.length - 1, Math.round(i / Math.max(1, mainPx.length) * fr.length))] || 0; };

  // meander ring and neck: from a baked meander feature in this frame (the asked-for one first)
  let ring = null, neck = null;
  if (C.has('meander') && (!whole || o.sClose != null)) {
    const ms = D.feats.filter(f => f.kind === 'meander' && realFeat(D.id, [0, 'meander']));
    const pick = ms.find(f => f.id === P.view.feature) || ms.map(f => ({ f, p: D_(f.loop).map(Pj) })).filter(({ p }) => p.every(q => inRect(q, M, -10))).sort((a, b) => plen(b.p) - plen(a.p)).map(x => x.f)[0];
    if (pick) { const lp = D_(pick.loop).map(Pj), cx = mean(lp, p => p[0]), cy = mean(lp, p => p[1]);
      const rad = Math.max(whole ? 34 : 60, Math.max(...lp.map(p => Math.hypot(p[0] - cx, p[1] - cy))) + (whole ? 12 : 22));
      if (inRect([cx, cy], M, -rad * .5)) {
        ring = { x: cx, y: cy, r: rad, loop: lp }; neck = { a: lp[0], b: lp[lp.length - 1] };
        h('circle', { cx, cy, r: rad, fill: 'none', stroke: 'var(--part)', 'stroke-width': 3, 'stroke-dasharray': '7 7', s: Sx('meander', o.sClose), delay: o.delay, cls: 'rr-mark' }, marks);
        for (let t = 0; t < 360; t += 6) L.obstacles.push({ x: cx + rad * Math.cos(t * Math.PI / 180), y: cy + rad * Math.sin(t * Math.PI / 180), r: 3, hard: false });
      }
    } else if (ctx.warn) ctx.warn('no meander inside this map, so the meander label is left off');
  }
  // flow arrows beside the river, pointing downstream
  const flowAt = [];
  if (C.has('flow') && mainPx.length > 40) for (const f0 of whole ? [[.3, .4, .5, .6, .2]] : [[.18, .25, .1], [.7, .62, .76, .82, .9, .55]]) { let pick = null; for (const f of f0) {
    const i = Math.floor(mainPx.length * f), t2 = whole ? 18 : 10, a = mainPx[Math.max(0, i - t2)], b = mainPx[Math.min(mainPx.length - 1, i + t2)];
    const Ln = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / Ln, uy = (b[1] - a[1]) / Ln, off = wMain(fAtPx(i)) / 2 + 16;
    let best = null; for (const sgn of [1, -1]) { const m = [mainPx[i][0] - uy * off * sgn, mainPx[i][1] + ux * off * sgn];
      const R = { x: m[0] - 34, y: m[1] - 34, w: 68, h: 68 }; const pen = L.obstacles.filter(ob => circRect(ob, R)).length + (inRect(m, M, -40) ? 0 : 99) + L.placed.filter(pp => hit(pp, R, 0)).length * 5 + (ring && Math.hypot(m[0] - ring.x, m[1] - ring.y) < ring.r + 30 ? 60 : 0); if (!best || pen < best.pen) best = { pen, m }; }
    if (!pick || best.pen < pick.best.pen) pick = { best, ux, uy }; if (best.pen === 0) break; }
    const { best, ux, uy } = pick; const m = best.m;
    if (best.pen >= 99) continue;
    h('line', { x1: m[0] - ux * 30, y1: m[1] - uy * 30, x2: m[0] + ux * 30, y2: m[1] + uy * 30, stroke: 'var(--water-text)', 'stroke-width': 4, 'stroke-linecap': 'round', 'marker-end': `url(#ah${uid})`, s: Sx('flow', o.sRiver), delay: o.delay2, cls: 'rr-mark' }, marks);
    L.placed.push({ x: Math.min(m[0] - ux * 30, m[0] + ux * 30) - 6, y: Math.min(m[1] - uy * 30, m[1] + uy * 30) - 6, w: Math.abs(ux * 60) + 12, h: Math.abs(uy * 60) + 12 }); flowAt.push(m);
  }
  // source and mouth when in frame
  const stemP = fullStem.map(Pj);
  // the mouth is only in this map when the stem's real end is (a run cut by the frame edge is not a mouth)
  const endIn = inRect(stemP[stemP.length - 1], M, 2);
  const src = o.isSourceStem ? stemP[0] : null; let mouth = mainRuns.length && o.isMouthStem && endIn ? mainRuns[mainRuns.length - 1][mainRuns[mainRuns.length - 1].length - 1].slice(0, 2) : null;
  if (mouth && fade) mouth = fade.coast; // the estuary label points at the coast, where the funnel meets the sea
  const srcIn = src && inRect(src, M, -4), mouthIn = mouth && inRect(mouth, M, 4);
  if (srcIn && C.has('source')) { h('circle', { cx: src[0], cy: src[1], r: 9, fill: 'var(--water)', stroke: 'var(--paper)', 'stroke-width': 3, s: Sx('source', o.sRiver), cls: 'rr-mark' }, marks); L.obstacles.push({ x: src[0], y: src[1], r: 12, hard: true }); }
  // towns: obstacles first, so cards keep off every dot
  const townPts = P.towns.map((tid, i) => { const t = D.towns.find(x => x.id === tid); return t && { t, i, p: Pj(t.ll) }; }).filter(x => x && inRect(x.p, M, -10));
  for (const { p } of townPts) L.obstacles.push({ x: p[0], y: p[1], r: 12, hard: true });

  // labels, most important first
  // the source card names the place (baked: the nearest settlement); one line when two have no room
  if (srcIn && C.has('source')) { const sc = (two) => L.card({ g: labels, s: Sx('source', o.sRiver), lines: [{ t: txt(P, 'label:source', 'Source'), w: 700, color: WT, edit: 'text.label:source' }, ...(two ? [{ t: I.sourceName, w: 500, color: 'var(--ink-2)', computed: 'river' }] : [])], anchor: src, leader: WT, dot: false, dirs: [150, 180, 120, -150, 90, -90, 60, 30, 0, -120, -60], radii: [14, 30, 55, 90, 130, 170] });
    if (!(I.sourceName && whole && sc(true))) sc(false); }
  const mk = C.has('estuary') ? 'estuary' : C.has('mouth') ? 'mouth' : null;
  if (mouthIn && mk) L.card({ g: labels, s: Sx(mk, o.sRiver), delay: o.delay2, lines: [{ t: txt(P, `label:${mk}`, mk === 'estuary' ? 'Estuary' : 'Mouth'), w: 700, color: WT, edit: `text.label:${mk}` }], anchor: mouth, leader: WT, dirs: [90, 60, 120, 30, 150, 0, -90, 180, -60, -120], radii: [24, 45, 70, 100, 140] });
  if (ring) L.card({ g: labels, s: Sx('meander', o.sClose), delay: o.delay, lines: [{ t: txt(P, 'label:meander', 'Meander'), w: 600, color: 'var(--part-text)', edit: 'text.label:meander' }], anchor: [ring.x, ring.y - ring.r], dashed: 'var(--part)', leader: 'var(--part)', dot: false, dirs: [-90, -60, -120, -30, -150, 0, 180, 30, 150, 90], radii: [8, 20, 40, 70, 110] });
  if (neck && C.has('neck')) { const m = [(neck.a[0] + neck.b[0]) / 2, (neck.a[1] + neck.b[1]) / 2];
    h('line', { x1: neck.a[0], y1: neck.a[1], x2: neck.b[0], y2: neck.b[1], stroke: 'var(--part)', 'stroke-width': 4, 'stroke-linecap': 'round', s: Sx('neck', o.sClose), delay: o.delay, cls: 'rr-mark' }, marks);
    L.card({ g: labels, s: Sx('neck', o.sClose), delay: o.delay, lines: [{ t: txt(P, 'label:neck', 'Neck'), w: 600, color: 'var(--part-text)', edit: 'text.label:neck' }], anchor: m, dashed: 'var(--part)', leader: 'var(--part)', radii: [40, 70, 100, 140, 190] }); }
  if (flowAt.length) { const m = flowAt[0]; const ft = txt(P, 'label:flow', 'Flow');
    for (const [dx, dy] of [[0, -26], [0, 44], [70, 8], [-70, 8], [0, -56], [0, 74]]) { const w = tw(ft), R = { x: m[0] + dx - w / 2, y: m[1] + dy - 20, w, h: 26 };
      if (!inRect([R.x, R.y], M, -6) || !inRect([R.x + R.w, R.y + R.h], M, -6) || L.placed.some(p => hit(p, R, 4)) || L.obstacles.some(ob => ob.hard && circRect(ob, R))) continue;
      L.plain(labels, ft, m[0] + dx, m[1] + dy, { color: WT, s: Sx('flow', o.sRiver), delay: o.delay2, edit: 'text.label:flow' }); break; } }
  // land/sea raster (for the sea name and zone names)
  const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; const c2 = cv.getContext('2d');
  c2.fill(new Path2D(landD || 'M0,0'), 'evenodd'); const land = c2.getImageData(0, 0, 1280, 720).data;
  const isLand = (x, y) => x >= 0 && y >= 0 && x < 1280 && y < 720 && land[(Math.round(y) * 1280 + Math.round(x)) * 4 + 3] > 128;
  if (C.has('sea') && I.sea && (whole ? true : mouthIn)) { let best = null; const mo = mouth || [M.x + M.w, M.y + M.h / 2];
    for (let y = M.y + 30; y < M.y + M.h - 30; y += 8) for (let x = M.x + 60; x < M.x + M.w - 60; x += 8) { if (isLand(x, y)) continue;
      let dmin = 60; for (let a = 0; a < 360 && dmin > 0; a += 30) for (let r = 8; r <= 60; r += 8) if (isLand(x + r * Math.cos(a * Math.PI / 180), y + r * Math.sin(a * Math.PI / 180))) { dmin = Math.min(dmin, r); break; }
      const dm = Math.hypot(x - mo[0], y - mo[1]), sc = dmin * 3 - dm * .2; if (dmin >= 8 && (!mouth || dm < 320) && (!best || sc > best.sc)) best = { sc, x, y }; } // the sea the river meets, not another bay
    if (best) L.card({ g: labels, s: Sx('sea', o.sRiver), delay: o.delay2, lines: [{ t: I.sea, w: 600, color: WT, computed: 'river' }], anchor: [best.x, best.y], allowCentre: true, radii: [0, 20, 40, 70], noLeader: true }); }
  if (C.has('oxbow')) for (const ox of oxb) L.card({ g: labels, s: Sx('oxbow', o.sClose), delay: o.delay, lines: [{ t: txt(P, 'label:oxbow', 'Ox-bow lake'), w: 700, color: WT, edit: 'text.label:oxbow' }, { t: ox.name, w: 500, color: 'var(--ink-2)', computed: 'callouts' }], anchor: ox.p[Math.floor(ox.p.length / 4)], leader: WT, radii: [20, 45, 80, 120, 170] });
  for (const { t, i, p } of townPts) {
    const sT = Sx('towns', o.sTown);
    if (ring && polyContains(ring.loop, p)) { // the town sits inside its loop: a plain name in the loop
      let best = null; const w = tw(t.name, 700, 24);
      for (let y = ring.y - ring.r; y < ring.y + ring.r; y += 4) for (let x = ring.x - ring.r; x < ring.x + ring.r; x += 4) {
        const R = { x: x - w / 2, y: y - 19, w, h: 26 }; if (![[R.x, R.y], [R.x + w, R.y], [R.x, R.y + 26], [R.x + w, R.y + 26]].every(q => polyContains(ring.loop, q))) continue;
        let dm = 1e9; for (const q of mainPx) { const xx = Math.max(R.x, Math.min(q[0], R.x + R.w)), yy = Math.max(R.y, Math.min(q[1], R.y + R.h)); dm = Math.min(dm, Math.hypot(q[0] - xx, q[1] - yy)); }
        const sc = dm - Math.hypot(x - p[0], y - p[1]) * .05; if (dm > 3 && !L.placed.some(pp => hit(pp, R, 2)) && (!best || sc > best.sc)) best = { sc, x, y }; }
      if (best) { L.plain(labels, t.name, best.x, best.y, { w: 700, size: 24, s: sT, computed: `towns.${i}` }); continue; }
    }
    h('circle', { cx: p[0], cy: p[1], r: 7, fill: 'var(--ink)', stroke: 'var(--paper)', 'stroke-width': 2.5, s: sT, cls: 'rr-mark' }, marks);
    L.card({ g: labels, s: sT, lines: [{ t: t.name, w: 600, computed: `towns.${i}` }], anchor: p, dot: false, radii: [12, 30, 55, 85, 110] });
  }
  for (const { T, i, runs } of tribRuns) { const r = runs.slice().sort((a, b) => b.length - a.length)[0]; const a = r[Math.floor(r.length * .35)];
    L.card({ g: labels, s: Sx('tributaries', o.sTrib), lines: [{ t: T.name, w: 600, color: WT, computed: `tributaries.${i}` }], anchor: [a[0], a[1]], leader: WT, dot: false, radii: [0, 34, 60, 95, 130] }); }
  // close-up context: where the river comes from and goes to, and a locator of the whole river
  if (!whole) {
    const first = mainRuns[0], last = mainRuns[mainRuns.length - 1];
    if (first && !srcIn) { const enter = first.find(p => inRect(p, M, -36)) || first[0];
      L.card({ g: labels, s: o.sRiver, lines: [{ t: txt(P, 'label:from', 'From the source'), w: 500, size: 22, color: 'var(--ink-2)', edit: 'text.label:from' }], anchor: [enter[0], enter[1]], leader: WT, dirs: [180, 0, 150, 30, -150, -30, 90, -90, 120, 60], radii: [10, 24, 44, 70, 100, 140, 190, 240] }); }
    if (last && !mouthIn) { const exit = [...last].reverse().find(p => inRect(p, M, -36)) || last[last.length - 1];
      L.card({ g: labels, s: o.sRiver, lines: [{ t: txt(P, 'label:to', I.mouth === 'sea' && I.sea ? `To the ${I.sea.replace(/^the /i, '')}` : 'To the mouth'), w: 500, size: 22, color: 'var(--ink-2)', edit: 'text.label:to' }], anchor: [exit[0], exit[1]], leader: WT, dirs: [0, 180, 30, 150, -30, -150, 90, -90, 60, 120], radii: [10, 24, 44, 70, 100, 140, 190, 240] }); }
    const iw = 190, ih = 150, ix = M.x + M.w - iw - 14, iy = M.y + 14, R = { x: ix, y: iy, w: iw, h: ih };
    if (!L.placed.some(p => hit(p, R)) && !L.obstacles.some(ob => ob.hard && circRect(ob, R))) { L.placed.push(R);
      const ws = D_(D.stemWhole), ib = [Math.min(...ws.map(p => p[0])), Math.min(...ws.map(p => p[1])), Math.max(...ws.map(p => p[0])), Math.max(...ws.map(p => p[1]))];
      const icam = camera(ib, { x: ix + 15, y: iy + 15, w: iw - 30, h: ih - 30 });
      const gi = h('g', { cls: 'rr-inset', s: o.sRiver }, labels);
      h('rect', { x: ix, y: iy, width: iw, height: ih, rx: 10, fill: 'var(--paper)', stroke: 'color-mix(in oklab, var(--ink) 14%, transparent)', 'stroke-width': 1.5 }, gi);
      h('path', { d: pd(ws.map(icam.P)), stroke: 'var(--water)', 'stroke-width': 3, fill: 'none', 'stroke-linejoin': 'round' }, gi);
      const a = icam.P([cam.box[0], cam.box[3]]), b = icam.P([cam.box[2], cam.box[1]]), fw = clamp(b[0] - a[0], 8, iw - 8), fh = clamp(b[1] - a[1], 8, ih - 8);
      const fx = clamp((a[0] + b[0]) / 2 - fw / 2, ix + 4, ix + iw - 4 - fw), fy = clamp((a[1] + b[1]) / 2 - fh / 2, iy + 4, iy + ih - 4 - fh); // the frame box stays inside the inset
      h('rect', { x: fx, y: fy, width: fw, height: fh, fill: 'none', stroke: 'var(--hue-red)', 'stroke-width': 3 }, gi);
      const s0 = icam.P(ws[0]); h('circle', { cx: s0[0], cy: s0[1], r: 4, fill: 'var(--water)' }, gi);
    }
  }
  if (floodPt && mainPx.length) { const a = mainPx[Math.floor(mainPx.length * .55)];
    L.card({ g: labels, s: Sx('flood', o.sFlood), lines: [{ t: 'Low land: floods first', w: 600, size: 22, color: WT }], anchor: [a[0], a[1]], leader: WT, radii: [40, 70, 100, 140, 190] }); }
  // zone names: plain text where each zone is widest and nothing else is (no zone names under the flood layer)
  if (!floodPt && (hasZones || (Z && P.zones !== 'none'))) {
    const names = whole ? [txt(P, 'label:zone0', 'Low land'), txt(P, 'label:zone1', 'Hills'), txt(P, 'label:zone2', 'Mountains')] : [txt(P, 'label:zone0', 'Flood plain'), txt(P, 'label:zone1', 'Higher ground')];
    const nb = Math.min(names.length, Z.thr.length + 1);
    const masks = zoneD.map(d => { c2.clearRect(0, 0, 1280, 720); if (d) c2.fill(new Path2D(d), 'evenodd'); return c2.getImageData(0, 0, 1280, 720).data; });
    const cell = 6, gw = Math.ceil(M.w / cell), gh = Math.ceil(M.h / cell), cls = new Int8Array(gw * gh).fill(-1);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const x = Math.round(M.x + (i + .5) * cell), y = Math.round(M.y + (j + .5) * cell); if (!isLand(x, y)) continue;
      let z = 0; masks.forEach((md, ti) => { if (md[(y * 1280 + x) * 4 + 3] > 128) z = ti + 1; }); cls[j * gw + i] = z; }
    const dist = new Float32Array(gw * gh);
    for (let z = 0; z < nb; z++) {
      let count = 0; for (let n = 0; n < gw * gh; n++) { dist[n] = cls[n] === z ? 1e9 : 0; if (cls[n] === z) count++; }
      if (count < 80) continue;
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const n = j * gw + i; if (i) dist[n] = Math.min(dist[n], dist[n - 1] + 1); if (j) dist[n] = Math.min(dist[n], dist[n - gw] + 1); if (!i || !j || i === gw - 1 || j === gh - 1) dist[n] = Math.min(dist[n], 1); }
      for (let j = gh - 1; j >= 0; j--) for (let i = gw - 1; i >= 0; i--) { const n = j * gw + i; if (i < gw - 1) dist[n] = Math.min(dist[n], dist[n + 1] + 1); if (j < gh - 1) dist[n] = Math.min(dist[n], dist[n + gw] + 1); }
      const cands = []; for (let j = 2; j < gh - 2; j++) for (let i = 2; i < gw - 2; i++) { const n = j * gw + i; if (dist[n] >= 2) cands.push({ x: M.x + (i + .5) * cell, y: M.y + (j + .5) * cell, d: Math.min(dist[n], 9) - Math.hypot(M.x + (i + .5) * cell - M.x - M.w / 2, M.y + (j + .5) * cell - M.y - M.h / 2) / 160 }); }
      cands.sort((a, b) => b.d - a.d);
      const w = tw(names[z]), col = z === 2 ? 'var(--paper)' : 'var(--ink)';
      const fits = (c, strict) => { const R = { x: c.x - w / 2, y: c.y - 20, w, h: 28 };
        if (!inRect([R.x, R.y], M, -8) || !inRect([R.x + R.w, R.y + R.h], M, -8) || L.placed.some(p => hit(p, R, strict ? 10 : 8)) || L.obstacles.some(ob => circRect({ ...ob, r: ob.r + (strict ? 8 : 6) }, R))) return false;
        if (!strict) return true;
        return [[R.x, R.y], [R.x + R.w, R.y], [R.x, R.y + R.h], [R.x + R.w, R.y + R.h]].every(([x, y]) => { const i = Math.floor((x - M.x) / cell), j = Math.floor((y - M.y) / cell); return i >= 0 && j >= 0 && i < gw && j < gh && cls[j * gw + i] === z; }); };
      const c = cands.slice(0, 20000).find(c => fits(c, true)) || cands.find(c => fits(c, false));
      if (c) L.plain(labels, names[z], c.x, c.y, { color: col, halo: !fits(c, true), edit: `text.label:zone${z}` });
    }
  }
  return { g, labels, marks, riverDr, tribRuns, L, mainRuns };
}

/* ------------------------------------------------------------------ render */
/** Several rivers across a country: real land, each river's whole course, its name on a card (no collisions). */
function renderNational(root, P, ctx) {
  const ids = [P.river, ...P.rivers].filter(id => RIVERS[id] && DATA.get(id));
  if (!ids.length) { h('text', { x: 640, y: 380, 'text-anchor': 'middle', cls: 'ts-label', text: 'Loading the map…' }, root); return {}; }
  const bbs = ids.map(id => DATA.get(id).bbox), b0 = [Math.min(...bbs.map(b => b[0])), Math.min(...bbs.map(b => b[1])), Math.max(...bbs.map(b => b[2])), Math.max(...bbs.map(b => b[3]))];
  const px = (b0[2] - b0[0]) * .12, py = (b0[3] - b0[1]) * .08, box = [b0[0] - px, b0[1] - py, b0[2] + px, b0[3] + py];
  const M = { x: 0, y: 112, w: 1280, h: 548 }, cam = camera(box, M), Pj = cam.P, WT = 'var(--water-text)';
  const clipId = `rrclip${ctx.uid}`, cp = h('clipPath', { id: clipId }, h('defs', {}, root)); h('rect', { x: M.x, y: M.y, width: M.w, height: M.h }, cp);
  const g = h('g', { 'clip-path': `url(#${clipId})` }, root);
  h('rect', { x: M.x, y: M.y, width: M.w, height: M.h, fill: 'var(--sea-1)' }, g);
  const view = { lon: [box[0] - 2, box[2] + 2], lat: [box[1] - 2, box[3] + 2] };
  h('path', { d: landRings(view).map(r => ringD(r.map(Pj))).join(''), fill: 'var(--hill-far)', 'fill-rule': 'evenodd' }, g);
  const L = labeller(M, ctx), sR = ctx.b.rivers ?? 0, rg = h('g', { s: sR }, g), labels = h('g', {}, g), lines = [];
  for (const id of ids) { const D = DATA.get(id), pts = chaikin(rdp(D_(D.stemWhole).map(Pj), 1.2), 2); lines.push({ id, pts });
    h('path', { d: pd(pts), fill: 'none', stroke: 'var(--water)', 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, rg);
    h('circle', { cx: pts[0][0], cy: pts[0][1], r: 6, fill: 'var(--water)', stroke: 'var(--paper)', 'stroke-width': 2 }, rg);
    resample(pts, 8).forEach(p => L.obstacles.push({ x: p[0], y: p[1], r: 6, hard: true })); }
  for (const { id, pts } of lines) { const a = pts[Math.floor(pts.length * .45)];
    L.card({ g: labels, s: sR, lines: [{ t: RIVERS[id].name, w: 600, color: WT, computed: 'rivers' }], anchor: a, leader: WT, dot: false, radii: [0, 30, 55, 85, 120, 160] }); }
  h('rect', { x: M.x, y: M.y, width: M.w, height: M.h, fill: 'none', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)', cls: 'rr-frame' }, root);
  const na = h('g', {}, root), NX = M.x + 30, NY = M.y + M.h - 64;
  h('path', { d: `M${NX} ${NY} l10 26 l-10 -6 l-10 6 Z`, fill: 'var(--ink-2)' }, na);
  h('text', { x: NX, y: NY + 46, 'text-anchor': 'middle', 'font-size': 24 /* the type floor */, 'font-weight': 700, fill: 'var(--ink-2)', style: `font-family:${FONT}`, text: 'N' }, na);
  return { dur: { rivers: 1200 }, still() {}, reset() {}, tick() {} };
}

export function render(root, P, ctx) {
  if (P.view.kind === 'national') return renderNational(root, P, ctx);
  const I = RIVERS[P.river], D = DATA.get(P.river);
  if (!I || !D) { // not prepared or not validated: never draw a wrong map
    h('text', { x: 640, y: 380, 'text-anchor': 'middle', cls: 'ts-label', fill: 'var(--ink-2)', text: I ? 'Loading the map…' : 'This river has no checked map.' }, root);
    if (ctx.warn) ctx.warn(I ? 'river data not loaded: call prepare() before mounting' : 'river not in the index');
    return {};
  }
  const b = ctx.b, bi = k => b[k] ?? 0, N = ctx.N;
  const close = isCloseUp(P), zoom = close && P.view.zoom;
  // the answer to a question appears at the reveal (or never on this slide)
  const hide = new Set(P.question.on ? P.question.hide : []);
  const reveal = P.question.on ? (P.question.reveal ? b.answer : 999) : null;
  const Sx = (key, base) => (hide.has(key) ? reveal : base);

  // cameras: the whole river (fitted, with room at the mouth) and the close-up frame
  const wholeStem = D_(D.stem), bb = D.bbox;
  let fbox = null;
  if (P.view.kind === 'feature') { const f = D.feats.find(x => x.id === P.view.feature); fbox = f && f.box;
    if (f && f.kind === 'meander') { const lp = D_(f.loop), cx = mean(lp, p => p[0]), cy = mean(lp, p => p[1]), k = Math.cos(cy * Math.PI / 180);
      const r = Math.max(...lp.map(p => Math.hypot((p[0] - cx) * k, p[1] - cy))) * 1.6; fbox = [cx - r / k, cy - r, cx + r / k, cy + r]; } }
  else if (P.view.kind === 'places') { const ps = P.view.places.map(id => D.towns.find(t => t.id === id)).filter(Boolean).map(t => t.ll);
    if (ps.length >= 2) { const x0 = Math.min(...ps.map(p => p[0])), x1 = Math.max(...ps.map(p => p[0])), y0 = Math.min(...ps.map(p => p[1])), y1 = Math.max(...ps.map(p => p[1]));
      const k = Math.cos((y0 + y1) / 2 * Math.PI / 180), dx = Math.max((x1 - x0) * .2, 2 / (111.32 * k)), dy = Math.max((y1 - y0) * .2, 2 / 110.57); fbox = [x0 - dx, y0 - dy, x1 + dx, y1 + dy]; } }
  if (close && !fbox) { h('text', { x: 640, y: 380, 'text-anchor': 'middle', cls: 'ts-label', text: 'No such feature on this river.' }, root); return {}; }
  // layout: a tall whole river gets the side layout (map left, profile right)
  const k0 = Math.cos((bb[1] + bb[3]) / 2 * Math.PI / 180), aspect = ((bb[2] - bb[0]) * k0) / Math.max(1e-6, bb[3] - bb[1]);
  const side = (!close || zoom) && aspect < 1.25 && P.profile;
  const M = side ? { x: 0, y: 112, w: 780, h: 548 } : P.profile ? { x: 0, y: 112, w: 1280, h: 470 } : { x: 0, y: 112, w: 1280, h: 548 };
  const pad = { l: .1, r: .1, t: .08, b: .08 };
  if (I.mouth === 'sea') { const m = wholeStem[wholeStem.length - 1], dx = bb[2] - bb[0], dy = bb[3] - bb[1];
    if (m[0] > bb[2] - dx * .15) pad.r = .2; if (m[0] < bb[0] + dx * .15) pad.l = .2; if (m[1] < bb[1] + dy * .15) pad.b = .16; if (m[1] > bb[3] - dy * .15) pad.t = .16; }
  const wbox = [bb[0] - (bb[2] - bb[0]) * pad.l, bb[1] - (bb[3] - bb[1]) * pad.b, bb[2] + (bb[2] - bb[0]) * pad.r, bb[3] + (bb[3] - bb[1]) * pad.t];
  const camW = camera(wbox, M), camC = fbox && camera(fbox, M);
  // which stem draws the close-up: the finer supplement (NHD) when the frame sits inside it
  const det = D.detail && fbox && fbox[0] >= D.detail.bbox[0] - .05 && fbox[2] <= D.detail.bbox[2] + .05 && fbox[1] >= D.detail.bbox[1] - .05 && fbox[3] <= D.detail.bbox[3] + .05;
  const cStem = det ? D_(D.detail.stem) : wholeStem;
  const kmW = cumKm(wholeStem), wholeKm = kmW[kmW.length - 1];
  let kmOffset = 0;
  if (det) { const p0 = cStem[0]; let bi0 = 0, bd = 1e9; wholeStem.forEach((p, i) => { const d = kmB(p, p0); if (d < bd) { bd = d; bi0 = i; } }); kmOffset = kmW[bi0]; }

  const clipId = `rrclip${ctx.uid}`;
  const cp = h('clipPath', { id: clipId }, h('defs', {}, root)); h('rect', { x: M.x, y: M.y, width: M.w, height: M.h }, cp);
  const mapG = h('g', { 'clip-path': `url(#${clipId})` }, root);
  const sR = bi('river'), sT = b.tributaries ?? sR, sTown = b.towns ?? sR, sZoom = b.zoom, sClose = b.zoom ?? b.closeup ?? null;
  let W = null, Cp = null;
  const fZone = f => f && f.zones && f.zones.thr.length ? f.zones : null;
  const featZones = () => { if (P.view.kind === 'feature') { const z = fZone(D.feats.find(x => x.id === P.view.feature)); if (z) return z; }
    const c = [(fbox[0] + fbox[2]) / 2, (fbox[1] + fbox[3]) / 2]; // the nearest feature whose zone grid covers the box
    const cover = D.feats.map(f => f.zones && f.zones.box && f.zones.box[0] <= fbox[0] && f.zones.box[2] >= fbox[2] && f.zones.box[1] <= fbox[1] && f.zones.box[3] >= fbox[3] ? f : null).filter(Boolean).map(f => fZone(f)).filter(Boolean)[0] || null;
    return cover || (D.corridor && D.corridor.thr.length ? D.corridor : null); }; // else the valley corridor over the whole camera
  if (!close || zoom) {
    W = plate(mapG, D, I, P, camW, M, { whole: true, tag: 'w', S: Sx, stem: wholeStem, wholeKm, zones: D.zones && D.zones.thr.length ? D.zones : null, floodZ: D.zones && D.zones.thr.length ? D.zones : D.corridor, sFlood: b.flood, isSourceStem: true, isMouthStem: true,
      sRiver: sR, sTrib: sT, sTown, sClose: close ? null : (b.closeup ?? null), delay: 0, delay2: 900 }, ctx);
  }
  if (close) {
    const kmBox = (() => { const pp = wholeStem.map(camC.P); const ins = pp.map((p, i) => inRect(p, M) ? i : -1).filter(i => i >= 0); return ins.length ? [kmW[ins[0]], kmW[ins[ins.length - 1]]] : null; })();
    Cp = plate(mapG, D, I, P, camC, M, { whole: false, tag: 'c', S: Sx, stem: cStem, kmOffset, wholeKm, zones: featZones(), floodZ: featZones(), sFlood: b.flood, isSourceStem: !det, isMouthStem: !det,
      sRiver: zoom ? sZoom : sR, sTrib: zoom ? sZoom : sT, sTown: zoom ? sZoom : sTown, sClose, delay: zoom ? 1200 : 0, delay2: zoom ? 1200 : 900 }, ctx);
    Cp.kmBox = kmBox;
    if (zoom) Cp.g.setAttribute('data-s', String(sZoom));
  }
  h('rect', { x: M.x, y: M.y, width: M.w, height: M.h, fill: 'none', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)', cls: 'rr-frame' }, root);

  // north arrow
  const na = h('g', {}, root), NX = M.x + 30, NY = M.y + M.h - 64;
  h('path', { d: `M${NX} ${NY} l10 26 l-10 -6 l-10 6 Z`, fill: 'var(--ink-2)' }, na);
  h('text', { x: NX, y: NY + 46, 'text-anchor': 'middle', 'font-size': 24 /* the type floor */, 'font-weight': 700, fill: 'var(--ink-2)', style: `font-family:${FONT}`, text: 'N' }, na);

  // long profile from the baked heights (it only falls); the number comes from a checked fact or the writer
  if (P.profile) {
    const PR = side ? { x: 860, y: 190, w: 360, h: 170 } : { x: 160, y: 598, w: 1000, h: 46 };
    // the top value: the writer's number, else a checked fact, else the DEM height at the source (baked, to 10 m)
    const hs = D.profile.heights, H0 = P.sourceHeight || I.sourceHeight || I.sourceDem || D.sourceDem || null, top = Math.max(1, hs[0]);
    const X = u => PR.x + u * PR.w, Y = v => PR.y + PR.h - v / top * PR.h;
    const pg = h('g', {}, root);
    if (side) h('text', { x: PR.x, y: PR.y - 30, 'font-size': FS, 'font-weight': 600, fill: 'var(--ink)', style: `font-family:${FONT}`, text: txt(P, 'label:heights', 'Height from source to sea'), 'data-edit': 'text.label:heights' }, pg);
    const pts = hs.map((v, i) => [X(i / (hs.length - 1)), Y(v)]);
    h('path', { d: pd(pts) + `L${X(1)},${PR.y + PR.h}L${X(0)},${PR.y + PR.h}Z`, fill: 'var(--hill-mid)' }, pg);
    h('path', { d: pd(pts.map(p => [p[0], p[1] - 3])), fill: 'none', stroke: 'var(--water)', 'stroke-width': 3.5, 'stroke-linejoin': 'round' }, pg);
    if (I.mouth === 'sea') h('line', { x1: X(1), x2: X(1) + 40, y1: PR.y + PR.h, y2: PR.y + PR.h, stroke: 'var(--sea-2)', 'stroke-width': 6 }, pg);
    if (H0) { const t = h('text', { x: PR.x - 12, y: PR.y + 10, 'text-anchor': 'end', 'font-size': FS, 'font-weight': 600, fill: 'var(--ink)', style: `font-family:${FONT}`, text: `${H0.toLocaleString('en-GB')} m` }, pg); t.setAttribute('data-computed', 'sourceHeight'); }
    if (side || !H0) h('text', side ? { x: PR.x, y: PR.y + PR.h + 34, 'font-size': 22, 'font-weight': 500, fill: 'var(--ink-3)', style: `font-family:${FONT}`, text: 'Source' } : { x: PR.x - 12, y: PR.y + 18, 'text-anchor': 'end', 'font-size': 22, 'font-weight': 500, fill: 'var(--ink-2)', style: `font-family:${FONT}`, text: 'Source' }, pg);
    if (I.mouth === 'sea') { const t = h('text', { x: side ? PR.x + PR.w : PR.x + PR.w + 40, y: side ? PR.y + PR.h + 34 : PR.y + PR.h - 14, 'text-anchor': 'end', 'font-size': 24, 'font-weight': 500, fill: 'var(--water-text)', style: `font-family:${FONT}`, text: txt(P, 'label:sealevel', 'Sea level: 0 m') }, pg); t.setAttribute('data-edit', 'text.label:sealevel'); }
    if (close && Cp && Cp.kmBox) { const a = Cp.kmBox[0] / wholeKm, z = Cp.kmBox[1] / wholeKm, right = a > .6 || X(z) + 12 + tw(txt(P, 'label:thismap', 'This map'), 600, 20) > 1268;
      const bx = h('g', { s: zoom ? sZoom : null }, pg);
      h('rect', { x: X(a), y: PR.y - 8, width: Math.max(6, X(z) - X(a)), height: PR.h + 8, fill: 'none', stroke: 'var(--hue-red)', 'stroke-width': 3, rx: 3 }, bx);
      const t = h('text', { x: right ? X(a) - 12 : X(z) + 12, y: PR.y + 16, 'text-anchor': right ? 'end' : 'start', 'font-size': 20, 'font-weight': 600, fill: 'var(--ink-2)', style: `font-family:${FONT}`, text: txt(P, 'label:thismap', 'This map') }, bx); t.setAttribute('data-edit', 'text.label:thismap'); }
  }

  // build hooks: river and tributaries draw on; the zoom flies the whole plate into the frame
  const zoomT = (() => { if (!zoom || !W) return null;
    const E0 = camC.inv(M.x, M.y + M.h), E1 = camC.inv(M.x + M.w, M.y), a = camW.P([E0[0], E1[1]]), c = camW.P([E1[0], E0[1]]);
    return { x: a[0], y: a[1], w: c[0] - a[0], h: c[1] - a[1] }; })();
  function setZoom(t) {
    if (!zoomT) return;
    const r = Math.pow(zoomT.w / M.w, t), cx = lerp(M.x + M.w / 2, zoomT.x + zoomT.w / 2, t), cy = lerp(M.y + M.h / 2, zoomT.y + zoomT.h / 2, t);
    const s = 1 / r, Ax = cx - M.w * r / 2, Ay = cy - M.h * r / 2; // the rect A(t) of the whole plate that fills M
    W.g.setAttribute('transform', `translate(${M.x - Ax * s} ${M.y - Ay * s}) scale(${s})`);
    W.g.style.opacity = String(1 - clamp((t - .35) / .35)); W.labels.style.opacity = W.marks.style.opacity = String(1 - clamp(t * 5));
    const rx = M.x + (zoomT.x - Ax) * s, ry = M.y + (zoomT.y - Ay) * s, rs = (zoomT.w * s) / M.w;
    Cp.g.setAttribute('transform', `translate(${rx - M.x * rs} ${ry - M.y * rs}) scale(${rs})`);
    Cp.g.style.opacity = String(clamp((t - .15) / .4));
    if (t >= 1) { Cp.g.removeAttribute('transform'); W.g.style.opacity = '0'; } // land exactly on the close-up camera
  }
  const setRiver = u => { if (W) W.riverDr.set(u); else Cp.riverDr.set(u); };
  const setTribs = u => { for (const x of (W || Cp).tribRuns) x.dr.set(u); };
  if (Cp && W) { Cp.riverDr.set(1); for (const x of Cp.tribRuns) x.dr.set(1); }
  const state = (k, u) => {
    setRiver(k > sR ? 1 : k === sR ? eIO(clamp(u)) : 0);
    if (b.tributaries != null) setTribs(k > b.tributaries ? 1 : k === b.tributaries ? eIO(clamp(u)) : 0); else setTribs(1);
    if (zoom) { setZoom(k > sZoom ? 1 : k === sZoom ? eIO(clamp(u)) : 0); if (k < sZoom) Cp.g.style.opacity = '0'; }
  };
  return {
    dur: { river: 2400, tributaries: 1400, zoom: 2200 },
    still() { state(N, 1); },
    reset() { state(-1, 0); },
    tick(k, u) { state(k, u); },
  };
}
