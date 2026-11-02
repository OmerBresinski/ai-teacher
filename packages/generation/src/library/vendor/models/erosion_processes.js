// Erosion and transport processes (KS3, KS4 geography): four small pictures in a two by two grid, one
// process each, named one build at a time with what it does. Erosion: hydraulic action (water forces
// air into cracks), abrasion (the load scrapes the bed and banks, or a cliff), attrition (rocks in
// the load knock into each other and become smaller and rounder) and solution (water dissolves
// rocks such as limestone and chalk). Transport: traction (boulders rolled along the bed), saltation
// (pebbles bounced along it), suspension (fine sediment carried in the water) and solution (minerals
// carried dissolved). Each picture draws its own mechanism, so a name is never drawn over another
// process's picture, and validate() refuses a reworded line that describes the wrong process. Each
// name first shows as a letter, so a question slide asks pupils to name the processes.
import {
  h, T, GRID, textBlock, arrow,
  txt, TEXT_PARAM_FOR, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';

export const meta = {
  id: 'erosion_processes', name: 'Erosion and transport processes', kind: 'scene', version: 1,
  subjects: ['Geography'],
  years: ['KS3', 'KS4'],
  teaches: 'The four ways a river or the sea erodes (hydraulic action, abrasion, attrition, solution) or the four ways a river transports its load (traction, saltation, suspension, solution), each as a small labelled picture.',
};

const EROSION = ['hydraulic', 'abrasion', 'attrition', 'solution'];
const TRANSPORT = ['traction', 'saltation', 'suspension', 'dissolved'];

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Erosion and transport processes',
  properties: {
    title: TITLE_PARAM('How rivers erode'),
    view: { type: 'string', title: 'What to show', enum: ['erosion', 'transport'], 'x-labels': ['How water erodes (four processes)', 'How a river carries its load (four processes)'], default: 'erosion' },
    setting: { type: 'string', title: 'Where', enum: ['river', 'coast'], 'x-labels': ['A river (bed and banks)', 'The coast (cliffs and waves)'], default: 'river',
      description: 'Erosion only: a river wears its bed and banks; at the coast waves wear the cliff. Transport is drawn in a river.' },
    erosion: { type: 'array', title: 'Erosion processes, in teaching order', minItems: 1, maxItems: 4, default: EROSION,
      items: { type: 'string', enum: EROSION, 'x-labels': ['Hydraulic action', 'Abrasion', 'Attrition', 'Solution'] } },
    transport: { type: 'array', title: 'Transport processes, in teaching order', minItems: 1, maxItems: 4, default: TRANSPORT,
      items: { type: 'string', enum: TRANSPORT, 'x-labels': ['Traction', 'Saltation', 'Suspension', 'Solution'] } },
    explain: { type: 'boolean', title: 'Say what each process does', default: true,
      description: 'Off: the names only (for a slide where pupils explain each one).' },
    // a name (40 letters) and its line (60): a teacher may reword them, never into another process
    text: TEXT_PARAM_FOR(Object.fromEntries([...EROSION, ...TRANSPORT].flatMap(id => [[`name:${id}`, 'label'], [`line:${id}`, 'phrase']]))),
  },
};

export const presets = [
  { id: 'ks3-river-erosion', name: 'KS3: how a river erodes', params: { title: 'Four ways a river erodes', view: 'erosion', setting: 'river' } },
  { id: 'ks3-coast-erosion', name: 'KS3: how the sea erodes a cliff', params: { title: 'How waves erode the coast', view: 'erosion', setting: 'coast' } },
  { id: 'ks3-transport', name: 'KS3: how a river carries its load', params: { title: 'How a river transports its load', view: 'transport' } },
];

