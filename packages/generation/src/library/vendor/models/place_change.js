// How a place changes: then and now. One viewpoint (seaside, high street, village or home)
// drawn in two or three periods side by side; each change is its own build, then what stayed
// the same. Every object is checked against the year it is drawn in (kit PERIODS table).
// A second view, the town plan, shows land use growing outward ring by ring (Y6 settlement).
import {
  h, T, measure, clamp, rng, GRID, panels, textBlock, sky, hills, ground, water, object,
  parseDate, durationLabel, editable, computed, txt, TEXT_PARAM, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { periodObject, PERIODS, periodCheck, G_OBJECTS } from '../kit/batch-G.js';

export const meta = {
  id: 'place_change', name: 'Then and now', kind: 'scene', version: 1,
  subjects: ['History', 'Geography'],
  years: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'],
  teaches: 'How a place changes over time: what is different, what stayed the same, and how a town grows outward.',
};

const THIS_YEAR = new Date().getFullYear();
const KINDS = ['none', ...G_OBJECTS, 'tree'];
const KIND_NAME = k => k === 'none' ? 'nothing' : k === 'tree' ? 'tree' : (PERIODS[k] ? PERIODS[k].name : k);
const cap1 = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const PLACES = ['seaside', 'high_street', 'village', 'home'];
const PLACE_WORDS = { seaside: 'The seaside', high_street: 'The high street', village: 'The village', home: 'At home' };
const USES = ['housing', 'shops', 'industry', 'parks', 'services', 'roads'];
const USE_LABELS = ['homes', 'shops', 'factories', 'parks', 'services', 'roads, stations'];
const USE_COL = { housing: 'var(--tile)', shops: 'var(--sun)', industry: 'color-mix(in oklab,var(--hue-grey) 80%,var(--ink))', parks: 'var(--life)', services: 'var(--hue-blue)', roads: 'var(--road)' };
const SIZE = { small: 1, medium: 2, large: 3 };
const THING = { type: 'string', enum: KINDS, 'x-labels': KINDS.map(k => cap1(KIND_NAME(k))), default: 'none' };
const SLOTS = ['first', 'second', 'third'];

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Then and now',
  properties: {
    title: TITLE_PARAM('Then and now'),
    view: { type: 'string', title: 'Show', enum: ['scene', 'plan'], 'x-labels': ['The same spot, then and now', 'A town plan: how the land is used'], default: 'scene' },
    place: { type: 'string', title: 'Place', enum: PLACES, 'x-labels': ['Seaside', 'High street', 'Village', 'At home'], default: 'high_street' },
    periods: {
      type: 'array', title: 'Times to compare', description: 'Two or three times, oldest first.', 'x-item': 'a time', minItems: 2, maxItems: 3,
      default: [{ name: 'Long ago', year: '1900' }, { name: 'Today', year: String(THIS_YEAR) }],
      items: { type: 'object', required: ['year'], default: { name: 'Today', year: String(THIS_YEAR) }, properties: {
        name: { type: 'string', title: 'Name', description: 'Like “Long ago”, “When Grandma was little” or “Today”.', maxLength: 36 /* libfix: what the lane holds at the most items (tools/laneFit); longer is refused, never cut */, default: '' },
        year: { type: 'string', title: 'Year', description: 'Like “1900” or “c. 1950”.', minLength: 1, maxLength: 12 },
      } },
    },
    features: {
      type: 'array', title: 'Things that change', description: 'One row each. Pick what was there at each time, in the same order as the times.', 'x-item': 'a thing', maxItems: 4,
      default: [{ name: 'Getting about', first: 'horse_cart', second: 'car' }, { name: 'Street lights', first: 'gas_lamp', second: 'street_lamp' }],
      items: { type: 'object', required: ['name'], default: { name: 'Something else', first: 'none', second: 'none', third: 'none' }, properties: {
        name: { type: 'string', title: 'What it is about', maxLength: 32 /* libfix: what the lane holds at the most items (tools/laneFit); longer is refused, never cut */, minLength: 1 },
        first: Object.assign({ title: 'At the first time' }, THING), second: Object.assign({ title: 'At the second time' }, THING),
        third: Object.assign({ title: 'At the third time', description: 'Only used when there are three times.' }, THING),
      } },
    },
    same: { type: 'array', title: 'Also stayed the same', description: 'Words for things that did not change, like “the sea”.', 'x-item': 'a thing', maxItems: 3, default: [],
      items: { type: 'object', required: ['thing'], default: { thing: 'the sea' }, properties: { thing: { type: 'string', title: 'What stayed the same', maxLength: 40, minLength: 1 } } } },
    landUse: {
      type: 'array', title: 'Town plan: what was built', description: 'For the town plan. Each place goes in the ring of the time it was built.', 'x-item': 'a place', maxItems: 9, default: [],
      items: { type: 'object', required: ['name', 'use', 'when'], default: { name: 'New houses', use: 'housing', when: '2', size: 'medium' }, properties: {
        name: { type: 'string', title: 'Name', maxLength: 36 /* libfix: what the lane holds at the most items (tools/laneFit); longer is refused, never cut */, minLength: 1 },
        use: { type: 'string', title: 'Used for', enum: USES, 'x-labels': USE_LABELS.map(cap1), default: 'housing' },
        when: { type: 'string', title: 'Built by', enum: ['1', '2', '3'], 'x-labels': ['The first time', 'The second time', 'The third time'], default: '2' },
        size: { type: 'string', title: 'Size', enum: ['small', 'medium', 'large'], 'x-labels': ['Small', 'Medium', 'Large'], default: 'medium' },
      } },
    },
    text: TEXT_PARAM,
  },
};

