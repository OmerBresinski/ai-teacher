// Photosynthesis (KS3): a leaf in sunlight takes in light energy (absorbed by chlorophyll in its
// chloroplasts), carbon dioxide through its stomata and water up the xylem; inside the chloroplasts
// they become glucose (used for energy, stored as starch, carried round the plant as sucrose) and
// oxygen (out through the stomata). The word equation, and for older classes the balanced symbol
// equation, close it. The code draws where every substance goes, so glucose can never be drawn
// leaving the leaf as a gas and oxygen can never be drawn going in.
import {
  h, T, GRID, textBlock, computed, arrow, line, zoomInset,
  txt, TEXT_PARAM_FOR, TITLE_PARAM, schemaCheck, withDefaults, result, measure,
} from '../kit/index.js';

export const meta = {
  id: 'photosynthesis', name: 'Photosynthesis', kind: 'scene', version: 1,
  subjects: ['Science'],
  years: ['KS3', 'KS4'],
  teaches: 'How a leaf makes glucose by photosynthesis: light absorbed by chlorophyll, carbon dioxide in through stomata and water up the xylem become glucose and oxygen, with the word equation.',
};

const SUBSTANCES = ['light', 'carbon_dioxide', 'water', 'glucose', 'oxygen'];
const NAME = { light: 'light', carbon_dioxide: 'carbon dioxide', water: 'water', glucose: 'glucose', oxygen: 'oxygen' };
const INPUTS = ['light', 'carbon_dioxide', 'water'];
const OUTPUTS = ['glucose', 'oxygen'];

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Photosynthesis',
  properties: {
    title: TITLE_PARAM('How a leaf makes food'),
    inputs: {
      type: 'array', title: 'What goes into the leaf', maxItems: 5, default: ['light', 'carbon_dioxide', 'water'],
      description: 'Each is one build, in this order: light, carbon dioxide, water. Light is always needed.',
      items: { type: 'string', enum: SUBSTANCES, 'x-labels': ['Light energy', 'Carbon dioxide', 'Water', 'Glucose', 'Oxygen'] },
    },
    outputs: {
      type: 'array', title: 'What the leaf makes', maxItems: 5,
      default: [{ substance: 'glucose', leavesAsGas: false }, { substance: 'oxygen', leavesAsGas: true }],
      description: 'Each is one build: glucose (stays in the plant), then oxygen (leaves through the stomata). Leave empty to show the inputs only.',
      items: {
        type: 'object', required: ['substance'],
        properties: {
          substance: { type: 'string', title: 'Product', enum: SUBSTANCES },
          leavesAsGas: { type: 'boolean', title: 'Drawn leaving the leaf as a gas', default: false },
        },
      },
    },
    chloroplast: { type: 'boolean', title: 'Zoom into a chloroplast', default: true,
      description: 'A build that zooms into a chloroplast, where chlorophyll traps the light and the reaction happens.' },
    wordEquation: { type: 'boolean', title: 'End with the word equation', default: true },
    symbolEquation: { type: 'string', title: 'Symbol equation (higher KS3 and KS4)', default: '', maxLength: 60,
      description: 'Leave empty for none. When set it must be the balanced equation, e.g. 6CO2 + 6H2O → C6H12O6 + 6O2. Needs the word equation.' },
    labels: { type: 'string', title: 'Label wording', enum: ['full', 'short'], 'x-labels': ['Says where it goes (Carbon dioxide in through stomata)', 'Names only (Carbon dioxide)'], default: 'full' },
    // names on the slide are labels (40 letters): a teacher may reword them, but never drop the substance
    text: TEXT_PARAM_FOR(Object.fromEntries(['leaf', 'light', 'carbon_dioxide', 'stomata', 'water', 'glucose', 'starch', 'sucrose', 'oxygen', 'chloroplast', 'chlorophyll', 'reaction'].map(id => [id, 'label']))),
  },
};