/* ------------------------------------------------------------------ words */
const NAMES = { hydraulic: 'Hydraulic action', abrasion: 'Abrasion', attrition: 'Attrition', solution: 'Solution', traction: 'Traction', saltation: 'Saltation', suspension: 'Suspension', dissolved: 'Solution' };
const LINES = {
  river: {
    hydraulic: 'Water forces air into cracks, breaking the rock apart',
    abrasion: 'Rocks carried by the river scrape the bed and banks',
    attrition: 'Rocks knock into each other and become smaller and rounder',
    solution: 'Water dissolves some rocks, such as limestone and chalk',
  },
  coast: {
    hydraulic: 'Waves force air into cracks, breaking the rock apart',
    abrasion: 'Waves throw rocks at the cliff, wearing it away',
    attrition: 'Rocks knock into each other and become smaller and rounder',
    solution: 'Seawater dissolves some rocks, such as limestone and chalk',
  },
  transport: {
    traction: 'Large boulders roll along the river bed',
    saltation: 'Pebbles bounce along the river bed',
    suspension: 'Fine sand and silt are carried along in the water',
    dissolved: 'Minerals are dissolved in the water and carried along',
  },
};
const nameOf = (P, id) => txt(P, `label:name:${id}`, NAMES[id]);
const lineOf = (P, id) => txt(P, `label:line:${id}`, LINES[P.view === 'transport' ? 'transport' : P.setting][id]);

// A reworded name keeps its process's name; a reworded line must not describe another process.
const MUST_NAME = {
  hydraulic: /hydraulic/i, abrasion: /abrasion|corrasion/i, attrition: /attrition/i, solution: /solution|corrosion/i,
  traction: /traction/i, saltation: /saltation/i, suspension: /suspension/i, dissolved: /solution/i,
};
const WRONG_LINE = {
  hydraulic: [/\b(rocks?|pebbles?|stones?|load|sediment)\b.*\b(scrap|hit|thrown|throw|carried)|dissolv/i, 'Hydraulic action is the force of the water itself (air forced into cracks); rocks scraping or hitting the bank is abrasion, and dissolving is solution.'],
  abrasion: [/each other|one another|collid|dissolv|air (is )?(forced|squeezed|compressed)/i, 'Abrasion is the load scraping or hitting the bed, banks or cliff; rocks hitting each other is attrition, air forced into cracks is hydraulic action, and dissolving is solution.'],
  attrition: [/\b(bed|banks?|cliffs?)\b|dissolv/i, 'Attrition is rocks in the load knocking into each other; wearing the bed, banks or cliff is abrasion, and dissolving is solution.'],
  solution: [/scrap|knock|collid|crack/i, 'Solution is rock dissolving in the water (a chemical process), not rocks scraping, knocking or cracking.'],
  traction: [/bounc|float|suspend|dissolv/i, 'Traction is the largest load rolling along the bed; bouncing is saltation, carried in the water is suspension, and dissolved is solution.'],
  saltation: [/\brol+\w*|float|suspend|dissolv/i, 'Saltation is pebbles bouncing along the bed; rolling is traction, carried in the water is suspension, and dissolved is solution.'],
  suspension: [/dissolv|bounc|\brol+\w*/i, 'Suspension is fine sediment carried along in the water; dissolved minerals are solution, bouncing is saltation, rolling is traction.'],
  dissolved: [/bounc|\brol+\w*|float|suspend/i, 'In solution the load is dissolved, so it cannot be seen; floating sediment is suspension.'],
};
const MUST_LINE = { solution: [/dissolv|chemical|acid/i, 'Solution is rock dissolving in the water: the line must say so.'], dissolved: [/dissolv/i, 'Transport in solution means the minerals are dissolved: the line must say so.'] };

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P);
  if (R.length) return result(R);
  const list = P.view === 'transport' ? P.transport : P.erosion;
  const field = P.view === 'transport' ? 'transport' : 'erosion';
  list.forEach((id, i) => { if (list.indexOf(id) !== i) R.push({ path: `${field}.${i}`, reason: `${NAMES[id]} is in the list twice. Each process appears once.` }); });
  for (const id of [...EROSION, ...TRANSPORT]) {
    const n = P.text && P.text[`label:name:${id}`];
    if (n != null && n !== '' && !MUST_NAME[id].test(n)) R.push({ path: `text.label:name:${id}`, reason: `The name “${n}” no longer names ${NAMES[id].toLowerCase()}. Keep that word in it.` });
    const l = P.text && P.text[`label:line:${id}`];
    if (l == null || l === '') continue;
    if (WRONG_LINE[id][0].test(l)) R.push({ path: `text.label:line:${id}`, reason: WRONG_LINE[id][1] });
    else if (MUST_LINE[id] && !MUST_LINE[id][0].test(l)) R.push({ path: `text.label:line:${id}`, reason: MUST_LINE[id][1] });
  }
  return result(R);
}

