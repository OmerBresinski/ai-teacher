// Number bonds and part–whole. One whole split into two or three parts, shown as a part–whole
// (cherry) diagram, counters in a ten frame, a train of cubes or a bar model. Ten frames and cubes
// sit beside a small cherry diagram that carries the numbers (concrete next to the model).
// Builds: the whole, the split, the words "whole" and "part", the parts swapped round, the facts
// the bond gives, and (optional) every bond of the whole in order.
// The parts are typed by the teacher; validate() refuses parts that do not add up to the whole.
import {
  h, T, measure, GRID, textBlock, tenFrame,
  editable, computed, txt, TEXT_PARAM_FOR, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { isWholeNumber, fmtNum, partWhole } from '../kit/batch-A.js';

export const meta = {
  id: 'number_bonds', name: 'Number bonds', kind: 'info', version: 1,
  subjects: ['Maths'],
  years: ['Reception', 'Y1', 'Y2'],
  teaches: 'A whole number splits into parts that add back to the whole, in either order, and each bond gives addition and subtraction facts.',
};

const REPS = ['cherry', 'tenframe', 'cubes', 'bar'];
const REP_LABELS = ['Part–whole model (cherry)', 'Counters in a ten frame', 'Cubes in a train', 'Bar model'];

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Number bonds',
  properties: {
    title: TITLE_PARAM('Number bonds to 10'),
    whole: { type: 'number', title: 'The whole', description: 'The number being split, from 1 to 100.', minimum: 1, maximum: 100, default: 10 },
    parts: {
      type: 'array', title: 'The parts', description: 'Two or three whole numbers that add up to the whole.',
      'x-item': 'a part', minItems: 2, maxItems: 3, default: [6, 4],
      items: { type: 'number', title: 'Part', minimum: 0, maximum: 100, default: 1 },
    },
    representation: { type: 'string', title: 'Show it as', enum: REPS, 'x-labels': REP_LABELS, default: 'cherry',
      description: 'Ten frames and cubes work up to 20. The cherry and the bar work up to 100.' },
    showAll: { type: 'boolean', title: 'List every bond of the whole', description: 'Adds a last step listing every bond in order. Wholes up to 20 list every bond; 30, 40 and so on up to 100 list the bonds in tens.', default: false },
    // the words sit in narrow lanes beside circles, frames and bars: names, not sentences
    text: TEXT_PARAM_FOR({ whole: 'label', part0: 'label', part1: 'label', part2: 'label', parts: 'label', allHead: 'phrase' }),
  },
};

export const presets = [
  { id: 'rec-bonds-5', name: 'Reception: ways to make 5', params: {
    title: 'Ways to make 5', whole: 5, parts: [3, 2], representation: 'cubes', showAll: true,
  } },
  { id: 'y1-bonds-10', name: 'Year 1: bonds to 10 in a ten frame', params: {
    title: 'Number bonds to 10', whole: 10, parts: [7, 3], representation: 'tenframe', showAll: true,
  } },
  { id: 'y1-three-parts', name: 'Year 1: 8 in three parts', params: {
    title: 'Three parts make 8', whole: 8, parts: [3, 4, 1], representation: 'cherry', showAll: false,
  } },
  { id: 'y2-bonds-100', name: 'Year 2: bonds to 100 in tens', params: {
    title: 'Number bonds to 100', whole: 100, parts: [60, 40], representation: 'bar', showAll: false,
  } },
];

/* ------------------------------------------------------------------ colours */
// Part colours: orange, teal, blue. The whole is neutral ink: it is all the parts together.
const PC = [
  { fill: 'var(--counter)', text: 'color-mix(in oklab, var(--counter) 62%, var(--ink))', pale: 'color-mix(in oklab, var(--counter) 18%, var(--paper))' },
  { fill: 'var(--compare)', text: 'var(--compare-text)', pale: 'var(--compare-pale)' },
  { fill: 'var(--water)', text: 'var(--water-text)', pale: 'color-mix(in oklab, var(--water) 16%, var(--paper))' },
];
const NEUTRAL = 'color-mix(in oklab, var(--ink) 30%, var(--paper))';
const EDGE = c => `color-mix(in oklab, ${c} 70%, var(--shade))`;
const MINUS = '−';

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const W = [];
  if (R.length) return result(R);
  const w = P.whole, parts = P.parts;
  if (!isWholeNumber(w)) R.push({ path: 'whole', reason: `The whole is ${w}. Number bonds here use whole numbers, so pick a whole number from 1 to 100.` });
  parts.forEach((v, i) => {
    if (!isWholeNumber(v)) R.push({ path: `parts.${i}`, reason: v < 0 ? `Part ${i + 1} is ${fmtNum(v)}. A part can't be less than 0: use 0 or more.` : `Part ${i + 1} is ${fmtNum(v)}. Number bonds here use whole numbers, so use a whole number.` });
  });
  if (R.length) return result(R);
  // the parts are what the teacher typed; when they don't add up to the whole yet, the whole follows
  // them (with a warning), so changing the whole and a part one at a time never locks either
  const sum = parts.reduce((a, b) => a + b, 0), last = `parts.${parts.length - 1}`;
  if (sum === 0) R.push({ path: last, reason: 'Every part is 0, so there is no whole to split. Make at least one part bigger than 0.' });
  else if (sum > 100) R.push({ path: last, reason: `${parts.join(' + ')} makes ${sum}. Wholes here go up to 100, so make the parts smaller.` });
  if (R.length) return result(R);
  if (sum !== w) W.push({ path: 'whole', reason: `${parts.join(' + ')} makes ${sum}, not ${w}, so the slide shows a whole of ${sum}. Change the whole or a part so they agree.` });
  const E = sum;
  if (P.representation === 'tenframe' && E > 20) R.push({ path: 'representation', reason: `Ten frames show up to 20 (two frames). For ${E}, use the part–whole model or the bar model.` });
  if (P.representation === 'cubes' && E > 20) R.push({ path: 'representation', reason: `${E} cubes are too many to count on one slide. Use cubes for wholes up to 20, or the bar model for bigger numbers.` });
  if (P.showAll && E > 20 && E % 10) R.push({ path: 'showAll', reason: `Every bond of ${E} is ${E + 1} lines, too many for one slide. Turn off “List every bond”, or use a whole of 20 or less, or a whole in tens such as 50 or 100.` });
  return result(R, W);
}