export const presets = [
  { id: 'ks3-photosynthesis', name: 'KS3: how a leaf makes food', params: { title: 'Photosynthesis' } },
  { id: 'ks3-in-and-out', name: 'KS3: what goes in and what comes out', params: {
    title: 'What goes in and what comes out', chloroplast: false, labels: 'short',
  } },
  { id: 'ks4-symbol-equation', name: 'KS4: the balanced symbol equation', params: {
    title: 'The photosynthesis equation', symbolEquation: '6CO2 + 6H2O → C6H12O6 + 6O2',
  } },
];

/* ------------------------------------------------------------------ words */
const FULL = {
  leaf: 'Leaf', light: 'Light energy, absorbed by chlorophyll', carbon_dioxide: 'Carbon dioxide in through stomata',
  stomata: 'Stomata', water: 'Water from the roots, up the xylem', glucose: 'Glucose', starch: 'stored as starch',
  sucrose: 'Carried round the plant as sucrose', oxygen: 'Oxygen out through stomata', chloroplast: 'Chloroplast',
  chlorophyll: 'Chlorophyll traps light', reaction: 'Photosynthesis happens here',
};
const SHORT = Object.assign({}, FULL, { light: 'Light energy', carbon_dioxide: 'Carbon dioxide', water: 'Water', oxygen: 'Oxygen', sucrose: 'Sucrose' });
const label = (P, id) => txt(P, `label:${id}`, (P.labels === 'short' ? SHORT : FULL)[id]);
// a reworded label must still name what it labels (the science is in the name)
const MUST_NAME = {
  light: /light/i, carbon_dioxide: /carbon dioxide|CO2|CO₂/i, water: /water|H2O|H₂O/i, glucose: /glucose/i,
  starch: /starch|energy/i, sucrose: /sucrose|sugar/i, oxygen: /oxygen|O2|O₂/i, chloroplast: /chloroplast/i,
  chlorophyll: /chlorophyll/i, stomata: /stoma/i, leaf: /leaf/i,
};
const FORBID = {
  glucose: [/\bgas\b|\bgiven off\b|\bout of the leaf\b|\breleased\b/i, 'Glucose is not a gas and does not leave the leaf: it is used, stored as starch or carried round the plant as sucrose.'],
  oxygen: [/\bin(to)? (the leaf|through)\b|\btaken in\b|\babsorbed\b/i, 'Oxygen is a product of photosynthesis: it goes out of the leaf, not in.'],
  carbon_dioxide: [/\bout\b|\breleased\b|\bgiven off\b/i, 'Carbon dioxide goes into the leaf in photosynthesis, not out.'],
};