/* ------------------------------------------------------------------ builds */
const CAPTION = {
  hydraulic: s => `Hydraulic action: the force of the water. ${s === 'coast' ? 'Waves' : 'Fast water'} squeezes air into cracks; the pressure breaks the rock apart.`,
  abrasion: s => s === 'coast' ? 'Abrasion: waves hurl rocks and pebbles at the cliff, which chip and wear it away.' : 'Abrasion: rocks and pebbles carried by the river scrape and wear away the bed and banks, like sandpaper.',
  attrition: () => 'Attrition: rocks in the water knock into each other, so they break into smaller, rounder pieces.',
  solution: () => 'Solution: the water slowly dissolves rocks such as limestone and chalk, carrying them away unseen.',
  traction: () => 'Traction: the biggest boulders are rolled along the bed, mostly when the river is in flood.',
  saltation: () => 'Saltation: pebbles and coarse sand are bounced along the bed in a series of hops.',
  suspension: () => 'Suspension: fine sand and silt are carried along in the water; this is what makes a river look brown.',
  dissolved: () => 'Solution: minerals dissolved in the water are carried along, though you cannot see them.',
};
const NOTE = {
  hydraulic: 'The pressure of the water and the air trapped in cracks loosens and breaks off pieces of rock. Strongest where the water is fast.',
  abrasion: 'Abrasion does most of the erosion in a river. The more load and the faster the water, the more abrasion.',
  attrition: 'Attrition wears down the load, not the bed or banks. That is why stones further downstream are smaller and rounder.',
  solution: 'Solution is a chemical process: slightly acidic water reacts with rocks such as limestone and chalk. It is sometimes called corrosion.',
  traction: 'Only the fastest water (floods) can roll the largest boulders.',
  saltation: 'Saltation needs less energy than traction but more than suspension.',
  suspension: 'Suspension carries most of a river\'s load, and the faster the river, the more it carries.',
  dissolved: 'Dissolved load comes from rocks such as limestone and chalk; it travels whatever the speed of the river.',
};
function plan(P) {
  const tr = P.view === 'transport';
  const list = tr ? P.transport : P.erosion;
  const S = [{ key: 'picture', caption: tr ? 'A river carries its load in four ways, depending on the size of the pieces.' : P.setting === 'coast' ? 'Waves wear away the coast in four ways.' : 'A river wears away its bed and banks in four ways.',
    note: 'Ask pupils to describe what each picture shows before the names are given.' }];
  for (const id of list) S.push({ key: id, caption: CAPTION[id](P.setting), note: NOTE[id] });
  return { S, list, tr, summary: tr ? 'A river transports its load by traction, saltation, suspension and solution.' : 'Water erodes by hydraulic action, abrasion, attrition and solution.' };
}
export function builds(P) { const p = plan(P); return { steps: p.S.map(({ key, caption }) => ({ key, caption })), summary: { caption: p.summary } }; }
export function notes(P) {
  const p = plan(P);
  return { steps: p.S.map(s => s.note), summary: p.tr ? 'Ask: which process carries the biggest pieces, and which carries pieces you cannot see?' : 'Ask: which process wears away the load rather than the bed or banks? (attrition)' };
}

/* ------------------------------------------------------------------ pictures */
// Each picture fills a box (x, y, w 250, h 196): water on the left or above, rock on the right or below.
const COLS = '--ep-water:color-mix(in oklab, var(--hue-blue) 26%, var(--paper));--ep-flow:var(--hue-blue);--ep-rock:color-mix(in oklab, var(--hue-brown) 45%, var(--paper));' +
  '--ep-rock-edge:color-mix(in oklab, var(--hue-brown) 70%, var(--ink));--ep-stone:color-mix(in oklab, var(--hue-grey) 55%, var(--paper));--ep-stone-edge:color-mix(in oklab, var(--hue-grey) 80%, var(--ink));' +
  '--ep-air:var(--paper);--ep-mark:var(--ink)';