/* ------------------------------------------------------------------ plan */
// the whole drawn is always the sum of the parts (validate() warns when the typed whole differs)
function eff(P) { const sum = (P.parts || []).reduce((a, b) => a + b, 0); return sum > 0 && sum !== P.whole ? Object.assign({}, P, { whole: sum }) : P; }
function model(P) {
  const w = P.whole, parts = P.parts.slice(), n = parts.length;
  const order = parts.map((_, i) => i);
  const swapped = order.slice().reverse();
  const canSwap = parts.some((v, i) => v !== parts[n - 1 - i]);
  // facts as token lists: {s, k} where k is a part index or 'w'
  const N = i => ({ s: fmtNum(parts[i]), k: i }), Wt = { s: fmtNum(w), k: 'w' }, op = s => ({ s: ` ${s} ` });
  const facts = [];
  if (n === 2) {
    facts.push([N(0), op('+'), N(1), op('='), Wt], [N(1), op('+'), N(0), op('='), Wt], [Wt, op(MINUS), N(0), op('='), N(1)], [Wt, op(MINUS), N(1), op('='), N(0)]);
  } else {
    facts.push([N(0), op('+'), N(1), op('+'), N(2), op('='), Wt], [N(2), op('+'), N(1), op('+'), N(0), op('='), Wt], [Wt, op(MINUS), N(0), op(MINUS), N(1), op('='), N(2)]);
  }
  const seen = new Set(); const uniq = facts.filter(f => { const s = f.map(t => t.s).join(''); if (seen.has(s)) return false; seen.add(s); return true; });
  return { w, parts, n, order, swapped, canSwap, facts: uniq };
}
// wholes over 20 (in tens) list their bonds in tens: 0 + 100, 10 + 90, ... (Year 2 bonds to 100)
const stepOf = w => w > 20 ? 10 : 1;
const andList = a => a.length === 2 ? `${a[0]} and ${a[1]}` : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;

function plan(P0) {
  const P = eff(P0), M = model(P), w = fmtNum(M.w), ps = M.parts.map(v => fmtNum(v)), rev = ps.slice().reverse();
  const two = M.n === 2;
  const whole = {
    cherry: `The whole is ${w}. It goes in the top circle.`,
    tenframe: `${w} counters in the ten frame${M.w > 10 ? 's' : ''}: this is the whole.`,
    cubes: `${w} cubes joined in a train: this is the whole.`,
    bar: `The top bar is the whole: ${w}.`,
  }[P.representation];
  const steps = [
    { key: 'whole', caption: whole },
    { key: 'split', caption: `Split it into ${two ? 'two' : 'three'} parts: ${andList(ps)}.` },
    { key: 'label', caption: `${w} is the whole. ${andList(ps)} are the parts.` },
  ];
  if (M.canSwap) steps.push({ key: 'swap', caption: two ? `Swap the parts round: ${rev[0]} and ${rev[1]} still make ${w}.` : `Change the order: ${andList(rev)} still make ${w}.` });
  steps.push({ key: 'facts', caption: `The same parts and whole give ${M.facts.length} facts, adding and taking away.` });
  if (P.showAll) steps.push({ key: 'all', caption: stepOf(M.w) > 1 ? `The bonds to ${w} in tens, in order: as one part goes up by 10, the other goes down by 10.` : `Every bond to ${w}, in order: as one part goes up, the other goes down.` });
  return { M, steps, summary: `${andList(ps)} make ${w}: a number bond to ${w}.` };
}
export function builds(P) { const { steps, summary } = plan(P); return { steps, summary: { caption: summary } }; }

export function notes(P0) {
  const P = eff(P0), { M, steps } = plan(P);
  const rep = P.representation;
  const N = {
    whole: rep === 'tenframe' ? 'Count the counters together first. Ask: how many spaces are empty? A full frame is 10.'
      : rep === 'cubes' ? 'Count the cubes together, touching each one once. The whole train is the whole number.'
      : rep === 'bar' ? 'The bar stands for the whole amount. Its length is the whole.'
      : 'The top circle holds the whole. Ask: what could we split this into?',
    split: 'Nothing is added or taken away: the same counters or cubes are now in parts. Ask: how many in each part?',
    label: '“Whole” and “part” are the words to use every time. Ask a child to point at the whole, then at each part.',
    swap: `The parts change places but the whole stays the same. This is why ${M.parts.join(' + ')} and ${M.parts.slice().reverse().join(' + ')} give the same answer.`,
    facts: M.n === 2 ? 'Two adding facts and two taking-away facts from one bond. Cover one number and ask which it is.' : 'Adding three parts in any order gives the whole. Taking away two parts leaves the third.',
    all: stepOf(M.w) > 1 ? `Read the list together and link each line to a bond of ${M.w / 10}: ${Math.floor(M.w / 30)} + ${M.w / 10 - Math.floor(M.w / 30)} = ${M.w / 10}, so ${Math.floor(M.w / 30) * 10} + ${M.w - Math.floor(M.w / 30) * 10} = ${M.w}. These are the ${M.w / 10 + 1} bonds in tens; there are ${M.w + 1} bonds in all when 0 counts as a part.`
      : `Read the list together. Ask: what pattern do you see? There are ${M.w + 1} bonds when 0 counts as a part.`,
  };
  return { steps: steps.map(s => N[s.key]), summary: 'Ask: if I hide one part, how can you work it out from the whole and the other part?' };
}

