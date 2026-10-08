// Electrical circuits: one series loop drawn as pictures (Year 4) or standard symbols (Year 6).
// The parts appear, the wires join them, the switch closes, current flows and the bulb lights.
// The model works out whether the loop is complete and how bright each bulb is; the teacher never
// sets "lit". Two optional extensions: a materials test in a gap (conductors and insulators) or a
// second loop with one more cell or one more bulb (brighter and dimmer). Built on the kit's
// batch E circuit(); this file only orders the parts so cells sit together and face one way.
import {
  h, T, clamp, GRID, headD,
  measure, textBlock, editable, computed, txt, TEXT_PARAM_FOR, LABEL_PARAM, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { apparatus, circuit, currentDots } from '../kit/batch-E.js';

export const meta = {
  id: 'circuits', name: 'Electrical circuits', kind: 'scene', version: 1,
  subjects: ['Science'],
  years: ['Y4', 'Y6'],
  teaches: 'A bulb lights only in a complete loop with a cell; switches open and close the loop, metals conduct, and more cells or fewer bulbs make a bulb brighter.',
};

const KINDS = ['bulb', 'buzzer', 'motor', 'switch'];
const NAME = { bulb: 'bulb', buzzer: 'buzzer', motor: 'motor', switch: 'switch', cell: 'cell' };
const NUM = ['no', 'one', 'two', 'three', 'four', 'five'];
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Electrical circuits',
  properties: {
    title: TITLE_PARAM('Does the bulb light?'),
    style: { type: 'string', title: 'Draw the circuit as', enum: ['pictures', 'symbols'], 'x-labels': ['Pictures of real parts', 'Circuit symbols'], default: 'pictures' },
    cells: { type: 'integer', title: 'Cells (batteries)', description: 'How many cells push the current. 0 shows a circuit with nothing to push it.', minimum: 0, maximum: 3, default: 1 },
    components: {
      type: 'array', title: 'Other parts in the loop', 'x-item': 'a part', maxItems: 4,
      default: [{ kind: 'bulb', label: '' }, { kind: 'switch', label: '' }],
      items: { type: 'object', required: ['kind'], default: { kind: 'bulb', label: '' }, properties: {
        kind: { type: 'string', title: 'Part', enum: KINDS, 'x-labels': ['Bulb', 'Buzzer', 'Motor', 'Switch'], default: 'bulb' },
        label: LABEL_PARAM('Label', '', { description: 'Leave empty to use the part’s name.' }),
      } },
    },
    switch: { type: 'string', title: 'The switch', description: 'Only used when the loop has a switch.', enum: ['closes', 'open', 'closed'], 'x-labels': ['Starts open, then closes', 'Stays open', 'Already closed'], default: 'closes' },
    layout: { type: 'string', title: 'Wires', enum: ['complete', 'broken'], 'x-labels': ['All joined in a loop', 'One wire not joined'], default: 'complete' },
    testMaterials: {
      type: 'array', title: 'Materials to test in a gap', description: 'Adds a gap to the loop. Each material is tested in its own step and sorted into conductors and insulators.',
      'x-item': 'a material', maxItems: 4, default: [],
      items: { type: 'object', required: ['name', 'conducts'], default: { name: 'a metal spoon', conducts: true }, properties: {
        name: { type: 'string', title: 'Material or object', minLength: 1, maxLength: 40 },
        conducts: { type: 'boolean', title: 'Conducts electricity', default: true },
      } },
    },
    compare: { type: 'string', title: 'Then change one thing', description: 'Shows a second loop beside the first.', enum: ['none', 'add-cell', 'add-bulb'], 'x-labels': ['No change', 'Add one more cell', 'Add one more bulb'], default: 'none' },
    current: { type: 'boolean', title: 'Show current flowing (dots)', default: true, 'x-panel': 'advanced' },
    // every label this model draws is a name on a part or a list heading: the kit's label cap
    text: TEXT_PARAM_FOR(Object.fromEntries(['bulb', 'buzzer', 'motor', 'switch', 'cell', 'cells', 'gap', 'break', 'conductors', 'insulators'].map(k => [k, 'label']))),
  },
};

export const presets = [
  { id: 'y4-does-it-light', name: 'Year 4: does the bulb light?', params: {
    title: 'Does the bulb light?', style: 'pictures', cells: 1,
    components: [{ kind: 'bulb', label: '' }, { kind: 'switch', label: '' }], switch: 'closes', layout: 'complete',
  } },
  { id: 'y4-broken', name: 'Year 4: why is the buzzer quiet?', params: {
    title: 'Why is the buzzer quiet?', style: 'pictures', cells: 2,
    components: [{ kind: 'buzzer', label: '' }, { kind: 'switch', label: '' }], switch: 'closed', layout: 'broken',
  } },
  { id: 'y4-materials', name: 'Year 4: conductors and insulators', params: {
    title: 'Conductors and insulators', style: 'pictures', cells: 1,
    components: [{ kind: 'bulb', label: '' }], layout: 'complete',
    testMaterials: [{ name: 'a metal spoon', conducts: true }, { name: 'a plastic ruler', conducts: false }, { name: 'aluminium foil', conducts: true }, { name: 'a wooden lolly stick', conducts: false }],
  } },
  { id: 'y6-adding-cells', name: 'Year 6: adding cells', params: {
    title: 'More cells, brighter bulb', style: 'symbols', cells: 1,
    components: [{ kind: 'bulb', label: '' }, { kind: 'switch', label: '' }], switch: 'closes', layout: 'complete', compare: 'add-cell',
  } },
];

/* ------------------------------------------------------------------ materials truth */
// [pattern, noun, conducts]. Metals are checked first, so "a paper clip" counts as metal.
const KNOWN = [
  [/\bgraphite\b|\bpencil lead\b/i, 'Graphite (pencil lead)', true],
  [/\bmetal|\bcopper\b|\biron\b|\bsteel\b|\balumin(i)?um\b|\bfoil\b|\bgold\b|\bsilver\b|\bbrass\b|\btin\b|\bnickel\b|\bzinc\b|\bcoins?\b|\bpaper ?clips?\b|\bnails?\b|\bscrews?\b|\bkeys?\b/i, 'Metal', true],
  [/\bplastic\b/i, 'Plastic', false], [/\bwood(en)?\b|\blolly sticks?\b/i, 'Wood', false],
  [/\brubber\b|\beraser\b/i, 'Rubber', false], [/\bglass\b/i, 'Glass', false],
  [/\bpaper\b|\bcard(board)?\b/i, 'Paper and card', false], [/\bfabric\b|\bcotton\b|\bwool(len)?\b|\bfelt\b|\bstring\b/i, 'Fabric', false],
  [/\bcork\b/i, 'Cork', false], [/\bpolystyrene\b/i, 'Polystyrene', false], [/\bceramic\b|\bpottery\b/i, 'Pottery', false],
];
function knownMaterial(name) { for (const [re, noun, c] of KNOWN) if (re.test(name)) return { noun, conducts: c }; return null; }

