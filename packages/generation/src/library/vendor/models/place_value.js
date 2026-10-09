// Place value: a place-value chart from ten millions to thousandths, with the number as digit
// cards and, optionally, base-ten blocks (Dienes) or place-value counters. Operations: show,
// partition into a sum, × or ÷ by 10, 100 or 1,000 (digits move, the decimal point stays), and
// exchange (one of a column becomes ten of the next column down, the total stays the same).
// Every digit, value, sum and answer is computed in code from `number`; only wording is typed.
import {
  h, T, measure, GRID, textBlock, arrow,
  editable, computed, txt, TEXT_PARAM_FOR, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { pvColour, digitCard, dienes, fmtNum } from '../kit/batch-A.js';

export const meta = {
  id: 'place_value', name: 'Place value', kind: 'info', version: 1,
  subjects: ['Maths'],
  years: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'],
  teaches: 'What each digit is worth from its column: partitioning, multiplying and dividing by 10, 100 and 1,000, and exchanging between columns.',
};

/* ------------------------------------------------------------------ places */
const NAME = { 7: 'ten millions', 6: 'millions', 5: 'hundred thousands', 4: 'ten thousands', 3: 'thousands', 2: 'hundreds', 1: 'tens', 0: 'ones', '-1': 'tenths', '-2': 'hundredths', '-3': 'thousandths' };
const ONE = { 7: 'ten million', 6: 'million', 5: 'hundred thousand', 4: 'ten thousand', 3: 'thousand', 2: 'hundred', 1: 'ten', 0: 'one', '-1': 'tenth', '-2': 'hundredth', '-3': 'thousandth' };
const SHORT = { 7: 'TM', 6: 'M', 5: 'HTh', 4: 'TTh', 3: 'Th', 2: 'H', 1: 'T', 0: 'O', '-1': 'Tth', '-2': 'Hth', '-3': 'Thth' };
const EXP = Object.fromEntries(Object.entries(NAME).map(([e, n]) => [n, +e]));
const cap1 = s => s[0].toUpperCase() + s.slice(1);
const colour = e => pvColour(e === 7 ? 4 : e);
const valueOf = e => fmtNum(Math.pow(10, e));
const many = (d, e) => `${d} ${d === 1 ? ONE[e] : NAME[e]}`;
const HIGH = ['auto', 'ten millions', 'millions', 'hundred thousands', 'ten thousands', 'thousands', 'hundreds', 'tens', 'ones'];
const LOW = ['auto', 'ones', 'tenths', 'hundredths', 'thousandths'];
const MAX_COLS = 10;

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Place value',
  properties: {
    title: TITLE_PARAM('Place value'),
    number: { type: 'number', title: 'The number', description: 'Up to 10,000,000, with up to 3 decimal places (thousandths).', minimum: 0, maximum: 10000000, default: 47 },
    representation: { type: 'string', title: 'Show it with', enum: ['dienes', 'counters', 'digits'], 'x-labels': ['Base-ten blocks (whole numbers to 9,999)', 'Place-value counters (up to thousands)', 'Digits only'], default: 'dienes' },
    operation: { type: 'string', title: 'What happens', enum: ['show', 'partition', 'multiply', 'divide', 'regroup'], 'x-labels': ['Show the number', 'Partition into a sum', 'Multiply by 10, 100 or 1,000', 'Divide by 10, 100 or 1,000', 'Exchange between columns'], default: 'partition' },
    factor: { type: 'string', title: 'Multiply or divide by', enum: ['10', '100', '1000'], 'x-labels': ['10', '100', '1,000'], default: '10', description: 'Used when the number is multiplied or divided.' },
    regroupFrom: { type: 'string', title: 'Exchange one from', enum: ['thousands', 'hundreds', 'tens', 'ones', 'tenths', 'hundredths'], 'x-labels': ['Thousands', 'Hundreds', 'Tens', 'Ones', 'Tenths', 'Hundredths'], default: 'tens', description: 'One of this column becomes ten of the column to its right.' },
    headings: { type: 'string', title: 'Column headings', enum: ['words', 'letters', 'values'], 'x-labels': ['Words (Tens, Ones)', 'Letters (T, O)', 'Values (10, 1)'], default: 'words' },
    highest: { type: 'string', title: 'First column', enum: HIGH, 'x-labels': HIGH.map(x => x === 'auto' ? 'Just what the number needs' : cap1(x)), default: 'auto', 'x-panel': 'advanced' },
    lowest: { type: 'string', title: 'Last column', enum: LOW, 'x-labels': LOW.map(x => x === 'auto' ? 'Just what the number needs' : cap1(x)), default: 'auto', 'x-panel': 'advanced' },
    // column headings and the ×10 tag are labels (40 letters), so they always fit their column
    text: TEXT_PARAM_FOR(Object.fromEntries([...Object.keys(NAME).map(e => [`col:${e}`, 'label']), ['times10', 'label']])),
  },
};

export const presets = [
  { id: 'y2-47', name: 'Year 2: 47 is 4 tens and 7 ones', params: { title: '47 is 4 tens and 7 ones', number: 47, representation: 'dienes', operation: 'partition', headings: 'words' } },
  { id: 'y3-exchange', name: 'Year 3: exchange a ten for ten ones', params: { title: 'Exchanging a ten', number: 52, representation: 'dienes', operation: 'regroup', regroupFrom: 'tens', headings: 'words' } },
  { id: 'y4-1352', name: 'Year 4: 1,352 partitioned', params: { title: '1,352 partitioned', number: 1352, representation: 'counters', operation: 'partition', headings: 'words' } },
  { id: 'y5-3-7x10', name: 'Year 5: 3.7 × 10', params: { title: 'Multiplying by 10', number: 3.7, representation: 'digits', operation: 'multiply', factor: '10', headings: 'values', lowest: 'tenths' } },
];

