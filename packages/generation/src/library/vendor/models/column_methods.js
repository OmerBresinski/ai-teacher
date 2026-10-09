// Column addition and subtraction with exchanging (Y3–Y6). The teacher enters the two numbers,
// + or −, compact or expanded, and whether place value counters sit in a chart directly above the
// written columns (one aligned grid: H T O over the counters and over the digits, as White Rose and
// Oak show it). Every digit of the working, every exchange and the answer are computed here, so the
// slide can never show a wrong sum. Builds: set out → the counters → each column from the smallest
// place (an addition exchange belongs to its column's build; a subtraction exchange is its own
// build) → the summary: the counters join up to show the answer, and the answer is ringed or underlined. The inverse check lives in the teacher notes.
import {
  h, T, measure, wrap, GRID, textBlock, arrow,
  computed, txt, TEXT_PARAM_FOR, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { fmtNum, pvColour, groupRing } from '../kit/batch-A.js';

export const meta = {
  id: 'column_methods', name: 'Column addition and subtraction', kind: 'info', version: 2,
  subjects: ['Maths'],
  years: ['Y3', 'Y4', 'Y5', 'Y6'],
  teaches: 'Adding and taking away in columns: digits lined up by place value, one column at a time from the smallest place, exchanging ten for one (or one for ten) only where it is needed.',
};

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Column method',
  required: ['a', 'b'],
  properties: {
    title: TITLE_PARAM('Column addition'),
    op: { type: 'string', title: 'Add or take away', enum: ['add', 'subtract'], 'x-labels': ['Add (+)', 'Take away (−)'], default: 'add' },
    a: { type: 'number', title: 'Top number', description: 'A whole number up to 99,999, or a decimal with up to 2 decimal places.', minimum: 0, maximum: 99999.99, default: 245 },
    b: { type: 'number', title: 'Bottom number', description: 'The number added on, or the number taken away.', minimum: 0, maximum: 99999.99, default: 137 },
    method: { type: 'string', title: 'Method', enum: ['compact', 'expanded'], 'x-labels': ['Compact (exchanges written small)', 'Expanded (partial sums, or numbers partitioned)'], default: 'compact' },
    showBlocks: { type: 'boolean', title: 'Show place value counters above the columns', description: 'Counters for each digit sit in a chart directly above the written columns, so the exchanges can be seen. They go with the compact method.', default: true },
    check: { type: 'boolean', title: 'Add a check with the inverse to the teacher notes', default: true, 'x-panel': 'advanced' },
    // column headers are place names (label cap)
    text: TEXT_PARAM_FOR(Object.assign({}, ...[-2, -1, 0, 1, 2, 3, 4, 5].map(e => ({ [`head:${e}`]: 'label' })))),
  },
};

export const presets = [
  { id: 'y3-compact-add', name: 'Year 3: 245 + 137, compact, with place value counters', params: {
    title: 'Column addition with an exchange', op: 'add', a: 245, b: 137, method: 'compact', showBlocks: true,
  } },
  { id: 'y4-across-zero', name: 'Year 4: 503 − 278, exchanging across a zero', params: {
    title: 'Exchanging across a zero', op: 'subtract', a: 503, b: 278, method: 'compact', showBlocks: true,
  } },
  { id: 'y5-compact-add', name: 'Year 5: 4,682 + 2,759', params: {
    title: 'Column addition', op: 'add', a: 4682, b: 2759, method: 'compact', showBlocks: false,
  } },
  { id: 'y6-decimals', name: 'Year 6: 15.4 − 7.85, decimals', params: {
    title: 'Taking away decimals', op: 'subtract', a: 15.4, b: 7.85, method: 'compact', showBlocks: false,
  } },
];

/* ------------------------------------------------------------------ numbers */
const NEG = '−';
const PLACE = { 5: ['hundred thousand', 'hundred thousands', 'HTh'], 4: ['ten thousand', 'ten thousands', 'TTh'], 3: ['thousand', 'thousands', 'Th'], 2: ['hundred', 'hundreds', 'H'], 1: ['ten', 'tens', 'T'], 0: ['one', 'ones', 'O'], '-1': ['tenth', 'tenths', '1/10'], '-2': ['hundredth', 'hundredths', '1/100'] };
const sg = e => PLACE[e][0], pl = e => PLACE[e][1];
const nOf = (n, e) => `${n} ${n === 1 ? sg(e) : pl(e)}`;
const cap1 = s => s[0].toUpperCase() + s.slice(1);
const dpOf = v => { for (let d = 0; d <= 6; d++) { const x = v * 10 ** d; if (Math.abs(x - Math.round(x)) < 1e-6) return d; } return 7; };
const listAnd = a => a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;