/* ------------------------------------------------------------------ arrangement */
// Mirrors the kit circuit()'s side choice (longest free side first) so the model can try orders
// and pick one where all cells share a side (and so all push the same way) and pictures stay on
// the top and bottom wires.
const SYM_L = { cell: 40, bulb: 64, switch: 48, buzzer: 64, motor: 64, resistor: 72, gap: 120 };
function simulate(order, box, style) {
  const len = [box.w, box.h, box.w, box.h], used = [0, 0, 0, 0], lists = [[], [], [], []], side = [];
  for (const c of order) {
    const need = style === 'pictures' ? 150 : (SYM_L[c.kind] || 64) + 50; let bi = -1, bf = -1e9;
    for (const i of [0, 2, 3, 1]) { const f = (len[i] - used[i] - need) / (lists[i].length + 2); if (f > bf) { bf = f; bi = i; } }
    if (bf < 0) return null;
    used[bi] += need; lists[bi].push(c); side.push(bi);
  }
  return { lists, side };
}
function score(order, box, style, first) {
  const r = simulate(order, box, style); if (!r) return null;
  const cs = new Set(order.map((c, i) => c.kind === 'cell' ? r.side[i] : null).filter(v => v != null));
  if (style === 'pictures' && (r.lists[1].length || r.lists[3].length)) return null;
  let cost = (r.lists[1].length + r.lists[3].length) * 2 + (cs.size > 1 ? 6 : 0);
  for (const L of r.lists) { const ix = L.map((c, j) => c.kind === 'cell' ? j : -1).filter(j => j >= 0); if (ix.length > 1 && ix[ix.length - 1] - ix[0] !== ix.length - 1) cost += 4; }
  if (cs.has(0)) cost += 1;
  if (first) { const i = order.indexOf(first); if (r.side[i] !== 0) cost += 3; }
  const gi = order.findIndex(c => c.kind === 'gap'); if (gi >= 0 && r.side[gi] !== 2) cost += 1;
  return cost;
}
function arrange(list, box, style, first) {
  let best = null, bestCost = Infinity; const n = list.length, used = new Array(n).fill(false), cur = [];
  const rec = () => {
    if (bestCost === 0) return;
    if (cur.length === n) { const c = score(cur, box, style, first); if (c != null && c < bestCost) { bestCost = c; best = cur.slice(); } return; }
    const tried = new Set();
    for (let i = 0; i < n; i++) {
      if (used[i]) continue; const key = list[i].kind + '|' + (list[i].label || '') + '|' + (list[i] === first);
      if (tried.has(key)) continue; tried.add(key);
      used[i] = true; cur.push(list[i]); rec(); cur.pop(); used[i] = false;
    }
  };
  rec(); return best;
}

// where loop 2's added part goes: beside the part it copies, on the same wire, with room to spare
const PIC_HALF = { cell: 38, bulb: 30 };
function extraSpot(order, box, style, twin) {
  const r = simulate(order, box, style); if (!r) return null;
  const pic = style === 'pictures', half = c => pic ? (PIC_HALF[c.kind] || 40) : (SYM_L[c.kind] || 64) / 2, corner = pic ? 30 : 20;
  let best = null;
  r.lists.forEach((L, s) => {
    const len = s % 2 ? box.h : box.w, n = L.length, t = j => len * (j + 1) / (n + 1);
    L.forEach((c, j) => {
      if (c.kind !== twin) return; const hw = half(c), dt = 2 * hw + 14;
      for (const sg of [1, -1]) {
        const at = t(j) + sg * dt, nb = L[j + sg];
        const room = sg > 0 ? (nb ? t(j + 1) - half(nb) - 10 : len - corner) - (at + hw) : (at - hw) - (nb ? t(j - 1) + half(nb) + 10 : corner);
        if (room >= 0 && (!best || room > best.room)) best = { src: c, d: sg * dt, room };
      }
    });
  });
  return best;
}

