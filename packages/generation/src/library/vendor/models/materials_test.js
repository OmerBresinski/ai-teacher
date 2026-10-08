// Materials test: everyday objects on a bench, one property tested on each in turn (water drips,
// the magnet pulls, it floats or sinks, light goes through, it bends, the bulb lights, the butter
// melts), then the objects slide into two groups and the property is named.
// Results are never typed: they come from the material, so the science is always true.
import { MATERIALS as MAT_FACTS } from '../kit/facts.js'; // libdata
import {
  h, T, clamp, eIO, eOut, GRID, headD,
  textBlock, editable, computed, txt, TEXT_PARAM_FOR, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { apparatus, wire, forceArrow } from '../kit/batch-E.js';

export const meta = {
  id: 'materials_test', name: 'Testing materials', kind: 'scene', version: 1,
  subjects: ['Science'],
  years: ['Reception', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5'],
  teaches: 'How to test a property of everyday materials, sort them by the result, and name the property.',
};

/* ------------------------------------------------------------------ the science */
const TESTS = ['waterproof', 'magnetic', 'floats', 'transparent', 'flexible', 'conducts', 'insulates'];
const TEST_LABELS = ['Is it waterproof?', 'Is it magnetic?', 'Does it float or sink?', 'Is it transparent?', 'Is it flexible?', 'Does it conduct electricity?', 'Is it a thermal insulator?'];

// One row per material: fill (tokens only), and the result of every test. null = no honest
// yes/no for a typical classroom object, with the teacher-worded reason in why[test].
// rho = density compared with water, used for how deep a floating block sits.
const MATS = {
  wood: { label: 'wood', fill: 'color-mix(in oklab,var(--hue-brown) 55%,var(--bg))', edge: 'var(--wood-line)', rho: .6,
    r: { waterproof: null, magnetic: false, floats: true, transparent: false, flexible: false, conducts: false, insulates: true },
    why: { waterproof: 'Bare wood slowly soaks up water, so a drip test does not give a clear yes or no. Choose a different material for this test.' } },
  plastic: { label: 'plastic', fill: 'var(--hue-green)',
    r: { waterproof: true, magnetic: false, floats: null, transparent: false, flexible: null, conducts: false, insulates: true },
    why: { floats: 'Some plastics float and some sink, so “plastic” has no single answer. Choose a material that always floats or always sinks.',
      flexible: 'Thin plastic bends but thick plastic does not, so “plastic” has no single answer. Choose a material that is clearly flexible or rigid.' } },
  'clear-plastic': { label: 'clear plastic', fill: 'var(--air)', edge: 'var(--glass-edge)',
    r: { waterproof: true, magnetic: false, floats: null, transparent: true, flexible: null, conducts: false, insulates: true },
    why: { floats: 'Some plastics float and some sink, so “plastic” has no single answer. Choose a material that always floats or always sinks.',
      flexible: 'Thin plastic bends but thick plastic does not, so “plastic” has no single answer. Choose a material that is clearly flexible or rigid.' } },
  glass: { label: 'glass', fill: 'var(--air)', edge: 'var(--glass-edge)', rho: 2.5,
    r: { waterproof: true, magnetic: false, floats: false, transparent: true, flexible: false, conducts: false, insulates: null },
    why: { insulates: 'Glass carries heat better than wood or plastic but far worse than metal, so it does not sort cleanly. Leave it out of this test.' } },
  steel: { label: 'steel', fill: 'var(--metal)', rho: 7.8,
    r: { waterproof: true, magnetic: true, floats: false, transparent: false, flexible: false, conducts: true, insulates: false } },
  iron: { label: 'iron', fill: 'var(--metal-shade)', rho: 7.9,
    r: { waterproof: true, magnetic: true, floats: false, transparent: false, flexible: false, conducts: true, insulates: false } },
  aluminium: { label: 'aluminium', fill: 'var(--metal-in)', rho: 2.7,
    r: { waterproof: true, magnetic: false, floats: false, transparent: false, flexible: false, conducts: true, insulates: false } },
  copper: { label: 'copper', fill: 'color-mix(in oklab,var(--hue-orange) 70%,var(--hue-brown))', rho: 8.9,
    r: { waterproof: true, magnetic: false, floats: false, transparent: false, flexible: null, conducts: true, insulates: false },
    why: { flexible: 'Copper wire bends easily but a copper pipe does not, so “copper” has no single answer. Choose a material that is clearly flexible or rigid.' } },
  foil: { label: 'aluminium foil', fill: 'var(--metal-in)',
    r: { waterproof: true, magnetic: false, floats: null, transparent: false, flexible: true, conducts: true, insulates: false },
    why: { floats: 'Foil floats as a flat sheet but sinks when squashed into a tight ball, so it has no single answer. Choose another material.' } },
  paper: { label: 'paper', fill: 'var(--paper)', edge: 'var(--ink-3)',
    r: { waterproof: false, magnetic: false, floats: null, transparent: null, flexible: true, conducts: false, insulates: true },
    why: { floats: 'Paper floats at first, then soaks up water and sinks, so it has no single answer. Choose another material.',
      transparent: 'Thin paper lets some light through (it is translucent), so it is neither transparent nor opaque. Choose another material.' } },
  cardboard: { label: 'cardboard', fill: 'color-mix(in oklab,var(--sand) 55%,var(--hue-brown))',
    r: { waterproof: false, magnetic: false, floats: null, transparent: false, flexible: null, conducts: false, insulates: true },
    why: { floats: 'Cardboard floats at first, then soaks up water and sinks, so it has no single answer. Choose another material.',
      flexible: 'Thin card bends but a thick box does not, so “cardboard” has no single answer. Choose a material that is clearly flexible or rigid.' } },
  fabric: { label: 'cotton fabric', fill: 'var(--cloth-1)',
    r: { waterproof: false, magnetic: false, floats: null, transparent: false, flexible: true, conducts: false, insulates: true },
    why: { floats: 'Fabric floats at first, then soaks up water and sinks, so it has no single answer. Choose another material.' } },
  wool: { label: 'wool', fill: 'var(--cloth-3)',
    r: { waterproof: false, magnetic: false, floats: null, transparent: false, flexible: true, conducts: false, insulates: true },
    why: { floats: 'Wool floats at first, then soaks up water and sinks, so it has no single answer. Choose another material.' } },
  rubber: { label: 'rubber', fill: 'color-mix(in oklab,var(--ink-2) 70%,var(--hue-brown))', rho: 1.2,
    r: { waterproof: true, magnetic: false, floats: false, transparent: false, flexible: true, conducts: false, insulates: true } },
  rock: { label: 'rock', fill: 'var(--stone)', rho: 2.6,
    r: { waterproof: null, magnetic: false, floats: false, transparent: false, flexible: false, conducts: false, insulates: null },
    why: { waterproof: 'Some rocks (like chalk and sandstone) soak up water and others (like granite) do not, so “rock” has no single answer. Use the rocks model to compare them.',
      insulates: 'Rock carries heat better than wood but far worse than metal, so it does not sort cleanly. Leave it out of this test.' } },
  cork: { label: 'cork', fill: 'color-mix(in oklab,var(--sand-shade) 70%,var(--hue-brown))', rho: .24,
    r: { waterproof: true, magnetic: false, floats: true, transparent: false, flexible: null, conducts: false, insulates: true },
    why: { flexible: 'Cork squashes and springs back but hardly bends, so it does not sort cleanly into flexible or rigid. Choose another material.' } },
  polystyrene: { label: 'polystyrene', fill: 'var(--snow)', edge: 'var(--ink-3)', rho: .1,
    r: { waterproof: true, magnetic: false, floats: true, transparent: false, flexible: false, conducts: false, insulates: true } },
  wax: { label: 'wax', fill: 'color-mix(in oklab,var(--hue-gold) 55%,var(--paper))', edge: 'var(--ink-3)', rho: .9,
    r: { waterproof: true, magnetic: false, floats: true, transparent: false, flexible: false, conducts: false, insulates: null },
    why: { insulates: 'Wax melts in hot water, so it cannot stand in the hot water test. Choose another material.' } },
  graphite: { label: 'pencil lead (graphite)', fill: 'var(--ink-2)', rho: 2.2,
    r: { waterproof: true, magnetic: false, floats: false, transparent: false, flexible: false, conducts: true, insulates: false } },
};
for (const [k, m] of Object.entries(MATS)) { const f = MAT_FACTS.rows[k]; if (!f) continue; if (f.densityKgM3 != null) m.rho = f.densityKgM3 / 1000; for (const t of ['magnetic', 'conducts', 'transparent', 'floats']) if (m.r[t] != null && f[t] != null) m.r[t] = f[t]; } // libdata: measured properties
const MAT_IDS = Object.keys(MATS);
const MAT_LABELS = MAT_IDS.map(k => MATS[k].label[0].toUpperCase() + MATS[k].label.slice(1));

// Per test: group words, the method, the result sentence and the property.
const TT = {
  waterproof: { yes: 'Waterproof', no: 'Not waterproof',
    setup: 'The test: drip water onto each material. Does any water get through?',
    res: ['the water soaks through, so it is not waterproof.', 'the water stays on top, so it is waterproof.'],
    def: 'Waterproof: water cannot get through it.',
    prop: 'Waterproof is a property of the material. We choose waterproof materials to keep things dry.',
    fair: 'Keep it fair: the same size drop, from the same height, onto every material.' },
  magnetic: { yes: 'Magnetic', no: 'Not magnetic',
    setup: 'The test: hold a magnet over each one. Does the magnet pull it?',
    res: ['the magnet does not pull it, so it is not magnetic.', 'the magnet pulls it, so it is magnetic.'],
    def: 'Magnetic: a magnet pulls it.',
    prop: 'Only some metals are magnetic: iron and steel are, aluminium and copper are not.',
    fair: 'Keep it fair: the same magnet, held at the same height over each object.' },
  floats: { yes: 'Floats', no: 'Sinks',
    setup: 'The test: put each one in water. Will it float or sink?',
    res: ['it sinks to the bottom.', 'it floats on the water.'],
    def: 'Things that float stay on top of the water.',
    prop: 'Whether a thing floats depends on its material, and on its shape.',
    fair: 'Lower each object gently onto the water; a throw can push a floater under for a moment.' },
  transparent: { yes: 'Transparent', no: 'Opaque',
    setup: 'The test: shine a torch at each one. Does the light go through?',
    res: ['the light is blocked, so it is opaque.', 'the light goes through, so it is transparent.'],
    def: 'Transparent: light goes through it, so we can see through it.',
    prop: 'Transparent materials let light through. Opaque materials block it and make a shadow.',
    fair: 'Keep it fair: the same torch, the same distance away, in a dim room.' },
  flexible: { yes: 'Flexible', no: 'Rigid',
    setup: 'The test: push down on the end of each one. Does it bend?',
    res: ['it stays straight, so it is rigid.', 'it bends, so it is flexible.'],
    def: 'Flexible: it bends without breaking.',
    prop: 'Flexible materials bend without breaking. Rigid materials keep their shape.',
    fair: 'Keep it fair: strips the same size, the same push on each.' },
  conducts: { yes: 'Conductors', no: 'Insulators',
    setup: 'The test: put each one into the gap in a circuit. Does the bulb light?',
    res: ['the bulb stays off, so it is an electrical insulator.', 'the bulb lights, so it conducts electricity.'],
    def: 'Electrical conductors let electricity flow through them.',
    prop: 'Conductors let electricity flow and the bulb lights. Insulators stop it.',
    fair: 'Check the circuit first: touch the two clips together and the bulb should light.' },
  insulates: { yes: 'Thermal insulators', no: 'Thermal conductors',
    setup: 'The test: stand each one in hot water with butter near the top. Does the butter melt?',
    res: ['heat travels up it and melts the butter: a thermal conductor.', 'heat hardly travels up it, so the butter stays: a thermal insulator.'],
    def: 'Thermal insulators slow heat down as it moves through them.',
    prop: 'Thermal insulators keep heat in or out. Metals are thermal conductors.',
    fair: 'Keep it fair: rods the same size, the same hot water, butter at the same height. Adults pour hot water.' },
};

// Short result marks shown above each column during the tests: [no, yes]. Kept to one line.
const SHORT = {
  waterproof: ['Soaks in', 'Stays dry'], magnetic: ['No pull', 'Pulled'], floats: ['Sinks', 'Floats'],
  transparent: ['Opaque', 'See-through'], flexible: ['Rigid', 'Bends'], conducts: ['No light', 'Lights'],
  insulates: ['Melts', 'No melt'],
};
// Words that name a result. A label for one side may not be a word that names the other side
// of this test, or any result of another test: that would sort the objects under a false heading.
const norm = s => String(s || '').trim().toLowerCase().replace(/[.!?]+$/, '');
function falseWords(test, side) {
  const other = side === 'yes' ? 'no' : 'yes', W = new Set([TT[test][other], SHORT[test][side === 'yes' ? 0 : 1]].map(norm));
  for (const t of TESTS) if (t !== test) for (const w of [TT[t].yes, TT[t].no, ...SHORT[t]]) W.add(norm(w));
  for (const w of [TT[test][side], SHORT[test][side === 'yes' ? 1 : 0]]) W.delete(norm(w));
  return W;
}

/* ------------------------------------------------------------------ params */
const OBJ = { type: 'object', required: ['material'], default: { name: 'Paper clip', material: 'steel' }, properties: {
  name: { type: 'string', title: 'Object', description: 'What it is, like “spoon” or “sock”. Leave empty to show only the material.', maxLength: 30 },
  material: { type: 'string', title: 'Made of', enum: MAT_IDS, 'x-labels': MAT_LABELS },
} };
export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Testing materials',
  required: ['test', 'objects'],
  properties: {
    title: TITLE_PARAM('Which materials are waterproof?'),
    test: { type: 'string', title: 'The test', enum: TESTS, 'x-labels': TEST_LABELS, default: 'waterproof' },
    objects: { type: 'array', title: 'Things to test', description: 'Each one is tested in turn, then sorted by its result. The result comes from the material.', 'x-item': 'a thing', minItems: 2, maxItems: 5,
      default: [{ name: 'Paper towel', material: 'paper' }, { name: 'Plastic bag', material: 'plastic' }, { name: 'T-shirt', material: 'fabric' }, { name: 'Kitchen foil', material: 'foil' }],
      items: OBJ },
    text: TEXT_PARAM_FOR({ yes: 'label', no: 'label', unclear: 'label', 'mark-yes': 'label', 'mark-no': 'label', 'mark-unclear': 'label', none: 'label', property: 'sentence' }),
  },
};

export const presets = [
  { id: 'rec-float-sink', name: 'Reception: floating and sinking', params: {
    title: 'Does it float or sink?', test: 'floats',
    objects: [{ name: 'Wooden block', material: 'wood' }, { name: 'Pebble', material: 'rock' }, { name: 'Cork', material: 'cork' }, { name: 'Key', material: 'steel' }, { name: 'Candle', material: 'wax' }],
  } },
  { id: 'y1-waterproof', name: 'Year 1: which material is waterproof?', params: {
    title: 'Which material would keep Teddy dry?', test: 'waterproof',
    objects: [{ name: 'Paper towel', material: 'paper' }, { name: 'Plastic bag', material: 'plastic' }, { name: 'T-shirt', material: 'fabric' }, { name: 'Kitchen foil', material: 'foil' }, { name: 'Woolly hat', material: 'wool' }],
  } },
  { id: 'y3-magnets', name: 'Year 3: are all metals magnetic?', params: {
    title: 'Are all metals magnetic?', test: 'magnetic',
    objects: [{ name: 'Paper clip', material: 'steel' }, { name: 'Drinks can', material: 'aluminium' }, { name: 'Nail', material: 'iron' }, { name: 'Copper pipe', material: 'copper' }, { name: 'Lolly stick', material: 'wood' }],
  } },
  { id: 'y5-insulators', name: 'Year 5: thermal insulators', params: {
    title: 'Which materials are thermal insulators?', test: 'insulates',
    objects: [{ name: 'Metal spoon', material: 'steel' }, { name: 'Wooden spoon', material: 'wood' }, { name: 'Plastic spoon', material: 'plastic' }, { name: 'Copper pipe', material: 'copper' }],
  } },
];

/* ------------------------------------------------------------------ model of the data */
const cap1 = s => s ? s[0].toUpperCase() + s.slice(1) : s;
function model(P) {
  const test = TESTS.includes(P.test) ? P.test : 'waterproof', t = TT[test];
  const objs = (P.objects || []).map((o, i) => {
    const m = MATS[o.material] || MATS.steel; const name = (o.name || '').trim();
    const r = m.r[test];
    return { i, name, m, mat: m.label, res: r === true, unclear: r == null, who: name || cap1(m.label) };
  });
  const yes = txt(P, 'label:yes', t.yes), no = txt(P, 'label:no', t.no);
  const markYes = txt(P, 'label:mark-yes', SHORT[test][1]), markNo = txt(P, 'label:mark-no', SHORT[test][0]);
  const unclear = txt(P, 'label:unclear', 'No clear answer'), markUnclear = txt(P, 'label:mark-unclear', 'It depends');
  return { test, t, objs, yes, no, unclear, markYes, markNo, markUnclear,
    yesObjs: objs.filter(o => o.res), noObjs: objs.filter(o => !o.res && !o.unclear), unObjs: objs.filter(o => o.unclear) };
}

// Why a material has no clear result for a test: the teacher-worded reason, first sentence only.
const whyOf = (m, test) => (m.why && m.why[test]) || `${cap1(m.label)} has no clear result for this test.`;
const why1 = (m, test) => whyOf(m, test).replace(/^(.*?\.)\s.*$/, '$1');

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const W = [];
  if (R.length) return result(R);
  const test = P.test;
  (P.objects || []).forEach((o) => {
    const m = MATS[o.material]; if (!m || m.r[test] != null) return;
    W.push(`${(o.name || '').trim() || cap1(m.label)}: ${why1(m, test)} It is set aside under “No clear answer” instead of being sorted.`);
  });
  for (const [id, side] of [['yes', 'yes'], ['no', 'no'], ['mark-yes', 'yes'], ['mark-no', 'no']]) {
    const v = P.text && P.text[`label:${id}`]; if (v == null || v === '') continue;
    const def = id.startsWith('mark') ? SHORT[test][side === 'yes' ? 1 : 0] : TT[test][side];
    if (falseWords(test, side).has(norm(v))) R.push({ path: `text.label:${id}`, reason: `“${v}” names a different result, so things would be sorted under a false heading. Use a word that means “${def}”, or clear it to show “${def}”.` });
  }
  if (R.length) return result(R);
  const M = model(P);
  if ((M.yesObjs.length + M.noObjs.length) && (!M.yesObjs.length || !M.noObjs.length)) W.push(`Every tested object lands in “${M.yesObjs.length ? M.yes : M.no}”, so one group stays empty. Add one with the other result to make the sort worth doing.`);
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
function plan(P) {
  const M = model(P); const items = [];
  const n = M.objs.length;
  items.push({ key: 'bench', caption: `Here are ${n} things. What is each one made of?` });
  items.push({ key: 'setup', caption: M.t.setup });
  const fit = (a, b) => (a.length + b.length <= 172 ? a : a.replace(/ \(.*\)$/, '')) + b;
  M.objs.forEach(o => items.push({ key: `test:${o.i}`, caption: fit(`${o.who}${o.name ? ` (${o.mat})` : ''}: `, o.unclear ? why1(o.m, M.test) : M.t.res[o.res ? 1 : 0]) }));
  items.push({ key: 'sort', caption: `Sort them by the result: ${M.yes.toLowerCase()} or ${M.no.toLowerCase()}.${M.unObjs.length ? ` ${M.unclear}: set to one side.` : ''}` });
  items.push({ key: 'property', caption: M.t.prop });
  const groups = [[M.yes, M.yesObjs], [M.no, M.noObjs]].concat(M.unObjs.length ? [[M.unclear, M.unObjs]] : []);
  const list = a => a.length ? a.map(o => o.who).join(', ') : 'none';
  const count = a => a.length === 1 ? '1 thing' : `${a.length} things`;
  let summary = groups.map(([w, a]) => `${w}: ${list(a)}.`).join(' ');
  if (summary.length > 172) summary = groups.map(([w, a]) => `${w}: ${count(a)}.`).join(' ');
  return { M, items, summary };
}
export function builds(P) { const { items, summary } = plan(P); return { steps: items.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }

function testNote(M, o) {
  if (o.unclear) return `${whyOf(o.m, M.test).replace(/\s*(Choose|Leave|Use)[^.]*\.$/, '')} Set it to one side; a test only sorts things with a clear yes or no.`;
  const k = o.m === MATS.steel ? 'steel' : Object.keys(MATS).find(x => MATS[x] === o.m);
  const metal = ['steel', 'iron', 'aluminium', 'copper', 'foil'].includes(k);
  if (M.test === 'magnetic') {
    if (metal && !o.res) return `${cap1(o.mat)} is a metal, but it is not magnetic. Only a few metals are: iron, steel (which is mostly iron), nickel and cobalt.`;
    if (k === 'steel') return 'Steel is magnetic because it is mostly iron. Stainless steel (most cutlery) is often not magnetic; test the real object first.';
    if (o.res) return `${cap1(o.mat)} is magnetic because it contains iron. Ask: is every metal magnetic? Predict the next one first.`;
  }
  if (M.test === 'floats') {
    if (k === 'rubber') return 'A solid lump of rubber sinks. A rubber duck floats because it is hollow and full of air.';
    if (metal) return `A solid lump of ${o.mat} sinks, yet a steel ship floats: its hollow shape holds a lot of air.`;
    if (k === 'rock') return 'Most rock sinks. Pumice, a rock full of air bubbles, floats.';
    if (o.res) return `Look how much of it is under the water: the lighter a material is for its size, the higher it floats.`;
  }
  if (M.test === 'conducts' && k === 'graphite') return 'Pencil lead (graphite) conducts electricity although it is not a metal.';
  if (M.test === 'conducts' && metal) return 'Metals conduct electricity. That is why wires have a metal core inside plastic.';
  if (M.test === 'insulates' && metal) return 'Metals carry heat quickly, which is why pan handles are made of plastic or wood.';
  if (M.test === 'waterproof' && !o.res) return `${cap1(o.mat)} has tiny gaps between its fibres, so water soaks in and through.`;
  if (M.test === 'transparent' && o.res) return 'Light passes straight through, so the light lands on the bench below and there is no shadow.';
  return `Ask for a prediction before the result: what will happen to the ${o.who.toLowerCase()}?`;
}
export function notes(P) {
  const { M, items } = plan(P);
  const steps = items.map(it => {
    if (it.key === 'bench') return 'Name the material, not the object: a spoon can be steel, wood or plastic. Each object is drawn as a simple picture; for most tests it becomes a plain piece of its material.';
    if (it.key === 'setup') return M.t.fair;
    if (it.key === 'sort') return `Sorting by one test gives two groups. Ask: which group would you choose to make ${M.test === 'waterproof' ? 'a raincoat' : M.test === 'insulates' ? 'a pan handle' : M.test === 'conducts' ? 'a wire' : M.test === 'transparent' ? 'a window' : M.test === 'flexible' ? 'a bendy straw' : M.test === 'magnetic' ? 'a fridge door' : 'a boat'} from?`;
    if (it.key === 'property') return 'A property describes a material, whatever the object is made into. Ask the class to name another object for each group.';
    return testNote(M, M.objs[+it.key.slice(5)]);
  });
  return { steps, summary: 'The pictures show what happens, not real sizes. Ask: which result surprised you?' };
}

/* ------------------------------------------------------------------ rigs */
// Each rig draws one object's test in local units: x centred on 0, y = 0 on the bench top, up to
// about 226 units tall. It returns pose(su, tu): su 0..1 = set up, tu 0..1 = the test itself.
const sampleAttrs = m => ({ fill: m.fill, stroke: m.edge || 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' });
const ph = (u, a, b) => clamp((u - a) / (b - a));
const DROP = 'M0 -14 C 5 -6 9 -1 9 4 A 9 9 0 0 1 -9 4 C -9 -1 -5 -6 0 -14 Z';
const tr = (el, x, y, extra = '') => el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})${extra}`);

// A simple silhouette of the object, picked from its name (then its material), bottom-centred at
// (0, 0) in a W x H box. Drawn with a firm outline so pale materials still read against water.
const matKey = m => MAT_IDS.find(k => MATS[k] === m);
const ICON_TOP = { spoon: .6, key: .9, nail: .64, pipe: .62, stick: .38, clip: .8, pebble: .85, hat: 1.06, bag: .95 };
const ICON_KINDS = [
  ['spoon', /spoon|fork|knife|cutlery/], ['key', /\bkey/], ['pebble', /pebble|stone|rock|marble/], ['candle', /candle|crayon/],
  ['cork', /cork|bung/], ['clip', /clip|pin\b/], ['can', /\bcan\b|tin\b|cup|mug|jar|bottle/], ['nail', /nail|screw/],
  ['pipe', /pipe|tube|rod/], ['stick', /stick|ruler|straw|pencil|lolly|bar\b/], ['bag', /bag/], ['shirt', /shirt|top\b|jumper|coat/],
  ['sheet', /towel|tissue|napkin|paper|card|envelope|sheet/], ['foil', /foil|wrapper/], ['hat', /hat|beanie/], ['sock', /sock|glove|mitten/],
  ['block', /block|brick|cube|lump/],
];
const MAT_KIND = { foil: 'foil', paper: 'sheet', fabric: 'shirt', wool: 'sock', rock: 'pebble', wax: 'candle', cork: 'cork', copper: 'pipe', graphite: 'stick' };
function iconKind(o) { const n = (o.name || '').toLowerCase(); const hit = ICON_KINDS.find(([, re]) => re.test(n)); return hit ? hit[0] : MAT_KIND[matKey(o.m)] || 'block'; }
function objIcon(g, o, W, H) {
  const ig = h('g', {}, g), k = iconKind(o);
  const A = { fill: o.m.fill, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round' };
  const P = (d, extra = {}) => h('path', Object.assign({ d }, A, extra), ig);
  const R = (x, y, w, hh, rx = 3, extra = {}) => h('rect', Object.assign({ x, y, width: w, height: hh, rx }, A, extra), ig);
  const L = d => h('path', { d, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)', 'stroke-linecap': 'round' }, ig);
  const w = W / 2;
  if (k === 'spoon') { R(-w, -H * .36, W * .58, H * .2, H * .1); h('ellipse', Object.assign({ cx: W * .26, cy: -H * .3, rx: W * .24, ry: H * .3 }, A), ig); }
  else if (k === 'key') { R(-W * .12, -H * .56, W * .6, H * .2, 2); R(W * .22, -H * .4, W * .08, H * .24, 1); R(W * .36, -H * .4, W * .08, H * .18, 1); h('circle', Object.assign({ cx: -W * .28, cy: -H * .46, r: H * .44 }, A), ig); h('circle', { cx: -W * .3, cy: -H * .46, r: H * .14, fill: 'var(--bg)', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-hair)' }, ig); }
  else if (k === 'pebble') P(`M${-w * .9} 0 C ${-w * 1.05} ${-H * .75} ${w * .1} ${-H * 1.05} ${w * .75} ${-H * .62} C ${w * 1.05} ${-H * .38} ${w * .8} 0 ${w * .2} 0 Z`);
  else if (k === 'candle') { R(-W * .17, -H * .88, W * .34, H * .88, 3); L(`M0 ${-H * .88} V ${-H}`); }
  else if (k === 'cork') { P(`M${-W * .26} 0 L ${-W * .32} ${-H * .92} L ${W * .32} ${-H * .92} L ${W * .26} 0 Z`); for (const [x, y] of [[-.12, .3], [.1, .55], [-.05, .72], [.14, .22]]) h('circle', { cx: W * x, cy: -H * y, r: 1.6, fill: 'var(--ink-3)' }, ig); }
  else if (k === 'clip') { const st = { fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 'calc(var(--sw-struct) * 2.6)' }, st2 = { fill: 'none', stroke: o.m.fill, 'stroke-width': 'calc(var(--sw-struct) * 1.4)' }; for (const s2 of [st, st2]) { h('rect', Object.assign({ x: -w * .9, y: -H * .8, width: W * .9, height: H * .62, rx: H * .31 }, s2), ig); h('path', Object.assign({ d: `M${w * .55} ${-H * .3} H ${-w * .45} A ${H * .14} ${H * .14} 0 0 1 ${-w * .45} ${-H * .58} H ${w * .25}` }, s2), ig); } }
  else if (k === 'can') { R(-W * .24, -H, W * .48, H, 4); L(`M${-W * .24} ${-H * .86} H ${W * .24}`); L(`M${-W * .24} ${-H * .14} H ${W * .24}`); }
  else if (k === 'nail') { R(-w, -H * .64, W * .08, H * .56, 1); R(-w * .84, -H * .44, W * .72, H * .16, 0); P(`M${w * .6} ${-H * .44} L ${w} ${-H * .36} L ${w * .6} ${-H * .28} Z`); }
  else if (k === 'pipe') { R(-w, -H * .62, W * .92, H * .42, 2); h('ellipse', Object.assign({ cx: w * .84, cy: -H * .41, rx: W * .06, ry: H * .21 }, A), ig); h('ellipse', { cx: w * .84, cy: -H * .41, rx: W * .03, ry: H * .11, fill: 'var(--ink-2)' }, ig); }
  else if (k === 'stick') { R(-w, -H * .38, W, H * .28, H * .14); if (/ruler/.test((o.name || '').toLowerCase())) for (let i = 1; i < 8; i++) L(`M${-w + W * i / 8} ${-H * .38} v ${H * (i % 2 ? .08 : .14)}`); }
  else if (k === 'bag') { const hs = { fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)' }; for (const sx of [-1, 1]) h('path', Object.assign({ d: `M${sx * W * .28} ${-H * .66} Q ${sx * W * .2} ${-H * 1.06} ${sx * W * .06} ${-H * .66}` }, hs), ig); P(`M${-W * .36} 0 L ${-W * .42} ${-H * .68} L ${W * .42} ${-H * .68} L ${W * .36} 0 Z`); }
  else if (k === 'shirt') P(`M${-W * .18} ${-H} L ${-w} ${-H * .76} L ${-W * .38} ${-H * .48} L ${-W * .26} ${-H * .58} L ${-W * .26} 0 L ${W * .26} 0 L ${W * .26} ${-H * .58} L ${W * .38} ${-H * .48} L ${w} ${-H * .76} L ${W * .18} ${-H} Q 0 ${-H * .78} ${-W * .18} ${-H} Z`);
  else if (k === 'sheet') { R(-W * .42, -H * .9, W * .84, H * .9, 2); L(`M${-W * .42} ${-H * .45} H ${W * .42}`); }
  else if (k === 'foil') { P(`M${-w * .9} ${-H * .1} L ${-w * .76} ${-H * .82} L ${-w * .3} ${-H * .7} L 0 ${-H * .94} L ${w * .4} ${-H * .76} L ${w * .9} ${-H * .86} L ${w * .8} ${-H * .16} L ${w * .3} ${-H * .02} L ${-w * .2} ${-H * .12} Z`); L(`M${-w * .3} ${-H * .7} L ${-w * .1} ${-H * .3} L ${w * .4} ${-H * .76}`); L(`M${-w * .1} ${-H * .3} L ${w * .3} ${-H * .02}`); }
  else if (k === 'hat') { P(`M${-W * .36} ${-H * .26} Q ${-W * .36} ${-H * .9} 0 ${-H * .9} Q ${W * .36} ${-H * .9} ${W * .36} ${-H * .26} Z`); R(-W * .4, -H * .3, W * .8, H * .3, 4); for (let i = -3; i <= 3; i++) L(`M${W * .1 * i} ${-H * .28} v ${H * .26}`); h('circle', Object.assign({ cx: 0, cy: -H * .94, r: H * .12 }, A), ig); }
  else if (k === 'sock') { P(`M${-W * .14} ${-H} L ${W * .12} ${-H} L ${W * .12} ${-H * .36} L ${W * .36} ${-H * .3} Q ${W * .48} 0 ${W * .22} 0 L ${-W * .06} 0 Q ${-W * .16} 0 ${-W * .14} ${-H * .3} Z`); L(`M${-W * .14} ${-H * .84} H ${W * .12}`); }
  else { R(-W * .36, -H * .8, W * .72, H * .8, 4); if (matKey(o.m) === 'wood') { L(`M${-W * .28} ${-H * .55} q ${W * .28} ${-H * .12} ${W * .56} 0`); L(`M${-W * .28} ${-H * .3} q ${W * .28} ${-H * .1} ${W * .56} 0`); } }
  return ig;
}
// Light texture on a flat sample of the material (sheet or strip), so cloth, foil and paper differ.
function texture(g, m, x0, x1, y) {
  const k = matKey(m), st = { fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)', 'stroke-linecap': 'round' };
  if (k === 'fabric' || k === 'wool') h('path', Object.assign({ d: `M${x0 + 6} ${y} H ${x1 - 6}`, 'stroke-dasharray': '4 5' }, st), g);
  else if (k === 'foil' || k === 'aluminium') { let d = `M${x0 + 6} ${y}`; for (let x = x0 + 14; x < x1 - 4; x += 10) d += ` L ${x} ${y + ((x / 10) % 2 ? -2 : 2)}`; h('path', Object.assign({ d }, st), g); }
}

// For tests whose sample is a piece of the material, the object itself stands on the bench in the
// first build and makes way for the sample when the test is set up.
function benchIcon(g, o, kSet, W = 104, H = 72) { const bg = h('g', { hide: kSet }, g); objIcon(bg, o, W, H); }

const RIGS = {
  waterproof(g, o, A, ctx, P, kT, kSet) {
    benchIcon(g, o, kSet, 140, 96);
    apparatus(g, 'beaker', 0, 0, 1, A, { w: 130, h: 120, level: 0 });
    const puddle = h('rect', { x: -59, y: -5, width: 118, height: 0, fill: 'var(--water)', opacity: .85 }, g);
    const sw = h('g', { s: kSet }, g); const sg = h('g', {}, sw);
    h('path', Object.assign({ d: 'M-80 -128 Q 0 -116 80 -128 L 80 -112 Q 0 -100 -80 -112 Z' }, sampleAttrs(o.m), { stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)' }), sg);
    texture(sg, o.m, -80, 80, -114);
    const patch = h('ellipse', { cx: 0, cy: -112, rx: 50, ry: 9, fill: 'var(--water-text)', opacity: 0 }, sg);
    const bead = h('ellipse', { cx: 0, cy: -133, rx: 36, ry: 15, fill: 'var(--water)', stroke: 'var(--water-text)', 'stroke-width': 'var(--sw-hair)', opacity: 0 }, g);
    const drop = h('path', { d: DROP, fill: 'var(--water)', opacity: 0 }, g);
    const drip = h('path', { d: DROP, fill: 'var(--water)', opacity: 0 }, g);
    return (su, tu) => {
      tr(sg, 0, 116 * (1 - su));
      const f = ph(tu, 0, .4); drop.setAttribute('opacity', tu > 0 && tu < .42 ? 1 : 0); tr(drop, 0, -196 + 44 * f * f, ' scale(2)');
      if (o.res) { bead.setAttribute('opacity', tu >= .4 ? 1 : 0); return; }
      patch.setAttribute('opacity', .8 * ph(tu, .4, .6));
      const d = ph(tu, .55, .85); drip.setAttribute('opacity', d > 0 && d < 1 ? 1 : 0); tr(drip, 0, -96 + 70 * d * d, ' scale(1.6)');
      puddle.setAttribute('height', 34 * ph(tu, .8, 1)); puddle.setAttribute('y', -5 - 34 * ph(tu, .8, 1));
    };
  },
  magnetic(g, o, A, ctx, P) {
    const blk = objIcon(g, o, 100, 60), lift = 88 - (ICON_TOP[iconKind(o)] || .8) * 60;
    const mg = h('g', A, g); const mi = h('g', {}, mg);
    h('line', { x1: 0, x2: 0, y1: -30, y2: -50, stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)' }, mi);
    apparatus(mi, 'magnet', 0, 0, 1, {}, { w: 96, h: 30 });
    return (su, tu) => {
      tr(mi, 0, -142 + 42 * eIO(ph(tu, 0, .5)));
      tr(blk, 0, o.res ? -lift * eOut(ph(tu, .5, .72)) : 0);
    };
  },
  floats(g, o, A) {
    apparatus(g, 'beaker', 0, 0, 1, A, { w: 120, h: 140, level: .7 });
    const surf = -5 - 130 * .7, bh = 50;
    const blk = objIcon(g, o, 88, bh);
    const wg = h('g', A, g);
    h('rect', { x: -55, y: surf, width: 110, height: -5 - surf, fill: 'var(--water)', opacity: .3 }, wg);
    h('line', { x1: -57, x2: 57, y1: surf, y2: surf, stroke: 'var(--water-text)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, wg);
    const sub = clamp(o.m.rho || 1, .18, 1);
    const end = o.res ? surf + sub * bh : -5;
    return (su, tu) => {
      const y0 = -150 * su;
      const a = ph(tu, 0, .35), b = eOut(ph(tu, .35, 1));
      const y = tu <= .35 ? y0 + (surf + (o.res ? 0 : 6) - y0) * a * a : surf + (o.res ? 0 : 6) + (end - surf - (o.res ? 0 : 6)) * b;
      tr(blk, 0, y);
    };
  },
  transparent(g, o, A, ctx, P, kT, kSet) {
    benchIcon(g, o, kSet);
    apparatus(g, 'torch', 0, -150, 1, A, { ang: 90 });
    const st = h('g', A, g);
    for (const x of [-56, 48]) h('rect', { x, y: -66, width: 8, height: 66, fill: 'var(--board)' }, st);
    const sg = h('g', {}, h('g', { s: kSet }, g));
    h('rect', Object.assign({ x: -60, y: -76, width: 120, height: 12, rx: 2 }, sampleAttrs(o.m), { stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)' }), sg);
    texture(sg, o.m, -60, 60, -70);
    const shadow = h('ellipse', { cx: 0, cy: -2, rx: 46, ry: 5, fill: 'var(--ground-shadow)', opacity: 0 }, g);
    const patch = h('ellipse', { cx: 0, cy: -2, rx: 50, ry: 5, fill: 'var(--energy)', opacity: 0 }, g);
    const src = [0, -110], T1 = [-16, 0, 16].map(x => [x, -75]), T2 = T1.map(([x]) => [x * 110 / 35, -4]);
    const s = ctx.tk.head * .8;
    const rays = T1.map((t1, i) => {
      const l1 = h('line', { x1: src[0], y1: src[1], stroke: 'var(--energy)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g);
      const l2 = h('line', { x1: t1[0], y1: t1[1] + 9, stroke: 'var(--energy)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g);
      const ang = Math.atan2(t1[1] - src[1], t1[0] - src[0]);
      const m2 = [(t1[0] + T2[i][0]) / 2, (t1[1] + T2[i][1]) / 2];
      const hd = i === 1 ? h('path', { d: headD(m2[0], m2[1], ang, s), fill: 'var(--energy)', opacity: 0 }, g) : null;
      return { l1, l2, t1, t2: T2[i], hd };
    });
    return (su, tu) => {
      tr(sg, 0, 66 * (1 - su));
      const a = ph(tu, 0, .4), b = ph(tu, .4, .75);
      for (const r of rays) {
        r.l1.setAttribute('x2', (src[0] + (r.t1[0] - src[0]) * a).toFixed(1)); r.l1.setAttribute('y2', (src[1] + (r.t1[1] - src[1]) * a).toFixed(1)); r.l1.setAttribute('opacity', tu > 0 ? 1 : 0);
        const bb = o.res ? b : 0; const y0 = r.t1[1] + 9;
        r.l2.setAttribute('x2', (r.t1[0] + (r.t2[0] - r.t1[0]) * bb).toFixed(1)); r.l2.setAttribute('y2', (y0 + (r.t2[1] - y0) * bb).toFixed(1)); r.l2.setAttribute('opacity', bb > 0 ? 1 : 0);
        if (r.hd) r.hd.setAttribute('opacity', o.res && b > .6 ? 1 : 0);
      }
      if (o.res) patch.setAttribute('opacity', .55 * ph(tu, .7, 1)); else shadow.setAttribute('opacity', ph(tu, .4, .7));
    };
  },
  flexible(g, o, A, ctx, P, kT, kSet) {
    benchIcon(g, o, kSet);
    const st = h('g', A, g);
    h('rect', { x: -76, y: -98, width: 14, height: 98, fill: 'var(--board)' }, st);
    h('rect', { x: -82, y: -112, width: 28, height: 34, rx: 'var(--r-mark)', fill: 'var(--board)', cls: 'body' }, st);
    const sg = h('g', {}, h('g', { s: kSet }, g));
    const strip = h('path', Object.assign(sampleAttrs(o.m), { stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)' }), sg);
    const x0 = -64, x1 = 66, yc = -90, th = 10;
    const draw = D => { let top = '', bot = ''; for (let i = 0; i <= 20; i++) { const t = i / 20, x = x0 + (x1 - x0) * t, y = yc + D * t * t; top += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + (y - th / 2).toFixed(1); bot = 'L' + x.toFixed(1) + ' ' + (y + th / 2).toFixed(1) + bot; } strip.setAttribute('d', top + bot + 'Z'); };
    const ag = h('g', {}, g); const ai = h('g', { s: kT, cls: 'rise', c: A.c }, ag);
    forceArrow(ctx, ai, [56, -152], 'down', 5, null, { unit: 10 });
    const D = o.res ? 46 : 0;
    return (su, tu) => {
      tr(sg, 0, 85 * (1 - su)); const d = D * eIO(ph(tu, .25, .9)); draw(d);
      tr(ag, 0, d * ((56 - x0) / (x1 - x0)) ** 2);
    };
  },
  conducts(g, o, A, ctx, P, kT, kSet) {
    benchIcon(g, o, kSet, 90, 60);
    const wa = Object.assign({}, A);
    apparatus(g, 'bulb', 0, -120, 1, A, { lit: false });
    const lit = apparatus(g, 'bulb', 0, -120, 1, { opacity: 0 }, { lit: true, brightness: 1 });
    apparatus(g, 'cell', -26, -22, 1, A);
    const wg = h('g', wa, g);
    wire(wg, [[-30, -117], [-72, -117], [-72, -22], [-66, -22]]);
    wire(wg, [[18, -22], [58, -22], [58, -40]]);
    wire(wg, [[30, -117], [58, -117], [58, -114]]);
    const clip = h('g', wa, g); const ci = h('g', {}, clip);
    h('line', { x1: 58, x2: 58, y1: -116, y2: -100, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, ci);
    h('rect', { x: 52, y: -100, width: 12, height: 8, rx: 2, fill: 'var(--metal-shade)' }, ci);
    const sg = h('g', {}, h('g', { s: kSet }, g));
    h('rect', Object.assign({ x: 51, y: -92, width: 14, height: 52, rx: 2 }, sampleAttrs(o.m), { stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)' }), sg);
    return (su, tu) => {
      tr(sg, 0, 40 * (1 - su)); tr(ci, 0, -16 * (1 - eIO(ph(tu, 0, .4))));
      lit.setAttribute('opacity', o.res ? ph(tu, .45, .7) : 0);
    };
  },
  insulates(g, o, A, ctx, P, kT, kSet) {
    benchIcon(g, o, kSet, 110, 70);
    apparatus(g, 'beaker', 0, 0, 1, A, { w: 100, h: 104, level: .66 });
    const surf = -5 - 94 * .66, rt = -184;
    const sg = h('g', {}, h('g', { s: kSet }, g));
    h('rect', Object.assign({ x: -9, y: rt, width: 18, height: 176, rx: 3 }, sampleAttrs(o.m), { stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)' }), sg);
    // heat climbing the rod: stepped bands, hottest at the water (flat tints, no gradient)
    const top = o.res ? surf - 14 : rt + 6, NB = 8, bands = [];
    for (let i = 0; i < NB; i++) bands.push(h('rect', { x: -9, y: 0, width: 18, height: 0, fill: 'var(--heat)', opacity: (.95 - i * .09).toFixed(2) }, sg));
    h('rect', { x: -45, y: surf, width: 90, height: -5 - surf, fill: 'var(--water)', opacity: .2 }, h('g', A, g));
    const st = h('g', A, g);
    for (const x of [-30, 28]) h('path', { d: `M${x} ${surf - 10} q -7 -9 0 -18 q 7 -9 0 -18`, fill: 'none', stroke: 'var(--heat)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round', opacity: .7 }, st);
    const bi = h('g', {}, h('g', { s: kSet }, g));
    const bs = { fill: 'var(--cheese)', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)' };
    const butter = h('rect', Object.assign({ x: -26, y: -172, width: 52, height: 30, rx: 'var(--r-mark)' }, bs), bi);
    return (su, tu) => {
      tr(sg, 0, 8 * (1 - su)); tr(bi, 0, 8 * (1 - su));
      const a = eIO(ph(tu, 0, .65)), span = -8 - top, reach = span * a;
      bands.forEach((b, i) => { const y0 = -8 - span * i / NB, y1 = -8 - span * (i + 1) / NB, yt = Math.max(y1, -8 - reach); const hh = Math.max(0, y0 - yt); b.setAttribute('y', (y0 - hh).toFixed(1)); b.setAttribute('height', hh.toFixed(1)); });
      const m = o.res ? 0 : eIO(ph(tu, .65, 1));
      // melted butter softens, slides down the rod and spreads on the water
      const hb = 30 - 20 * m, yb = -142 + (surf + 2 - -142) * m * m;
      butter.setAttribute('height', hb.toFixed(1)); butter.setAttribute('y', (yb - hb).toFixed(1));
      butter.setAttribute('width', (52 + 26 * m).toFixed(1)); butter.setAttribute('x', (-26 - 13 * m).toFixed(1));
    };
  },
};

/* ------------------------------------------------------------------ render */
const BY = 470, G = 72, HY = 200;
// rig height and half-width in rig units, for scaling each test to its column
const RIG_DIM = { waterproof: [205, 84], magnetic: [194, 50], floats: [185, 62], transparent: [220, 62], flexible: [160, 84], conducts: [226, 74], insulates: [186, 52] };
export function render(root, P, ctx) {
  const { M } = plan(P); const b = ctx.b, N = ctx.N;
  const n = M.objs.length, kSet = b.setup, kSort = b.sort, kProp = b.property;
  // groups after the sort: yes, no (each keeps one column even when empty), then any set aside
  const nY = M.yesObjs.length, nN = M.noObjs.length, nU = M.unObjs.length;
  const wCols = [Math.max(nY, 1), Math.max(nN, 1)].concat(nU ? [nU] : []);
  const gaps = wCols.length - 1;
  const cw = Math.min(250, (GRID.right - GRID.left - G * gaps) / Math.max(n, wCols.reduce((a, c) => a + c, 0)));
  const yesCol = 'var(--focus-text)', noCol = 'var(--compare-text)', unCol = 'var(--ink-2)';
  // text that wraps upward from a baseline, so a second line never reaches the rigs below
  const upBlock = (p, x, y, s, o) => { const tmp = h('g', {}, root); const pr = textBlock(tmp, 0, 0, s, o); tmp.remove(); return textBlock(p, x, y - (pr.lines.length - 1) * pr.lh, s, o); };

  /* the property, named in its own build (a line under the title) */
  const def = textBlock(root, GRID.left, 128, txt(P, 'label:property', M.t.def), { cls: 'ts-label', maxW: GRID.right - GRID.left, maxLines: 1, lh: 34, edit: 'text.label:property', a: { s: kProp, cls: 'rise', fill: yesCol } });
  def.el.classList.add('strong');
  const dim = RIG_DIM[M.test]; const s = Math.min(1.5, (cw - 24) / (2 * dim[1]), (BY - HY - 30) / dim[0]);

  /* the setting: a classroom wall behind the table */
  h('rect', { x: 0, y: 232, width: 1280, height: BY - 232, fill: 'var(--wall-bot)' }, root);
  h('line', { x1: 0, x2: 1280, y1: 232, y2: 232, stroke: 'var(--wall-line)', 'stroke-width': 'var(--sw-hair)' }, root);
  apparatus(root, 'bench', 640, BY, 1, {}, { w: 1280, depth: 26, front: 40 });

  /* positions before and after the sort */
  const before = M.objs.map((o, i) => 640 - n * cw / 2 + (i + .5) * cw);
  const total = wCols.reduce((a, c) => a + c, 0) * cw + G * gaps, xa = 640 - total / 2;
  const gx = [xa]; for (let i = 1; i < wCols.length; i++) gx.push(gx[i - 1] + wCols[i - 1] * cw + G);
  const after = [];
  [M.yesObjs, M.noObjs, M.unObjs].forEach((a, gi) => a.forEach((o, j) => { after[o.i] = gx[gi] + (j + .5) * cw; }));

  /* columns: rig, sample, name, material, result word */
  const cols = M.objs.map(o => {
    const kT = b[`test:${o.i}`];
    const g = h('g', {}, root);
    // only the rig under test is at full strength; the rest wait or have finished, quietly
    const rg = h('g', { transform: `translate(0 ${BY}) scale(${s.toFixed(3)})`, c: `${kSet + 1}-${kT}:quiet,${kT + 1}-${kSort}:quiet` }, g);
    const A = { s: kSet, cls: 'rise', c: `${kProp}:soft` };
    const pose = RIGS[M.test](rg, o, A, ctx, P, kT, kSet);
    // names under the bench
    const nm = o.name ? textBlock(g, 0, 572, o.name, { cls: 'ts-label', maxW: cw - 4, maxLines: 2, lh: 32, anchor: 'middle', edit: `objects.${o.i}.name`, a: { fill: 'var(--ink)' } }) : null;
    const my = nm ? 572 + nm.h - 4 : 572;
    computed(T(g, 0, my, nm ? o.mat : cap1(o.mat), nm ? 'ts-small' : 'ts-label', { 'text-anchor': 'middle', fill: 'var(--ink-2)' }), `objects.${o.i}.material`);
    if (my > GRID.bottom - 4) ctx.warn(`materials_test: the name “${o.name}” pushes its material below the slide's live area.`);
    // the result word above the rig, until the sort replaces it with the group heading
    const rw = h('g', { s: kT, hide: kSort, cls: 'rise', delay: 1300 }, g);
    const word = o.unclear ? M.markUnclear : o.res ? M.markYes : M.markNo;
    const rb = upBlock(rw, 0, HY, word, { cls: 'ts-label', maxW: cw - 8, maxLines: 3, lh: 28, anchor: 'middle', a: { fill: o.unclear ? unCol : o.res ? yesCol : noCol } });
    rb.el.classList.add('strong'); computed(rb.el, `objects.${o.i}.material`);
    return { o, g, pose, kT };
  });

  /* group headings, drawn where the columns land after the sort */
  const heads = [[M.yes, 'yes', gx[0], wCols[0] * cw, yesCol, 'var(--focus)', nY], [M.no, 'no', gx[1], wCols[1] * cw, noCol, 'var(--compare)', nN]]
    .concat(nU ? [[M.unclear, 'unclear', gx[2], wCols[2] * cw, unCol, 'var(--ink-3)', nU]] : []);
  for (const [word, id, x0, w, col, line, cnt] of heads) {
    const g = h('g', { s: kSort, cls: 'rise', delay: 900 }, root);
    // the property line above is always one line, so a heading may take two
    const tb = upBlock(g, x0 + w / 2, HY, word, { cls: 'ts-label', maxW: w - 12, maxLines: 2, lh: 30, anchor: 'middle', edit: `text.label:${id}`, a: { fill: col } });
    tb.el.classList.add('strong');
    h('path', { d: `M${x0 + 8} ${HY + 22} V ${HY + 14} H ${x0 + w - 8} V ${HY + 22}`, fill: 'none', stroke: line, 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
    if (!cnt) upBlock(g, x0 + w / 2, BY - 60, txt(P, 'label:none', 'None'), { cls: 'ts-small', maxW: w - 12, maxLines: 2, lh: 26, anchor: 'middle', edit: 'text.label:none', a: { fill: 'var(--ink-2)' } });
  }

  /* one state for every build: set up, each test, the sort */
  const place = (k, u) => {
    const su = k < kSet ? 0 : k === kSet ? eIO(u) : 1, so = k < kSort ? 0 : k === kSort ? eIO(u) : 1;
    for (const c of cols) {
      const tu = c.o.unclear || k < c.kT ? 0 : k === c.kT ? u : 1;
      c.pose(su, tu);
      tr(c.g, before[c.o.i] + (after[c.o.i] - before[c.o.i]) * so, 0);
    }
  };
  place(N, 1);
  return {
    dur: Object.assign({ setup: 1000, sort: 1300 }, Object.fromEntries(M.objs.map(o => [`test:${o.i}`, 1500]))),
    still() { place(N, 1); },
    reset() { place(-1, 0); },
    tick(k, u) { place(k, u); },
  };
}