export const presets = [
  { id: 'y1-seaside', name: 'Year 1: seaside holidays then and now', params: {
    title: 'Seaside holidays then and now', view: 'scene', place: 'seaside',
    periods: [{ name: 'Long ago', year: '1900' }, { name: 'Today', year: String(THIS_YEAR) }],
    features: [{ name: 'Getting changed', first: 'bathing_machine', second: 'beach_hut' }, { name: 'Getting about', first: 'horse_cart', second: 'car' }, { name: 'Lights on the prom', first: 'gas_lamp', second: 'street_lamp' }],
    same: [{ thing: 'the sea' }, { thing: 'the sand' }],
    landUse: [{ name: 'Pier and seafront shops', use: 'shops', when: '1', size: 'small' }, { name: 'Boarding houses', use: 'housing', when: '1', size: 'medium' },
      { name: 'Holiday homes', use: 'housing', when: '2', size: 'large' }, { name: 'Car parks', use: 'roads', when: '2', size: 'small' }],
  } },
  { id: 'y2-toys', name: 'Year 2: toys 100 years ago', params: {
    title: 'Toys 100 years ago and today', view: 'scene', place: 'home',
    periods: [{ name: '100 years ago', year: String(THIS_YEAR - 100) }, { name: 'Today', year: String(THIS_YEAR) }],
    features: [{ name: 'Teddy bear', first: 'teddy', second: 'teddy' }, { name: 'Playing on your own', first: 'hoop', second: 'tablet' }, { name: 'Spinning top', first: 'spinning_top', second: 'spinning_top' }],
    same: [],
    landUse: [{ name: 'Old terraced streets', use: 'housing', when: '1', size: 'medium' }, { name: 'Corner shop', use: 'shops', when: '1', size: 'small' },
      { name: 'New houses', use: 'housing', when: '2', size: 'large' }, { name: 'Park and playground', use: 'parks', when: '2', size: 'small' }],
  } },
  { id: 'y3-high-street', name: 'Year 3: our high street in three times', params: {
    title: 'Our high street in three times', view: 'scene', place: 'high_street',
    periods: [{ name: 'Victorian', year: '1900' }, { name: 'Between the wars', year: '1930' }, { name: 'Today', year: String(THIS_YEAR) }],
    features: [{ name: 'Shops', first: 'shopfront', second: 'shopfront', third: 'shopfront' }, { name: 'Getting about', first: 'horse_cart', second: 'early_car', third: 'bus' }, { name: 'Street lights', first: 'gas_lamp', second: 'street_lamp', third: 'street_lamp' }],
    same: [{ thing: 'the street plan' }],
    landUse: [{ name: 'High street shops', use: 'shops', when: '1', size: 'small' }, { name: 'Terraced houses', use: 'housing', when: '1', size: 'medium' },
      { name: 'Semi-detached houses', use: 'housing', when: '2', size: 'medium' }, { name: 'Cinema', use: 'services', when: '2', size: 'small' },
      { name: 'Supermarket', use: 'shops', when: '3', size: 'medium' }, { name: 'New estate', use: 'housing', when: '3', size: 'large' }],
  } },
  { id: 'y6-town-grew', name: 'Year 6: how our town grew', params: {
    title: 'How our town grew', view: 'plan', place: 'high_street',
    features: [{ name: 'Shops', first: 'shopfront', second: 'shopfront', third: 'shopfront' }, { name: 'Street lights', first: 'gas_lamp', second: 'street_lamp', third: 'street_lamp' }],
    periods: [{ name: 'Market town', year: '1850' }, { name: 'After the war', year: '1950' }, { name: 'Today', year: String(THIS_YEAR) }],
    landUse: [
      { name: 'Market square and shops', use: 'shops', when: '1', size: 'small' }, { name: 'Terraced houses', use: 'housing', when: '1', size: 'medium' }, { name: 'Mill by the river', use: 'industry', when: '1', size: 'small' },
      { name: 'Council estate', use: 'housing', when: '2', size: 'large' }, { name: 'Factory', use: 'industry', when: '2', size: 'medium' }, { name: 'School', use: 'services', when: '2', size: 'small' },
      { name: 'New housing estates', use: 'housing', when: '3', size: 'large' }, { name: 'Retail park', use: 'shops', when: '3', size: 'medium' }, { name: 'Leisure centre', use: 'services', when: '3', size: 'small' },
    ],
  } },
];