/* ------------------------------------------------------------------ model of the data */
// pictures are drawn 1.3 times kit size so real parts read from the back; the loop is laid out
// in a shrunk "virtual" box and the group is scaled about its centre
// symbols are drawn 1.6 times kit size on their own and 1.35 times in the side-by-side comparison
const PIC_S = 1.3, SYM_S = 1.6, CMP_S = 1.35;
const vbox = (b, s) => ({ x: b.x + b.w / 2 - b.w / s / 2, y: b.y + b.h / 2 - b.h / s / 2, w: b.w / s, h: b.h / s });
function boxes(mode, style) {
  const pic = style === 'pictures';
  const main = mode === 'materials' ? (pic ? { x: 120, y: 290, w: 480, h: 230 } : { x: 120, y: 250, w: 460, h: 250 })
    : (pic ? { x: 330, y: 290, w: 620, h: 230 } : { x: 350, y: 225, w: 580, h: 260 });
  const cmp = pic ? [{ x: 120, y: 300, w: 460, h: 210 }, { x: 700, y: 300, w: 460, h: 210 }] : [{ x: 130, y: 250, w: 460, h: 230 }, { x: 690, y: 250, w: 460, h: 230 }];
  return { main, cmp };
}
// an order of `list` that the kit lays out with exactly these kinds on each side, in this order
function matchOrder(list, box, style, target) {
  const n = list.length, used = new Array(n).fill(false), cur = []; let found = null;
  const ok = () => { const r = simulate(cur, box, style); return !!r && r.lists.every((L, s) => L.length <= target[s].length && L.every((c, j) => c.kind === target[s][j])); };
  const rec = () => {
    if (found) return; if (cur.length === n) { found = cur.slice(); return; }
    const tried = new Set();
    for (let i = 0; i < n; i++) {
      if (used[i] || tried.has(list[i].kind)) continue; tried.add(list[i].kind);
      used[i] = true; cur.push(list[i]); if (ok()) rec(); cur.pop(); used[i] = false;
    }
  };
  rec(); return found;
}
function model(P) {
  const comps = (P.components || []).map((c, i) => ({ kind: c.kind, label: (c.label && c.label.trim()) || txt(P, `label:${c.kind}`, NAME[c.kind]), edit: c.label && c.label.trim() ? `components.${i}.label` : `components.${i}.label`, i }));
  // a known material's conducting is a fact, so it comes from the name; the tick box only decides for
  // materials the model does not know
  const mats = (P.testMaterials || []).map(m => { const k = knownMaterial(m.name || ''); return { name: m.name, conducts: k ? k.conducts : !!m.conducts, ticked: !!m.conducts, known: k }; });
  const cells = P.cells | 0, style = P.style || 'pictures';
  const hasSwitch = comps.some(c => c.kind === 'switch');
  const loads = comps.filter(c => c.kind !== 'switch');
  const bulbs = comps.filter(c => c.kind === 'bulb').length;
  const mode = mats.length ? 'materials' : (P.compare && P.compare !== 'none') ? 'compare' : 'single';
  const sw = hasSwitch ? P.switch : 'none';
  // a materials test uses its own gap as the break, and a comparison starts from a working loop, so in
  // those modes the other wires are always joined (validate warns when the setting says otherwise)
  const layout = mode === 'single' ? P.layout : 'complete';
  const complete = cells > 0 && layout === 'complete' && sw !== 'open' && loads.length > 0;
  const bright = (c, n) => clamp(.1 + .4 * c / Math.max(1, n));
  const cellPart = (n, labelled) => Array.from({ length: n }, (_, j) => ({ kind: 'cell', label: labelled && j === 0 ? (n > 1 ? txt(P, 'label:cells', 'cells') : txt(P, 'label:cell', 'cell')) : null, edit: n > 1 ? 'text.label:cells' : 'text.label:cell' }));
  const first = loads[0] || null;
  const pic = style === 'pictures', B = boxes(mode, style), S = pic ? PIC_S : SYM_S;
  let SC = pic ? PIC_S : CMP_S;
  const V = vbox(B.main, S);
  const list1 = comps.concat(cellPart(cells, true), mode === 'materials' ? [{ kind: 'gap', label: null, gap: true }] : []);
  const order1 = arrange(list1, V, style, first);
  let order1c = null, order2 = null, c2 = null, spot = null;
  if (mode === 'compare' && order1) {
    c2 = { cells: cells + (P.compare === 'add-cell' ? 1 : 0), loads: loads.length + (P.compare === 'add-bulb' ? 1 : 0), bulbs: bulbs + (P.compare === 'add-bulb' ? 1 : 0) };
    // both comparison loops keep loop 1's layout; the added part sits next to the part it copies
    const t1 = simulate(order1, V, style).lists.map(L => L.map(c => c.kind));
    const plain = list1.map(c => Object.assign({}, c, { label: null }));
    const twin = P.compare === 'add-cell' ? 'cell' : 'bulb';
    // the two loops share the slide, so they are drawn smaller; when the added part has no room beside
    // its twin, both loops step down in size together until it does
    for (const sc of pic ? [PIC_S, 1.15, 1.0, 0.9] : [CMP_S, 1.2, 1.05]) {
      const VC = B.cmp.map(b => vbox(b, sc));
      order1c = matchOrder(plain, VC[0], style, t1) || arrange(plain, VC[0], style, first);
      spot = order1c && extraSpot(order1c, VC[1], style, twin);
      SC = sc; if (spot) break;
    }
    order2 = spot ? order1c : null;
  }
  return { comps, cells, mats, style, hasSwitch, sw, layout, loads, bulbs, mode, complete, b1: bright(cells, loads.length), b2: c2 ? bright(c2.cells, c2.loads) : 0, c2, B, S, SC, order1, order1c, order2, spot, first };
}

// "the bulb lights and the buzzer sounds" / "... stays off"
function loadPhrase(M, on) {
  const out = [];
  const n = k => M.loads.filter(c => c.kind === k).length;
  if (n('bulb')) out.push(n('bulb') > 1 ? (on ? 'the bulbs light' : 'the bulbs stay off') : (on ? 'the bulb lights' : 'the bulb stays off'));
  if (n('buzzer')) out.push(n('buzzer') > 1 ? (on ? 'the buzzers sound' : 'the buzzers stay quiet') : (on ? 'the buzzer sounds' : 'the buzzer stays quiet'));
  if (n('motor')) out.push(n('motor') > 1 ? (on ? 'the motors turn' : 'the motors stay still') : (on ? 'the motor turns' : 'the motor stays still'));
  return out.join(' and ') || (on ? 'current flows' : 'nothing happens');
}
function partsList(M) {
  const seq = [];
  if (M.cells) seq.push(M.cells === 1 ? 'a cell' : `${NUM[M.cells]} cells`);
  for (const k of ['bulb', 'buzzer', 'motor', 'switch']) { const n = M.comps.filter(c => c.kind === k).length; if (n) seq.push(n === 1 ? `a ${k}` : `${NUM[n]} ${k}es`.replace('switches', 'switches').replace(/(bulb|buzzer|motor)es/, '$1s')); }
  if (M.mode === 'materials') seq.push('a gap to test materials in');
  return seq.length > 1 ? seq.slice(0, -1).join(', ') + ' and ' + seq[seq.length - 1] : seq[0] || 'wires';
}
const makeIt = M => M.loads.some(c => c.kind === 'bulb') ? 'make the bulb light' : M.loads.some(c => c.kind === 'buzzer') ? 'make the buzzer sound' : 'make the motor turn';
const detector = M => M.loads.some(c => c.kind === 'bulb') ? ['the bulb lights', 'the bulb stays off'] : M.loads.some(c => c.kind === 'buzzer') ? ['the buzzer sounds', 'the buzzer stays quiet'] : ['the motor turns', 'the motor stays still'];