/* ------------------------------------------------------------------ the maths (integers in thousandths) */
const P10 = e => Math.pow(10, e);
function digitsOf(n3) { // n3 = number × 1000, an integer; returns {e: digit} for e in 7..-3
  const d = {}; for (let e = 7; e >= -3; e--) d[e] = Math.floor(n3 / P10(e + 3)) % 10; return d;
}
function sig(d) { const nz = Object.keys(d).map(Number).filter(e => d[e] > 0); return nz.length ? { hi: Math.max(...nz), lo: Math.min(...nz) } : { hi: 0, lo: 0 }; }
const fromN3 = n3 => fmtNum(n3 / 1000);

/** Everything the slide needs, computed once and shared by validate, builds, notes and render. */
function model(P) {
  const R = [], warn = [];
  const n3 = Math.round(P.number * 1000);
  if (Math.abs(P.number * 1000 - n3) > 1e-6 * Math.max(1, P.number * 1000)) {
    R.push({ path: 'number', reason: `${P.number} has more than 3 decimal places. The chart stops at thousandths, so round it to 3 places or fewer.` });
    return { R, warn };
  }
  const d = digitsOf(n3), s = sig(d), op = P.operation, k = P.factor.length - 1;
  const M = { n3, d, s, op, k, R, warn, rows: 1 };
  let hi = Math.max(0, s.hi), lo = Math.min(0, s.lo);
  if (op === 'multiply' || op === 'divide') {
    if (n3 === 0) R.push({ path: 'number', reason: '0 multiplied or divided by anything is still 0, so no digits move. Choose a number that is not 0.' });
    const r3 = op === 'multiply' ? n3 * P10(k) : n3 / P10(k);
    if (op === 'multiply' && r3 > 10000000 * 1000) R.push({ path: 'number', reason: `${fromN3(n3)} × ${fmtNum(+P.factor)} is more than 10,000,000, the biggest number this chart shows. Choose a smaller number or factor.` });
    if (op === 'divide' && !Number.isInteger(r3)) R.push({ path: 'factor', reason: `${fromN3(n3)} ÷ ${fmtNum(+P.factor)} needs a column smaller than thousandths. Choose a smaller divisor or a number with fewer decimal places.` });
    if (R.length) return M;
    M.r3 = r3; M.rd = digitsOf(r3); M.rs = sig(M.rd); M.rows = 2;
    hi = Math.max(hi, M.rs.hi); lo = Math.min(lo, M.rs.lo);
    if (P.representation !== 'digits') warn.push('Blocks and counters are left out while digits move: the digit cards show the move.');
  }
  if (op === 'regroup') {
    // an empty column has nothing to exchange: as in column subtraction, exchange from the next column up that has
    // one (else the nearest one down). Blocks have no tenths, so with blocks the ones never exchange.
    const want = EXP[P.regroupFrom], minE = P.representation === 'dienes' ? 1 : -2, ok = e => e >= minE && d[e] > 0;
    if (P.representation === 'dienes' && want < 1) R.push({ path: 'regroupFrom', reason: 'Base-ten blocks have no tenths, so exchange from the tens, hundreds or thousands, or show it with counters.' });
    let ef = want;
    if (!R.length && !ok(want)) {
      ef = null; for (let e = want + 1; e <= 7 && ef == null; e++) if (ok(e)) ef = e;
      for (let e = want - 1; e >= minE && ef == null; e--) if (ok(e)) ef = e;
      if (ef == null) R.push({ path: 'number', reason: P.representation === 'dienes' ? `${fromN3(n3)} has no tens, hundreds or thousands to exchange with blocks. Choose a bigger number, or show it with counters.` : `${fromN3(n3)} has no digit to exchange. Choose a number that is not 0.` });
      else warn.push(`${fromN3(n3)} has no ${NAME[want]}, so the exchange uses the ${NAME[ef]}.`);
    }
    if (R.length) return M;
    M.ef = ef; lo = Math.min(lo, ef - 1); hi = Math.max(hi, ef);
  }
  // forced columns must still hold every digit
  // a forced first or last column is a minimum: the chart still grows to hold every digit
  if (P.highest !== 'auto') { const e = EXP[P.highest]; if (e < hi) warn.push(`The chart starts at ${NAME[hi]}, not ${P.highest}, so every digit has a column.`); else hi = e; }
  if (P.lowest !== 'auto') { const e = EXP[P.lowest]; if (e > lo) warn.push(`The chart goes down to ${NAME[lo]}, not ${P.lowest}, so every digit has a column.`); else lo = e; }
  M.hi = hi; M.lo = lo; M.cols = []; for (let e = hi; e >= lo; e--) M.cols.push(e);
  if (M.cols.length > MAX_COLS) R.push({ path: 'number', reason: `That needs ${M.cols.length} columns; one slide holds ${MAX_COLS} legibly. Use fewer decimal places or a smaller number.` });
  // representation truth and fit
  const usesRep = M.rows === 1 && P.representation !== 'digits';
  M.rep = usesRep ? P.representation : 'digits';
  if (usesRep && P.representation === 'dienes' && (n3 % 1000 !== 0 || n3 >= 10000 * 1000)) R.push({ path: 'representation', reason: 'Base-ten blocks show whole numbers up to 9,999. Choose place-value counters or digits only for this number.' });
  if (usesRep && P.representation === 'counters' && hi > 3) R.push({ path: 'representation', reason: 'Place-value counters fit on one slide up to the thousands column. Choose digits only for bigger numbers.' });
  if (R.length) return M;
  // the chart: plain columns, at most COL_MAX wide and centred. Blocks or counters sit in the columns;
  // the digit cards sit under the chart, one per column (White Rose / NCETM Tens | Ones layout)
  M.cw = Math.min(COL_MAX, (GRID.right - GRID.left) / M.cols.length);
  M.x0 = 640 - M.cols.length * M.cw / 2;
  M.counts = Object.fromEntries(M.cols.map(e => [e, d[e]]));
  if (op === 'regroup') { M.after = Object.assign({}, M.counts); M.after[M.ef] -= 1; M.after[M.ef - 1] += 10; }
  M.line = op === 'partition' || op === 'regroup';
  if (usesRep) {
    const maxC = Object.assign({}, M.counts); if (M.after) maxC[M.ef - 1] = M.after[M.ef - 1];
    M.maxC = maxC;
    M.fit = M.rep === 'dienes' ? fitDienes(M, maxC) : fitCounters(M, maxC);
    if (!M.fit) R.push({ path: 'representation', reason: `There are too many ${M.rep === 'dienes' ? 'blocks' : 'counters'} to show clearly on one slide. Choose ${M.rep === 'dienes' ? 'counters or ' : ''}digits only, or a number with smaller digits.` });
  }
  return M;
}
// geometry shared by validate and render. The whole chart (headings, blocks, cards, bottom line) is laid out
// for the final build and centred in the content area, so nothing moves between builds.
const COL_MAX = 460, CARD_W = 104, CARD_H = 100, U_MAX = 32, HH0 = 50, BOT_PAD = 20, AVAIL = GRID.bottom - GRID.top;
const DCARD_H = [164, 132], DCARD_W = 132; // digits-only cards: one row, two rows
const topPadOf = rep => rep === 'dienes' ? 40 : 22; // dienes leave room for the running count
const tailOf = M => 16 + CARD_H + (M.line ? 54 : 0) + 4; // under the chart: cards, then the bottom line
const repAvailOf = (M, HH = HH0) => AVAIL - tailOf(M) - HH - topPadOf(M.rep) - BOT_PAD;
const colWOf = M => M.cw - 32;
// rods stand two cubes apart when a column's rods fit in one row that way, else a cube and a half, else one
const rodGap = (k, c, u, colW) => k !== 'tens' ? u : [2, 1.5].map(g => g * u).find(g => c * (u + g) - g <= colW) ?? u;
function dienesColH(k, c, u, colW) {
  if (!c) return 0;
  if (k === 'ones') { const r = Math.floor((c - 1) / 5); return r * 1.6 * u + Math.floor(r / 2) * u + u; }
  const w = k === 'thousands' ? 13 * u : k === 'hundreds' ? 10 * u : u, hh = k === 'thousands' ? 13 * u : 10 * u, gap = u;
  const per = Math.max(1, Math.min(10, Math.floor((colW + gap) / (w + gap)))); return Math.ceil(c / per) * (hh + gap) - gap;
}
// rods and flats stand apart, so four tens read as four sticks, not one block
function fitDienes(M, cnt, H = repAvailOf(M), colW = colWOf(M)) {
  for (let u = U_MAX; u >= 5; u--) {
    if (M.cols.includes(3) && 13 * u > colW) continue;
    if (M.cols.every(e => dienesColH(NAME[e], cnt[e] || 0, u, colW) <= H)) return { u };
  }
  return null;
}
// counters: label-size value text when they fit, scaled up as far as the column allows, else the smaller size
const counterR = (e, big) => { const s = valueOf(e), n = s.replace(/[,.]/g, '').length, p = (s.match(/[,.]/g) || []).length;
  return big ? Math.max(40, Math.ceil((n * 18 + p * 8) / 2 + 12)) : Math.max(30, Math.ceil((n * 15 + p * 7) / 2 + 10)); };