/* ------------------------------------------------------------------ model of the data */
function model(P) {
  const periods = (P.periods || []).map((p, j) => { const d = parseDate(p.year); return { ...p, j, d, y: d.astro, isToday: /^today$/i.test((p.name || '').trim()) && d.astro === THIS_YEAR }; });
  const n = periods.length;
  const objLabel = k => txt(P, `label:obj:${k}`, KIND_NAME(k));
  const features = (P.features || []).map((f, i) => {
    const objs = Array.from({ length: n }, (_, j) => f[SLOTS[j]] || 'none');
    const kinds = new Set(objs);
    return { ...f, i, objs, changed: kinds.size > 1, same: kinds.size === 1 && !kinds.has('none') };
  });
  const changed = features.filter(f => f.changed); changed.forEach((f, m) => { f.num = m + 1; });
  const sameF = features.filter(f => f.same);
  const sameWords = (P.same || []).map((w, k) => ({ s: w.thing, k }));
  const zones = (P.landUse || []).map((z, i) => ({ ...z, i, w: +z.when - 1, sz: SIZE[z.size] || 2 }));
  return { periods, n, features, changed, sameF, sameWords, zones, objLabel };
}
const when = (p, cap = false) => p.isToday ? (cap ? 'Today' : 'today') : `${cap ? 'In ' : 'in '}${p.d.approx ? 'about ' : ''}${p.y}`;
const yearsBetween = (a, b) => durationLabel(b.y - a.y, a.d.approx || b.d.approx);

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); if (R.length) return result(R);
  const M = model(P);
  M.periods.forEach(p => {
    const path = `periods.${p.j}.year`;
    if (p.d.error) R.push({ path, reason: p.d.error });
    else if (p.y > THIS_YEAR) R.push({ path, reason: `${p.y} has not happened yet. Use ${THIS_YEAR} or earlier for “now”.` });
    else if (p.y < 1500) R.push({ path, reason: `This model compares a place over the last few hundred years (from about 1500). For older times, use the timeline.` });
    else if (/^today$/i.test((p.name || '').trim()) && p.y !== THIS_YEAR) R.push({ path, reason: `A time called “Today” has to be ${THIS_YEAR}. Change the year to ${THIS_YEAR}, or give this time another name.` });
  });
  if (R.length) return result(R);
  for (let j = 1; j < M.n; j++) if (M.periods[j].y <= M.periods[j - 1].y)
    R.push({ path: `periods.${j}.year`, reason: `The times go oldest first: ${M.periods[j].year} has to come after ${M.periods[j - 1].year}. Swap them or change a year.` });
  if (R.length) return result(R);
  if (P.view === 'plan') {
    if (!M.zones.length) R.push({ path: 'landUse', reason: 'The town plan needs at least one place in “What was built”.' });
    M.zones.forEach(z => { if (z.w >= M.n) R.push({ path: `landUse.${z.i}.when`, reason: `“${z.name}” is built by time ${z.w + 1}, but there are only ${M.n} times. Pick an earlier time or add one.` }); });
    for (let j = 0; j < M.n && !R.length; j++) if (!M.zones.some(z => z.w === j))
      R.push({ path: 'landUse', reason: `Nothing is built by ${M.periods[j].year}, so the town would not grow in that ring. Add a place for that time, or remove the time.` });
    return result(R);
  }
  if (!M.features.length) R.push({ path: 'features', reason: 'Add at least one thing that changes, like “Getting about”.' });
  M.features.forEach(f => {
    if (f.objs.every(k => k === 'none')) R.push({ path: `features.${f.i}.first`, reason: `“${f.name}” has nothing drawn at any time. Pick what was there.` });
    f.objs.forEach((k, j) => { const why = periodCheck(k, M.periods[j].y); if (why) R.push({ path: `features.${f.i}.${SLOTS[j]}`, reason: why }); });
  });
  return result(R);
}