const PW = 250, PH = 196;
const stone = (p, cx, cy, r, sides = 7, seed = 0) => {
  const pts = [];
  for (let i = 0; i < sides; i++) { const a = (i / sides) * Math.PI * 2 + seed; const rr = r * (0.82 + 0.18 * Math.abs(Math.sin(i * 1.7 + seed))); pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`); }
  return h('polygon', { points: pts.join(' '), fill: 'var(--ep-stone)', stroke: 'var(--ep-stone-edge)', 'stroke-width': 'var(--sw-rule)', 'stroke-linejoin': 'round' }, p);
};
const pebble = (p, cx, cy, rx, ry) => h('ellipse', { cx, cy, rx, ry, fill: 'var(--ep-stone)', stroke: 'var(--ep-stone-edge)', 'stroke-width': 'var(--sw-rule)' }, p);
const flowArrow = (ctx, p, x1, y, x2, k) => arrow(ctx, p, `M${x1} ${y} L ${x2} ${y}`, x2, y, 0, 'var(--ep-flow)', 'var(--sw-arrow)', { draw: k });
const ground = (p, x, y, w, hh) => h('rect', { x, y, width: w, height: hh, fill: 'var(--ep-rock)', stroke: 'var(--ep-rock-edge)', 'stroke-width': 'var(--sw-rule)' }, p);
const burst = (p, cx, cy, r) => { for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3; h('line', { x1: cx + Math.cos(a) * r * 0.55, y1: cy + Math.sin(a) * r * 0.55, x2: cx + Math.cos(a) * r, y2: cy + Math.sin(a) * r, stroke: 'var(--ep-mark)', 'stroke-width': 'var(--sw-rule)', 'stroke-linecap': 'round' }, p); } };

const PICTURE = {
  // water pushing into cracks in a bank or cliff (rock on the right)
  hydraulic(ctx, p, x, y, k) {
    const rx = x + 150;
    h('path', { d: `M${rx} ${y} L ${x + PW} ${y} L ${x + PW} ${y + PH} L ${rx - 10} ${y + PH} Z`, fill: 'var(--ep-rock)', stroke: 'var(--ep-rock-edge)', 'stroke-width': 'var(--sw-rule)' }, p);
    for (const cy of [y + 52, y + 132]) {
      h('path', { d: `M${rx - 2} ${cy - 9} L ${rx + 62} ${cy - 2} L ${rx + 70} ${cy + 1} L ${rx + 62} ${cy + 3} L ${rx - 2} ${cy + 10} Z`, fill: 'var(--ep-air)', stroke: 'var(--ep-rock-edge)', 'stroke-width': 'var(--sw-rule)' }, p);
      for (const dx of [14, 30]) h('circle', { cx: rx + dx, cy, r: 3.5, fill: 'none', stroke: 'var(--ep-flow)', 'stroke-width': 'var(--sw-rule)' }, p);
      arrow(ctx, p, `M${x + 22} ${cy} L ${rx - 6} ${cy}`, rx - 6, cy, 0, 'var(--ep-flow)', 'var(--sw-arrow)', { draw: k });
    }
  },
  // the load scraping the bed (rock below), scratches where it touches
  abrasion(ctx, p, x, y, k, coast) {
    if (coast) {
      const rx = x + 170;
      ground(p, rx, y, PW - 170, PH);
      for (const [cx, cy, r] of [[x + 70, y + 60, 14], [x + 110, y + 120, 11], [x + 60, y + 150, 9]]) {
        stone(p, cx, cy, r, 7, cx); arrow(ctx, p, `M${cx + r + 6} ${cy} L ${rx - 6} ${cy + (cy > y + 100 ? -10 : 10)}`, rx - 6, cy + (cy > y + 100 ? -10 : 10), Math.atan2(cy > y + 100 ? -10 : 10, rx - cx - r - 12), 'var(--ep-flow)', 'var(--sw-arrow)', { draw: k });
        burst(p, rx + 4, cy + (cy > y + 100 ? -10 : 10), 12);
      }
      return;
    }
    const gy = y + 140;
    ground(p, x, gy, PW, PH - 140);
    flowArrow(ctx, p, x + 20, y + 40, x + PW - 20, k);
    for (const [cx, r] of [[x + 60, 14], [x + 130, 11], [x + 196, 15]]) {
      // a scraped groove in the bed behind each stone, and lines showing it is dragged along
      h('path', { d: `M${cx - r - 30} ${gy} Q ${cx - r - 12} ${gy + 9} ${cx} ${gy}`, fill: 'var(--ep-water)', stroke: 'var(--ep-rock-edge)', 'stroke-width': 'var(--sw-rule)' }, p);
      stone(p, cx, gy - r + 4, r, 7, cx);
      for (const dy of [-r * 0.9, -r * 0.3]) h('line', { x1: cx - r - 26, y1: gy + dy, x2: cx - r - 8, y2: gy + dy, stroke: 'var(--ep-mark)', 'stroke-width': 'var(--sw-rule)', 'stroke-linecap': 'round' }, p);
    }
  },
  // two angular rocks meeting mid-water, then smaller, rounder pieces
  attrition(ctx, p, x, y, k) {
    flowArrow(ctx, p, x + 20, y + 30, x + PW - 20, k);
    stone(p, x + 52, y + 112, 22, 5, 0.4); stone(p, x + 98, y + 104, 18, 5, 1.1);
    burst(p, x + 76, y + 108, 20);
    arrow(ctx, p, `M${x + 128} ${y + 110} L ${x + 168} ${y + 110}`, x + 168, y + 110, 0, 'var(--ep-mark)', 'var(--sw-rule)', { draw: k, k: 0.7 });
    pebble(p, x + 194, y + 92, 12, 9); pebble(p, x + 222, y + 116, 10, 8); pebble(p, x + 196, y + 132, 9, 7);
  },
  // limestone below, its particles leaving into the water as dissolved dots
  solution(ctx, p, x, y, k) {
    // limestone with joints, its top pitted where it is dissolving
    const gy = y + 128;
    let d = `M${x} ${y + PH} L ${x} ${gy}`;
    for (let px = x; px < x + PW; px += 50) d += ` L ${px + 14} ${gy} Q ${px + 25} ${gy + 14} ${px + 36} ${gy} L ${px + 50} ${gy}`;
    h('path', { d: `${d} L ${x + PW} ${y + PH} Z`, fill: 'var(--ep-rock)', stroke: 'var(--ep-rock-edge)', 'stroke-width': 'var(--sw-rule)' }, p);
    for (let i = 0; i < 4; i++) h('line', { x1: x + 50 + i * 50, y1: gy, x2: x + 50 + i * 50, y2: y + PH, stroke: 'var(--ep-rock-edge)', 'stroke-width': 'var(--sw-rule)' }, p);
    flowArrow(ctx, p, x + 20, y + 32, x + PW - 20, k);
    const dots = [[40, 112], [70, 96], [100, 116], [128, 86], [150, 108], [182, 92], [210, 112], [86, 70], [168, 64], [60, 60], [200, 70]];
    for (const [dx, dy] of dots) h('circle', { cx: x + dx, cy: y + dy, r: 3.5, fill: 'var(--ep-rock-edge)', opacity: dy > 90 ? 0.8 : 0.45 }, p);
  },
  // a boulder rolled along the bed: a curved arrow round it
  traction(ctx, p, x, y, k) {
    const gy = y + 150; ground(p, x, gy, PW, PH - 150);
    flowArrow(ctx, p, x + 20, y + 32, x + PW - 20, k);
    stone(p, x + 110, gy - 36, 36, 8, 0.2);
    arrow(ctx, p, `M${x + 70} ${gy - 66} Q ${x + 112} ${gy - 118} ${x + 160} ${gy - 62}`, x + 160, gy - 62, Math.atan2(56, 48), 'var(--ep-mark)', 'var(--sw-rule)', { draw: k, k: 0.7 });
  },
  // a pebble's path in hops along the bed
  saltation(ctx, p, x, y, k) {
    const gy = y + 150; ground(p, x, gy, PW, PH - 150);
    flowArrow(ctx, p, x + 20, y + 32, x + PW - 20, k);
    const hops = [[x + 24, x + 92], [x + 92, x + 160], [x + 160, x + 222]];
    hops.forEach(([a, z], i) => {
      const d = `M${a} ${gy - 8} Q ${(a + z) / 2} ${gy - 80} ${z} ${gy - 8}`;
      if (i < 2) h('path', { d, fill: 'none', stroke: 'var(--ep-mark)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '4 7' }, p);
      else arrow(ctx, p, d, z, gy - 8, 1.1, 'var(--ep-mark)', 'var(--sw-rule)', { draw: k, dash: '4 7', k: 0.7 });
    });
    pebble(p, x + 24, gy - 8, 9, 7); pebble(p, x + 228, gy - 8, 9, 7);
  },
  // fine grains spread through the water
  suspension(ctx, p, x, y, k) {
    const gy = y + 160; ground(p, x, gy, PW, PH - 160);
    flowArrow(ctx, p, x + 20, y + 32, x + PW - 20, k);
    const grains = [[30, 70], [62, 96], [90, 64], [118, 120], [146, 82], [176, 110], [204, 72], [226, 128], [48, 134], [100, 98], [160, 140], [214, 100], [76, 120], [132, 60]];
    for (const [dx, dy] of grains) h('circle', { cx: x + dx, cy: y + dy, r: 5, fill: 'var(--ep-rock)', stroke: 'var(--ep-rock-edge)', 'stroke-width': 1.5 }, p);
  },
  // nothing to see: faint dots, carried along
  dissolved(ctx, p, x, y, k) {
    const gy = y + 160; ground(p, x, gy, PW, PH - 160);
    flowArrow(ctx, p, x + 20, y + 32, x + PW - 20, k);
    const dots = [[34, 76], [66, 104], [96, 70], [128, 118], [150, 86], [184, 112], [210, 74], [228, 132], [52, 136], [106, 140], [170, 140]];
    for (const [dx, dy] of dots) h('circle', { cx: x + dx, cy: y + dy, r: 3, fill: 'var(--ep-rock-edge)', opacity: 0.4 }, p);
  },
};

/* ------------------------------------------------------------------ render */
// Two by two: each cell holds its picture on the left and its name (and line) on the right. The name
// shows as a letter until its build, so every picture can open the slide without giving the answer.
export function render(root, P, ctx) {
  const { list, tr } = plan(P); const b = ctx.b;
  const g0 = h('g', { style: COLS }, root);
  const tb = (p, x, y, s, o) => {
    const r = textBlock(p, x, y, s, o); const last = r.lines[r.lines.length - 1] || '';
    if (last.endsWith('…') && !String(s).trim().endsWith('…')) ctx.warn(`“${String(s).slice(0, 40)}” is too long for its space, so it is cut short. Shorten it.`);
    return r;
  };
  const cw = (GRID.right - GRID.left - GRID.gap) / 2, ch = 236;
  list.forEach((id, i) => {
    const k = b[id];
    const cx = GRID.left + (i % 2) * (cw + GRID.gap), cy = GRID.top + 14 + Math.floor(i / 2) * (ch + GRID.gap);
    const px = cx, py = cy + (ch - PH) / 2;
    const pic = h('g', { s: b.picture, cls: 'pop', delay: i * 150 }, g0);
    // the picture is clipped to its card, so rock and water keep the card's round corners
    const clip = `ep-${ctx.uid || 0}-${i}`;
    h('rect', { x: px, y: py, width: PW, height: PH, rx: 16, fill: 'var(--ep-water)' }, h('clipPath', { id: clip }, pic));
    const inner = h('g', { 'clip-path': `url(#${clip})` }, pic);
    h('rect', { x: px, y: py, width: PW, height: PH, fill: 'var(--ep-water)' }, inner);
    PICTURE[id](ctx, inner, px, py, b.picture, !tr && P.setting === 'coast');
    h('rect', { x: px, y: py, width: PW, height: PH, rx: 16, fill: 'none', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)' }, pic);
    const tx = px + PW + 26, maxW = cw - PW - 26;
    // the letter, until the name is given
    const lg = h('g', { s: b.picture, hide: k }, g0);
    h('circle', { cx: tx + 20, cy: py + 34, r: 20, fill: 'var(--paper)', stroke: 'var(--ink)', 'stroke-width': 'var(--sw-rule)' }, lg);
    T(lg, tx + 20, py + 43, String.fromCharCode(65 + i), 'ts-label', { 'text-anchor': 'middle', fill: 'var(--ink)', cls: 'strong' });
    const ng = h('g', { s: k, cls: 'rise' }, g0);
    const nm = tb(ng, tx, py + 44, nameOf(P, id), { cls: 'ts-label', maxW, maxLines: 1, lh: 32, a: { fill: 'var(--ink)', cls: 'strong' }, edit: `text.label:name:${id}` });
    if (P.explain) tb(ng, tx, py + 44 + nm.h + 12, lineOf(P, id), { cls: 'ts-label', maxW, maxLines: 4, lh: 32, a: { fill: 'var(--ink-2)' }, edit: `text.label:line:${id}` });
  });
  return {};
}