function fitCounters(M, cnt, H = repAvailOf(M)) {
  const tries = []; for (let k = 1.5; k >= 0.999; k -= 0.05) tries.push([true, k]); tries.push([false, 1]);
  for (const [big, k] of tries) {
    const out = {}; let ok = true;
    for (const e of M.cols) {
      const r = Math.round(counterR(e, big) * k), step = 2 * r + 8; if (2 * r > M.cw - 12) { ok = false; break; }
      const per = Math.max(1, Math.min(5, Math.floor((M.cw - 4) / step))), rows = Math.ceil((cnt[e] || 0) / per);
      if (rows * step - 8 > H) { ok = false; break; }
      out[e] = { r, k: r / counterR(e, big), step, per, cls: big ? 'ts-label' : 'ts-small', dy: big ? 10 : 8 };
    }
    if (ok) return out;
  }
  return null;
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); if (R.length) return result(R);
  const M = model(P);
  return result(M.R, M.warn);
}


/* ------------------------------------------------------------------ builds and notes */
const placesIn = (d, s) => { const out = []; for (let e = s.hi; e >= s.lo; e--) if (d[e] > 0) out.push(e); return out; };
const andList = p => p.length > 1 ? p.slice(0, -1).join(', ') + ' and ' + p[p.length - 1] : p[0];
const wordsOf = (d, s) => { const p = placesIn(d, s).map(e => many(d[e], e)); return p.length ? andList(p) : '0 ones'; };
const partsOf = (d, s) => placesIn(d, s).map(e => ({ e, v: fmtNum(d[e] * P10(e)) }));
const sumOf = (d, s) => { const p = partsOf(d, s).map(q => q.v); return p.length ? p.join(' + ') : '0'; };
const verb = M => M.op === 'multiply' ? '×' : '÷';
function zeros(M) { // placeholder zeros the answer needs that the moving digits do not bring
  if (M.rows < 2) return [];
  const sh = M.op === 'multiply' ? M.k : -M.k, out = [];
  for (let e = Math.max(0, M.rs.hi); e >= Math.min(0, M.rs.lo); e--) if (M.rd[e] === 0 && !(e - sh >= M.s.lo && e - sh <= M.s.hi)) out.push(e);
  return out;
}
// one column's blocks or counters: "4 tens. Count in tens: 10, 20, 30, 40."
function colCaption(e, c) {
  if (e === 0) return `${c} ${c === 1 ? 'one' : 'ones'}.`;
  if (c === 1) return `1 ${ONE[e]}.`;
  return `${many(c, e)}. Count in ${NAME[e]}: ${Array.from({ length: c }, (_, i) => fmtNum((i + 1) * P10(e))).join(', ')}.`;
}
function plan(P) {
  const M = model(P); const n = fromN3(M.n3); const rep = M.rep !== 'digits';
  const first = M.cols[0], last = M.cols[M.cols.length - 1];
  const steps = [{ key: 'chart', caption: rep ? `${cap1(NAME[first])} on the left, ${NAME[last]} on the right.` : 'Each column is worth ten times the column to its right.' }];
  const parts = placesIn(M.d, M.s); const one = parts.length === 1 && M.d[parts[0]] === 1;
  const makes = `${wordsOf(M.d, M.s)} ${one ? 'makes' : 'make'} ${n}.`;
  const addWords = parts.length > 1 ? `${n} is ${partsOf(M.d, M.s).map(q => q.v).join(' add ')}.` : `${n} is ${wordsOf(M.d, M.s)}.`;
  let summary;
  if (rep) {
    const filled = M.cols.filter(e => M.counts[e] > 0);
    if (filled.length <= 3) for (const e of filled) steps.push({ key: `col:${e}`, caption: colCaption(e, M.counts[e]) });
    else steps.push({ key: 'blocks', caption: `${wordsOf(M.d, M.s)}.` });
    if (M.op === 'show') summary = makes;
    else {
      steps.push({ key: 'number', caption: makes });
      if (M.op === 'partition') summary = addWords;
    }
  } else if (M.rows === 1) {
    steps.push({ key: 'number', caption: `Here is ${n} in the place value chart.` });
    summary = M.op === 'partition' ? addWords : `${n} is ${wordsOf(M.d, M.s)}.`;
  }
  if (M.rows === 2) {
    steps.push({ key: 'number', caption: `Here is ${n} in the place value chart.` });
    const cols = M.k === 1 ? 'one column' : M.k === 2 ? 'two columns' : 'three columns';
    steps.push({ key: 'move', caption: `${verb(M)} ${fmtNum(+P.factor)}: every digit moves ${cols} to the ${M.op === 'multiply' ? 'left' : 'right'}.` });
    const z = zeros(M);
    if (z.length) steps.push({ key: 'zero', caption: z.length === 1 ? `A 0 holds the empty ${NAME[z[0]]} column, so every digit keeps its new value.` : 'Zeros hold the empty columns, so every digit keeps its new value.' });
    summary = 'The digits moved; the decimal point stayed still.';
  } else if (M.op === 'regroup') {
    steps.push({ key: 'exchange', caption: `Exchange 1 ${ONE[M.ef]} for 10 ${NAME[M.ef - 1]}.` });
    summary = `The total is still ${n}.`;
  }
  return { M, steps, summary };
}
function afterWords(M) { return andList(M.cols.filter(e => M.after[e] > 0 || e === M.ef).map(e => many(M.after[e], e))); }