// what one more cell (or one more bulb) does to each kind of part in the loop: a bulb is brighter,
// a buzzer louder, a motor faster (the Year 6 brightness and volume objective)
function changeEffect(M, P) {
  const n = k => M.loads.filter(c => c.kind === k).length, more = P.compare === 'add-cell', out = [];
  const nb = n('bulb') + (more ? 0 : 1);
  if (nb) out.push(more ? (nb > 1 ? 'the bulbs are brighter' : 'the bulb is brighter') : 'each bulb is dimmer');
  if (n('buzzer')) out.push(n('buzzer') > 1 ? (more ? 'the buzzers are louder' : 'the buzzers are quieter') : (more ? 'the buzzer is louder' : 'the buzzer is quieter'));
  if (n('motor')) out.push(n('motor') > 1 ? (more ? 'the motors turn faster' : 'the motors turn more slowly') : (more ? 'the motor turns faster' : 'the motor turns more slowly'));
  return out.join(' and ');
}
const changeWord = (M, P) => P.compare === 'add-cell' ? (M.bulbs ? 'brighter' : M.loads.some(c => c.kind === 'buzzer') ? 'louder' : 'faster') : (M.c2.bulbs > 1 ? 'each bulb dimmer' : 'dimmer');

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const W = [];
  if (R.length) return result(R);
  const M = model(P);
  M.comps.forEach(c => { if (c.kind === 'motor' && M.style === 'pictures') R.push({ path: `components.${c.i}.kind`, reason: 'A motor is drawn only as a circuit symbol here. Choose “Circuit symbols”, or swap the motor for a bulb or buzzer.' }); });
  if (M.cells > 0 && M.loads.length === 0 && M.layout === 'complete' && !M.mats.length)
    R.push({ path: 'components', reason: M.hasSwitch ? 'With only a switch and wire, closing the switch makes a short circuit: the wire gets hot and the cell goes flat. Add a bulb, buzzer or motor.' : 'A cell joined back to itself with only wire is a short circuit: the wire gets hot and the cell goes flat. Add a bulb, buzzer or motor.' });
  if (M.mats.length) {
    if (P.compare && P.compare !== 'none') W.push({ path: 'compare', reason: 'One slide shows a materials test or a second loop, not both, so the materials test is shown. Remove the materials to show the second loop.' });
    if (!M.loads.some(c => c.kind === 'bulb' || c.kind === 'buzzer')) R.push({ path: 'components', reason: 'A materials test needs a bulb or buzzer to show whether current flows. Add one.' });
    if (M.cells === 0) R.push({ path: 'cells', reason: 'With no cell, nothing would light for any material, so the test would not show which materials conduct. Add a cell.' });
    if (P.layout !== 'complete') W.push({ path: 'layout', reason: 'In a materials test the gap is the break in the loop, so the other wires are drawn joined.' });
    if (M.sw === 'open') R.push({ path: 'switch', reason: 'With the switch open, nothing would light for any material. Close the switch for the test.' });
    M.mats.forEach((m, i) => {
      if (!m.known || m.known.conducts === m.ticked) return;
      W.push({ path: `testMaterials.${i}.conducts`, reason: m.known.conducts
        ? `${m.known.noun} conducts electricity, so “${m.name}” is shown as a conductor and the bulb lights.`
        : `${m.known.noun} is an insulator, so “${m.name}” is shown as an insulator and the bulb stays off.` });
    });
  }
  if (M.mode === 'compare') {
    if (P.compare === 'add-bulb' && !M.bulbs) R.push({ path: 'compare', reason: 'There is no bulb in the loop to add another of. Add a bulb, or choose “Add one more cell”.' });
    else if (M.cells === 0) R.push({ path: 'cells', reason: 'With no cell nothing works in the first loop, so there is nothing to compare. Add a cell.' });
    else if (M.sw === 'open') R.push({ path: 'switch', reason: 'With the switch open nothing works in the first loop, so there is nothing to compare. Close the switch.' });
    if (P.layout !== 'complete') W.push({ path: 'layout', reason: 'A comparison starts from a loop that works, so the wires are drawn joined.' });
    if (P.compare === 'add-cell' && M.cells >= 3) R.push({ path: 'cells', reason: 'More than three cells can blow a classroom bulb. Start with one or two cells.' });
  }
  if (R.length) return result(R);
  if (!M.order1) R.push({ path: 'components', reason: M.style === 'pictures' ? 'Too many parts to draw as pictures round one loop. Choose “Circuit symbols” or remove a part.' : 'Too many parts to fit round one loop on a slide. Remove a part or a cell.' });
  else if (M.mode === 'compare' && !M.order2) R.push({ path: 'compare', reason: M.style === 'pictures' ? 'The second loop has too many parts to draw as pictures. Choose “Circuit symbols” or use fewer cells.' : 'The second loop has too many parts to fit. Use fewer parts.' });
  if (M.loads.length && M.cells / M.loads.length > 2) W.push({ path: 'cells', reason: 'Three cells on one bulb may blow a classroom bulb; check what the bulb is made for.' });
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
function plan(P) {
  const M = model(P); const st = [];
  st.push({ key: 'parts', caption: `The parts: ${partsList(M)}.` });
  st.push({ key: 'wires', caption: M.layout === 'broken' ? 'Wires join the parts, but one wire is not joined.' : 'Wires join the parts into one loop.' });
  if (M.sw === 'closes') st.push({ key: 'switch', caption: 'The switch closes.' + (M.cells > 0 && M.layout === 'complete' ? ' Now the loop is complete.' : '') });
  if (M.mode === 'materials') {
    const [on, off] = detector(M);
    M.mats.forEach((m, i) => st.push({ key: `mat:${i}`, caption: m.conducts ? `${cap(m.name)} is a conductor: current flows and ${on}.` : `${cap(m.name)} is an insulator: no current flows, so ${off}.` }));
  } else if (M.complete) {
    st.push({ key: 'current', caption: 'Current flows all the way round the loop, through every part.' });
    // on its own, the summary is where the bulb lights (no separate build that the still repeats)
    if (M.mode === 'compare') {
      st.push({ key: 'light', caption: cap(loadPhrase(M, true)) + '.' });
      st.push({ key: 'change', caption: P.compare === 'add-cell' ? 'Now add one more cell to the same loop.' : 'Now add one more bulb to the same loop.' });
      st.push({ key: 'compare', caption: (P.compare === 'add-cell' ? 'With one more cell, ' : 'With one more bulb in the loop, ') + changeEffect(M, P) + '.' });
    }
  } else {
    const off = loadPhrase(M, false);
    st.push({ key: 'off', caption: M.cells === 0 ? `There is no cell to push current round, so ${off}.` : M.layout === 'broken' ? `The loop has a gap, so no current flows and ${off}.` : `The switch is open, so the loop is broken and ${off}.` });
  }
  let summary;
  if (M.mode === 'materials') summary = `Conductors let current through, so ${detector(M)[0]}. Insulators do not.`;
  else if (M.mode === 'compare') summary = (P.compare === 'add-cell' ? 'More cells push more current round, so ' : 'More bulbs in one loop share the push, so ') + changeEffect(M, P) + '.';
  else if (M.complete) summary = `A complete loop with a cell: ${loadPhrase(M, true)}.`;
  else summary = M.cells === 0 ? `No cell, so ${loadPhrase(M, false)}.` : M.layout === 'broken' ? `One wire is not joined, so ${loadPhrase(M, false)}.` : `The switch is open, so ${loadPhrase(M, false)}.`;
  return { M, steps: st, summary };
}
export function builds(P) { const { steps, summary } = plan(P); return { steps, summary: { caption: summary } }; }