const MAX_COUNTER_COLS = 4; // counters ten to a row per column: past four columns the method no longer fits at a readable size
function model(P) {
  const add = P.op !== 'subtract', exp = P.method === 'expanded';
  const dpa = dpOf(P.a), dpb = dpOf(P.b), dp = Math.min(2, Math.max(dpa, dpb)), S = 10 ** dp;
  const A = Math.round(P.a * S), B = Math.round(P.b * S), R = add ? A + B : A - B;
  const len = n => Math.max(String(Math.abs(n)).length, dp + 1);
  const lA = len(A), lB = len(B), lR = len(R), ncol = Math.max(lA, lB, lR);
  const dig = (n, i) => Math.floor(Math.abs(n) / 10 ** i) % 10;
  const E = i => i - dp, kn = i => pl(E(i)).replace(/ /g, '-');
  const f = n => fmtNum(n / S);
  const sign = add ? '+' : NEG;
  // counters go with the compact method (the expanded rows already show each place whole)
  // and fit beside each other only up to four columns: wider, the whole method shrinks below the type floor
  const counters = !!P.showBlocks && !exp && R >= 0 && ncol <= MAX_COUNTER_COLS;
  const steps = [];
  const top = Array.from({ length: ncol }, (_, i) => i < lA ? dig(A, i) : 0);
  const val = top.map((d, i) => d * 10 ** i);
  const places = Array.from({ length: ncol }, (_, i) => pl(E(ncol - 1 - i)));
  steps.push({ type: 'setout', key: 'setout', caption: exp && !add ? 'Partition both numbers and line up the parts by place value.' : dp ? 'Line up the decimal points, so every digit sits under the same place.' : `Line up ${listAnd(places)}.` });
  if (counters) steps.push({ type: 'counters', key: 'counters', caption: add ? `Here are ${f(A)} and ${f(B)} as counters.` : `Here is ${f(A)} as counters, ready to take ${f(B)} away.` });
  if (add) {
    let c = 0; let first = true;
    for (let i = 0; i < ncol; i++) {
      const hasA = i < lA, hasB = i < lB; if (!hasA && !hasB && !c) continue;
      const da = hasA ? dig(A, i) : 0, db = hasB ? dig(B, i) : 0, cin = c, s = da + db + cin; c = s >= 10 ? 1 : 0;
      const Pn = cap1(pl(E(i)));
      if (exp && !hasA && !hasB) continue;
      let caption;
      if (exp) { const v = [hasA && i >= dp - dpa ? da * 10 ** i : null, hasB && i >= dp - dpb ? db * 10 ** i : null].filter(x => x != null); caption = v.length === 1 ? `${Pn}: only ${f(v[0])}, with nothing to add to it.` : `${Pn}: ${v.map(x => f(x)).join(' + ')} = ${f((da + db) * 10 ** i)}.`; }
      else {
        const t = [hasA ? String(da) : null, hasB ? String(db) : null].filter(Boolean); if (cin) t.push('1');
        if (!hasA && !hasB) caption = `${Pn}: just the 1 exchanged. Write 1.`;
        else if (t.length === 1) caption = `${Pn}: ${nOf(s, E(i))}, with nothing to add. Write ${s}.`;
        else if (c) caption = `${t.join(' + ')} = ${s}. Exchange 10 ${pl(E(i))} for 1 ${sg(E(i + 1))}.`;
        else caption = `${t.join(' + ')} = ${nOf(s, E(i))}.`;
      }
      steps.push({ type: 'col', key: `col:${kn(i)}`, i, da, db, hasA, hasB, cin, s, cout: exp ? 0 : c, first, caption });
      first = false;
    }
    // expanded: the partial sums are added up on their own build
    if (exp) steps.push({ type: 'answer', key: 'answer', caption: `Add the rows: ${f(A)} ${sign} ${f(B)} = ${f(R)}.` });
  } else {
    for (let i = 0; i < lA; i++) {
      const hasB = i < lB, db = hasB ? dig(B, i) : 0;
      if (top[i] < db) {
        const before = top[i]; let j = i + 1; while (top[j] === 0) j++;
        const zeros = []; for (let z = i + 1; z < j; z++) zeros.push(pl(E(z)));
        for (let m = j; m > i; m--) {
          top[m] -= 1; top[m - 1] += 10; val[m] = top[m] * 10 ** m; val[m - 1] = top[m - 1] * 10 ** (m - 1);
          const what = `exchange 1 ${sg(E(m))} for 10 ${pl(E(m - 1))}`;
          const caption = j === i + 1 ? `${before} ${NEG} ${db}: not enough ${pl(E(i))}. ${cap1(what)}: now ${nOf(top[i], E(i))}.`
            : m === j ? `${before} ${NEG} ${db} needs more ${pl(E(i))}, but there are no ${zeros.join(' or ')}: ${what}.`
              : `Now ${what}${m - 1 === i ? `: ${nOf(top[i], E(i))}` : ''}.`;
          const regroup = top.slice(0, lA).map((d, q) => [d, q]).reverse().map(([d, q]) => nOf(d, E(q)));
          steps.push({ type: 'ex', key: `ex:${kn(m)}`, from: m, to: m - 1, newFrom: top[m], newTo: top[m - 1], fromVal: val[m], toVal: val[m - 1], caption, regroup });
        }
      }
      const d = top[i] - db, lead = i > 0 && i >= lR, Pn = cap1(pl(E(i)));
      const caption = lead ? (hasB ? `${Pn}: ${top[i]} ${NEG} ${db} = 0, and a zero at the front is not written.` : `${Pn}: nothing is left, and a zero at the front is not written.`)
        : exp ? (hasB ? `${Pn}: ${f(val[i])} ${NEG} ${f(db * 10 ** i)} = ${f(d * 10 ** i)}.` : `${Pn}: nothing to take away, so ${f(val[i])} stays.`)
          : hasB ? `${Pn}: ${top[i]} ${NEG} ${db} = ${d}. Write ${d}.` : `${Pn}: nothing to take away, so write ${d}.`;
      steps.push({ type: 'col', key: `col:${kn(i)}`, i, t: top[i], tv: val[i], db, hasB, d, lead, first: i === 0, caption });
    }
  }
  return { add, exp, dp, dpa, dpb, S, A, B, R, lA, lB, lR, ncol, dig, E, f, sign, counters, steps };
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P);
  if (R.length) return result(R);
  for (const k of ['a', 'b']) if (dpOf(P[k]) > 2) R.push({ path: k, reason: `${fmtNum(P[k])} has more than 2 decimal places. The columns go down to hundredths, so round it to 2 decimal places.` });
  if (R.length) return result(R);
  const M = model(P);
  if (!M.add && M.B > M.A) R.push({ path: 'b', reason: `${M.f(M.B)} is bigger than ${M.f(M.A)}, so the answer would be negative. Column subtraction takes the smaller number from the bigger one: swap the numbers, or change one of them.` });
  if (M.exp && M.ncol > 4) R.push({ path: 'method', reason: 'The expanded method needs a row for every place, and numbers this big need too many rows to read on one slide. Use the compact method, or numbers below 10,000.' });
  // counters that cannot be shown are left off with a note, never a refusal
  const W = [];
  const why = countersOff(P, M); if (why) W.push({ path: 'showBlocks', reason: why });
  return result(R, W);
}