export function builds(P) { const { steps, summary } = plan(P); return { steps: steps.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }

export function notes(P) {
  const { M, steps } = plan(P); const n = fromN3(M.n3);
  const out = steps.map(({ key }) => {
    if (key === 'chart') return M.rep === 'digits'
      ? 'Ask: how many ones make a ten? How many tens make a hundred? Every column is ten of the column to its right.' + (M.lo < 0 ? ' To the right of the point, each column is a tenth of the one before.' : '')
      : 'Read the headings with the class. Ask: which column is worth more, and why?';
    if (key.startsWith('col:')) { const e = +key.slice(4); return e === 0 ? 'Count the ones together. Point out the row of five, so pupils can see how many without counting one by one.' : `Count in ${NAME[e]} together as each one arrives. Ask: how many ${NAME[e - 1]} are in one ${ONE[e]}?`; }
    if (key === 'blocks') return M.rep === 'dienes' ? 'Count the blocks in each column with the class.' : 'Each counter shows its own value. Count each column with the class.';
    if (key === 'number') return M.rep === 'digits' ? 'Read the number aloud, column by column. A dashed 0 is a placeholder: that column is empty.' : 'Match each count to its digit card. Stem sentence: there are ' + wordsOf(M.d, M.s) + '.';
    if (key === 'move') return `When we ${M.op === 'multiply' ? 'multiply' : 'divide'} by ${fmtNum(+(10 ** M.k))}, the digits move and the decimal point stays still. Avoid “add a zero”: it fails for decimals (3.7 × 10 is 37, not 3.70).`;
    if (key === 'zero') return 'A placeholder 0 keeps every digit in its new column. Without it the digits would slide back and the value would change.';
    if (key === 'exchange') return `One ${ONE[M.ef]} is worth ten ${NAME[M.ef - 1]}, so swapping keeps the total ${n}. This is the exchange used in column subtraction.`;
    return '';
  });
  const summary = M.rows === 2 ? `Check by doing the inverse: ${fromN3(M.r3)} ${M.op === 'multiply' ? '÷' : '×'} ${fmtNum(+P.factor)} = ${n}.`
    : M.op === 'regroup' ? 'Ask: why is the total the same? Which column-subtraction calculation needs this exchange?'
      : M.op === 'partition' ? `Stem sentence: there are ${wordsOf(M.d, M.s)}; ${n} is ${sumOf(M.d, M.s)}. Ask for another way to partition it.`
        : 'Ask the class to say the number in words and in parts, then build a different number with the same digits.';
  return { steps: out, summary };
}

/* ------------------------------------------------------------------ render */
const boxOf = el => { const r = el.querySelector('rect'); return { x: +r.getAttribute('x'), y: +r.getAttribute('y'), w: +r.getAttribute('width'), h: +r.getAttribute('height') }; };
const unionOf = bs => { const x = Math.min(...bs.map(q => q.x)), y = Math.min(...bs.map(q => q.y)); return { x, y, w: Math.max(...bs.map(q => q.x + q.w)) - x, h: Math.max(...bs.map(q => q.y + q.h)) - y }; };
// a rod, flat or cube as the real manipulative looks: a crisp edge in its column's text colour and visible unit grooves
function crisp(el, e, u) {
  const b = boxOf(el), c = colour(e), g = el; const groove = `color-mix(in oklab, ${c.fill} 50%, var(--paper))`;
  if (e >= 1 && e <= 2) {
    for (let i = 1; i < Math.round(b.h / u); i++) h('line', { x1: b.x, x2: b.x + b.w, y1: b.y + i * u, y2: b.y + i * u, stroke: groove, 'stroke-width': 'var(--sw-hair)' }, g);
    if (e === 2) for (let i = 1; i < 10; i++) h('line', { x1: b.x + i * u, x2: b.x + i * u, y1: b.y, y2: b.y + b.h, stroke: groove, 'stroke-width': 'var(--sw-hair)' }, g);
  }
  if (e <= 2) h('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: 'none', stroke: c.text, 'stroke-width': 'var(--sw-hair)' }, g);
}

// a digit card at any size: the kit card (88 tall) scaled as a whole, so the digit grows with the card
function bigCard(p, x, y, d, col, { w, ht, ...o }) {
  const k = ht / 88, g = h('g', { transform: `translate(${x} ${y}) scale(${k})` }, p);
  return digitCard(g, 0, 0, d, col, Object.assign({}, o, { w: w / k, h: 88 }));
}

export function render(root, P, ctx) {
  const { M } = plan(P); const b = ctx.b, N = ctx.N, bi = key => b[key] ?? 0;
  if (M.R && M.R.length) { ctx.warn(`refused params: ${M.R.map(r => r.reason).join(' ')}`); return {}; }
  const { cols, cw } = M; const xOf = e => M.x0 + (M.hi - e) * cw; const cx = e => xOf(e) + cw / 2;
  const rep = M.rep !== 'digits';
  const sChart = bi('chart');
  const hs = (ctx.tk && ctx.tk.head) || 14;

  /* headings: plain text in the column colour; wrap first, the heading area grows to the tallest */
  const hg = h('g', { s: sChart, cls: 'rise' }, root);
  const heads = cols.map(e => {
    const c = colour(e);
    if (P.headings === 'values') { const t = T(hg, cx(e), 0, valueOf(e), 'ts-label', { 'text-anchor': 'middle', fill: c.text, 'font-weight': 'var(--w-strong)' }); computed(t, 'headings'); return { el: t, h: 30, lh: 30 }; }
    // a heading word that cannot fit its column even at the minimum size falls back to its letters
    const W8 = { 'font-weight': 'var(--w-strong)' }, own = txt(P, `label:col:${e}`, null);
    let def = P.headings === 'letters' ? SHORT[e] : cap1(NAME[e]);
    const longest = s => Math.max(...String(s).split(/\s+/).map(w => measure(hg, w, 'ts-tiny', W8)));
    if (!own && longest(def) > cw - 10) def = SHORT[e];
    if (own && longest(own) > cw - 10) ctx.warn(`the heading “${own}” has a word wider than its column`);
    return textBlock(hg, cx(e), 0, own || def, { cls: cw >= 200 ? 'ts-label' : longest(own || def) * 24 / 22 > cw - 10 ? 'ts-tiny' : 'ts-small', maxW: cw - 16, maxLines: 3, lh: cw >= 200 ? 32 : 26, anchor: 'middle', edit: `text.label:col:${e}`, a: { fill: c.text, 'font-weight': 'var(--w-strong)' } });
  });
  const HH = HH0 + Math.max(0, ...heads.map(t => t.h - t.lh));

  /* size the hero for the final build, then centre the whole chart in the content area */
  const colW = colWOf(M), topPad = topPadOf(M.rep);
  let u = 0, fit = null, repH = 0, total, cardH = CARD_H, lineBig = false;
  const dH = DCARD_H[M.rows - 1], dW = Math.min(DCARD_W, cw - 24);
  const dGap = 104, dPadT = 20, dPadB = 22, dLine = 74; // digits only: the gap between rows leaves room for the move arrows
  if (rep) {
    const H = repAvailOf(M, HH);
    if (M.rep === 'dienes') { u = (fitDienes(M, M.maxC, H, colW) || M.fit).u; repH = Math.max(...cols.map(e => e >= 0 && e <= 3 ? dienesColH(NAME[e], M.maxC[e] || 0, u, colW) : 0)); }
    else { fit = fitCounters(M, M.maxC, H) || M.fit; repH = Math.max(...cols.map(e => Math.ceil((M.maxC[e] || 0) / fit[e].per) * fit[e].step - 8)); }
    repH = Math.max(repH, 40);
    total = HH + topPad + repH + BOT_PAD + tailOf(M);
    // room to spare (counters stop growing at the column width): bigger cards, then a bigger bottom line
    const spare = AVAIL - total; cardH = CARD_H + Math.max(0, Math.min(32, spare - 24)); lineBig = M.line && spare >= 24;
    total += cardH - CARD_H + (lineBig ? 12 : 0);
  } else total = HH + dPadT + M.rows * dH + (M.rows - 1) * dGap + dPadB + (M.rows === 2 || M.op === 'partition' || M.op === 'regroup' ? dLine : 0);
  const HT = GRID.top + Math.max(0, Math.round((AVAIL - total) / 2)); const hb = HT + HH;
  cols.forEach((e, i) => {
    const t = heads[i]; t.el.setAttribute('y', HT + HH / 2 - (t.h - t.lh) / 2 + 12);
    for (const sp of t.el.querySelectorAll('tspan')) sp.setAttribute('x', cx(e));
  });
  /* the chart itself: a hairline under the headings and between the columns; no panels, no colour bars */
  const frame = h('g', { s: sChart }, root); root.insertBefore(frame, hg);
  const xL = xOf(M.hi), xR = xOf(M.lo) + cw;
  h('line', { x1: xL + 8, x2: xR - 8, y1: hb, y2: hb, stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }, frame);
  const dividers = cols.slice(1).map(e => h('line', { x1: xOf(e), x2: xOf(e), y1: HT, y2: HT, stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }, frame));
  const setBottom = y => dividers.forEach(l => l.setAttribute('y2', y));
  const links = h('g', {}, root); // arrows sit under the cards

  // the bottom line: shrinks a step, never below the minimum, never past the live area
  const lineCls = (s, big) => { const maxW = GRID.right - GRID.left; const cls = [...(big ? ['ts-eq'] : []), 'ts-num', 'ts-label', 'ts-small'].find(c => measure(root, s, c) <= maxW) || 'ts-small';
    if (measure(root, s, cls) > maxW) ctx.warn(`bottom line too long: “${s}”`); return cls; };
  // "47 = 40 + 7", each part in its column's colour
  const sumLine = (y, s, big) => {
    const parts = partsOf(M.d, M.s), str = `${fromN3(M.n3)} = ${sumOf(M.d, M.s)}`, cls = lineCls(str, big);
    const t = T(root, 640, y, `${fromN3(M.n3)} = `, cls, { 'text-anchor': 'middle', s, cls: `${cls} rise` });
    if (!parts.length) h('tspan', {}, t).textContent = '0';
    parts.forEach((q, i) => { if (i) h('tspan', {}, t).textContent = ' + '; h('tspan', { fill: colour(q.e).text }, t).textContent = q.v; });
    computed(t, 'number');
  };
  const sEx = b.exchange; const regroup = sEx != null;

  /* ---------------- digits only: the cards are the representation, inside the chart */
  if (!rep) {
    const rowY = [hb + dPadT + dH / 2, hb + dPadT + dH * 1.5 + dGap];
    const bodyB = rowY[M.rows - 1] + dH / 2 + dPadB;
    setBottom(bodyB);
    const sNum = bi('number');
    // the first build's focal: ×10 from each column to the one on its left (gone once the number arrives)
    const ag = h('g', { hide: sNum }, root); const lift = Math.min(70, cw * .25), yA = Math.round((hb + bodyB) / 2) + lift * .8;
    const lab = txt(P, 'label:times10', '× 10');
    for (let i = 1; i < cols.length; i++) {
      const x1 = cx(cols[i]) - 10, x2 = cx(cols[i - 1]) + 10, cy = yA - 2 * lift, ang = Math.atan2(yA - cy, x2 - (x1 + x2) / 2);
      const ex = x2 - Math.cos(ang) * hs * .72, ey = yA - Math.sin(ang) * hs * .72;
      arrow(ctx, ag, `M${x1} ${yA} Q ${(x1 + x2) / 2} ${cy} ${ex} ${ey}`, ex, ey, ang, 'var(--focus)', null, { draw: sChart, delay: i * 150 });
      if (measure(ag, lab, 'ts-label') <= cw - 24) editable(T(ag, (x1 + x2) / 2, yA - lift - 14, lab, 'ts-label', { 'text-anchor': 'middle', fill: 'var(--focus-text)', 'font-weight': 'var(--w-strong)', s: sChart, cls: 'ts-label halo rise', delay: 400 + i * 150 }), 'text.label:times10');
    }
    const point = (y, s, delay) => h('circle', { cx: xOf(-1), cy: y + dH / 2 - 18, r: 11, fill: 'var(--ink)', s, cls: 'pop', delay }, root);
    const card = (p, e, y, d, a) => bigCard(p, cx(e), y, d, e === 7 ? 4 : e, { w: dW, ht: dH, computedPath: 'number', placeholder: d === 0, a });
    if (M.rows === 2) {
      const sMove = bi('move'), sZero = b.zero ?? sMove, sh = M.op === 'multiply' ? M.k : -M.k;
      for (let e = Math.max(0, M.s.hi); e >= Math.min(0, M.s.lo); e--) card(root, e, rowY[0], M.d[e], { s: sNum, cls: 'pop', delay: (M.hi - e) * 90, c: `${sMove}:soft` });
      if (M.lo < 0) point(rowY[0], sNum, 300);
      if (M.rs.lo < 0) point(rowY[1], sMove, 900);
      // moving digits fly from row one, shifted by the factor; an arrow links each digit to its new column
      const mv = h('g', {}, root); const opS = `${verb(M)} ${fmtNum(+P.factor)}`;
      for (let e = M.s.hi; e >= M.s.lo; e--) {
        const to = e + sh, i = M.s.hi - e;
        const x1 = cx(e), y1 = rowY[0] + dH / 2 + 8, x2 = cx(to), y2 = rowY[1] - dH / 2 - 10, ang = Math.atan2(y2 - y1, x2 - x1);
        const ex = x2 - Math.cos(ang) * hs * .72, ey = y2 - Math.sin(ang) * hs * .72;
        arrow(ctx, links, `M${x1} ${y1} L${ex} ${ey}`, ex, ey, ang, 'var(--focus)', null, { draw: sMove, delay: i * 120 });
        if (i === 0) { const my = (y1 + y2) / 2;
          computed(T(root, Math.min(x1, x2) + Math.abs(x2 - x1) / 2 - 16, sh > 0 ? my - 14 : my + 40, opS, 'ts-label', { 'text-anchor': 'end', fill: 'var(--focus-text)', 'font-weight': 'var(--w-strong)', s: sMove, cls: 'ts-label halo rise', delay: 500 }), 'factor'); }
        const w = h('g', { s: sMove, cls: 'fly', delay: i * 120, vars: { '--fx': `${cx(e) - cx(to)}px`, '--fy': `${rowY[0] - rowY[1]}px` } }, mv);
        card(w, to, rowY[1], M.rd[to], {});
      }
      for (const e of zeros(M)) card(mv, e, rowY[1], 0, { s: sZero, cls: 'pop' });
      const eq = `${fromN3(M.n3)} ${verb(M)} ${fmtNum(+P.factor)} = ${fromN3(M.r3)}`, ecls = lineCls(eq, true);
      computed(T(root, 640, bodyB + dLine - 12, eq, ecls, { 'text-anchor': 'middle', s: N, cls: `${ecls} rise` }), 'number');
      return {};
    }
    for (let e = Math.max(0, M.s.hi); e >= Math.min(0, M.s.lo); e--) card(root, e, rowY[0], M.d[e], { s: sNum, cls: 'pop', delay: (M.hi - e) * 90, hide: regroup && (e === M.ef || e === M.ef - 1) ? sEx : null });
    if (regroup) for (const e of [M.ef, M.ef - 1]) card(root, e, rowY[0], M.after[e], { s: sEx, cls: 'pop', delay: 600 });
    if (M.lo < 0) point(rowY[0], sNum, 300);
    const lineY = bodyB + dLine - 12;
    if (M.op === 'partition') sumLine(lineY, N, true);
    if (regroup) { const s = `${wordsOf(M.d, M.s)} = ${afterWords(M)}`, c = lineCls(s, true); computed(T(root, 640, lineY, s, c, { 'text-anchor': 'middle', s: N, cls: `${c} rise` }), 'regroupFrom'); }
    return {};
  }

  /* ---------------- blocks or counters in the columns */
  const sCol = e => b[`col:${e}`] ?? b.blocks ?? 0;
  const oneByOne = e => b[`col:${e}`] != null && e >= 1; // rods drop in one at a time, counted in tens
  const repTop = hb + topPad, repLimit = repTop + repAvailOf(M, HH);
  let repBottom = repTop;
  const rg = h('g', {}, root);
  if (M.rep === 'dienes') {
    const D = {};
    for (const e of cols) {
      if (e < 0 || e > 3) continue;
      const k = NAME[e], c = regroup && e === M.ef - 1 ? M.after[e] : M.counts[e]; if (!c) continue;
      // rods and flats stand apart, centred in the column; ones in rows of five, level with the rods' tops
      let bx = xOf(e) + 16, bw = colW, n1 = c, gp = u;
      if (k !== 'ones') { const w = k === 'thousands' ? 13 * u : k === 'hundreds' ? 10 * u : u; gp = rodGap(k, M.maxC[e], u, colW); n1 = Math.min(c, 10, Math.max(1, Math.floor((bw + gp) / (w + gp)))); const used = n1 * (w + gp) - gp; bx += (bw - used) / 2; bw = used; }
      D[e] = dienes(rg, 0, { counts: { [k]: c }, places: [k], x: bx, y: repTop, colW: bw, gap: gp, u, maxH: repLimit - repTop, sCol: { [k]: sCol(e) }, warn: ctx.warn });
      const items = D[e].cols[k].items;
      items.forEach((el, i) => {
        crisp(el, e, u);
        if (oneByOne(e) && i < M.counts[e]) el.style.setProperty('--d', `calc(${i * 380}ms * var(--pace))`);
      });
      // a part-filled row of ones is centred under the full row above it, so the ones sit under the Ones heading
      if (k === 'ones') { const nOld = regroup && e === M.ef - 1 ? (M.counts[e] || 0) : c;
        items.slice(0, nOld).forEach((el, i) => { const inRow = Math.min(5, nOld - Math.floor(i / 5) * 5); if (inRow >= 5) return;
          const wrap = h('g', { transform: `translate(${(5 - inRow) * 1.6 * u / 2} 0)` }); el.parentNode.insertBefore(wrap, el); wrap.appendChild(el); }); }
      // the running count above each rod: 10, 20, 30, 40 (steps back a little once the column is counted)
      if (oneByOne(e) && M.counts[e] >= 2 && M.counts[e] <= n1) {
        const pitch = (k === 'thousands' ? 13 : k === 'hundreds' ? 10 : 1) * u + gp;
        const labs = items.slice(0, M.counts[e]).map((el, i) => fmtNum((i + 1) * P10(e)));
        const cls = ['ts-label', 'ts-small', 'ts-tiny'].find(cl => labs.every(s => measure(root, s, cl, { 'font-weight': 'var(--w-strong)' }) <= pitch - 4));
        if (cls) items.slice(0, M.counts[e]).forEach((el, i) => { const bb = boxOf(el);
          computed(T(rg, bb.x + bb.w / 2, repTop - 12, labs[i], cls, { 'text-anchor': 'middle', fill: colour(e).text, 'font-weight': 'var(--w-strong)', s: sCol(e), cls: `${cls} rise`, delay: i * 380 + 200, c: ctx.rc(`col:${e}`, N + 1, 'soft'), hide: regroup && e === M.ef && i === M.counts[e] - 1 ? sEx : null }), 'number'); });
      }
      repBottom = Math.max(repBottom, D[e].bottom);
    }
    if (regroup && D[M.ef] && D[M.ef - 1]) {
      // the exchange: one block flies into the next column and breaks into ten; its ghost stays behind
      const f = M.ef, t = f - 1, src = D[f].cols[NAME[f]].items, dst = D[t].cols[NAME[t]].items;
      const last = src[src.length - 1]; last.dataset.h = sEx; const gb = boxOf(last);
      h('rect', { x: gb.x, y: gb.y, width: gb.w, height: gb.h, fill: 'none', stroke: colour(f).text, 'stroke-width': 'var(--sw-hair)', 'stroke-dasharray': '6 5', s: sEx }, rg);
      const fresh = dst.slice(M.counts[t] || 0), boxes = [];
      // new ones land as their own block of ten (two rows of five) under the ones already there, so 12 reads as 10 and 2
      const old = M.counts[t] || 0, ones = t === 0 && old > 0, x0 = ones ? boxOf(dst[0]).x : 0, rowsOld = Math.ceil(old / 5);
      fresh.forEach((el, j) => {
        const kb = boxOf(el); const bb = ones ? { x: x0 + (j % 5) * 1.6 * u, y: repTop + rowsOld * 1.6 * u + .6 * u + Math.floor(j / 5) * 1.6 * u, w: kb.w, h: kb.h } : kb; boxes.push(bb);
        delete el.dataset.s; el.removeAttribute('class'); el.style.removeProperty('--d');
        const at = h('g', { transform: `translate(${bb.x - kb.x} ${bb.y - kb.y})` }, rg);
        const w = h('g', { s: sEx, cls: 'fly', delay: 300 + j * 60, vars: { '--fx': `${gb.x - bb.x}px`, '--fy': `${gb.y + j * gb.h / 10 - bb.y}px` } }, at);
        w.appendChild(el); repBottom = Math.max(repBottom, bb.y + bb.h);
      });
      const U = unionOf(boxes);
      h('rect', { x: U.x - 8, y: U.y - 8, width: U.w + 16, height: U.h + 16, fill: 'none', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)', rx: 'var(--r-mark)', s: sEx, cls: 'pop', delay: 1000 }, rg);
      const sx = gb.x + gb.w + 14, sy = gb.y + gb.h * .5, ex = U.x - 18 - hs * .72, ey = U.y + U.h / 2;
      if (ex - sx >= 80) arrow(ctx, links, `M${sx} ${sy} C ${sx + 120} ${sy}, ${ex - 120} ${ey}, ${ex} ${ey}`, ex, ey, 0, 'var(--focus)', null, { draw: sEx });
    }
  } else {
    // counters: rows centred in the column (a part-filled last row too); the column an exchange fills keeps its
    // rows left-aligned on the fullest it gets, so the ten new counters continue the rows
    const slot = (e, i) => { const f = fit[e]; const r = Math.floor(i / f.per), c = i % f.per;
      const target = regroup && e === M.ef - 1; const rowN = target ? Math.min(f.per, Math.max(1, M.maxC[e] || 0)) : Math.min(f.per, (M.counts[e] || 0) - r * f.per);
      const w = rowN * f.step - 8; return [cx(e) - w / 2 + f.r + c * f.step, repTop + f.r + r * f.step]; };
    const pvc = (p, e, x, y, a) => { const c = colour(e), f = fit[e]; const g = h('g', a, p);
      h('circle', { cx: x, cy: y, r: f.r, fill: c.pale, stroke: c.fill, 'stroke-width': 'var(--sw-struct)', cls: 'body' }, g);
      const s = h('g', { transform: `translate(${x} ${y}) scale(${f.k})` }, g);
      computed(T(s, 0, f.dy, valueOf(e), f.cls, { 'text-anchor': 'middle', fill: c.text, 'font-weight': 'var(--w-strong)' }), 'number');
      return g; };
    for (const e of cols) for (let i = 0; i < M.counts[e]; i++) {
      const [x, y] = slot(e, i); repBottom = Math.max(repBottom, y + fit[e].r); const last = regroup && e === M.ef && i === M.counts[e] - 1;
      pvc(rg, e, x, y, { s: sCol(e), cls: 'pop', delay: (oneByOne(e) ? 300 : 120) * i, hide: last ? sEx : null });
      if (last) h('circle', { cx: x, cy: y, r: fit[e].r, fill: 'none', stroke: colour(e).text, 'stroke-width': 'var(--sw-hair)', 'stroke-dasharray': '6 5', s: sEx }, rg);
    }
    if (regroup) {
      const e = M.ef, t = e - 1; const [sx, sy] = slot(e, M.counts[e] - 1);
      for (let j = 0; j < 10; j++) { const [x, y] = slot(t, M.counts[t] + j); repBottom = Math.max(repBottom, y + fit[t].r);
        const w = h('g', { s: sEx, cls: 'fly', delay: j * 50, vars: { '--fx': `${sx - x}px`, '--fy': `${sy - y}px` } }, rg); pvc(w, t, x, y, {}); }
    }
  }
  if (repBottom > repLimit + 2) ctx.warn('the blocks or counters run past the bottom of the chart');

  /* the chart ends just below its blocks; one digit card per column sits under it */
  const chartB = Math.max(repTop + repH, repBottom) + BOT_PAD; setBottom(chartB);
  const cardW = Math.min(CARD_W * cardH / CARD_H, cw - 24), cy = chartB + 16 + cardH / 2, sCards = b.number ?? N;
  const cg = h('g', {}, root);
  for (let e = Math.max(0, M.s.hi); e >= Math.min(0, M.s.lo); e--) {
    if (!cols.includes(e)) continue;
    bigCard(cg, cx(e), cy, M.d[e], e === 7 ? 4 : e, { w: cardW, ht: cardH, computedPath: 'number', placeholder: M.d[e] === 0, a: { s: sCards, cls: 'rise', delay: (M.hi - e) * 120, hide: regroup && (e === M.ef || e === M.ef - 1) ? sEx : null } });
  }
  if (regroup) for (const e of [M.ef, M.ef - 1]) bigCard(cg, cx(e), cy, M.after[e], e, { w: cardW, ht: cardH, computedPath: 'number', placeholder: M.after[e] === 0, a: { s: sEx, cls: 'pop', delay: 1100 } });

  /* the bottom line: the partition, or the exchange statement (in the summary) */
  const lineY = cy + cardH / 2 + (lineBig ? 66 : 54);
  if (M.op === 'partition') sumLine(lineY, N, lineBig);
  if (regroup) { const s = `${wordsOf(M.d, M.s)} = ${afterWords(M)}`, c = lineCls(s, lineBig); computed(T(root, 640, lineY, s, c, { 'text-anchor': 'middle', s: N, cls: `${c} rise` }), 'regroupFrom'); }
  return {};
}