export function notes(P) {
  const { M, steps } = plan(P); const sym = M.style === 'symbols';
  const out = steps.map(s => {
    if (s.key === 'parts') return sym ? 'These are standard circuit symbols. The long line of the cell is its positive (+) side; a circle with a cross is a bulb. Ask: what does each part do?' : `Name each part. A cell (often called a battery) pushes the current round. Ask: what do we need to ${makeIt(M)}?`;
    if (s.key === 'wires') return M.layout === 'broken' ? 'Point to the break. Even a small gap stops current flowing all the way round.' : 'A circuit must be a complete loop from one end of the cell, through every part, back to the other end.';
    if (s.key === 'switch') return 'Closing the switch joins the gap in the loop; opening it breaks the loop again. Ask: what happens if we open it?';
    if (s.key === 'current') return 'The dots show the current. It flows from the + end of the cell round to the − end, and it is the same all the way round: it is not used up.';
    if (s.key === 'light') return 'Every part works at once because the same current flows through them all. A bulb lights because current heats its thin wire (the filament) until it glows.';
    if (s.key === 'off') return M.cells === 0 ? 'A bulb needs a cell to push current through it. Ask: what would you add to make it work?' : M.layout === 'broken' ? 'Ask: where is the gap, and how would you fix it? Check every connection is tight.' : 'An open switch is a gap in the loop. Ask: what do we need to do to make it work?';
    if (s.key.startsWith('mat:')) { const m = M.mats[+s.key.slice(4)]; return m.conducts ? 'Metals are conductors. Graphite (pencil lead) is the one common non-metal that conducts too.' : 'Plastic, wood, rubber, glass and fabric are insulators. Ask: why are wires covered in plastic?'; }
    if (s.key === 'change') return 'Change only one thing, so it is a fair comparison.';
    if (s.key === 'compare') return P.compare === 'add-cell' ? `More cells give a bigger push, so more current flows and ${changeEffect(M, P)}. Too many cells can blow a bulb or damage a part, so use the number it is made for. The drawing shows the change, not an exact amount.` : 'Two bulbs in one loop share the push from the cell, so less current flows and each glows less brightly than one bulb on its own.';
    return '';
  });
  const summary = M.mode === 'materials' ? 'Ask the class to predict before each test, then sort the materials. Ask: what do all the conductors have in common?'
    : M.mode === 'compare' ? (P.compare === 'add-bulb' ? 'Ask: how could we make the bulb brighter again without changing the cells? (Take a bulb away.)' : 'Ask: what would happen with one cell and two bulbs? (Each bulb is dimmer.)') + ' Brightness in the drawing is shown, not measured.'
      : (M.complete ? 'Every part works at once because the same current flows through them all. A bulb lights because current heats its thin wire (the filament) until it glows. ' : '') + 'Ask the class to predict, then explain: a complete loop, a cell to push the current, and nothing broken or open.';
  return { steps: out, summary };
}