// why counters that were asked for are not drawn (null when they are drawn, or not asked for)
function countersOff(P, M) {
  if (!P.showBlocks || M.counters || M.R < 0) return null;
  if (M.exp) return 'Place value counters go with the compact method, so they are left off for the expanded method.';
  return `Place value counters fit above up to ${MAX_COUNTER_COLS} columns, and these numbers need ${M.ncol}, so the counters are left off and the digits stay big enough to read.`;
}

/* ------------------------------------------------------------------ builds and notes */
export function builds(P) {
  const M = model(P);
  return { steps: M.steps.map(({ key, caption }) => ({ key, caption })), summary: { caption: `${M.f(M.A)} ${M.sign} ${M.f(M.B)} = ${M.f(M.R)}.` } };
}
// a rounded estimate, or null when rounding cannot help (a non-zero number would round to 0
// even at its smallest place, or the "estimate" would just be the exact sum)
function estimate(M) {
  const a = M.A / M.S, b = M.B / M.S, big = Math.max(a, b), min = 10 ** -M.dp;
  let p = M.dp ? 1 : 10 ** Math.max(0, String(Math.round(big)).length - 2);
  const rd = v => +(Math.round(v / p) * p).toFixed(6);
  while (p > min + 1e-9 && ((a && !rd(a)) || (b && !rd(b)))) p /= 10;
  const ea = rd(a), eb = rd(b);
  if ((a && !ea) || (b && !eb) || (Math.abs(ea - a) < 1e-9 && Math.abs(eb - b) < 1e-9)) return null;
  return `${fmtNum(ea)} ${M.sign} ${fmtNum(eb)} = ${fmtNum(+(M.add ? ea + eb : ea - eb).toFixed(6))}`;
}
export function notes(P) {
  const M = model(P);
  const steps = M.steps.map(st => {
    const e = st.i != null ? M.E(st.i) : 0;
    if (st.type === 'setout') {
      let n = `Read both numbers aloud. Ask: why must the ${pl(M.E(0))} sit under the ${pl(M.E(0))}?`;
      if (M.dpa < M.dp) n += ` The grey 0 in ${fmtNum(M.A / M.S, M.dp)} is a placeholder: ${M.f(M.A)} and ${fmtNum(M.A / M.S, M.dp)} are the same number.`;
      const off = countersOff(P, M); if (off) n += ` ${off}`;
      if (M.exp && M.add) n += ' In the expanded method each place is added on its own row, then the rows are added.';
      return n;
    }
    if (st.type === 'counters') return M.add
      ? 'The counters sit in the same columns as the digits: each counter is worth its column. Pupils can build both numbers with their own counters.'
      : `Only ${M.f(M.A)} is made with counters: we take ${M.f(M.B)} away from it.`;
    if (st.type === 'col') {
      if (M.add && st.cout) return `The amount does not change: ten ${pl(e)} make 1 ${sg(e + 1)}. We write the exchanged 1 under the answer line; some schools write it above the top number. Use your school’s way.`;
      if (st.first) return `Always start with the smallest place, the ${pl(e)}. Say the place each time: “${M.add ? `${nOf(st.da, e)} add ${nOf(st.db, e)}` : `${nOf(st.t, e)} take away ${nOf(st.db, e)}`}”.`;
      if (!M.add && st.lead) return 'Ask: why do we not write a 0 at the front of the answer?';
      if (M.add && st.cin && !M.exp) return `Remember the 1 exchanged: it is a whole ${sg(e)}, moved over from the place to the right.`;
      return `Say the value as well as the digit: ${M.add ? (M.exp ? st.da + st.db : st.s) : st.d} here means ${fmtNum((M.add ? (M.exp ? st.da + st.db : st.s) : st.d) * 10 ** st.i / M.S)}.`;
    }
    if (st.type === 'ex') return `Exchanging does not change the number: ${M.f(M.A)} is now ${st.regroup.slice(0, -1).join(', ')} and ${st.regroup[st.regroup.length - 1]}.`;
    return 'Each row is one place, so adding the rows puts every exchange in.';
  });
  const est = estimate(M);
  let summary = est ? `Estimate: about ${est}, so ${M.f(M.R)} is sensible.` : `Ask: is ${M.f(M.R)} ${M.add ? 'more' : 'less'} than ${M.f(M.A)}, as it should be?`;
  if (P.check) summary += ` Check with the inverse: ${M.f(M.R)} ${M.add ? NEG : '+'} ${M.f(M.B)} = ${M.f(M.A)}, the number we started with.`;
  summary += ' Ask a pupil to explain one exchange in their own words, using the place names.';
  return { steps, summary };
}