/* ------------------------------------------------------------------ render */
// A coloured row of tokens as one text element (tspans), so the fact measures and wraps as one.
function factText(p, x, y, toks, cls, a) {
  const t = T(p, x, y, '', cls, a);
  for (const k of toks) h('tspan', { text: k.s, fill: k.k === 'w' ? 'var(--ink)' : k.k == null ? 'var(--ink-2)' : PC[k.k].text }, t);
  return t;
}
const off = (k) => `${k}-${k + 1}:off`;

export function render(root, P0, ctx) {
  const P = eff(P0), { M } = plan(P); const b = ctx.b, NB = ctx.N;
  // the teacher must see why the slide's whole differs from the one typed in the panel
  if (P0.whole !== P.whole) ctx.warn(`${M.parts.join(' + ')} makes ${P.whole}, not ${P0.whole}, so the slide shows a whole of ${P.whole}. Change the whole or a part so they agree.`);
  const kW = b.whole, kS = b.split, kL = b.label, kSw = b.swap, kF = b.facts, kA = b.all;
  const rep = P.representation, n = M.n, w = M.w;
  const ALL = !!P.showAll;
  const zx0 = GRID.left, zx1 = GRID.right, zW = zx1 - zx0, CX = (zx0 + zx1) / 2;
  // the words "whole" and "part" are read from the back of the class: bigger than a plain label
  const LBL = 'ts-num', LH = 44;
  const wordWhole = txt(P, 'label:whole', 'whole');
  // each part has its own word (“part”, or a name such as “red”), so it travels with its part
  const wordPart = i => txt(P, `label:part${i}`, 'part');
  // the list of every bond takes the stage on its own: the bond and its facts step aside for it
  const stage = kA != null ? `${kA}-${kA + 1}:off` : null;
  const gRep = h('g', { c: stage }, root), gText = h('g', { c: stage }, root);
  // the words keep full strength to the end: dimmed grey text is lost on a projector
  const labSoft = null;
  // swap: the swapped copy shows only at the swap build; the original steps aside meanwhile
  const swapPos = (i) => M.swapped.indexOf(i); // where part i sits after the swap
  // a faded-out group still catches clicks, so only the set on show takes the pointer
  const swapSets = [], origSets = [];
  const pe = k => { for (const g of swapSets) g.style.pointerEvents = k === kSw ? '' : 'none'; for (const g of origSets) g.style.pointerEvents = k === kSw ? 'none' : ''; };

  // A wording block that fits a box: wrap at the label size, then wrap again at the minimum size
  // with as many lines as the height allows. y is the first baseline; maxH is measured from the
  // top of the first line. Returns the block with its top and bottom.
  // A word is drawn at the label size only when it fits on one line; longer wording wraps at the
  // calmer label step, then at the minimum size with as many lines as the height allows.
  const FS = { [LBL]: 40, 'ts-label': 30, 'ts-tiny': 22 }, ASC = .78;
  const fullOf = s => String(s).split(/\s+/).filter(Boolean).join(' ');
  function fitText(p, x, y, s, { maxW, maxH, anchor = 'middle', a, edit, maxLines = 3, quiet, from = 0 }) {
    let tb;
    // from: the step to start at, so a row of words shares one size and one baseline
    const steps = [[LBL, LH, 1], ['ts-label', 36, maxLines], ['ts-tiny', 26, 99]];
    for (let st = from; st < steps.length; st++) {
      const [cls, lh, most] = steps[st], fs = FS[cls], n = Math.max(1, Math.min(most, Math.floor((maxH - fs) / lh) + 1));
      if (tb) tb.el.remove();
      // textBlock's own fallback would shrink with the same line count: give it one size at a time
      tb = textBlock(p, x, y - (FS[LBL] - fs) * ASC, s, { cls, maxW, maxLines: n, lh, anchor, a, edit });
      tb.step = steps.findIndex(q => q[0] === tb.cls);
      if (tb.cls === cls && tb.lines.join(' ') === fullOf(s)) break;
    }
    // wrapped wording is balanced, so a last line is never a lone short word
    if (tb.lines.length > 1 && tb.lines.join(' ') === fullOf(s)) {
      const fs0 = FS[tb.cls], lh0 = tb.lh, n0 = tb.lines.length, y0 = y - (FS[LBL] - fs0) * ASC;
      for (let mw = tb.w - 12; mw > tb.w / 2; mw -= 12) {
        const t = textBlock(p, x, y0, s, { cls: tb.cls, maxW: mw, maxLines: n0, lh: lh0, anchor, a, edit });
        if (t.cls === tb.cls && t.lines.length === n0 && t.lines.join(' ') === fullOf(s)) { t.step = tb.step; tb.el.remove(); tb = t; } else { t.el.remove(); break; }
      }
    }
    const fs = FS[tb.cls] || 40, top = Number(tb.el.getAttribute('y')) - fs * ASC;
    tb.top = top; tb.bottom = top + (tb.lines.length - 1) * tb.lh + fs;
    lowest = Math.max(lowest, tb.bottom);
    tb.cut = tb.lines.join(' ') !== fullOf(s);
    if (tb.cut && !quiet) ctx.warn('A label is too long for its space and is cut short.');
    return tb;
  }
  /* ---- the facts row: laid out first, so the words above know where to stop ---- */
  const factW = M.facts.map(f => measure(root, f.map(t => t.s).join(''), 'ts-num'));
  const GAP = 64, oneRow = factW.reduce((a, x) => a + x, 0) + GAP * (factW.length - 1) <= zW;
  // one row of facts sits at 604, and may drop as far as 628 to give long words above it more room
  const factsTop = (oneRow ? 628 : 572) - 40 * ASC, wordsFloor = factsTop - 16;
  let lowest = -Infinity;

  /* ---- cherry diagram (alone, or with counters or cubes) ---- */
  function cherry({ cx, y, r, pr, dy, spread, wordY, avoid, floor = wordsFloor }) {
    const pw = partWhole(gRep, w, M.parts, { x: cx, y, r, pr, dy, spread, s: kW, sParts: kS, wholeCol: 'var(--ink-2)', partCol: 'var(--compare)', wholePath: 'whole', partsPath: 'parts' });
    // the whole is neutral (it is every part together); each part takes its own colour
    const wc = pw.whole.g.querySelector('circle');
    wc.style.setProperty('fill', 'var(--paper)'); wc.style.setProperty('stroke', 'var(--ink-2)');
    pw.whole.text.style.setProperty('fill', 'var(--ink)');
    pw.parts.forEach((q, i) => {
      const c = q.g.querySelector('circle'); c.style.setProperty('fill', PC[i].pale); c.style.setProperty('stroke', PC[i].fill);
      q.text.style.setProperty('fill', PC[i].text);
      // the number shrinks to fit its circle (a three-digit part in a small circle)
      if (q.text.getComputedTextLength() > 2 * pr - 14) q.text.setAttribute('class', 'ts-num');
    });
    // the words under each part circle live in the part's group, so a swap carries them along
    // each part's words get the room between its neighbours, inside the slide and clear of any
    // frame beside them (avoid: [x0, x1]); they wrap, then shrink, down to the floor
    // a lane per circle position: from halfway to each neighbour (less a gap) or to the slide
    // edge, clear of any frame beside it (avoid: [x0, x1]). A word wider than its circle slides
    // along its lane; after the swap it is placed again in the lane it lands in.
    const Q = pw.parts, lanes = Q.map((q, j) => {
      let L = j ? (Q[j - 1].x + q.x) / 2 + 14 : zx0, R = j < n - 1 ? (Q[j + 1].x + q.x) / 2 - 14 : zx1;
      if (avoid && q.x < avoid[0]) R = Math.min(R, avoid[0] - 16);
      if (avoid && q.x > avoid[1]) L = Math.max(L, avoid[1] + 16);
      return { L, R };
    });
    const at = (j, tw) => Math.min(Math.max(Q[j].x, lanes[j].L + tw / 2), lanes[j].R - tw / 2);
    const moveX = (el, x) => { el.setAttribute('x', x); el.querySelectorAll('tspan').forEach(t => t.setAttribute('x', x)); };
    // a part's words must fit the lane it starts in and the lane it is swapped into
    const maxW = i => Math.max(60, Math.min(lanes[i].R - lanes[i].L, kSw != null ? lanes[swapPos(i)].R - lanes[swapPos(i)].L : Infinity));
    let wordsBottom = -Infinity; const wordW = [];
    const word = (q, i, from) => { const y0 = wordY != null ? wordY : q.y + pr + 48; return fitText(q.g, q.x, y0, wordPart(i), { maxW: maxW(i), maxH: floor - (y0 - 40 * ASC), a: { fill: 'var(--ink-2)', s: kL, cls: 'rise', c: labSoft }, edit: `text.label:part${i}`, from, maxLines: 2 }); };
    // the part words are one row: if any has to shrink, they all take the smaller size
    let tbs = Q.map((q, i) => word(q, i, 0));
    const lo = Math.max(...tbs.map(t => t.step));
    tbs = tbs.map((t, i) => { if (t.step >= lo) return t; t.el.remove(); return word(Q[i], i, lo); });
    tbs.forEach((tb, i) => { moveX(tb.el, at(i, tb.w)); wordW[i] = tb.w; wordsBottom = Math.max(wordsBottom, tb.bottom); });
    if (kSw != null) Q.forEach((q, i) => {
      const j = swapPos(i), to = Q[j], dx = to.x - q.x;
      if (!dx) return;
      const fly = h('g', { s: kSw, hide: kSw + 1, cls: 'fly', vars: { '--fx': `${-dx}px`, '--fy': '0px' } }, gRep); swapSets.push(fly); origSets.push(q.g);
      const inner = h('g', { transform: `translate(${dx} 0)` }, fly);
      const cl = q.g.cloneNode(true); cl.removeAttribute('class'); cl.style.removeProperty('--d'); inner.appendChild(cl);
      const wt = cl.querySelector(`[data-edit="text.label:part${i}"]`); if (wt) moveX(wt, at(j, wordW[i]) - dx);
      q.g.dataset.c = off(kSw);
    });
    // the word for the whole sits beside the top circle
    // beside the circle it stops above the stem to the right part; a longer word starts further
    // right, past where that stem has dropped to, and gets more lines
    const slope = dy / Math.max(1, (n - 1) / 2 * spread), stemX = yy => cx + (yy - y) / slope;
    const wTop = y + 14 - 40 * ASC, wa = { fill: 'var(--ink-2)', s: kL, cls: 'rise', c: labSoft };
    const besideW = (x0, bottom) => fitText(gText, x0, y + 14, wordWhole, { maxW: Math.max(80, zx1 - x0), maxH: bottom - wTop, maxLines: 2, anchor: 'start', a: wa, edit: 'text.label:whole', quiet: true });
    const x0a = cx + r + 18;
    let lw = besideW(x0a, Math.min(y + dy - pr - 12, y + (x0a - cx) * slope - 16));
    if (lw.cut) {
      lw.el.remove();
      const bottom = Math.min(y + dy - pr - 12, wTop + 110), x0b = Math.max(x0a, stemX(bottom) + 16);
      lw = besideW(x0b, bottom);
      if (lw.cut) ctx.warn('The word for the whole is too long for its space and is cut short.');
    }
    if (Number(lw.el.getAttribute('x')) + lw.w > zx1 + 1) ctx.warn('The word for the whole does not fit beside the circle.');
    pw.wordsBottom = wordsBottom;
    return pw;
  }
  const disc = (g, [cx, cy], rr, col, a = {}) => h('circle', Object.assign({ cx, cy, r: rr, fill: col, stroke: EDGE(col), 'stroke-width': 'var(--sw-hair)', cls: 'body' }, a), g);
  // the ledge a cube train stands on, so the cubes read as real objects on a table
  const shelf = (xa, xb, y, a) => h('line', Object.assign({ x1: xa, x2: xb, y1: y, y2: y, stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, a), gRep);

  /* ---- counters in a ten frame (up to 20), inside the bond: the whole sits on top of its frame ---- */
  function framesTree() {
    const two = w > 10;
    let cell, fr, Y, r, pr, py, sp, wordY;
    if (n === 2) {
      // the frame sits between the two part circles, under the whole
      cell = two ? 48 : 72; Y = 222; r = 58; pr = 50;
      const fw = cell * 5, fh = cell * 2, top = Y + r + 30, tall = two ? 2 * fh + 16 : fh;
      fr = two ? [[CX - fw / 2, top], [CX - fw / 2, top + fh + 16]] : [[CX - fw / 2, top]];
      py = top + tall / 2;
      // wide enough that the stems pass outside the frame and the circles clear it
      sp = 2 * Math.max(fw / 2 + pr + 40, (fw / 2 + 20) * (py - Y) / (top - Y));
      wordY = py + pr + 48;
    } else {
      // three parts: the bond on top, the frame under it
      cell = two ? 52 : 56; Y = 170; r = 56; pr = 48; py = 310; sp = 260; wordY = py + pr + 46;
    }
    // with three parts the frame sits under the words, so the words stop a frame's height higher
    const pw = cherry({ cx: CX, y: Y, r, pr, dy: py - Y, spread: sp, wordY, avoid: n === 2 ? [CX - cell * 2.5, CX + cell * 2.5] : null,
      floor: n === 2 ? wordsFloor : factsTop - 14 - 2 * cell - 20 });
    if (n !== 2) {
      const fw = cell * 5, top = Math.max(wordY + 28, pw.wordsBottom + 20);
      fr = two ? [[CX - fw - 12, top], [CX + 12, top]] : [[CX - fw / 2, top]];
    }
    // the facts row keeps clear of the frames too
    lowest = Math.max(lowest, ...fr.map(([, y]) => y + 2 * cell));
    fr.forEach(([x, y]) => tenFrame(gRep, x, y, 0, { cell, a: { s: kW, cls: 'rise' } }));
    const pos = i => { const [x, y] = fr[Math.floor(i / 10)], j = i % 10; return [x + cell * (j % 5 + .5), y + cell * (Math.floor(j / 5) + .5)]; };
    const rr = cell * .34;
    // the whole: neutral counters
    const gw = h('g', { s: kW, hide: kS }, gRep);
    for (let i = 0; i < w; i++) disc(gw, pos(i), rr, NEUTRAL, { cls: 'body pop', s: kW, delay: i * 40 });
    // the parts: the same counters, coloured part by part in reading order
    const owner = []; M.parts.forEach((v, k) => { for (let j = 0; j < v; j++) owner.push(k); });
    const gs = h('g', { s: kS }, gRep), gsi = h('g', { c: kSw != null ? off(kSw) : null }, gs);
    owner.forEach((k, i) => disc(gsi, pos(i), rr, PC[k].fill, { s: kS, cls: 'body pop', delay: i * 40 }));
    if (kSw != null) {
      const owner2 = []; M.swapped.forEach(k => { for (let j = 0; j < M.parts[k]; j++) owner2.push(k); });
      // each counter moves from its place in the first order to its place in the swapped order
      const from = {}; owner.forEach((k, i) => { (from[k] = from[k] || []).push(i); });
      const used = {};
      owner2.forEach((k, i) => {
        const j = from[k][used[k] = (used[k] || 0)]; used[k]++;
        const [fx, fy] = pos(j), [tx, ty] = pos(i);
        const fg = h('g', { s: kSw, hide: kSw + 1, cls: 'fly', delay: i * 30, vars: { '--fx': `${fx - tx}px`, '--fy': `${fy - ty}px` } }, gRep);
        disc(fg, [tx, ty], rr, PC[k].fill);
      });
    }
  }

  /* ---- a train of cubes (up to 20): the whole train under the whole, then each part under its circle ---- */
  function cubesTree() {
    const Y = 184, r = 58, pr = 50, py = Y + 168, sp = n === 2 ? 380 : 290;
    const circX = j => CX + (j - (n - 1) / 2) * sp;
    // cube size: neighbouring part trains keep a gap, and the end trains stay on the slide
    let u = Math.min(56, (zW - 32) / w);
    for (let i = 0; i < n - 1; i++) u = Math.min(u, (sp - 32) / ((M.parts[i] + M.parts[i + 1]) / 2));
    for (const ord of [M.order, M.swapped]) u = Math.min(u, (circX(0) - zx0) / (M.parts[ord[0]] / 2), (zx1 - circX(n - 1)) / (M.parts[ord[n - 1]] / 2));
    const trainY = Y + r + 22, cy = py + pr + 22;
    const cube = (p, x, y, col, a = {}) => {
      const cg = h('g', a, p);
      const m = Math.max(1.5, u * .05);
      h('rect', { x: x + m, y, width: u - 2 * m, height: u, rx: 'var(--r-mark)', fill: col, stroke: EDGE(col), 'stroke-width': 'var(--sw-hair)', cls: 'body' }, cg);
      return cg;
    };
    const contX = i => CX - (w * u) / 2 + i * u;
    const layout = ord => { const xs = []; ord.forEach((k, j) => { let x = circX(j) - M.parts[k] * u / 2; for (let q = 0; q < M.parts[k]; q++) { xs.push({ k, x }); x += u; } }); return xs; };
    const A = layout(M.order), B = kSw != null ? layout(M.swapped) : [];
    // the whole train stands on a short ledge under the whole circle; the parts on one long ledge
    shelf(contX(0) - 16, contX(w) + 16, trainY + u + 3, { s: kW, hide: kS, cls: 'rise' });
    const xs = A.concat(B).map(c => c.x);
    shelf(Math.min(...xs) - 16, Math.max(...xs) + u + 16, cy + u + 3, { s: kS, cls: 'rise' });
    const gw = h('g', { s: kW, hide: kS }, gRep);
    for (let i = 0; i < w; i++) cube(gw, contX(i), trainY, NEUTRAL, { s: kW, cls: 'pop', delay: i * 40 });
    const gs = h('g', { c: kSw != null ? off(kSw) : null }, gRep);
    A.forEach((c, i) => { const fg = h('g', { s: kS, cls: 'fly', delay: i * 30, vars: { '--fx': `${contX(i) - c.x}px`, '--fy': `${trainY - cy}px` } }, gs); cube(fg, c.x, cy, PC[c.k].fill); });
    if (kSw != null) {
      const idx = {};
      B.forEach(c => {
        const j = (idx[c.k] = (idx[c.k] || 0)); idx[c.k]++;
        const src = A.filter(a => a.k === c.k)[j];
        const fg = h('g', { s: kSw, hide: kSw + 1, cls: 'fly', vars: { '--fx': `${src.x - c.x}px`, '--fy': '0px' } }, gRep); cube(fg, c.x, cy, PC[c.k].fill);
      });
    }
    if (u < 22) ctx.warn(`The cubes are small at ${w}: try the ten frame.`);
    cherry({ cx: CX, y: Y, r, pr, dy: py - Y, spread: sp, wordY: cy + u + 50 });
  }

  /* ---- bar model (to scale) ---- */
  function bar() {
    const lw = Math.min(200, measure(gText, wordWhole, LBL));
    const x0 = zx0 + lw + 28, x1 = zx1, BW = x1 - x0, BH = 84, y1 = 168, y2 = 280;
    h('rect', { x: x0, y: y1, width: BW, height: BH, rx: 'var(--r-mark)', fill: 'color-mix(in oklab, var(--ink) 7%, var(--paper))', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', s: kW, cls: 'wipe body' }, gRep);
    computed(T(gRep, x0 + BW / 2, y1 + BH / 2 + 14, fmtNum(w), 'ts-num', { 'text-anchor': 'middle', fill: 'var(--ink)', s: kW, cls: 'rise' }), 'whole');
    // the word for the whole sits left of the bar, centred on it; a long one wraps and shrinks in
    // the space between the title and the parts bar
    const wTop = GRID.top + 4, wBot = y2 - 14;
    const tb = fitText(gText, x0 - 20, wTop + 40 * ASC, wordWhole, { maxW: lw, maxH: wBot - wTop, anchor: 'end', a: { fill: 'var(--ink-2)', s: kL, cls: 'rise', c: labSoft }, edit: 'text.label:whole' });
    const tbH = tb.bottom - tb.top, want = Math.min(Math.max(y1 + BH / 2 - tbH / 2, wTop), wBot - tbH);
    tb.el.setAttribute('y', Number(tb.el.getAttribute('y')) + want - tb.top);
    const segs = ord => { let x = x0; return ord.map(k => { const sw = M.parts[k] / w * BW; const s = { k, x, w: sw }; x += sw; return s; }); };
    const A = segs(M.order);
    const numW = k => measure(gText, fmtNum(M.parts[k]), 'ts-num');
    const inside = k => numW(k) + 20 <= M.parts[k] / w * BW;
    const anyBelow = M.parts.some((_, k) => !inside(k));
    const ly = y2 + BH + (anyBelow ? 104 : 56);
    // a row of labels in bar order: each sits as near its piece as it can, never left of an earlier one
    // numbers keep under the bar; words may run out to the slide edge (the bar is indented by the word for the whole)
    const row = (items, gap = 28, L = x0) => {
      const cx = [];
      items.forEach((it, i) => { cx[i] = Math.max(it.want, L + it.w / 2, i ? cx[i - 1] + (items[i - 1].w + it.w) / 2 + gap : -Infinity); });
      for (let i = items.length - 1; i >= 0; i--) cx[i] = Math.min(cx[i], i === items.length - 1 ? x1 - items[i].w / 2 : cx[i + 1] - (items[i].w + items[i + 1].w) / 2 - gap);
      return items.length && cx[0] < L + items[0].w / 2 - .5 ? null : cx;
    };
    const seg = (p, s) => {
      const g = h('g', {}, p);
      h('rect', { x: s.x, y: y2, width: Math.max(0, s.w), height: BH, fill: PC[s.k].pale, stroke: PC[s.k].fill, 'stroke-width': 'var(--sw-struct)', cls: 'body' }, g);
      if (inside(s.k)) computed(T(g, s.x + s.w / 2, y2 + BH / 2 + 14, fmtNum(M.parts[s.k]), 'ts-num', { 'text-anchor': 'middle', fill: PC[s.k].text }), `parts.${s.k}`);
      return g;
    };
    const labels = (p, S) => {
      // the numbers of parts too thin to hold them go under the bar, in the bar's order
      const th = S.filter(s => !inside(s.k));
      const nx = row(th.map(s => ({ want: s.x + s.w / 2, w: numW(s.k) })));
      if (!nx) ctx.warn('No room under the bar for the part numbers.');
      else th.forEach((s, i) => computed(T(p, nx[i], y2 + BH + 44, fmtNum(M.parts[s.k]), 'ts-num', { 'text-anchor': 'middle', fill: PC[s.k].text }), `parts.${s.k}`));
      // the words: one per part, every one of them on the slide. First each word may use its piece
      // or its share of the row; then the row is split in proportion to the words' lengths, so long
      // ones wrap and shrink; the default word "part" on a run of thin pieces may become one "parts";
      // last, the words sit in a row with a leader from each piece to a word that is not under it
      const WG = 56, avail = items => zW - WG * (items.length - 1);
      // each word takes its part's colour, as its number does, so a word that cannot sit right
      // under a thin piece still reads as that piece's word (a shared "parts" word stays neutral)
      const wa = it => ({ fill: it.n > 1 ? 'var(--ink-2)' : PC[it.k].text, s: kL, cls: 'rise' });
      const natural = items => it => Math.min(zW, Math.max(120, avail(items) / items.length, it.x1 - it.x0 - 12));
      const shared = items => { const nat = items.map(it => Math.max(60, measure(p, it.text, LBL))), tot = nat.reduce((a, b) => a + b, 0); return it => Math.max(60, avail(items) * nat[items.indexOf(it)] / tot); };
      const clear = items => items.forEach(it => { if (it.tb) it.tb.el.remove(); it.tb = null; });
      const make = (items, widthOf) => {
        const one = (it, from) => { if (it.tb) it.tb.el.remove(); it.tb = fitText(p, 0, ly, it.text, { maxW: widthOf(it), maxH: wordsFloor - (ly - 40 * ASC), maxLines: 2, a: wa(it), edit: it.path, quiet: true, from }); it.w = it.tb.w; it.want = (it.x0 + it.x1) / 2; };
        items.forEach(it => one(it, 0));
        // one row, one size
        const lo = Math.max(...items.map(it => it.tb.step));
        items.forEach(it => { if (it.tb.step < lo) one(it, lo); });
        return items;
      };
      const wordRow = items => row(items, WG, zx0);
      const under = (it, x) => it.x1 - it.x0 < 1 || (x + it.w / 2 > it.x0 && x - it.w / 2 < it.x1);
      const fits = items => { const cx = wordRow(items); return cx && items.every((it, i) => under(it, cx[i])) ? cx : null; };
      const base = () => S.map(s => ({ x0: s.x, x1: s.x + s.w, text: wordPart(s.k), path: `text.label:part${s.k}`, k: s.k }));
      // only the default word may be shared: a teacher's own words are always shown
      const own = k => txt(P, `label:part${k}`, null) != null;
      const merged = () => {
        const runs = [];
        S.forEach(s => {
          const thin = !own(s.k) && measure(p, wordPart(s.k), LBL) > s.w - 12, last = runs[runs.length - 1];
          if (thin && last && last.thin) { last.x1 = s.x + s.w; last.n++; } else runs.push({ x0: s.x, x1: s.x + s.w, text: wordPart(s.k), path: `text.label:part${s.k}`, thin, n: 1, k: s.k });
        });
        runs.forEach(q => { if (q.n > 1) { q.text = txt(P, 'label:parts', 'parts'); q.path = 'text.label:parts'; } });
        return runs.length < S.length ? runs : null;
      };
      let items = null, cx = null;
      const attempt = (mk, widths) => { const its = mk(); if (!its) return false; make(its, widths(its)); const c = fits(its); if (c) { items = its; cx = c; return true; } clear(its); return false; };
      attempt(base, natural) || attempt(base, shared) || attempt(merged, natural) || attempt(merged, shared);
      let lead = false;
      if (!cx) {
        items = base(); make(items, shared(items)); lead = true;
        cx = wordRow(items);
        if (!cx) { let x = zx0; cx = items.map(it => { const c = x + it.w / 2; x += it.w + WG; return c; }); }
      }
      if (items.some(it => it.tb.cut)) ctx.warn('A part word is too long for its space and is cut short.');
      items.forEach((it, i) => {
        it.tb.el.setAttribute('x', cx[i]); it.tb.el.querySelectorAll('tspan').forEach(sp => sp.setAttribute('x', cx[i]));
        if (!lead || under(it, cx[i])) return;
        // a leader from under the piece (and its number) to the near edge of its word, never through the word
        // drawn only when it can drop steeply; a long shallow line would read as a stroke across the slide
        const xm = (it.x0 + it.x1) / 2, ya = inside(it.k) ? y2 + BH + 8 : y2 + BH + 58;
        const xb = Math.min(Math.max(xm, cx[i] - it.w / 2 + 6), cx[i] + it.w / 2 - 6), yb = it.tb.top - 8;
        if (yb - ya < 16 || Math.abs(xb - xm) > yb - ya) return;
        h('line', { x1: xm, y1: ya, x2: xb, y2: yb, stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)', 'stroke-linecap': 'round', s: kL, cls: 'rise' }, p);
      });
    };
    const gs = h('g', { s: kS, cls: 'wipe' }, gRep), gsi = h('g', { c: kSw != null ? off(kSw) : null }, gs);
    A.forEach(s => seg(gsi, s)); labels(gsi, A);
    if (kSw != null) {
      const B = segs(M.swapped);
      B.forEach(s => { const src = A.find(a => a.k === s.k); const fg = h('g', { s: kSw, hide: kSw + 1, cls: 'fly', vars: { '--fx': `${src.x - s.x}px`, '--fy': '0px' } }, gRep); swapSets.push(fg); seg(fg, s); });
      const gl = h('g', { s: kSw, hide: kSw + 1, cls: 'rise' }, gRep); swapSets.push(gl); labels(gl, B);
      origSets.push(gsi);
    }
  }

  if (rep === 'cherry') {
    const two = n === 2;
    cherry({ cx: CX - 40, y: 196, r: 66, pr: 56, dy: 196, spread: two ? 320 : 250 });
  } else if (rep === 'bar') bar();
  else if (rep === 'tenframe') framesTree();
  else cubesTree();

  /* ---- the facts this bond gives ---- */
  const gF = h('g', { s: kF, cls: 'rise' }, gText);
  const ws = factW, one = oneRow;
  if (one) {
    let x = CX - (ws.reduce((a, x) => a + x, 0) + GAP * (ws.length - 1)) / 2;
    const fy = Math.min(628, Math.max(604, lowest + 16 + 40 * ASC));
    M.facts.forEach((f, i) => { computed(factText(gF, x, fy, f, 'ts-num', { 'text-anchor': 'start', delay: i * 120 }), 'parts'); x += ws[i] + GAP; });
  } else {
    const colW = Math.max(...ws), cols = 2, total = cols * colW + GAP;
    if (total > zW) ctx.warn('The facts are too long for the slide.');
    const xL = CX - total / 2;
    M.facts.forEach((f, i) => computed(factText(gF, xL + (i % 2) * (colW + GAP), 572 + Math.floor(i / 2) * 58, f, 'ts-num', { 'text-anchor': 'start', delay: i * 120 }), 'parts'));
  }

  /* ---- every bond of the whole, in order: on its own, large, centred (not in the summary) ---- */
  if (ALL && kA != null) {
    const gT = h('g', { s: kA, hide: NB }, root);
    // the heading first (it may wrap to two lines), then as many rows per column as fit under it
    const numW = measure(gText, fmtNum(w), LBL);
    const st = stepOf(w);
    const headTxt = txt(P, 'label:allHead', st > 1 ? 'Bonds in tens to' : 'Bonds to'), headMax = zW - numW - 12;
    const hg = h('g', {}, gT);
    const headAt = mw => textBlock(hg, 0, 0, headTxt, { cls: LBL, maxW: mw, maxLines: 2, lh: LH, anchor: 'end', a: { fill: 'var(--ink-2)', s: kA, cls: 'rise' }, edit: 'text.label:allHead' });
    let head = headAt(headMax);
    // a heading on two lines is balanced, so its last line (and the number after it) is not a lone word
    if (head.lines.length === 2) for (let mw = head.w - 16; mw > head.w / 2; mw -= 16) {
      const t = headAt(mw);
      if (t.lines.length === 2 && t.cls === head.cls && !/…$/.test(t.lines[1])) { head.el.remove(); head = t; } else { t.el.remove(); break; }
    }
    const rowsN = w / st + 1, lh = 58, maxRows = Math.max(1, Math.floor((GRID.bottom - GRID.top - 10 - head.h - 30) / lh));
    const colsN = Math.ceil(rowsN / maxRows), perCol = Math.ceil(rowsN / colsN);
    const sumW = measure(gText, `${fmtNum(w)} + ${fmtNum(w)}`, 'ts-num');
    const CG = 110, colW = sumW + CG, blockW = colsN * colW - CG;
    const blockH = head.h + 30 + perCol * lh;
    const top = GRID.top + 10 + Math.max(0, (GRID.bottom - GRID.top - 10 - blockH) / 2);
    // the heading lines end flush right, so the whole number follows the last line as its next
    // word, at the heading's size, and never sits inside the heading
    const numCls = head.cls === LBL ? LBL : 'ts-tiny', numW2 = measure(gText, fmtNum(w), numCls), gapW = head.cls === LBL ? 12 : 8;
    const hx = CX - (head.w + gapW + numW2) / 2;
    hg.setAttribute('transform', `translate(${hx + head.w} ${top + 32})`);
    computed(T(gT, hx + head.w + gapW, top + 32 + (head.lines.length - 1) * head.lh, fmtNum(w), numCls, { fill: 'var(--ink)', s: kA, cls: 'rise' }), 'whole');
    const y0 = top + head.h + 30;
    if (y0 + perCol * lh > GRID.bottom + 8) ctx.warn('The list of bonds is too tall for the slide.');
    if (blockW > zW) ctx.warn('The list of bonds is too wide for the slide.');
    const mine = n === 2 ? M.parts[0] : -1, lx0 = CX - blockW / 2;
    for (let a = 0; a <= w; a += st) {
      const col = Math.floor(a / st / perCol), rw = (a / st) % perCol;
      const x = lx0 + col * colW, y = y0 + rw * lh + 40;
      const rg = h('g', { s: kA, cls: 'rise', delay: a / st * 50 }, gT);
      if (a === mine) h('rect', { x: x - 14, y: y - 38, width: sumW + 28, height: 52, rx: 'var(--r-mark)', fill: 'var(--focus-pale)' }, rg);
      computed(factText(rg, x, y, [{ s: fmtNum(a), k: 0 }, { s: ' + ' }, { s: fmtNum(w - a), k: 1 }], 'ts-num', { 'text-anchor': 'start' }), 'whole');
    }
  }
  pe(-1);
  return { onStep: pe, still: () => pe(NB) };
}