/* ------------------------------------------------------------------ render */
const SW = 'var(--sw-struct)';
function litSymbol(p, it, b, a) {
  const g = h('g', Object.assign({ transform: `translate(${it.x} ${it.y}) rotate(${it.ang})` }, a), p);
  h('circle', { cx: 0, cy: 0, r: 22, fill: 'var(--bg)' }, g);
  h('circle', { cx: 0, cy: 0, r: 22, fill: 'var(--energy)', opacity: Math.pow(b, 1.5) }, g);
  h('circle', { cx: 0, cy: 0, r: 22, fill: 'none', stroke: 'var(--ink)', 'stroke-width': SW }, g);
  h('path', { d: 'M-15.5 -15.5 L 15.5 15.5 M-15.5 15.5 L 15.5 -15.5', stroke: 'var(--ink)', 'stroke-width': SW }, g);
  return g;
}
function closedSymbol(p, it, a) {
  const g = h('g', Object.assign({ transform: `translate(${it.x} ${it.y}) rotate(${it.ang})` }, a), p);
  h('circle', { cx: -22, cy: 0, r: 5, fill: 'var(--ink)' }, g); h('circle', { cx: 22, cy: 0, r: 5, fill: 'var(--ink)' }, g);
  h('line', { x1: -22, y1: 0, x2: 22, y2: 0, stroke: 'var(--ink)', 'stroke-width': SW, 'stroke-linecap': 'round' }, g);
  return g;
}
// a point on the loop as far from every part as possible (and away from corners), for the break
function breakPoint(res, box) {
  const { x, y, w, h: hh } = box; let best = null;
  const cand = [];
  for (let t = 50; t <= hh - 50; t += 10) cand.push([x, y + t, 'v', -1], [x + w, y + t, 'v', 1]);
  for (let t = 60; t <= w - 60; t += 10) cand.push([x + t, y, 'h', -1], [x + t, y + hh, 'h', 1]);
  for (const c of cand) { const d = Math.min(...res.items.map(it => Math.hypot(it.x - c[0], it.y - c[1]) - it.r)); if (!best || d > best.d + 0.5) best = { x: c[0], y: c[1], o: c[2], s: c[3], d }; }
  return best;
}
// Part labels sit outside the loop at the Year 4 size (PIC_S times ts-small) however much the loop is
// scaled. Each label gets a lane: the top and bottom rows split the width between neighbouring labels
// (out to the grid, or `laneR`), and the height runs from the part to the title or the caption; side
// labels run from the part to the grid edge. A long label wraps, then steps down in size until it
// fits its lane whole.
const LANE_TOP = GRID.top - 25, LANE_BOT = GRID.foot - 12, LANE_GAP = 24;
const FIT_STEPS = [PIC_S, 1.15, 1.0, 0.9];
const norm = s => String(s).replace(/\s+/g, ' ').trim();
function fitText(parent, text, { anchor, maxLines, laneW, edit, a = {} }, f) {
  const n = Math.max(1, Math.min(4, Math.floor(maxLines(f)))); // libfix: a fourth line where the room allows, before any cut
  const tb = textBlock(parent, 0, 0, text, { cls: 'ts-small', maxW: laneW / f, maxLines: n, lh: 28, anchor, edit, a });
  return { tb, whole: norm(tb.lines.join(' ')) === norm(text) };
}
// tries each size until the text fits whole; the last try is kept (cut with "…") and warned about
function fitLabel(ctx, parent, text, opts) {
  let r = null, f = FIT_STEPS[0];
  for (f of FIT_STEPS) { if (r) r.tb.el.remove(); r = fitText(parent, text, opts, f); if (r.whole) break; }
  if (!r.whole) ctx.warn(`circuits: the label "${text}" is too long for the space by its part; shorten it`);
  return { tb: r.tb, f };
}
function placeLabels(ctx, res, stage, real, S, laneL, laneR) {
  const box = res.vb, cx = real.x + real.w / 2, cy = real.y + real.h / 2, pic = res.style === 'pictures';
  const toR = (vx, vy) => [cx + (vx - cx) * S, cy + (vy - cy) * S], toV = (rx, ry) => [cx + (rx - cx) / S, cy + (ry - cy) / S];
  const sideOf = it => it.y <= box.y + 1 ? 'top' : it.y >= box.y + box.h - 1 ? 'bottom' : it.x <= box.x + 1 ? 'left' : 'right';
  const labs = [];
  for (const it of res.items) {
    const c = it.c, text = c.kind === 'gap' ? c.material : c.label; if (!text) continue;
    const side = sideOf(it);
    // one "cells" label, centred on the cells that share its side
    const same = it.kind === 'cell' ? res.items.filter(o => o.kind === 'cell' && sideOf(o) === side) : [it];
    const vx = same.reduce((t, o) => t + o.x, 0) / same.length, vy = same.reduce((t, o) => t + o.y, 0) / same.length;
    const [rx, ry] = toR(vx, vy);
    const top = pic ? (it.kind === 'bulb' || it.kind === 'buzzer' ? 98 : 46) : 50, bot = pic ? 64 : 68, off = pic ? 56 : 44;
    labs.push({ it, text, edit: c.kind === 'gap' ? c.materialEdit : c.edit, side, rx, ry, top, bot, off });
  }
  // libfix: a side name too wide for the room beside its part moves to the row above or below the loop
  // (nearest edge), where the row lanes and stagger give it the width; it is never cut to "cel…"
  for (const l of labs) {
    if (l.side !== 'left' && l.side !== 'right') continue;
    const room = l.side === 'left' ? l.rx - l.off * S - laneL : laneR - l.rx - l.off * S;
    if (measure(stage, l.text, 'ts-small') * 0.9 <= room) continue;
    const up = l.ry < cy; l.side = up ? 'top' : 'bottom';
    l.ry = toR(0, up ? box.y : box.y + box.h)[1];
  }
  const row = sd => labs.filter(l => l.side === sd).sort((m, n) => m.rx - n.rx);
  // libfix: neighbours share the space between them by need, not halves: a long name takes room from a
  // short neighbour's half ("cell" next to a long name kept only "cel…" before)
  const needW = l => measure(stage, l.text, 'ts-small') * 1.0;
  const split = (a0, b0, pa, pb) => { const mid = (pa + pb) / 2, lo = pa + needW(a0) / 2 + LANE_GAP / 2, hi = pb - needW(b0) / 2 - LANE_GAP / 2;
    return lo <= hi ? Math.min(Math.max(mid, lo), hi) : pa + (pb - pa) * needW(a0) / (needW(a0) + needW(b0)); };
  const lanes0 = (L, at, lo0, hi0, byNeed) => L.forEach((l, j) => {
    const cutL = j ? (byNeed ? split(L[j - 1], l, at(L[j - 1]), at(l)) : (at(L[j - 1]) + at(l)) / 2) : null;
    const cutR = j < L.length - 1 ? (byNeed ? split(l, L[j + 1], at(l), at(L[j + 1])) : (at(l) + at(L[j + 1])) / 2) : null;
    l.lo = cutL == null ? lo0 : cutL + LANE_GAP / 2; l.hi = cutR == null ? hi0 : cutR - LANE_GAP / 2; });
  // a row whose names still do not fit side by side staggers onto two tiers (every other name one line
  // further out), so each name shares its width only with the names two along
  const lanes = (L, at, lo0, hi0, byNeed) => {
    lanes0(L, at, lo0, hi0, byNeed); L.forEach(l => { l.tier = 0; });
    if (!byNeed || L.length < 2 || !L.some(l => needW(l) > l.hi - l.lo)) return;
    for (const t of [0, 1]) { const sub = L.filter((_, j) => j % 2 === t); lanes0(sub, at, lo0, hi0, true); sub.forEach(l => { l.tier = t; }); }
  };
  const T0 = row('top'), B0 = row('bottom'), Lf = labs.filter(l => l.side === 'left').sort((m, n) => m.ry - n.ry), Rt = labs.filter(l => l.side === 'right').sort((m, n) => m.ry - n.ry);
  lanes(T0, l => l.rx, laneL, laneR, true); lanes(B0, l => l.rx, laneL, laneR, true);
  lanes(Lf, l => l.ry, real.y - 20, real.y + real.h + 20); lanes(Rt, l => l.ry, real.y - 20, real.y + real.h + 20);
  // a row shares one baseline: the last line above the tallest part, the first line below the parts
  const yTop = Math.min(...T0.map(l => l.ry - l.top * S)), yBot = Math.max(...B0.map(l => l.ry + l.bot * S));
  for (const l of labs) {
    let anchor, ax, ay, laneW, maxLines;
    if (l.side === 'top' || l.side === 'bottom') {
      anchor = 'middle'; ax = l.rx; laneW = Math.min(l.hi - l.lo, 420);
      const tierDy = l.tier ? 32 : 0; // the outer tier of a staggered row
      if (l.side === 'top') { ay = yTop - tierDy; maxLines = f => 1 + (ay - LANE_TOP - 19 * f) / (28 * f); }
      else { ay = yBot + tierDy; maxLines = f => 1 + (LANE_BOT - 6 * f - ay) / (28 * f); }
    } else {
      const sg = l.side === 'left' ? -1 : 1; anchor = sg < 0 ? 'end' : 'start'; ax = l.rx + sg * l.off * S; ay = l.ry;
      laneW = sg < 0 ? ax - laneL : laneR - ax; maxLines = f => (l.hi - l.lo) / (28 * f);
    }
    const [vax, vay] = toV(ax, ay);
    const g = h('g', {}, stage);
    const { tb, f } = fitLabel(ctx, g, l.text, { anchor, maxLines, laneW, edit: l.edit });
    const n = tb.lines.length, wR = tb.w * f;
    // slide a top or bottom label along its lane, as near over its part as the lane allows
    const cxR = anchor === 'middle' ? clamp(ax, l.lo + wR / 2, Math.max(l.lo + wR / 2, l.hi - wR / 2)) : ax;
    const dx = (cxR - ax) / f, dy = l.side === 'top' ? -(n - 1) * tb.lh : l.side === 'bottom' ? 0 : -(n - 1) * tb.lh / 2 + 8;
    tb.el.setAttribute('transform', `translate(${vax} ${vay}) scale(${f / S}) translate(${dx} ${dy})`);
    stage.appendChild(tb.el); g.remove();
    l.it.label = { el: tb.el, lines: tb.lines, lh: tb.lh };
  }
}
function placeCircuit(parent, P, ctx, M, order, real, { labels, S = M.S, a = {}, laneL = GRID.left, laneR = GRID.right }) {
  const box = vbox(real, S), cx = real.x + real.w / 2, cy = real.y + real.h / 2;
  const stage = h('g', S !== 1 ? { transform: `translate(${cx} ${cy}) scale(${S}) translate(${-cx} ${-cy})` } : {}, parent);
  // the kit draws the parts and wires; this model places the labels so long ones fit
  const comps = order.map(c => ({ kind: c.kind, open: c.kind === 'switch' ? M.sw !== 'closed' : undefined, lit: false, conducts: true, label: null, src: c }));
  const res = circuit(ctx, stage, comps, { box, style: M.style, a });
  res.sg = stage; res.vb = box; res.S = S; res.style = M.style;
  if (labels) {
    res.items.forEach(it => { const c = it.c.src; it.c = Object.assign({}, it.c, { label: c.gap ? null : c.label, edit: c.edit, material: c.gap ? txt(P, 'label:gap', 'test gap') : null, materialEdit: 'text.label:gap' }); });
    placeLabels(ctx, res, res.g, real, S, laneL, laneR);
  }
  for (const it of res.items) {
    // pictures: a cell on the bottom wire is turned round so every cell pushes the same way
    if (M.style === 'pictures' && it.kind === 'cell' && Math.abs(it.ang) > 90) it.el.firstChild.setAttribute('transform', `translate(${it.x} ${it.y}) scale(-1 1)`);
    // symbols: the + plate of a cell in the + colour, and a filled bulb
    if (M.style === 'symbols' && it.kind === 'cell') it.el.querySelectorAll('line').forEach(l => { if (l.getAttribute('y1') === '-26') l.style.setProperty('stroke', 'var(--heat)'); });
    if (M.style === 'symbols' && it.kind === 'bulb') { const c0 = it.el.querySelector('circle'); if (c0) c0.style.setProperty('fill', 'var(--rule)'); }
    it.el.querySelectorAll('[data-computed]').forEach(e => { if (it.c.src.i != null) e.dataset.computed = `components.${it.c.src.i}.kind`; else e.dataset.computed = 'compare'; });
  }
  if (M.style === 'pictures') res.g.firstChild.querySelectorAll('path').forEach(pa => pa.style.setProperty('stroke-width', 'var(--sw-lens)'));
  return res;
}