/* ------------------------------------------------------------------ render */
// Fit wording into a width: wrap at the given size, then the next size down, to the token minimum.
function fitWords(p, s, maxW, opts, a) {
  for (const [cls, lh, n] of opts) {
    const L = wrap(p, s, cls, maxW, a);
    const w = Math.max(0, ...L.map(l => measure(p, l, cls, a)));
    if (L.length <= n && w <= maxW + .5) return { cls, lh, L, w, maxW };
  }
  return null;
}
// column headers: one size for the whole row. Each option (size, lines) is tried for every header:
// a column widens to its longest word, or to HEAD_MAXW where the wording wraps. The method is scaled
// to fill its region, so an option is kept only if its text still reads at the token minimum after
// scaling; otherwise the option that reads largest wins. Widths are in method units.
const HEAD_OPTS = [['ts-label', 32, 2], ['ts-label', 32, 3], ['ts-cap', 29, 2], ['ts-cap', 29, 3], ['ts-small', 27, 2], ['ts-small', 27, 3], ['ts-tiny', 25, 2], ['ts-tiny', 25, 3], ['ts-tiny', 25, 4]];
const HEAD_FS = { 'ts-label': 30, 'ts-cap': 26, 'ts-small': 24, 'ts-tiny': 22 };
const HEAD_A = { 'font-weight': 'var(--w-strong)' }, HEAD_CAPS = [200, 280, 360, 440], FS_MIN = 22;
function headFit(p, s, minW, [cls, lh, n], cap) {
  const words = String(s).split(/\s+/).filter(Boolean);
  const ww = Math.max(minW, ...words.map(w => measure(p, w, cls, HEAD_A)));
  return (ww <= cap && fitWords(p, s, ww, [[cls, lh, n]], HEAD_A)) || fitWords(p, s, Math.max(minW, cap), [[cls, lh, n]], HEAD_A);
}
const headH = HF => 44 + Math.max(0, ...HF.map(f => (f.L.length - 1) * f.lh));
const focusRect = (p, x, y, w, hh, a) => h('rect', Object.assign({ x, y, width: w, height: hh, rx: 'var(--r-mark)', fill: 'none', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)' }, a), p);
const hair = (p, x1, y1, x2, y2, a = {}) => h('line', Object.assign({ x1, y1, x2, y2, stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }, a), p);
// the crossing-out of an exchanged digit: thin and light, so the digit underneath still reads
const slash = (p, x1, y1, x2, y2, s) => h('line', { x1, y1, x2, y2, stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round', s, cls: 'draw', pathLength: 1 }, p);
// the exchange as motion: a curved arrow from what is given to where it lands, for its build only
function arc(ctx, p, x1, y1, x2, y2, cy, k, delay = 0) {
  const cx = (x1 + x2) / 2, s = ctx.tk.head * .9, ang = Math.atan2(y2 - cy, x2 - cx);
  const ex = x2 - Math.cos(ang) * s * .72, ey = y2 - Math.sin(ang) * s * .72;
  return arrow(ctx, p, `M${x1} ${y1} Q${cx} ${cy} ${ex} ${ey}`, ex, ey, ang, 'var(--focus)', 'var(--sw-struct)', { draw: k, delay, k: .9, g: { hide: k + 1 } });
}
// place value counters: flat discs in the column colour, ten to a row with a gap after five
// (ten-frame style, so a number never wraps), the top number on row 1 and the bottom number on row 2
const CP = 30, CR = 13, CGAP = 14, CTOP = 30, C5 = 12, CROW = 10;
// rows the chart needs: the top number (and an exchanged ten) in rows 1–2, the bottom number below
function chartRows(M) {
  const n = M.ncol, d = (v, l, i) => i < l ? M.dig(v, i) : 0;
  if (!M.add) {
    const recv = Array(n).fill(0); for (const s of M.steps) if (s.type === 'ex') recv[s.to] += 10;
    return { aRows: Math.max(1, ...Array.from({ length: n }, (_, i) => Math.ceil((d(M.A, M.lA, i) + recv[i]) / CROW))), bRows: 0 };
  }
  // addition: a column never holds more than 10 on the top row (9 and an exchanged one) or 9 below
  return { aRows: 1, bRows: M.steps.some(s => s.type === 'col' && (s.db || s.cout)) ? 1 : 0 };
  return { aRows, bRows };
}

export function render(root, P, ctx) {
  const M = model(P); const b = ctx.b, N = ctx.N;
  const bi = k => b[k] ?? 0; const k0 = bi('setout'), kC = bi('counters');
  const regionX0 = GRID.left, regionX1 = GRID.right;
  const RY0 = GRID.top, RY1 = GRID.bottom - 16;
  // the written method is laid out at its natural size, then scaled to fill its region
  const stage = h('g', {}, root);
  const marks = h('g', {}, stage);          // focus outlines
  const chart = h('g', {}, stage);          // counters
  const main = h('g', {}, stage);
  const flows = h('g', {}, stage);          // exchange arrows, on top
  const colX = {};
  let methodBox = null, ansLine = null, answerBox = null;
  // the column being worked keeps full strength; the others step back to soft for that build
  const work = M.steps.filter(s => s.type === 'col' || s.type === 'ex');
  const inv = st => st.type === 'ex' ? [st.from, st.to] : [st.i];
  const softFor = i => work.filter(st => !inv(st).includes(i)).map(st => `${bi(st.key)}-${bi(st.key) + 1}:soft`);
  const colG = Array.from({ length: M.ncol }, (_, i) => { const c = softFor(i).join(','); return h('g', c ? { c } : {}, main); });
  const cntG = Array.from({ length: M.ncol }, (_, i) => { const c = softFor(i).join(','); return h('g', c ? { c } : {}, chart); });
  // column headers: fitted first (headFit), so a column is as wide as its header needs
  const hText = i => txt(P, `label:head:${M.E(i)}`, PLACE[M.E(i)][2]);
  let HF = [];
  const fitHeads = (n, minW, geom) => {
    const aw = regionX1 - regionX0, ah = RY1 - RY0; let best = null;
    out: for (const o of HEAD_OPTS) for (const cap of HEAD_CAPS) {
      const fs = Array.from({ length: n }, (_, i) => headFit(root, hText(i), minW(i), o, cap));
      if (fs.some(f => !f)) continue;
      const g = geom(fs), eff = HEAD_FS[o[0]] * Math.min(aw / g.w, ah / g.h, 1.8);
      if (eff >= FS_MIN - .01) { best = fs; break out; }
      if (!best || eff > best.eff) { best = fs; best.eff = eff; }
    }
    HF = best; return headH(HF);
  };
  const head = (x, y, i) => {
    const e = M.E(i); const c = pvColour(e), f = HF[i];
    textBlock(main, x, y, hText(i), { cls: f.cls, maxW: f.maxW, maxLines: f.L.length, lh: f.lh, anchor: 'middle', edit: `text.label:head:${e}`, a: Object.assign({ fill: c.text, s: k0 }, HEAD_A) });
  };
  const num = (p, x, y, s, cls, path, a = {}) => computed(T(p, x, y, s, cls, Object.assign({ 'text-anchor': 'middle', 'dominant-baseline': 'central' }, a)), path);

  if (!(M.exp && !M.add)) {
    /* ---------------- digit grid: compact (both) and expanded addition */
    const CT = M.counters;
    const big = !M.exp, huge = big, cls = huge ? 'ts-eq' : 'ts-big';
    const sub = !M.add;
    const nPar = M.exp ? M.steps.filter(s => s.type === 'col').length : 0;   // partial-sum rows
    const CW0 = CT ? CROW * CP + C5 + 22 : huge ? (sub ? 140 : 120) : big ? (sub ? 96 : 68) : 64, RH = huge ? 84 : big ? 74 : nPar > 3 ? 60 : 66, RP = nPar > 3 ? 50 : 60, signW = 56, DPW = M.dp ? 20 : 0;
    const cols = M.steps.filter(s => s.type === 'col');
    const carries = !M.exp && M.add && cols.some(s => s.cout);
    const exRow = !M.add && M.steps.some(s => s.type === 'ex');
    const nP = M.exp ? cols.length : 0;
    const exH = exRow ? 64 : 0, carryH = carries ? 64 : 0;
    const { aRows, bRows } = CT ? chartRows(M) : { aRows: 0, bRows: 0 };
    const chartH = (aRows + bRows) * CP + (bRows ? CGAP : 0), bandH = CT ? CTOP + chartH + 24 : 0;
    const bodyH = bandH + exH + 2 * RH + (nP ? nP * RP + 10 : 0) + RH + 8 + carryH;
    const colsW = fs => fs.map(f => Math.max(CW0, f.w + 28));
    const hH = fitHeads(M.ncol, () => CW0 - 8, fs => ({ w: signW + DPW + colsW(fs).reduce((s, v) => s + v, 0), h: headH(fs) + bodyH }));
    const CW = colsW(HF);
    const cwSum = (from, to) => CW.slice(from, to).reduce((s, v) => s + v, 0);
    const height = hH + bodyH;
    const gridW = signW + cwSum(0, M.ncol) + DPW;
    const gx0 = Math.round((regionX0 + regionX1) / 2 - gridW / 2);
    const y0 = RY0;
    const x = i => gx0 + signW + cwSum(i + 1, M.ncol) + CW[i] / 2 + (i < M.dp ? DPW : 0);
    const colL = i => gx0 + signW + cwSum(i + 1, M.ncol) + (i < M.dp ? DPW : 0);
    const gridR = gx0 + gridW;
    const dw = measure(root, '0', cls) / 2, dwN = measure(root, '0', 'ts-num') / 2, pw = measure(root, '1', 'ts-label');
    const bandY = y0 + hH + CTOP;
    const aY = y0 + hH + bandH + exH + RH / 2, bY = aY + RH, line1 = bY + RH / 2 + 2;
    const pY = r => line1 + 6 + RP * (r + .5);
    const line2Top = M.exp ? line1 + nP * RP + 10 : null;
    const ansY = M.exp ? line2Top + RH / 2 + 2 : line1 + RH / 2 + 4;
    const line2 = ansY + RH / 2 + 2, carryY = line2 + 30;
    methodBox = { x: gx0, y: y0, w: gridW, h: height };
    // plain headings, a hairline under them; with counters, hairline dividers make the chart
    for (let i = 0; i < M.ncol; i++) { head(x(i), y0 + 30, i); colX[i] = { x: colL(i) + 3, w: CW[i] - 6 }; }
    const ruleY = y0 + hH - 6;
    hair(main, gx0 + signW, ruleY, gridR, ruleY, { s: k0 });
    if (CT) for (let i = 1; i < M.ncol; i++) { const xx = (colL(i) + CW[i] + colL(i - 1)) / 2; hair(main, xx, y0 + 4, xx, bandY + chartH + 10, { s: k0 }); }
    const sh = (i, s, ph) => h('g', { s }, colG[i]);
    const digits = (n, l, y, path, ph) => { for (let i = 0; i < l; i++) num(sh(i, k0), x(i), y, String(M.dig(n, i)), cls, path, { fill: i < ph ? 'var(--ink-2)' : null }); };
    digits(M.A, M.lA, aY, 'a', M.dp - M.dpa);
    digits(M.B, M.lB, bY, 'b', M.dp - M.dpb);
    const g = h('g', { s: k0 }, main);
    computed(T(g, gx0 + signW / 2, bY, M.sign, cls, { 'text-anchor': 'middle', 'dominant-baseline': 'central' }), 'op');
    if (M.dp) { const dx = gx0 + signW + cwSum(M.dp, M.ncol) + DPW / 2; for (const y of [aY, bY, ansY]) computed(T(g, dx, y, '.', cls, { 'text-anchor': 'middle', 'dominant-baseline': 'central' }), 'a'); }
    const rule = (y, a) => h('line', Object.assign({ x1: gx0 + 8, x2: gridR, y1: y, y2: y, stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, a), main);
    rule(line1, { s: k0 });
    rule(line2, { s: M.exp ? bi('answer') : k0 });
    if (M.exp) rule(line2Top, { s: k0 });
    ansLine = { x1: gx0 + 8, x2: gridR, y: line2 };

    /* counters */
    const disc = (p, i, sl, a = {}) => { const c = pvColour(M.E(i)); return h('circle', Object.assign({ cx: sl.x, cy: sl.y, r: CR, fill: c.fill, stroke: c.text, 'stroke-width': 'var(--sw-hair)' }, a), p); };
    const slot = (i, idx) => { const lo = M.add && idx >= 10, r = lo ? aRows + Math.floor((idx - 10) / CROW) : Math.floor(idx / CROW), c = idx % CROW; return { x: x(i) + (c - (CROW - 1) / 2) * CP + (c < 5 ? -C5 / 2 : C5 / 2), y: bandY + CR + r * CP + (lo ? CGAP : 0) }; };
    const flyDisc = (p, i, sl, from, k, delay, outer = {}) => { const o = h('g', outer, p); const w = h('g', { s: k, cls: 'fly', delay, vars: { '--fx': `${from.x - sl.x}px`, '--fy': `${from.y - sl.y}px` } }, o); disc(w, i, sl); return o; };
    const live = Array.from({ length: M.ncol }, () => []);     // {at: slot, el, pos}
    if (CT) {
      for (let i = 0; i < M.ncol; i++) {
        const da = i < M.lA ? M.dig(M.A, i) : 0, db = M.add && i < M.lB ? M.dig(M.B, i) : 0;
        for (let j = 0; j < da; j++) { const sl = slot(i, j); live[i].push({ at: j, pos: sl, el: disc(cntG[i], i, sl, { s: kC, cls: 'pop', delay: j * 30 }) }); }
        for (let j = 0; j < db; j++) { const sl = slot(i, 10 + j); live[i].push({ at: 10 + j, pos: sl, el: disc(cntG[i], i, sl, { s: kC, cls: 'pop', delay: (da + j) * 30 + 150 }) }); }
      }
    }
    // compact subtraction: where each column's current value is written (the top digit, or the row above)
    const loc = Array.from({ length: M.ncol }, () => ({ row: 'a', prefix: false }));
    const exY = aY - RH / 2 - exH / 2 + 2;
    const preMain = i => ({ x: x(i) - dw - 6, y: aY - RH * .26 }), preEx = i => ({ x: x(i) - dwN - 5, y: exY - 8 });
    let r = 0;
    for (const st of M.steps) {
      const k = bi(st.key);
      if (st.type === 'col') {
        focusRect(marks, colX[st.i].x, y0 + 2, colX[st.i].w, height - 4, { s: k, hide: k + 1 });
        if (M.exp) {
          const v = (st.da + st.db) * 10 ** st.i; const pg = h('g', { s: k, cls: 'rise' }, main);
          const l = Math.max(String(v).length, M.dp + 1); for (let i = 0; i < l; i++) num(pg, x(i), pY(r), String(M.dig(v, i)), cls, 'a');
          if (M.dp) num(pg, gx0 + signW + cwSum(M.dp, M.ncol) + DPW / 2, pY(r), '.', cls, 'a');
          r++;
        } else if (M.add && st.cout) {
          const i = st.i, t = i + 1;
          // the counters gather into a ten and the rest; a ring goes round the ten, and one counter of
          // the next place flies over in its place
          if (CT) {
            const L = live[i].sort((p, q) => p.at - q.at); live[i] = [];
            L.forEach((it, q) => {
              it.el.dataset.h = k; const sl = slot(i, q);
              if (q < 10) { flyDisc(cntG[i], i, sl, it.pos, k, q * 25, { hide: k + 1 }); return; }
              // what is left after the exchange moves up to the top rows on the next build
              flyDisc(cntG[i], i, sl, it.pos, k, q * 25, { hide: k + 1 });
              const up = slot(i, q - 10); live[i].push({ at: q - 10, pos: up, el: flyDisc(cntG[i], i, up, sl, k + 1, (q - 10) * 25) });
            });
            const r0 = slot(i, 0), r9 = slot(i, 9);
            const ringBox = { x: r0.x - CR, y: bandY, w: r9.x - r0.x + 2 * CR, h: 2 * CR };
            groupRing(flows, ringBox, { pad: 6, s: k, a: { hide: k + 1, delay: 500 } });
            const at = live[t].filter(it => it.at < 10).length, dst = slot(t, at);
            live[t].push({ at, pos: dst, el: flyDisc(cntG[t], t, dst, { x: r0.x, y: bandY + CR }, k, 1000) });
            arc(ctx, flows, r0.x, bandY - 6, dst.x + CP / 2, bandY - 6, bandY - 40, k, 800);
          }
          num(colG[i], x(i), ansY, String(st.s % 10), cls, 'a', { s: k, cls: 'pop', delay: CT ? 1200 : 0 });
          num(colG[t], x(t), carryY, '1', 'ts-num', 'a', { s: k, cls: 'rise', fill: 'var(--focus-text)', delay: CT ? 1400 : 500, c: `${N}:soft` });
          if (!CT) arc(ctx, flows, x(i) - dw - 4, ansY + 6, x(t) + dwN + 6, carryY - 4, carryY - 6, k, 200);
        } else if (M.add ? true : !st.lead) {
          num(colG[st.i], x(st.i), ansY, String(M.add ? st.s : st.d), cls, 'a', { s: k, cls: 'pop' });
          // taken away: those counters step back (quiet) so pupils can see what went; the summary clears
          // them, so the counters left show the answer
          if (CT && !M.add) for (let j = 0; j < st.db; j++) { const it = live[st.i].pop(); if (it) { it.el.dataset.c = [it.el.dataset.c, `${k}:quiet`].filter(Boolean).join(','); it.el.dataset.h = N; } }
        } else if (CT && !M.add) for (let j = 0; j < st.db; j++) { const it = live[st.i].pop(); if (it) { it.el.dataset.c = [it.el.dataset.c, `${k}:quiet`].filter(Boolean).join(','); it.el.dataset.h = N; } }
      } else if (st.type === 'ex') {
        const m = st.from, t = st.to;
        focusRect(marks, colX[m].x, y0 + 2, colX[t].x + colX[t].w - colX[m].x, height - 4, { s: k, hide: k + 1 });
        // the giving column: cross out what is there, write the new value in the row above
        const L = loc[m];
        if (L.row === 'a') slash(colG[m], x(m) - dw - (L.prefix ? pw + 8 : 0), aY + RH * .24, x(m) + dw, aY - RH * .24, k);
        else slash(colG[m], x(m) - dwN - (L.prefix ? pw + 6 : 0), exY + 13, x(m) + dwN, exY - 13, k);
        num(colG[m], x(m), exY, String(st.newFrom), 'ts-num', 'a', { s: k, cls: 'rise', fill: 'var(--focus-text)', delay: 400 });
        loc[m] = { row: 'ex', prefix: false };
        // the receiving column: a small 1 in front makes it ten more
        const L2 = loc[t]; const pre = L2.row === 'a' ? preMain(t) : preEx(t);
        computed(T(colG[t], pre.x, pre.y, '1', 'ts-label', { 'text-anchor': 'end', 'dominant-baseline': 'central', fill: 'var(--focus-text)', s: k, cls: 'rise', delay: 700 }), 'a');
        L2.prefix = true;
        if (CT) {
          // one counter leaves the giving column and ten arrive in the next column
          const giver = live[m].sort((p, q) => p.at - q.at).pop(); giver.el.dataset.h = k;
          const n0 = live[t].length;
          for (let j = 0; j < 10; j++) { const sl = slot(t, n0 + j); live[t].push({ at: n0 + j, pos: sl, el: flyDisc(cntG[t], t, sl, giver.pos, k, 200 + j * 40) }); }
          arc(ctx, flows, giver.pos.x, bandY - 6, slot(t, n0 + 4).x, bandY - 6, bandY - 40, k, 0);
        } else arc(ctx, flows, x(m) + dwN + 4, exY - 14, pre.x - pw / 2, pre.y - 18, exY - 46, k, 300);
      }
    }
    // the summary: in each column the bottom row of counters joins the top row, so the counters show the answer
    if (CT && M.add) for (let i = 0; i < M.ncol; i++) {
      const L = live[i].sort((p, q) => p.at - q.at); let top = L.filter(it => it.at < 10).length;
      for (const it of L) if (it.at >= 10) { it.el.dataset.h = N; flyDisc(cntG[i], i, slot(i, top), it.pos, N, top * 30); top++; }
    }
    if (carries) answerBox = { x: gx0 + signW - 4, y: line1 + 6, w: gridR - gx0 - signW + 4, h: line2 - line1 - 12 };
    if (M.exp) { const tg = h('g', { s: bi('answer'), cls: 'rise' }, main); for (let i = 0; i < M.lR; i++) num(tg, x(i), ansY, String(M.dig(M.R, i)), cls, 'a'); }
  } else {
    /* ---------------- expanded subtraction: both numbers partitioned, exchanges rewrite the parts */
    const hist = Array.from({ length: M.lA }, (_, i) => [M.dig(M.A, i) * 10 ** i]);
    for (const st of M.steps) if (st.type === 'ex') { hist[st.from].push(st.fromVal); hist[st.to].push(st.toVal); }
    const cols = M.steps.filter(s => s.type === 'col');
    const ansV = i => { const st = cols.find(c => c.i === i); return st ? st.d * 10 ** i : 0; };
    const levels = Math.max(...hist.map(x => x.length)) - 1;
    const signW = 56, SEP = 40, RH = 62, LH = 46;
    const cw0 = hist.map((hs, i) => Math.max(56, ...[...hs, i < M.lB ? M.dig(M.B, i) * 10 ** i : 0, ansV(i)].map(v => measure(root, M.f(v), 'ts-num'))) + 18);
    const bodyH = levels * LH + 3 * RH + 12;
    const cwOf = fs => cw0.map((w, i) => Math.max(w, fs[i].w + 28));
    const hH = fitHeads(M.lA, i => cw0[i] - 8, fs => ({ w: signW + cwOf(fs).reduce((s, v) => s + v, 0) + (M.lA - 1) * SEP, h: headH(fs) + bodyH }));
    const cw = cwOf(HF);
    const totalW = signW + cw.reduce((s, v) => s + v, 0) + (M.lA - 1) * SEP;
    const height = hH + bodyH;
    const gx0 = Math.round((regionX0 + regionX1) / 2 - totalW / 2);
    const y0 = RY0;
    const cx = []; let xx = gx0 + signW;
    for (let i = M.lA - 1; i >= 0; i--) { cx[i] = xx + cw[i] / 2; xx += cw[i] + (i ? SEP : 0); }
    const gridR = xx;
    const aY = y0 + hH + levels * LH + RH / 2, bY = aY + RH, line1 = bY + RH / 2 + 4, ansY = line1 + RH / 2 + 4;
    methodBox = { x: gx0, y: y0, w: totalW, h: height };
    for (let i = 0; i < M.lA; i++) { head(cx[i], y0 + 30, i); colX[i] = { x: cx[i] - cw[i] / 2 - 2, w: cw[i] + 4 }; }
    hair(main, gx0 + signW, y0 + hH - 6, gridR, y0 + hH - 6, { s: k0 });
    const part = (p, i, y, v, path, a = {}, cls = 'ts-num') => computed(T(p, cx[i], y, M.f(v), cls, Object.assign({ 'text-anchor': 'middle', 'dominant-baseline': 'central' }, a)), path);
    const plus = (p, i, y, a = {}) => T(p, cx[i] + cw[i] / 2 + SEP / 2, y, '+', 'ts-num', Object.assign({ 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: 'var(--ink-2)' }, a));
    const g = h('g', { s: k0 }, main);
    for (let i = 0; i < M.lA; i++) { const cg = h('g', { s: k0 }, colG[i]); part(cg, i, aY, hist[i][0], 'a', i < M.dp - M.dpa ? { fill: 'var(--ink-2)' } : {}); if (i > 0) plus(g, i, aY); }
    for (let i = 0; i < M.lB; i++) { const cg = h('g', { s: k0 }, colG[i]); part(cg, i, bY, M.dig(M.B, i) * 10 ** i, 'b'); if (i > 0) plus(g, i, bY); }
    computed(T(g, gx0 + signW / 2, bY, NEG, 'ts-num', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }), 'op');
    h('line', { x1: gx0 + 8, x2: gridR, y1: line1, y2: line1, stroke: 'var(--ink)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g);
    const lvl = Array(M.lA).fill(0);
    const rewrite = (i, v, k, delay) => {
      const y = lvl[i] ? aY - RH / 2 - (lvl[i] - .5) * LH : aY; const w = measure(root, M.f(hist[i][lvl[i]]), lvl[i] ? 'ts-label' : 'ts-num') / 2 + 4; const dy = lvl[i] ? 11 : 16;
      slash(colG[i], cx[i] - w, y + dy, cx[i] + w, y - dy, k);
      lvl[i]++; part(colG[i], i, aY - RH / 2 - (lvl[i] - .5) * LH, v, 'a', { s: k, cls: 'rise', delay, fill: 'var(--focus-text)' }, 'ts-label');
    };
    for (const st of M.steps) {
      const k = bi(st.key);
      if (st.type === 'ex') {
        focusRect(marks, colX[st.from].x, y0 + 2, colX[st.to].x + colX[st.to].w - colX[st.from].x, height - 4, { s: k, hide: k + 1 });
        rewrite(st.from, st.fromVal, k, 300); rewrite(st.to, st.toVal, k, 700);
      } else if (st.type === 'col') {
        focusRect(marks, colX[st.i].x, y0 + 2, colX[st.i].w, height - 4, { s: k, hide: k + 1 });
        // a zero at the front of the answer is not written (the caption says so)
        if (!st.lead) { const pg = h('g', { s: k, cls: 'pop' }, colG[st.i]); part(pg, st.i, ansY, st.d * 10 ** st.i, 'a');
          if (st.i + 1 < M.lR) plus(pg, st.i + 1, ansY); }
      }
    }
    ansLine = { x1: gx0 + signW - 6, x2: gridR, y: ansY + RH / 2 };
  }
  // the summary's point is the answer: underlined in the focus colour
  // (with exchanged 1s written under the answer line, a ring round the answer row instead, the 1s stepping back)
  if (answerBox) groupRing(marks, answerBox, { pad: 0, s: N });
  else h('line', { x1: ansLine.x1, x2: ansLine.x2, y1: ansLine.y, y2: ansLine.y, stroke: 'var(--focus)', 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round', s: N, cls: 'wipe' }, marks.parentNode);
  // scale the written method up to fill its region: the digits are the hero
  {
    const B = methodBox, aw = regionX1 - regionX0, ah = RY1 - RY0;
    const sc = Math.min(aw / B.w, ah / B.h, 1.8);
    if (HEAD_FS[HF[0].cls] * sc < FS_MIN - .01) ctx.warn(`column method is ${Math.round(B.w)} by ${Math.round(B.h)}, too big for its ${Math.round(aw)} by ${ah} region`);
    const tx = (regionX0 + regionX1) / 2 - sc * (B.x + B.w / 2), ty = (RY0 + RY1) / 2 - sc * (B.y + B.h / 2);
    stage.setAttribute('transform', `translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${sc.toFixed(3)})`);
  }
  return {};
}