/* ------------------------------------------------------------------ builds */
function plan(P) {
  const M = model(P); const items = []; const pr = M.periods; const first = pr[0], last = pr[M.n - 1];
  if (P.view === 'plan') {
    pr.forEach((p, j) => {
      const zs = M.zones.filter(z => z.w === j).map(z => z.name);
      items.push({ key: `p:${j}`, caption: j === 0 ? `${cap1(when(p))}: the town starts with ${zs.join(', ').toLowerCase()}.` : `By ${p.y} the town has grown outward: ${zs.join(', ').toLowerCase()}.` });
    });
    return { M, items, summary: `In ${last.y - first.y} years the town grew outward, ring by ring, from its oldest part.` };
  }
  pr.forEach((p, j) => items.push({ key: `p:${j}`, caption: j === 0 ? `${PLACE_WORDS[P.place] || 'This place'} ${when(p)}. What can you see?` : `The same spot ${when(p)}, ${yearsBetween(pr[j - 1], p)} later. What looks different?` }));
  const runs = f => { const out = []; f.objs.forEach((k, j) => { if (out.length && out[out.length - 1].k === k) out[out.length - 1].z = j; else out.push({ k, a: j, z: j }); }); return out; };
  M.changed.forEach(f => { const parts = runs(f).map(r => `${M.objLabel(r.k)} ${r.z > r.a ? `from ${pr[r.a].y}` : when(pr[r.a])}`);
    items.push({ key: `chg:${f.i}`, caption: `${f.name}: ` + parts.join(parts.length > 2 ? ', ' : ', then ') + '.' }); });
  const sameList = [...M.sameF.map(f => f.name.toLowerCase()), ...M.sameWords.map(w => w.s)];
  if (sameList.length) items.push({ key: 'same', caption: `Some things stayed the same: ${sameList.join(', ')}.` });
  const c = M.changed.length;
  return { M, items, summary: `${first.y} to ${last.isToday ? 'today' : last.y}: ${c} ${c === 1 ? 'thing' : 'things'} changed in ${yearsBetween(first, last)}${sameList.length ? `, and ${sameList.length} stayed the same` : ''}.` };
}
export function builds(P) { const { items, summary } = plan(P); return { steps: items.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }

export function notes(P) {
  const { M, items } = plan(P); const pr = M.periods;
  const steps = items.map(it => {
    if (it.key.startsWith('p:')) {
      const j = +it.key.slice(2), p = pr[j];
      if (P.view === 'plan') return j === 0 ? 'Towns usually grow outward from their oldest part: a river crossing, a market or a church. Ask: why did people first settle here?'
        : `Each ring is what was added by ${p.y}. Ask: why build ${M.zones.filter(z => z.w === j).map(z => USE_LABELS[USES.indexOf(z.use)]).filter((v, i, a) => a.indexOf(v) === i).join(' and ')} on the edge of town?`;
      return j === 0 ? `Let the class look before you name anything. These are simple drawings: photos, postcards, maps and adverts from ${p.y} are the evidence for what was really there.`
        : `The same spot, ${yearsBetween(pr[j - 1], p)} later. Ask the class to spot changes before the next builds name them.`;
    }
    if (it.key === 'same') return 'Not everything changes. Ask: why do you think these stayed the same?';
    const f = M.features[+it.key.slice(4)];
    return `${f.objs.map((k, j) => `${pr[j].y}: ${M.objLabel(k)}`).join('; ')}. Ask what caused the change (a new invention, more money, a new way of living) and whether life got easier.`;
  });
  return { steps, summary: P.view === 'plan'
    ? 'This is a simple plan, not a map of a real town: each ring’s area is in proportion to the sizes chosen. Compare it with an old and a new map of your own town.'
    : 'Sort the changes: which made life easier, and for whom? The drawings are simple and not to scale; each row is drawn at one size so its things can be compared.' };
}

/* ------------------------------------------------------------------ render */
const NOTE_W = 460, MIN_BOX = 240, USE_W = 200;
const ERA = n => n === 2 ? [1, 4] : [1, 5, 4];
const arrowD = (x1, x2, y) => `M${x1} ${y} L${x2} ${y} M${x2 - 9} ${y - 7} L${x2} ${y} L${x2 - 9} ${y + 7}`;

export function render(root, P, ctx) {
  const { M } = plan(P); const b = ctx.b; const bi = k => b[k] ?? 0;
  // the honesty note sits in the title band, right
  const noteT = P.view === 'plan' ? txt(P, 'label:note', 'A simple plan, not a map') : txt(P, 'label:note', 'Simple drawings, not to scale');
  textBlock(root, GRID.right, GRID.subY, noteT, { cls: 'ts-small', maxW: NOTE_W, maxLines: 1, anchor: 'end', a: { fill: 'var(--ink-2)' }, edit: 'text.label:note' });
  if (P.view === 'plan') return renderPlan(root, P, ctx, M);
  const n = M.n, pr = M.periods, era = ERA(n);
  const PANELS = panels(n, 0, 1, 32);

  /* headers: year, name, and (computed) how long after the one before: on the same line when it fits */
  const HY = 152; let hBottom = HY + 14;
  const heads = PANELS.map((pb, j) => {
    const p = pr[j]; const g = h('g', { s: bi(`p:${j}`), cls: 'rise' }, root);
    const yt = editable(T(g, pb.x, HY, p.year, 'ts-date', { fill: `var(--era-${era[j]}-text)` }), `periods.${j}.year`);
    const yw = yt.getComputedTextLength();
    let yy = HY, end = pb.x + yw;
    if (p.name) { const tb = textBlock(g, pb.x + yw + 12, HY, p.name, { cls: 'ts-small', maxW: pb.w - yw - 12, maxLines: 2, lh: 26, a: { fill: 'var(--ink)' }, edit: `periods.${j}.name` }); yy += (tb.lines.length - 1) * tb.lh; end = tb.lines.length > 1 ? pb.x + pb.w : pb.x + yw + 12 + tb.w; }
    if (j > 0) {
      const t = computed(T(g, pb.x + pb.w, yy, `${yearsBetween(pr[j - 1], p)} later`, 'ts-small', { 'text-anchor': 'end', fill: 'var(--ink-2)' }), `periods.${j}.year`);
      if (end + 24 > pb.x + pb.w - t.getComputedTextLength()) { yy += 30; t.setAttribute('x', pb.x); t.setAttribute('y', yy); t.setAttribute('text-anchor', 'start'); }
    }
    hBottom = Math.max(hBottom, yy + 16);
    return g;
  });
  /* legend rows (bottom up), measured first so the panels take what is left */
  const legend = maxL => {
  const L = h('g', {}, root);
  const rowsAll = [...M.changed.map(f => ({ f })), ...((M.sameF.length || M.sameWords.length) ? [{ same: true }] : [])];
  const nameCol = Math.min(320, Math.max(0, ...rowsAll.map(r => measure(L, r.same ? txt(P, 'label:same', 'Stayed the same') : r.f.name, 'ts-small', { cls: 'strong' }))));
  const cx0 = GRID.left + 44 + nameCol + 28;
  const rows = rowsAll.map(r => {
    // earlier rows step back to soft (not quiet), so they stay readable when projected
    const outer = h('g', r.same ? { s: bi('same') } : { s: bi(`chg:${r.f.i}`), c: ctx.rc(`chg:${r.f.i}`, null, 'soft') }, L); outer.setAttribute('class', 'rise');
    const g = h('g', {}, outer); let lines = 1;
    if (r.same) {
      h('circle', { cx: GRID.left + 15, cy: 14, r: 15, fill: 'var(--compare)' }, g);
      for (const dy of [-4, 4]) h('line', { x1: GRID.left + 8, x2: GRID.left + 22, y1: 14 + dy, y2: 14 + dy, stroke: 'var(--on-hue)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g);
      const nb = textBlock(g, GRID.left + 44, 22, txt(P, 'label:same', 'Stayed the same'), { cls: 'ts-small', maxW: nameCol, maxLines: maxL, lh: 28, a: { cls: 'strong', fill: 'var(--compare-text)' }, edit: 'text.label:same' });
      lines = nb.lines.length;
      const items = [...M.sameF.map(f => ({ s: f.name, edit: `features.${f.i}.name` })), ...M.sameWords.map(w => ({ s: w.s, edit: `same.${w.k}.thing` }))];
      let x = cx0, line = 0;
      items.forEach((it, q) => {
        const w = Math.min(measure(g, it.s, 'ts-small'), GRID.right - cx0);
        if (x + w > GRID.right && x > cx0) { line++; x = cx0; }
        else if (q) h('circle', { cx: x - 14, cy: 14 + line * 28, r: 3, fill: 'var(--ink-2)' }, g);
        const tb = textBlock(g, x, 22 + line * 28, it.s, { cls: 'ts-small', maxW: GRID.right - x, maxLines: 1, lh: 28, a: { fill: 'var(--ink)' }, edit: it.edit });
        x += tb.w + 28;
      });
      lines = Math.max(lines, line + 1);
    } else {
      const f = r.f;
      h('circle', { cx: GRID.left + 15, cy: 14, r: 15, fill: 'var(--focus)' }, g);
      computed(T(g, GRID.left + 15, 22, String(f.num), 'ts-badge', { 'text-anchor': 'middle' }), `features.${f.i}.name`);
      const nb = textBlock(g, GRID.left + 44, 22, f.name, { cls: 'ts-small', maxW: nameCol, maxLines: maxL, lh: 28, a: { cls: 'strong', fill: 'var(--ink)' }, edit: `features.${f.i}.name` });
      lines = nb.lines.length; let x = cx0;
      f.objs.forEach((k, j) => {
        const left = n - j, maxW = (GRID.right - x - (left - 1) * 52) / left;
        const tb = textBlock(g, x, 22, M.objLabel(k), { cls: 'ts-small', maxW, maxLines: Math.min(2, maxL), lh: 28, a: { fill: k === 'none' ? 'var(--ink-2)' : 'var(--ink)' }, edit: `text.label:obj:${k}` });
        lines = Math.max(lines, tb.lines.length); x += tb.w;
        if (j < n - 1) { h('path', { d: arrowD(x + 12, x + 40, 14), fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g); x += 52; }
      });
    }
    return { g, hh: 30 + (lines - 1) * 28 };
  });
  const total = rows.reduce((s, r) => s + r.hh, 0) + Math.max(0, rows.length - 1) * 6;
  return { L, rows, total };
  };
  // the pictures keep at least MIN_BOX: long names wrap while they fit, then go to one line each
  const budget = GRID.bottom - 20 - MIN_BOX - hBottom;
  let LG = legend(3);
  if (LG.total > budget) { LG.L.remove(); LG = legend(1); }
  const L = LG.L;
  let y = GRID.bottom - LG.total; const legTop = y;
  for (const r of LG.rows) { r.g.setAttribute('transform', `translate(0 ${y})`); y += r.hh + 6; }

  const boxY = hBottom, boxH = legTop - 20 - boxY;
  if (boxH < MIN_BOX) ctx.warn(`The changes list leaves only ${boxH | 0} units for the pictures.`);

  /* later panels are reserved as faint outlines until their time arrives */
  PANELS.forEach((pb, j) => { if (j) h('rect', { x: pb.x + 1.5, y: boxY + 1.5, width: pb.w - 3, height: boxH - 3, rx: 'var(--r-card)', fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-struct)', 'stroke-dasharray': '10 10', hide: bi(`p:${j}`) }, root); });

  /* object sizes at scale 1, measured once */
  const tmp = h('g', {}, root); const BB = {};
  for (const k of new Set(M.features.flatMap(f => f.objs))) if (k !== 'none') {
    const o = k === 'tree' ? object(tmp, 'tree', 0, 0, 1) : periodObject(tmp, k, 0, 0, 1); const r = o.getBBox(); BB[k] = { x: r.x, y: r.y, w: r.width, h: r.height }; }
  tmp.remove();
  // one scale for the whole scene. Tall things stand a little further back, so neighbours may
  // overlap in depth and every drawing can be larger than a single row would allow.
  const real = f => f.objs.filter(k => k !== 'none');
  const ws = M.features.map(f => Math.max(...real(f).map(k => BB[k].w)) + 16);
  const hs = M.features.map(f => Math.max(...real(f).map(k => BB[k].h)));
  // Each row (feature) has one scale in every panel, so its things compare; rows may differ.
  // Tall things (buildings, lamps) stand in a back lane; the rest stand in front on the near
  // ground. Each lane is laid out across the whole panel, so the front things can be large.
  const PW = PANELS[0].w, lanes = M.features.length > 1;
  const standing = M.features.map(f => real(f).every(k => STANDING.has(k)));
  const back = standing.map(v => lanes && v && standing.some(w => !w));
  const gyF = GROUND_F[P.place] ?? .9, dz = back.some(v => v) ? boxH * .12 : 0;
  const gyOf = i => boxY + boxH * gyF - (back[i] ? dz : 0);
  // a lone front thing may fill a narrow (three-time) panel; in a wide panel it keeps clear of the sides
  const S = [], slotX = [];
  for (const bk of [true, false]) {
    const ids = M.features.map((f, i) => i).filter(i => back[i] === bk); if (!ids.length) continue;
    const fit = ids.map(i => Math.min((gyOf(i) - boxY - 52) * (bk ? .9 : 1) / hs[i], PW * (ids.length > 1 ? .5 : n > 2 ? .8 : .6) / ws[i], P.place === 'home' ? 3 : 2.6));
    const sum = ids.reduce((t, i, q) => t + ws[i] * fit[q], 0), k = Math.min(1, PW * .92 / sum);
    // the back lane spreads to the sides, leaving the middle for the things in front
    const spread = bk && ids.length > 1, gap = spread ? (PW * .92 - sum * k) / (ids.length - 1) : 0;
    let acc = spread ? PW * .04 : (PW - sum * k) / 2;
    ids.forEach((i, q) => { S[i] = clamp(fit[q] * k, .3, 3); slotX[i] = acc + ws[i] * S[i] / 2; acc += ws[i] * S[i] + gap; });
  }
  const order = M.features.map((f, i) => i).sort((a, c) => (back[c] - back[a]) || (a - c));

  // when is each object the focal point, and when should it step back?
  const steps = Object.keys(b);
  const quietFor = f => steps.filter(key => (key.startsWith('chg:') && key !== `chg:${f.i}`) || (key === 'same' && !f.same)).map(key => `${b[key]}-${b[key] + 1}:soft`).join(',') || null;

  const marks = h('g', {}, root);
  PANELS.forEach((pb, j) => {
    const box = { x: pb.x, y: boxY, w: pb.w, h: boxH };
    const outer = h('g', { s: bi(`p:${j}`), cls: j ? 'wipe' : 'rise' }, root);
    const id = `${ctx.uid}-pc${j}`;
    h('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: 'var(--r-card)' }, h('clipPath', { id }, h('defs', {}, outer)));
    const g = h('g', { 'clip-path': `url(#${id})` }, outer);
    backdrop(g, P.place, box, ctx);
    h('rect', { x: box.x, y: box.y, width: box.w, height: 8, fill: `var(--era-${era[j]})` }, g);
    const placed = [];
    for (const i of order) {
      const f = M.features[i], k = f.objs[j]; if (k === 'none') continue;
      const s = S[i], bb = BB[k], gy = gyOf(i), x = box.x + slotX[i] - (bb.x + bb.w / 2) * s;
      if (k === 'tree') object(g, 'tree', x, gy, s, { c: quietFor(f) }); else periodObject(g, k, x, gy, s, { c: quietFor(f) });
      placed.push({ i, f, n: placed.length, x0: x + bb.x * s, x1: x + (bb.x + bb.w) * s, top: gy + bb.y * s });
    }
    // badges sit in the clear air above their drawing, and above any neighbour that reaches under them
    placed.sort((a, c) => a.i - c.i).forEach(o => {
      const { f } = o; const bx = (o.x0 + o.x1) / 2;
      const top = Math.min(o.top, ...placed.filter(q => q.n > o.n && q.x1 > bx - 22 && q.x0 < bx + 22).map(q => q.top));
      const by = Math.max(box.y + 30, top - 28);
      if (f.changed) {
        const m = h('g', { s: bi(`chg:${f.i}`), cls: 'pop', c: ctx.rc(`chg:${f.i}`, null, 'soft') }, marks);
        h('circle', { cx: bx, cy: by, r: 17, fill: 'var(--focus)', stroke: 'var(--bg)', 'stroke-width': 'var(--sw-struct)' }, m);
        computed(T(m, bx, by + 8, String(f.num), 'ts-badge', { 'text-anchor': 'middle' }), `features.${f.i}.name`);
      } else if (f.same && b.same != null) {
        const m = h('g', { s: bi('same'), cls: 'pop' }, marks);
        h('circle', { cx: bx, cy: by, r: 17, fill: 'var(--compare)', stroke: 'var(--bg)', 'stroke-width': 'var(--sw-struct)' }, m);
        for (const dy of [-4, 4]) h('line', { x1: bx - 7, x2: bx + 7, y1: by + dy, y2: by + dy, stroke: 'var(--on-hue)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, m);
      }
    });
  });
  root.appendChild(marks);
  heads.forEach(g => root.appendChild(g));
  root.appendChild(L);
  return {};
}

/* one viewpoint, period-neutral: the same land, sea and sky in every panel */
const STANDING = new Set(['gas_lamp', 'street_lamp', 'beach_hut', 'bathing_machine', 'shopfront', 'tree']);
const GROUND_F = { home: .9, seaside: .92, high_street: .9, village: .9 };
function backdrop(g, place, box, ctx) {
  const { x, y, w, h: bh } = box; const x1 = x + w; const at = f => y + bh * f;
  if (place === 'home') {
    h('rect', { x, y, width: w, height: bh, fill: 'var(--wall-top)' }, g);
    const ww = Math.min(w * .2, 110), wx = x + w / 2 - ww / 2;
    h('rect', { x: wx - 7, y: at(.07) - 7, width: ww + 14, height: bh * .2 + 14, fill: 'var(--wood-2)' }, g);
    h('rect', { x: wx, y: at(.07), width: ww, height: bh * .2, fill: 'var(--sky-top)' }, g);
    h('rect', { x: wx + ww / 2 - 3, y: at(.07), width: 6, height: bh * .2, fill: 'var(--wood-2)' }, g);
    h('rect', { x, y: at(.62), width: w, height: bh * .38, fill: 'var(--wood-1)' }, g);
    h('rect', { x, y: at(.62) - 10, width: w, height: 10, fill: 'var(--wood-2)' }, g);
    return;
  }
  if (place === 'seaside') {
    const id = `${ctx.uid}-seasky`; const lg = h('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 }, h('defs', {}, g));
    h('stop', { offset: '0', 'stop-color': 'color-mix(in oklab,var(--hue-blue) 40%,var(--bg))' }, lg);
    h('stop', { offset: '1', 'stop-color': 'color-mix(in oklab,var(--hue-blue) 12%,var(--bg))' }, lg);
    h('rect', { x, y, width: w, height: bh * .5, fill: `url(#${id})` }, g);
    h('rect', { x, y: at(.48), width: w, height: bh * .24, fill: 'var(--sea-2)' }, g);
    h('rect', { x, y: at(.48), width: w, height: bh * .03, fill: 'var(--sea-3)' }, g);
    h('rect', { x, y: at(.68), width: w, height: bh * .03, fill: 'var(--sea-hi)' }, g);
    ground(g, x, x1, at(.7), y + bh, 'var(--sand)');
    return;
  }
  // the kit sky starts at the slide top; keep it inside this panel so nothing above reads as over it
  const sk = sky(g, ctx, at(.62), x, x1); sk.setAttribute('y', y); sk.setAttribute('height', at(.62) - y);
  if (place === 'high_street') {
    ground(g, x, x1, at(.62), at(.76), 'var(--stone)');
    ground(g, x, x1, at(.76), y + bh, 'var(--road)');
    return;
  }
  hills(g, { x0: x, x1, yBase: at(.62), amp: bh * .2, fill: 'var(--hill-far)', seed: 3, bumps: 3 });
  hills(g, { x0: x, x1, yBase: at(.7), amp: bh * .12, fill: 'var(--hill-mid)', seed: 8, bumps: 2 });
  ground(g, x, x1, at(.68), y + bh, 'var(--hill-near)');
}

/* ------------------------------------------------------------------ town plan */
function sector(cx, cy, r0, r1, a0, a1) {
  const pt = (r, a) => `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
  if (a1 - a0 > 2 * Math.PI - 1e-6) { // a whole ring or disc
    const outer = `M${pt(r1, 0)} A${r1} ${r1} 0 1 1 ${pt(r1, Math.PI)} A${r1} ${r1} 0 1 1 ${pt(r1, 0)} Z`;
    return r0 > 0 ? outer + ` M${pt(r0, 0)} A${r0} ${r0} 0 1 0 ${pt(r0, Math.PI)} A${r0} ${r0} 0 1 0 ${pt(r0, 0)} Z` : outer;
  }
  const big = a1 - a0 > Math.PI ? 1 : 0;
  if (r0 <= 0) return `M${cx} ${cy} L${pt(r1, a0)} A${r1} ${r1} 0 ${big} 1 ${pt(r1, a1)} Z`;
  return `M${pt(r0, a0)} L${pt(r1, a0)} A${r1} ${r1} 0 ${big} 1 ${pt(r1, a1)} L${pt(r0, a1)} A${r0} ${r0} 0 ${big} 0 ${pt(r0, a0)} Z`;
}

function renderPlan(root, P, ctx, M) {
  const b = ctx.b, bi = k => b[k] ?? 0; const n = M.n, pr = M.periods, era = ERA(n);
  const top = 140, Rmax = 236, cx = GRID.left + 290, cy = top + Rmax + 6;
  const tot = M.zones.reduce((s, z) => s + z.sz, 0) || 1;
  let cum = 0; const R = [0];
  for (let j = 0; j < n; j++) { cum += M.zones.filter(z => z.w === j).reduce((s, z) => s + z.sz, 0); R.push(Rmax * Math.sqrt(cum / tot)); }
  const rings = h('g', {}, root);
  for (let j = 0; j < n; j++) {
    const zs = M.zones.filter(z => z.w === j); const sum = zs.reduce((s, z) => s + z.sz, 0) || 1;
    const g = h('g', { s: bi(`p:${j}`), cls: 'pop', c: ctx.rc(`p:${j}`, null, 'soft') }, rings);
    let a = -Math.PI / 2 + j * .5;
    // the ring's era is written on the ring itself, at the top, on a paper ground
    const rm = j ? (R[j] + R[j + 1]) / 2 : R[1] * .5, ly = cy - rm;
    const lab = { w: measure(g, pr[j].year, 'ts-small', { cls: 'strong' }) + 20, x: cx, y: ly };
    for (const z of zs) {
      const da = 2 * Math.PI * z.sz / sum;
      h('path', { d: sector(cx, cy, R[j], R[j + 1], a, a + da), fill: USE_COL[z.use], stroke: 'var(--bg)', 'stroke-width': 'var(--sw-struct)', 'fill-rule': 'evenodd' }, g);
      // what was built, drawn as little plan shapes along the ring (houses, mills, trees)
      const t = R[j + 1] - R[j], gr = j ? rm : R[1] * .58, sz = Math.min(t * .5, 34);
      if (sz >= 18) {
        const cnt = clamp(Math.floor(gr * da / (sz * 2.1)), 1, 5);
        for (let q = 0; q < cnt; q++) {
          const an = a + da * (q + .5) / cnt, px = cx + gr * Math.cos(an), py = cy + gr * Math.sin(an);
          if (Math.abs(px - lab.x) < lab.w / 2 + sz * .6 && Math.abs(py - lab.y) < 18 + sz * .6) continue;
          glyph(g, z.use, px, py, sz / 30);
        }
      }
      a += da;
    }
    h('circle', { cx, cy, r: R[j + 1], fill: 'none', stroke: `var(--era-${era[j]})`, 'stroke-width': 'calc(var(--sw-struct) * 2)' }, g);
    h('rect', { x: cx - lab.w / 2, y: ly - 18, width: lab.w, height: 36, rx: 'var(--r-mark)', fill: 'var(--paper)' }, g);
    computed(T(g, cx, ly + 8, pr[j].year, 'ts-small strong', { 'text-anchor': 'middle', fill: `var(--era-${era[j]}-text)` }), `periods.${j}.year`);
  }
  /* the list: what was built by each time, in the colours of its use. Long names wrap while the
     list fits above the foot rule, then go to one line each; the use column has a fixed cap. */
  const x0 = 630, xR = GRID.right;
  const useOf = z => txt(P, `label:use:${z.use}`, USE_LABELS[USES.indexOf(z.use)]);
  const drawList = maxL => {
    const list = h('g', {}, root);
    const useW = Math.min(USE_W, Math.max(...M.zones.map(z => measure(list, useOf(z), 'ts-small'))));
    let y = top + 20;
    for (let j = 0; j < n; j++) {
      const p = pr[j]; const g = h('g', { s: bi(`p:${j}`), cls: 'rise', c: ctx.rc(`p:${j}`, null, 'soft') }, list);
      h('circle', { cx: x0 + 10, cy: y - 9, r: 10, fill: 'none', stroke: `var(--era-${era[j]})`, 'stroke-width': 'calc(var(--sw-struct) * 2)' }, g);
      const yt = editable(T(g, x0 + 32, y, p.year, 'ts-date', { fill: `var(--era-${era[j]}-text)` }), `periods.${j}.year`);
      const nb = p.name ? textBlock(g, x0 + 44 + yt.getComputedTextLength(), y, p.name, { cls: 'ts-small', maxW: xR - x0 - 60 - yt.getComputedTextLength(), maxLines: maxL, lh: 28, a: { fill: 'var(--ink)' }, edit: `periods.${j}.name` }) : null;
      y += 36 + (nb ? nb.lines.length - 1 : 0) * 28;
      for (const z of M.zones.filter(z => z.w === j)) {
        h('rect', { x: x0 + 32, y: y - 20, width: 24, height: 24, rx: 'var(--r-mark)', fill: USE_COL[z.use] }, g);
        const tb = textBlock(g, x0 + 68, y, z.name, { cls: 'ts-small', maxW: xR - x0 - 68 - useW - 20, maxLines: maxL, lh: 28, a: { fill: 'var(--ink)' }, edit: `landUse.${z.i}.name` });
        const ub = textBlock(g, xR, y, useOf(z), { cls: 'ts-small', maxW: useW, maxLines: maxL, lh: 28, anchor: 'end', a: { fill: 'var(--ink-2)' }, edit: `text.label:use:${z.use}` });
        y += 31 + (Math.max(tb.lines.length, ub.lines.length) - 1) * 28;
      }
      y += 8;
    }
    return { list, end: y - 8 };
  };
  let LS = drawList(2);
  if (LS.end > GRID.bottom) { LS.list.remove(); LS = drawList(1); }
  if (LS.end > GRID.bottom) ctx.warn(`The town plan list runs to y ${LS.end | 0}: use fewer places.`);
  return {};
}

/* a plan shape for each land use, drawn in a darker shade of its colour, about 30 units across */
function glyph(p, use, x, y, k) {
  const g = h('g', { transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${k.toFixed(3)})`, fill: `color-mix(in oklab,${USE_COL[use]} 45%,var(--ink))` }, p);
  const D = {
    housing: 'M-12 14 V-1 L0 -12 L12 -1 V14 Z',
    shops: 'M-14 -12 H14 L15 -3 H-15 Z M-12 -1 H12 V14 H-12 Z',
    industry: 'M-15 14 V-2 L-8 -8 V-2 L-1 -8 V-2 L6 -8 V-15 H12 V14 Z',
    parks: 'M-2 4 H2 V14 H-2 Z M0 -14 A10 10 0 1 1 -0.1 -14 Z',
    services: 'M-15 -1 L0 -12 L15 -1 Z M-12 1 H12 V14 H-12 Z',
    roads: 'M-15 -5 H15 V5 H-15 Z',
  };
  if (use === 'parks') { h('circle', { cx: 0, cy: -4, r: 10 }, g); h('rect', { x: -2, y: 4, width: 4, height: 10 }, g); }
  else h('path', { d: D[use] || D.housing }, g);
  return g;
}