export function render(root, P, ctx) {
  const { M } = plan(P); const b = ctx.b, N = ctx.N; const pic = M.style === 'pictures';
  if (!M.order1) { ctx.warn('circuit: the parts do not fit round one loop'); return {}; }
  const dir = pic ? 1 : -1; const flows = [];
  const kPart = b.parts, kWire = b.wires;
  const stage = h('g', {}, root);
  const cmp = M.mode === 'compare' && M.order2 && M.order1c;

  // ---- loop 1 (on its own until the comparison starts)
  const box = M.B.main;
  const g1 = h('g', cmp ? { hide: b.change } : {}, stage);
  const res = placeCircuit(g1, P, ctx, M, M.order1, box, { labels: true, laneR: M.mode === 'materials' ? 630 : GRID.right });
  const wg = res.g.firstChild, L1 = res.sg;
  wg.querySelectorAll('path').forEach(pa => { pa.setAttribute('pathLength', 1); pa.classList.add('draw'); });
  wg.dataset.s = kWire;
  // where the wires will go, before they are drawn
  const loopD = 'M' + res.pts.map(q => q.join(' ')).join(' L ');
  res.g.insertBefore(h('path', { d: loopD, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)', 'stroke-dasharray': '4 10', 'stroke-linecap': 'round', s: kPart, hide: kWire }), wg);
  res.items.forEach((it, j) => {
    const wrap = h('g', { s: kPart, cls: 'pop', delay: j * 120 });
    res.g.insertBefore(wrap, it.el); wrap.appendChild(it.el);
    if (it.label) wrap.appendChild(it.label.el);
  });
  const ring = (x, y, r, s) => h('circle', { cx: x, cy: y, r, fill: 'none', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)', s, cls: 'pop' }, L1);
  // the break in a wire: the focus from the moment the wires are drawn
  let brk = null;
  if (M.layout === 'broken') {
    brk = breakPoint(res, res.vb);
    const bg = h('g', { s: kWire, cls: 'pop' }); res.g.insertBefore(bg, wg.nextSibling);
    const v = brk.o === 'v', L = 26;
    h('rect', v ? { x: brk.x - 12, y: brk.y - L, width: 24, height: 2 * L, fill: 'var(--bg)' } : { x: brk.x - L, y: brk.y - 12, width: 2 * L, height: 24, fill: 'var(--bg)' }, bg);
    for (const s of [-1, 1]) h('circle', { cx: v ? brk.x : brk.x + s * L, cy: v ? brk.y + s * L : brk.y, r: 6, fill: pic ? 'var(--ink-2)' : 'var(--ink)' }, bg);
    if (M.cells > 0) ring(brk.x, brk.y, 38, kWire);
    // the label sits inside the loop, next to the ring, well away from the slide edge; it is drawn at the
    // part-label size and fits the inside of the loop
    const vb = res.vb, S = res.S, inner = (vb.h - 70) * S;
    const opts = v ? { anchor: brk.s < 0 ? 'start' : 'end', laneW: (vb.w - 110) * S, maxLines: f => inner / (28 * f), edit: 'text.label:break', a: { s: kWire, cls: 'rise' } }
      : { anchor: 'middle', laneW: (vb.w - 80) * S, maxLines: f => (vb.h - 110) * S / (28 * f), edit: 'text.label:break', a: { s: kWire, cls: 'rise' } };
    const bgl = h('g', {}, L1);
    const { tb, f } = fitLabel(ctx, bgl, txt(P, 'label:break', 'not joined'), opts);
    const n = tb.lines.length, ax = v ? brk.x - brk.s * 50 : brk.x, ay = v ? brk.y : (brk.s < 0 ? brk.y + 70 : brk.y - 50);
    const dy = v ? -(n - 1) * tb.lh / 2 + 8 : brk.s < 0 ? 0 : -(n - 1) * tb.lh;
    tb.el.setAttribute('transform', `translate(${ax} ${ay}) scale(${f / S}) translate(0 ${dy})`);
    L1.appendChild(tb.el); bgl.remove();
    const lab = tb;
    lab.el.style.setProperty('fill', 'var(--focus-text)');
  }
  // the switch closes
  if (M.sw === 'closes' && b.switch != null) for (const it of res.items.filter(i => i.kind === 'switch')) {
    it.el.dataset.h = b.switch;
    if (pic) apparatus(L1, 'switch', it.x, it.y + 6, 1, { s: b.switch }, { open: false });
    else closedSymbol(L1, it, { s: b.switch });
  }
  // lit bulbs and sounding buzzers
  const light = (r, g, bright, a) => { for (const it of r.items) {
    if (it.kind === 'bulb') { if (pic) apparatus(g, 'bulb', it.x, it.y + 6, 1, Object.assign({}, a), { lit: true, brightness: bright }); else litSymbol(g, it, bright, Object.assign({}, a)); }
    if (it.kind === 'buzzer' && pic) apparatus(g, 'buzzer', it.x, it.y + 6, 1, Object.assign({}, a), { on: true });
  } };
  // current: dots big enough for the back of the room, and an arrowhead on each clear side for direction
  const dots = (r, a) => {
    if (P.current === false) return;
    const d = currentDots(r.sg, r.pts, { avoid: r.avoid, a, r: 8 / r.S }); flows.push(d);
    const ag = h('g', Object.assign({}, a), r.sg), hs = 22 / r.S;
    for (let i = 0; i < 4; i++) {
      const p0 = r.pts[i], p1 = r.pts[i + 1], mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
      if (r.items.some(it => Math.hypot(it.x - mx, it.y - my) < it.r + hs)) continue;
      const ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) + (dir < 0 ? Math.PI : 0);
      h('path', { d: headD(mx + Math.cos(ang) * hs / 2, my + Math.sin(ang) * hs / 2, ang, hs), fill: 'var(--energy)' }, ag);
    }
  };
  if (M.mode === 'materials') {
    M.mats.forEach((m, i) => { const k = b[`mat:${i}`]; if (m.conducts) { light(res, L1, M.b1, { s: k, hide: k + 1 }); dots(res, { s: k, hide: k + 1 }); } });
    // the sorted lists: conductors above insulators, one wide column beside the loop. Tried at full
    // size first, then higher up the slide and tighter, until the whole column fits above the caption.
    const k0 = b['mat:0'], tx = 650, cw = GRID.right - tx - 34;
    const column = ({ cls, lh, ty0, sep, gap }) => {
      const G = h('g', {}, stage); let ty = ty0, bottom = 0;
      for (const c of [{ key: 'conductors', word: 'Conductors', on: true }, { key: 'insulators', word: 'Insulators', on: false }]) {
        const g = h('g', { s: k0, cls: 'rise' }, G);
        h('circle', { cx: tx + 12, cy: ty - 10, r: 11, fill: c.on ? 'var(--energy)' : 'var(--bg)', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-hair)' }, g);
        const hd = textBlock(g, tx + 34, ty, txt(P, `label:${c.key}`, c.word), { cls: 'ts-label', maxW: cw, maxLines: 2, lh: 36, edit: `text.label:${c.key}` });
        hd.el.style.setProperty('fill', 'var(--ink)');
        const ry = ty + (hd.lines.length - 1) * hd.lh + 18;
        h('line', { x1: tx, x2: GRID.right, y1: ry, y2: ry, stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)' }, g);
        let y = ry + lh + 8; bottom = ry + 4;
        M.mats.forEach((m, i) => {
          if (!!m.conducts !== c.on) return;
          const tb = textBlock(G, tx + 34, y, m.name, { cls, maxW: cw, maxLines: 2, lh, edit: `testMaterials.${i}.name`, a: { s: b[`mat:${i}`], cls: 'rise' } });
          tb.el.style.setProperty('fill', 'var(--ink)'); tb.el.style.setProperty('font-weight', 'var(--w-body)');
          bottom = y + (tb.lines.length - 1) * tb.lh + 8; y += tb.h + gap;
        });
        ty = Math.max(y, ry + lh) + sep;
      }
      return { G, ok: bottom <= GRID.bottom + 10 };
    };
    let colR = null;
    for (const c of [{ cls: 'ts-label', lh: 36, ty0: 250, sep: 40, gap: 10 }, { cls: 'ts-label', lh: 36, ty0: 170, sep: 30, gap: 6 }, { cls: 'ts-small', lh: 30, ty0: 160, sep: 24, gap: 4 }]) {
      if (colR) colR.G.remove(); colR = column(c); if (colR.ok) break;
    }
    if (!colR.ok) ctx.warn('circuits: the materials list runs below the slide');
  } else if (M.complete) {
    dots(res, { s: b.current });
    light(res, L1, M.b1, { s: b.light != null ? b.light : N });
  } else if (b.off != null) {
    if (M.cells > 0 && M.layout !== 'broken' && M.sw === 'open') for (const it of res.items.filter(i => i.kind === 'switch')) ring(it.x, pic ? it.y - 8 : it.y, pic ? 62 : 46, b.off);
  }

  // ---- the comparison: loop 1 again, smaller and without part labels, and loop 2 with one change
  if (cmp) {
    const [box1, box2] = M.B.cmp;
    const g1c = h('g', { s: b.change, cls: 'rise', c: `${b.change}-${b.compare + 1}:soft` }, stage);
    const r1 = placeCircuit(g1c, P, ctx, Object.assign({}, M, { sw: M.sw === 'open' ? 'open' : 'closed' }), M.order1c, box1, { labels: false, S: M.SC });
    light(r1, r1.sg, M.b1, {}); dots(r1, {});
    const g2 = h('g', { s: b.change, cls: 'rise' }, stage);
    const r2 = placeCircuit(g2, P, ctx, Object.assign({}, M, { sw: M.sw === 'open' ? 'open' : 'closed' }), M.order2, box2, { labels: false, S: M.SC });
    // the added part: a copy of its twin, beside it on the same wire, so nothing else moves
    const tw = r2.items.find(it => it.c.src === M.spot.src);
    if (tw) {
      const an = tw.ang * Math.PI / 180, dx = Math.cos(an) * M.spot.d, dy = Math.sin(an) * M.spot.d;
      const cl = tw.el.cloneNode(true); h('g', { transform: `translate(${dx} ${dy})` }, tw.el.parentNode).appendChild(cl);
      r2.items.push(Object.assign({}, tw, { x: tw.x + dx, y: tw.y + dy, el: cl, label: null }));
      r2.avoid.push({ x: tw.x + dx, y: tw.y + dy, r: tw.r });
    }
    light(r2, r2.sg, M.b2, { s: b.compare });
    dots(r2, { s: b.compare });
    const word = changeWord(M, P);
    const wy = box2.y - (pic ? 152 * M.SC / PIC_S : 66 * M.SC / CMP_S);
    const w = computed(T(stage, box2.x + box2.w / 2, wy, word, 'ts-label', { 'text-anchor': 'middle', s: b.compare, cls: 'rise' }), 'compare');
    w.style.setProperty('fill', 'var(--energy-text)');
    const hy = Math.max(box1.y + box1.h, box2.y + box2.h) + (pic ? 100 : 80);
    const others = M.loads.filter(c => c.kind !== 'bulb').map(c => c.kind), kinds = ['buzzer', 'motor'].filter(k => others.includes(k));
    // "1 cell, 1 bulb"; a loop with no bulb names its buzzer or motor instead
    const lbl = (c, n) => [plural(c, 'cell')].concat(n ? [plural(n, 'bulb')] : [], n ? [] : kinds.map(k => plural(others.filter(o => o === k).length, k))).join(', ');
    computed(T(stage, box1.x + box1.w / 2, hy, lbl(M.cells, M.bulbs), 'ts-label', { 'text-anchor': 'middle', s: b.change, cls: 'rise' }), 'cells');
    computed(T(stage, box2.x + box2.w / 2, hy, lbl(M.c2.cells, M.c2.bulbs), 'ts-label', { 'text-anchor': 'middle', s: b.change, cls: 'rise' }), 'compare');
    if (hy > GRID.bottom) ctx.warn('circuits: comparison labels run below the slide');
  }

  const setAll = t => flows.forEach(f => f.set(dir * ((t * 0.05) % 1)));
  setAll(0.4);
  return { tick: (k, u, t) => setAll(t || 0), still: () => setAll(0.4), reset: () => setAll(0.4) };
}