/* ------------------------------------------------------------------ the symbol equation */
// A formula's atoms: "6CO2" -> {C: 6, O: 12}. Subscript digits are read as digits.
const SUB = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
const plain = s => String(s).replace(/[₀-₉]/g, c => SUB[c]);
function term(s) {
  const m = /^(\d*)\s*((?:[A-Z][a-z]?\d*)+)$/.exec(plain(s).trim());
  if (!m) return null;
  const n = m[1] ? Number(m[1]) : 1, atoms = {};
  for (const [, el, k] of m[2].matchAll(/([A-Z][a-z]?)(\d*)/g)) atoms[el] = (atoms[el] || 0) + n * (k ? Number(k) : 1);
  return { n, formula: m[2], atoms };
}
/** Parses "6CO2 + 6H2O → C6H12O6 + 6O2". Returns {left, right} or {error}. */
export function parseEquation(s) {
  const sides = plain(s).split(/→|->|=|⟶/);
  if (sides.length !== 2) return { error: 'The symbol equation needs one arrow, with the reactants on the left and the products on the right.' };
  const side = x => x.split('+').map(t => t.trim()).filter(Boolean).map(term);
  const left = side(sides[0]), right = side(sides[1]);
  if (!left.length || !right.length || [...left, ...right].some(t => !t)) return { error: 'The symbol equation has a part that is not a chemical formula (write them like 6CO2 or C6H12O6).' };
  return { left, right };
}
function equationRefusals(s) {
  const E = parseEquation(s);
  if (E.error) return [E.error];
  const out = [];
  const set = ts => ts.map(t => t.formula).sort().join(' ');
  if (set(E.left) !== 'CO2 H2O' || set(E.right) !== 'C6H12O6 O2') {
    if (set(E.left) === 'C6H12O6 O2' && set(E.right) === 'CO2 H2O') out.push('That is the equation for respiration, the reverse of photosynthesis. Photosynthesis is 6CO2 + 6H2O → C6H12O6 + 6O2.');
    else out.push('Photosynthesis turns carbon dioxide (CO2) and water (H2O) into glucose (C6H12O6) and oxygen (O2): the symbol equation must have exactly those, on those sides.');
    return out;
  }
  const count = ts => ts.reduce((a, t) => { for (const [el, k] of Object.entries(t.atoms)) a[el] = (a[el] || 0) + k; return a; }, {});
  const L = count(E.left), R = count(E.right);
  const bad = [...new Set([...Object.keys(L), ...Object.keys(R)])].filter(el => L[el] !== R[el]);
  if (bad.length) out.push(`The symbol equation does not balance (${bad.map(el => `${el}: ${L[el] || 0} on the left, ${R[el] || 0} on the right`).join('; ')}). The balanced equation is 6CO2 + 6H2O → C6H12O6 + 6O2.`);
  return out;
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const W = [];
  if (R.length) return result(R);
  const ins = P.inputs, outs = P.outputs.map(o => o.substance);
  ins.forEach((s, i) => {
    if (s === 'oxygen') R.push({ path: `inputs.${i}`, reason: 'Oxygen is not an input to photosynthesis: it is made by it and leaves the leaf. The inputs are light, carbon dioxide and water.' });
    if (s === 'glucose') R.push({ path: `inputs.${i}`, reason: 'Glucose is not an input to photosynthesis: it is what the leaf makes. The inputs are light, carbon dioxide and water.' });
  });
  if (new Set(ins).size !== ins.length) R.push({ path: 'inputs', reason: 'An input is listed twice. Name each of light, carbon dioxide and water once.' });
  if (!ins.includes('light')) R.push({ path: 'inputs', reason: 'Photosynthesis needs light: without light energy there is no photosynthesis. Keep light among the inputs.' });
  P.outputs.forEach((o, i) => {
    if (o.substance === 'carbon_dioxide' || o.substance === 'water') R.push({ path: `outputs.${i}.substance`, reason: `${NAME[o.substance][0].toUpperCase() + NAME[o.substance].slice(1)} is used up by photosynthesis, not made by it. The products are glucose and oxygen.` });
    if (o.substance === 'light') R.push({ path: `outputs.${i}.substance`, reason: 'Light is the energy that drives photosynthesis, not a product. The products are glucose and oxygen.' });
    if (o.substance === 'glucose' && o.leavesAsGas) R.push({ path: `outputs.${i}.leavesAsGas`, reason: 'Glucose is not a gas and does not leave the leaf. It stays in the plant: used for energy, stored as starch or carried as sucrose.' });
    if (o.substance === 'oxygen' && o.leavesAsGas === false) R.push({ path: `outputs.${i}.leavesAsGas`, reason: 'Oxygen made in photosynthesis is a gas that diffuses out of the leaf through the stomata: draw it leaving.' });
  });
  if (new Set(outs).size !== outs.length) R.push({ path: 'outputs', reason: 'A product is listed twice. Name glucose and oxygen once each.' });
  // products drawn from fewer inputs than the reaction needs would teach a wrong reaction
  if ((outs.length || P.wordEquation) && !INPUTS.every(s => ins.includes(s)))
    R.push({ path: 'inputs', reason: `Glucose and oxygen are made from carbon dioxide and water, using light. Show all three inputs (missing: ${INPUTS.filter(s => !ins.includes(s)).map(s => NAME[s]).join(', ')}) when the slide shows what is made or the equation.` });
  if (outs.length && outs.length < 2 && !R.length) W.push({ path: 'outputs', reason: 'Only one product is shown: photosynthesis makes both glucose and oxygen.' });
  if (P.symbolEquation && P.symbolEquation.trim()) {
    if (!P.wordEquation) R.push({ path: 'symbolEquation', reason: 'The symbol equation follows the word equation: turn the word equation on too.' });
    for (const reason of equationRefusals(P.symbolEquation)) R.push({ path: 'symbolEquation', reason });
  }
  for (const [id, re] of Object.entries(MUST_NAME)) {
    const t = P.text && P.text[`label:${id}`];
    if (t == null || t === '') continue;
    if (!re.test(t)) R.push({ path: `text.label:${id}`, reason: `The label “${t}” no longer names ${id === 'starch' ? 'what glucose is used for' : NAME[id] || id.replace('_', ' ')}. Keep that word in it.` });
    if (FORBID[id] && FORBID[id][0].test(t)) R.push({ path: `text.label:${id}`, reason: FORBID[id][1] });
  }
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
function plan(P) {
  const ins = INPUTS.filter(s => P.inputs.includes(s));
  const outs = OUTPUTS.filter(s => P.outputs.some(o => o.substance === s));
  const sym = !!(P.symbolEquation && P.symbolEquation.trim()) && !!P.wordEquation;
  const S = [];
  S.push({ key: 'leaf', caption: 'Plants make their own food in their leaves. A leaf is broad and flat to catch as much light as it can.',
    note: 'Photosynthesis means “making with light”. Ask: where does a plant get its food? (Not from the soil: it makes it.)' });
  if (ins.includes('light')) S.push({ key: 'light', caption: 'Light energy from the Sun is absorbed by chlorophyll, the green pigment in the leaf’s chloroplasts.',
    note: 'Light is energy, not a substance: it is not made of particles of matter and is not part of the glucose. Chlorophyll is what makes leaves green.' });
  if (ins.includes('carbon_dioxide')) S.push({ key: 'carbon_dioxide', caption: 'Carbon dioxide from the air diffuses into the leaf through tiny pores called stomata.',
    note: 'Stomata are mostly on the underside of the leaf. Guard cells open and close them. The carbon in glucose comes from this carbon dioxide.' });
  if (ins.includes('water')) S.push({ key: 'water', caption: 'Water is taken up by the roots and carried up the stem to the leaf in the xylem.',
    note: 'Root hair cells give a large surface for taking in water. Minerals come in with the water, but they are not part of photosynthesis.' });
  if (P.chloroplast) S.push({ key: 'chloroplast', caption: 'Photosynthesis happens inside the chloroplasts, where chlorophyll traps the light energy.',
    note: 'Chloroplasts are found in plant cells, mostly in the palisade cells near the top of the leaf. Animal cells have none.' });
  if (outs.includes('glucose')) S.push({ key: 'glucose', caption: 'The leaf makes glucose. It stays in the plant: used for energy in respiration or stored as starch.',
    note: 'Glucose is a sugar, a solid dissolved in the cell sap; it never leaves the leaf as a gas. It is carried round the plant as sucrose (in the phloem) and stored as starch, which is why leaves test positive for starch with iodine.' });
  if (outs.includes('oxygen')) S.push({ key: 'oxygen', caption: 'Oxygen is made too. The leaf does not need it all, so it diffuses out through the stomata.',
    note: 'The oxygen comes from the water molecules. Plants also respire all the time, day and night, using some oxygen; in light they make more than they use.' });
  if (P.wordEquation) S.push({ key: 'equation', caption: 'In words: carbon dioxide and water make glucose and oxygen, using light energy absorbed by chlorophyll.',
    note: 'Light and chlorophyll go above and below the arrow: they are needed, but they are not reactants. Light is the energy; chlorophyll is not used up.' });
  if (sym) S.push({ key: 'symbol', caption: 'In symbols, balanced: six carbon dioxide and six water make one glucose and six oxygen.',
    note: 'Count the atoms on each side: 6 carbon, 12 hydrogen and 18 oxygen on both. Atoms are rearranged, never made or lost.' });
  const summary = P.wordEquation ? 'Photosynthesis: light energy turns carbon dioxide and water into glucose and oxygen in the leaf.'
    : outs.length ? 'The leaf uses light, carbon dioxide and water to make glucose and oxygen.' : 'A leaf takes in light energy, carbon dioxide and water for photosynthesis.';
  return { S, ins, outs, sym, summary };
}
export function builds(P) { const p = plan(P); return { steps: p.S.map(({ key, caption }) => ({ key, caption })), summary: { caption: p.summary } }; }
export function notes(P) {
  const p = plan(P);
  return { steps: p.S.map(s => s.note), summary: 'Ask: what goes in, what comes out, and where does each one go? Glucose stays in the plant; oxygen leaves.' };
}

/* ------------------------------------------------------------------ render */
// The scene sits left (x 64-860, y 120-490): the Sun top left, the leaf in the middle with its stem
// running down, inputs arriving from three sides and outputs leaving. The chloroplast zoom is a card
// on the right; the equation is a card along the bottom. Every label has its own fixed lane, so no
// label sits on another; a reworded label wraps in its lane and a cut is warned.
const LEAF = 'M300 330 C 370 190, 590 160, 700 220 C 640 330, 430 400, 300 330 Z';
const MIDRIB = 'M300 330 C 420 290, 560 236, 700 220';
const STOMA_A = [570, 326], STOMA_B = [457, 357];
const STEM = 'M300 330 C 296 380, 290 430, 288 490';
const COLS = '--ps-light:var(--hue-gold);--ps-light-text:var(--energy-text);--ps-co2:var(--ink-2);--ps-co2-text:var(--ink-2);' +
  '--ps-water:var(--hue-blue);--ps-water-text:var(--water-text);--ps-glu:var(--hue-orange);--ps-glu-text:color-mix(in oklab, var(--hue-orange) 70%, var(--ink));' +
  '--ps-o2:var(--hue-teal);--ps-o2-text:var(--teal-text);--ps-leaf:var(--life);--ps-leaf-edge:var(--life-shade)';

export function render(root, P, ctx) {
  const { ins, outs, sym } = plan(P); const b = ctx.b; const bi = k => b[k];
  const g0 = h('g', { style: COLS }, root);
  const under = h('g', {}, g0);
  // while the chloroplast or the equation is the point, the leaf steps back (still readable)
  const focus = ['chloroplast', 'equation', 'symbol'].filter(k => k in b).map(k => b[k]);
  const sceneC = focus.length ? focus.map(k => `${k}-${k + 1}:soft`).join(',') : null;
  const scene = h('g', sceneC ? { c: sceneC } : {}, g0);
  const top = h('g', {}, g0);
  const tb = (p, x, y, s, o) => {
    const r = textBlock(p, x, y, s, o); const last = r.lines[r.lines.length - 1] || '';
    if (last.endsWith('…') && !String(s).trim().endsWith('…')) ctx.warn(`“${String(s).slice(0, 40)}” is too long for its space, so it is cut short. Shorten it.`);
    return r;
  };
  const lab = (p, x, y, id, col, o = {}) => tb(p, x, y, label(P, id), Object.assign({ cls: 'ts-label', maxW: 240, maxLines: 2, lh: 32, a: { fill: col, cls: 'strong' }, edit: `text.label:${id}` }, o));

  /* the leaf in sunlight */
  const sunG = h('g', { s: bi('leaf'), cls: 'pop' }, scene);
  h('circle', { cx: 112, cy: 174, r: 36, fill: 'var(--sun)', cls: 'body' }, sunG);
  const leafG = h('g', { s: bi('leaf'), cls: 'pop' }, scene);
  h('path', { d: STEM, fill: 'none', stroke: 'var(--ps-leaf-edge)', 'stroke-width': 26, 'stroke-linecap': 'butt' }, leafG);
  h('path', { d: LEAF, fill: 'var(--ps-leaf)', stroke: 'var(--ps-leaf-edge)', 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round' }, leafG);
  h('path', { d: MIDRIB, fill: 'none', stroke: 'var(--ps-leaf-edge)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, leafG);
  for (const [x0, y0, x1, y1] of [[400, 292, 440, 228], [480, 263, 530, 204], [560, 238, 610, 196], [420, 285, 470, 340], [510, 254, 560, 320], [600, 232, 640, 280]])
    h('path', { d: `M${x0} ${y0} Q ${(x0 + x1) / 2 + 8} ${(y0 + y1) / 2} ${x1} ${y1}`, fill: 'none', stroke: 'var(--ps-leaf-edge)', 'stroke-width': 'var(--sw-rule)', 'stroke-linecap': 'round' }, leafG);
  // named at its tip, clear of the arrows under it
  lab(leafG, 714, 210, 'leaf', 'var(--ink)', { maxW: 160, maxLines: 1 });
  T(sunG, 112, 242, 'Sun', 'ts-label', { 'text-anchor': 'middle', fill: 'var(--ink-2)' });

  /* light: three rays from the Sun to the leaf's upper surface */
  if (ins.includes('light')) {
    const k = bi('light'); const lg = h('g', { c: ctx.rc('light', null, 'soft') }, scene);
    for (const [x2, y2, d] of [[338, 268, 0], [392, 232, 150], [478, 200, 300]]) {
      line(ctx, lg, 160, 186, x2, y2, 'var(--ps-light)', 'var(--sw-arrow)', { draw: k, delay: d });
    }
    lab(h('g', { s: k, cls: 'rise', delay: 400 }, lg), 196, 146, 'light', 'var(--ps-light-text)', { maxW: 640, maxLines: 1 });
  }

  /* carbon dioxide: in from the air below right, through a stoma on the underside */
  const stoma = (p, [x, y]) => {
    h('ellipse', { cx: x, cy: y, rx: 12, ry: 7, fill: 'var(--paper)', stroke: 'var(--ps-leaf-edge)', 'stroke-width': 'var(--sw-rule)', transform: `rotate(-18 ${x} ${y})` }, p);
    h('line', { x1: x - 7, y1: y + 2, x2: x + 7, y2: y - 2, stroke: 'var(--ink)', 'stroke-width': 'var(--sw-rule)', 'stroke-linecap': 'round' }, p);
  };
  if (ins.includes('carbon_dioxide')) {
    const k = bi('carbon_dioxide'); const cg = h('g', { c: ctx.rc('carbon_dioxide', null, 'soft') }, scene);
    const sg = h('g', { s: k, cls: 'pop' }, cg); stoma(sg, STOMA_A); stoma(sg, STOMA_B);
    line(ctx, cg, 706, 410, STOMA_A[0] + 4, STOMA_A[1] + 10, 'var(--ps-co2)', 'var(--sw-arrow)', { draw: k, dash: '2 14', delay: 300 });
    lab(h('g', { s: k, cls: 'rise', delay: 500 }, cg), 622, 446, 'carbon_dioxide', 'var(--ps-co2-text)', { maxW: 278 });
  }

  /* water: up the stem in the xylem, into the midrib */
  if (ins.includes('water')) {
    const k = bi('water'); const wg = h('g', { c: ctx.rc('water', null, 'soft') }, scene);
    arrow(ctx, wg, 'M282 488 C 284 440, 290 392, 294 350', 294, 350, Math.atan2(350 - 392, 294 - 290), 'var(--ps-water)', 'var(--sw-arrow)', { draw: k });
    h('path', { d: 'M296 334 C 420 294, 520 254, 600 236', fill: 'none', stroke: 'var(--ps-water)', 'stroke-width': 'var(--sw-rule)', 'stroke-linecap': 'round', cls: 'draw', pathLength: 1, s: k, delay: 700 }, wg);
    lab(h('g', { s: k, cls: 'rise', delay: 400 }, wg), 266, 300, 'water', 'var(--ps-water-text)', { maxW: 200, maxLines: 3, anchor: 'end' });
  }

  /* glucose: made in the leaf, stays in the plant (a card on the leaf, and sucrose down the stem) */
  if (outs.includes('glucose')) {
    const k = bi('glucose'); const gg = h('g', { s: k, c: ctx.rc('glucose', null, 'soft') }, scene);
    const card = h('g', { cls: 'pop' }, gg);
    // the card sits right of the leaf tip, clear of the carbon dioxide arrow and the zoom
    const CX = 726, CY = 248;
    const name = lab(card, CX + 14, CY + 32, 'glucose', 'var(--ps-glu-text)', { maxW: 148, maxLines: 1 });
    const use = tb(card, CX + 14, CY + 32 + 30, label(P, 'starch'), { cls: 'ts-label', maxW: 148, maxLines: 3, lh: 32, a: { fill: 'var(--ink)' }, edit: 'text.label:starch' });
    const w = Math.max(name.w, use.w) + 28, hh = name.h + use.h + 18;
    card.insertBefore(h('rect', { x: CX, y: CY, width: w, height: hh, rx: 'var(--r-card)', fill: 'var(--paper)', stroke: 'var(--ps-glu)', 'stroke-width': 'var(--sw-rule)' }), card.firstChild);
    // a short tie from the card into the leaf, where the glucose is made
    h('line', { x1: CX, y1: CY + 14, x2: 652, y2: 232, stroke: 'var(--ps-glu)', 'stroke-width': 'var(--sw-lead)' }, card);
    h('circle', { cx: 652, cy: 232, r: 5, fill: 'var(--ps-glu)' }, card);
    // sucrose: carried down the stem, beside the xylem
    arrow(ctx, gg, 'M306 350 C 304 392, 300 432, 298 470', 298, 470, Math.atan2(470 - 432, 298 - 300), 'var(--ps-glu)', 'var(--sw-arrow)', { draw: k, delay: 400 });
    lab(h('g', { cls: 'rise', delay: 600 }, gg), 266, 412, 'sucrose', 'var(--ps-glu-text)', { maxW: 200, maxLines: 3, anchor: 'end' });
  }

  /* oxygen: out through a stoma, down and away */
  if (outs.includes('oxygen')) {
    const k = bi('oxygen'); const og = h('g', { s: k, c: ctx.rc('oxygen', null, 'soft') }, scene);
    if (!ins.includes('carbon_dioxide')) stoma(og, STOMA_B);
    line(ctx, og, STOMA_B[0] - 2, STOMA_B[1] + 10, 446, 410, 'var(--ps-o2)', 'var(--sw-arrow)', { draw: k, dash: '2 14' });
    lab(h('g', { cls: 'rise', delay: 400 }, og), 362, 446, 'oxygen', 'var(--ps-o2-text)', { maxW: 244 });
  }

  /* the chloroplast: a zoom from a spot on the leaf to a card on the right */
  if (P.chloroplast) {
    const k = bi('chloroplast');
    const box = { x: 904, y: 124, w: 312, h: 346 };
    const z = zoomInset(ctx, top, { src: { x: 596, y: 196, w: 40, h: 30 }, box, a: { s: k, cls: 'pop' }, under });
    const cx = box.x + box.w / 2, cy = 246;
    h('ellipse', { cx, cy, rx: 116, ry: 54, fill: 'var(--ps-leaf)', stroke: 'var(--ps-leaf-edge)', 'stroke-width': 'var(--sw-struct)' }, z.inner);
    // grana: flat stacks of discs, where the chlorophyll is
    for (const [dx, dy] of [[-68, -4], [-22, 16], [24, -14], [68, 8]])
      for (let i = 0; i < 3; i++) h('rect', { x: cx + dx - 18, y: cy + dy - 14 + i * 10, width: 36, height: 8, rx: 4, fill: 'var(--ps-leaf-edge)' }, z.inner);
    T(z.inner, cx, box.y + 48, label(P, 'chloroplast'), 'ts-label', { 'text-anchor': 'middle', fill: 'var(--ink)', cls: 'strong' }).dataset.edit = 'text.label:chloroplast';
    // chlorophyll sits in the stacks: a leader from its label to one
    h('line', { x1: cx - 50, y1: cy + 74, x2: cx - 64, y2: cy + 18, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-lead)' }, z.inner);
    h('circle', { cx: cx - 64, cy: cy + 18, r: 4, fill: 'var(--ink-2)' }, z.inner);
    tb(z.inner, cx, cy + 102, label(P, 'chlorophyll'), { cls: 'ts-label', maxW: 280, maxLines: 2, lh: 32, anchor: 'middle', a: { fill: 'var(--ink)', cls: 'strong' }, edit: 'text.label:chlorophyll' });
    tb(z.inner, cx, cy + 172, label(P, 'reaction'), { cls: 'ts-label', maxW: 280, maxLines: 2, lh: 32, anchor: 'middle', a: { fill: 'var(--ink)' }, edit: 'text.label:reaction' });
  }

  /* the word equation (and the symbol equation): a card along the bottom */
  if (P.wordEquation) {
    const k = bi('equation'); const y0 = sym ? 492 : 524, y1 = 640;
    const eg = h('g', { s: k, cls: 'rise' }, top);
    h('rect', { x: GRID.left, y: y0, width: GRID.right - GRID.left, height: y1 - y0, rx: 'var(--r-card)', fill: 'var(--paper)', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)' }, eg);
    const ey = y0 + (sym ? 64 : 66);
    const parts = [['carbon dioxide', '--ps-co2-text'], ['+', '--ink'], ['water', '--ps-water-text'], [null], ['glucose', '--ps-glu-text'], ['+', '--ink'], ['oxygen', '--ps-o2-text']];
    const AR = 170, GAP = 18;
    const ws = parts.map(([s]) => s == null ? AR : measure(eg, s, 'ts-label'));
    let x = (GRID.left + GRID.right) / 2 - (ws.reduce((a, c) => a + c, 0) + GAP * (parts.length - 1)) / 2;
    parts.forEach(([s, col], i) => {
      if (s == null) {
        line(ctx, eg, x + 6, ey - 10, x + AR - 6, ey - 10, 'var(--ink)', 'var(--sw-arrow)');
        T(eg, x + AR / 2, ey - 24, 'light', null, { 'text-anchor': 'middle', cls: 'ts-label strong', style: 'fill:var(--ps-light-text);font-size:calc(var(--fs-label) * 0.9)' });
        T(eg, x + AR / 2, ey + 26, 'chlorophyll', null, { 'text-anchor': 'middle', cls: 'ts-label', style: 'fill:var(--ink-2);font-size:calc(var(--fs-label) * 0.9)' });
      } else computed(T(eg, x, ey, s, 'ts-label', { fill: `var(${col})`, cls: 'strong' }), 'wordEquation');
      x += ws[i] + GAP;
    });
    if (sym) {
      const E = parseEquation(P.symbolEquation);
      const sg = h('g', { s: bi('symbol'), cls: 'rise' }, top);
      // runs of main text, subscripts (90% of the label size, dropped) and the signs between terms,
      // laid left to right from measured widths; no run carries a space, so no width hangs on one
      const runs = []; const add = (t, kind) => { const r = runs[runs.length - 1]; if (r && r.kind === kind && kind !== 'op') r.t += t; else runs.push({ t, kind }); };
      const formula = tm => { if (tm.n !== 1) add(String(tm.n), 'main'); for (const [, el, n] of tm.formula.matchAll(/([A-Z][a-z]?)(\d*)/g)) { add(el, 'main'); if (n) add(n, 'sub'); } };
      const side = ts => ts.forEach((tm, i) => { if (i) add('+', 'op'); formula(tm); });
      side(E.left); add('→', 'op'); side(E.right);
      const SUBA = { style: 'fill:var(--ink);font-size:calc(var(--fs-label) * 0.9)' }, MAIN = { fill: 'var(--ink)' }, OPGAP = 14;
      const wOf = r => measure(sg, r.t, 'ts-label', r.kind === 'sub' ? SUBA : MAIN) + (r.kind === 'op' ? 2 * OPGAP : r.kind === 'sub' ? 2 : 0);
      const total = runs.reduce((a, r) => a + wOf(r), 0);
      let sx = (GRID.left + GRID.right) / 2 - total / 2; const sy = y1 - 20;
      for (const r of runs) {
        const w = wOf(r), dx = r.kind === 'op' ? OPGAP : r.kind === 'sub' ? 1 : 0;
        computed(T(sg, sx + dx, sy + (r.kind === 'sub' ? 8 : 0), r.t, 'ts-label', r.kind === 'sub' ? SUBA : MAIN), 'symbolEquation');
        sx += w;
      }
    }
  }
  return {};
}
