// Fractions, decimals and percentages: one model for Y1–Y6. A fraction is shown as equal parts
// of one whole (circle, rectangle, bar, fraction wall or number line), a set shared into equal
// groups, or a hundred square. Operations: show, compare, equivalent (checked by cross-
// multiplying), add with the same denominator, fraction of an amount, and convert to a decimal
// and a per cent (recurring decimals carry dots). Built only on the kit.
import {
  h, T, measure, clamp, GRID, textBlock, bracket, counter,
  editable, computed, txt, TEXT_PARAM, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { fracText } from '../kit/batch-B.js';

export const meta = {
  id: 'fractions', name: 'Fractions, decimals and percentages', kind: 'info', version: 1,
  subjects: ['Maths'],
  years: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'],
  teaches: 'A fraction is equal parts of one whole: naming, comparing, equivalent fractions, adding, fractions of an amount, and the same amount as a decimal and a per cent.',
};

const OPS = ['show', 'compare', 'equivalent', 'add', 'of', 'convert'];
const OP_LABELS = ['Show a fraction', 'Compare fractions', 'Equivalent fractions', 'Add fractions (same denominator)', 'Fraction of an amount', 'Fraction to decimal and per cent'];
const REPS = ['circle', 'rectangle', 'bar', 'wall', 'line', 'set', 'hundred'];
const REP_LABELS = ['Circle (like a pizza)', 'Rectangle (like a chocolate bar)', 'Bar', 'Fraction wall', 'Number line', 'Set of objects', 'Hundred square'];
const REP_NAMES = { circle: 'a circle', rectangle: 'a rectangle', bar: 'a bar', wall: 'a fraction wall', line: 'a number line', set: 'a set of objects', hundred: 'a hundred square' };
const FITS = { show: ['circle', 'rectangle', 'bar', 'wall', 'line'], compare: ['bar', 'wall', 'line', 'circle', 'rectangle'], equivalent: ['bar', 'wall', 'circle', 'rectangle', 'line'], add: ['bar', 'circle', 'rectangle', 'line'], of: ['set', 'bar'], convert: ['hundred', 'line'] };
const COUNT = { show: [1, 1], compare: [2, 3], equivalent: [2, 2], add: [2, 2], of: [1, 1], convert: [1, 1] };
const MAXD = { circle: 12, rectangle: 12, bar: 12, wall: 12, line: 20, set: 10, hundred: 100 };
const opName = op => OP_LABELS[OPS.indexOf(op)];
const repLabel = r => REP_LABELS[REPS.indexOf(r)];

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Fractions',
  properties: {
    title: TITLE_PARAM('Fractions'),
    operation: { type: 'string', title: 'What the slide does', enum: OPS, 'x-labels': OP_LABELS, default: 'show' },
    representation: { type: 'string', title: 'Show it as', enum: REPS, 'x-labels': REP_LABELS, default: 'circle',
      description: 'Circles, rectangles, bars and number lines can show more than one whole. A set of objects is for a fraction of an amount; the hundred square is for decimals and per cents.' },
    fractions: {
      type: 'array', title: 'Fractions', 'x-item': 'a fraction', minItems: 1, maxItems: 3, default: [{ value: '1/2' }],
      description: 'One fraction to show, convert or take of an amount; two to add or to show as equivalent; two or three to compare.',
      items: { type: 'object', required: ['value'], default: { value: '1/4' }, properties: {
        value: { type: 'string', title: 'Fraction', description: 'Like “3/4”, or “1 1/2” for a mixed number.', minLength: 1, maxLength: 9 },
      } },
    },
    whole: { type: 'string', title: 'Name of the whole', description: 'Shown on the whole before it is split, like “One pizza”.', default: '1 whole', maxLength: 60 },
    amount: { type: 'integer', title: 'Amount', description: 'For “Fraction of an amount”: how many in the whole set.', minimum: 1, maximum: 40, default: 12 },
    things: { type: 'string', title: 'The objects are', description: 'For “Fraction of an amount”, like “counters” or “sweets”.', default: 'counters', maxLength: 24 },
    words: { type: 'boolean', title: 'Name fractions in words', description: 'Like “three quarters”.', default: true, 'x-panel': 'advanced' },
    convertTo: { type: 'string', title: 'Convert to', enum: ['both', 'decimal', 'percent'], 'x-labels': ['Decimal and per cent', 'Decimal only', 'Per cent only'], default: 'both', 'x-panel': 'advanced' },
    text: TEXT_PARAM,
  },
};

export const presets = [
  { id: 'y1-half-pizza', name: 'Year 1: half of a pizza', params: {
    title: 'Half of a pizza', operation: 'show', representation: 'circle', fractions: [{ value: '1/2' }], whole: 'One pizza',
  } },
  { id: 'y3-quarter-of-12', name: 'Year 3: a quarter of 12', params: {
    title: 'A quarter of 12', operation: 'of', representation: 'set', fractions: [{ value: '1/4' }], amount: 12, things: 'counters',
  } },
  { id: 'y4-equivalent-wall', name: 'Year 4: 2/3 = 4/6 on a fraction wall', params: {
    title: 'Equivalent fractions', operation: 'equivalent', representation: 'wall', fractions: [{ value: '2/3' }, { value: '4/6' }],
  } },
  { id: 'y5-convert', name: 'Year 5: 3/4 = 0.75 = 75%', params: {
    title: 'Fractions, decimals and per cents', operation: 'convert', representation: 'hundred', fractions: [{ value: '3/4' }],
  } },
];

/* ------------------------------------------------------------------ number helpers */
// shaded cells that carry words: a firmer tint than --part-pale, so Night shows them lighter than empty cells
const PALE = 'color-mix(in oklab,var(--part) 32%,var(--paper))';
const gcd = (a, b) => b ? gcd(b, a % b) : a;
export function parseFrac(s) {
  const t = String(s ?? '').trim().replace(/\s+/g, ' ');
  let m = t.match(/^(\d+) (\d+) ?\/ ?(\d+)$/);
  if (m) {
    const w = +m[1], n = +m[2], d = +m[3];
    if (!d) return { error: `“${t}” has 0 as its bottom number (denominator). A whole can’t be split into 0 equal parts.` };
    if (n >= d) return { error: `“${t}” is not a mixed number: the fraction part should be less than 1, like ${w} 1/${Math.max(2, d)}.` };
    return { n: w * d + n, d, mixed: true, raw: t };
  }
  m = t.match(/^(\d+) ?\/ ?(\d+)$/);
  if (m) { const n = +m[1], d = +m[2]; if (!d) return { error: `“${t}” has 0 as its bottom number (denominator). A whole can’t be split into 0 equal parts.` }; return { n, d, raw: t }; }
  return { error: `“${t}” isn’t a fraction we can read. Write it like 3/4, or 1 1/2 for a mixed number.` };
}
const fs = f => `${f.n}/${f.d}`;
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const card = n => n < 20 ? ONES[n] : n < 100 ? TENS[(n / 10) | 0] + (n % 10 ? '-' + ONES[n % 10] : '') : n === 100 ? 'one hundred' : String(n);
const ORD = ['', 'whole', 'half', 'third', 'quarter', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth'];
const ORD_UNIT = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'];
const TORD = ['', '', 'twentieth', 'thirtieth', 'fortieth', 'fiftieth', 'sixtieth', 'seventieth', 'eightieth', 'ninetieth'];
const ord = d => d < 20 ? ORD[d] : d === 100 ? 'hundredth' : d % 10 === 0 ? TORD[d / 10] : `${TENS[(d / 10) | 0]}-${ORD_UNIT[d % 10]}`;
const ords = d => ord(d) === 'half' ? 'halves' : ord(d) + 's';
export function fracWords(n, d) {
  if (d === 1) return n === 1 ? 'one whole' : `${card(n)} wholes`;
  return n === 1 ? `one ${ord(d)}` : `${card(n)} ${ords(d)}`;
}
/** Long division: integer part, non-repeating digits and repeating digits. */
export function decParts(n, d) {
  const int = Math.floor(n / d); let r = n % d; const dig = [], seen = new Map();
  while (r && !seen.has(r) && dig.length < 40) { seen.set(r, dig.length); r *= 10; dig.push(Math.floor(r / d)); r %= d; }
  if (!r) return { int, pre: dig.join(''), rep: '' };
  const i = seen.get(r); return { int, pre: dig.slice(0, i).join(''), rep: dig.slice(i).join('') };
}
/** Plain-text decimal for captions: 0.75, or 0.333… for a recurring decimal. */
const decStr = q => !q.pre && !q.rep ? String(q.int) : q.rep ? `${q.int}.${(q.pre + q.rep.repeat(6)).slice(0, Math.max(q.pre.length + q.rep.length, 3))}…` : `${q.int}.${q.pre}`;
const placeWords = q => {
  if (q.rep || !q.pre) return null;
  const L = q.pre.length, v = +q.pre;
  if (L === 1) return `${v} tenth${v === 1 ? '' : 's'}`;
  if (L === 2) { const t = +q.pre[0], u = +q.pre[1]; return [t ? `${t} tenth${t === 1 ? '' : 's'}` : '', u ? `${u} hundredth${u === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and '); }
  if (L === 3) return `${v} thousandths`;
  return null;
};

/* ------------------------------------------------------------------ model of the data */
function model(P) {
  const F = P.fractions.map(f => parseFrac(f.value));
  const op = P.operation, rep = P.representation;
  const v = f => f.n / f.d;
  const M = { F, op, rep, v };
  if (op === 'compare') {
    const idx = F.map((f, i) => i);
    M.order = [...idx].sort((a, b) => F[a].n * F[b].d - F[b].n * F[a].d || a - b);
    M.cmp = F.length === 2 ? Math.sign(F[0].n * F[1].d - F[1].n * F[0].d) : null;
    M.nW = Math.max(1, Math.ceil(Math.max(...F.map(v)) - 1e-9));
  } else if (op === 'add') {
    M.sum = { n: F[0].n + F[1].n, d: F[0].d }; M.nW = Math.max(1, Math.ceil(v(M.sum) - 1e-9));
  } else if (op === 'of') {
    M.share = P.amount / F[0].d; M.ans = M.share * F[0].n;
  } else if (op === 'convert') {
    M.dec = decParts(F[0].n, F[0].d); M.pct = decParts(100 * F[0].n, F[0].d); M.k = 100 * F[0].n / F[0].d;
    M.showDec = P.convertTo !== 'percent'; M.showPct = P.convertTo !== 'decimal';
  }
  if (M.nW == null) M.nW = Math.max(1, Math.ceil(Math.max(...F.map(v)) - 1e-9));
  return M;
}

/* ------------------------------------------------------------------ what the slide actually uses */
// Changing what the slide does never strands the panel: a picture that can't show the operation is
// swapped for one that can, extra fractions are left off, and a missing second fraction is supplied
// (a warning says so each time). The truth rules then run on what the slide will show.
function partner(op, rep, a) {
  if (op === 'add') return { n: 1, d: a.d };
  if (op === 'equivalent') {
    for (const k of [2, 3, 4]) if (a.d * k <= MAXD[rep]) return { n: a.n * k, d: a.d * k };
    const g = gcd(a.n, a.d); return g > 1 ? { n: a.n / g, d: a.d / g } : null;
  }
  if (op === 'compare') return a.d + 1 <= MAXD[rep] ? { n: a.n, d: a.d + 1 } : a.d - 1 >= 2 && a.n <= a.d - 1 ? { n: a.n, d: a.d - 1 } : null;
  return null;
}
function eff(P) {
  const op = P.operation, W = [], list = Array.isArray(P.fractions) ? P.fractions : [];
  let rep = P.representation, L = list.slice();
  if (FITS[op] && !FITS[op].includes(rep)) {
    const to = FITS[op][0];
    W.push({ path: 'representation', reason: `${repLabel(rep)} can’t show “${opName(op)}”, so the slide uses ${REP_NAMES[to]}. You can choose ${FITS[op].map(r => repLabel(r).toLowerCase()).join(' or ')}.` });
    rep = to;
  }
  const [lo, hi] = COUNT[op] || [1, 3];
  if (L.length > hi) { W.push({ path: 'fractions', reason: `“${opName(op)}” uses ${card(hi)} fraction${hi > 1 ? 's' : ''}, so only the first ${hi > 1 ? card(hi) : 'one'} ${hi > 1 ? 'are' : 'is'} shown.` }); L = L.slice(0, hi); }
  const nReal = L.length;
  if (L.length && L.length < lo) {
    const a = parseFrac(L[0].value), b = !a.error && a.d > 1 ? partner(op, rep, a) : null;
    if (b) { L.push({ value: fs(b) }); W.push({ path: 'fractions', reason: `“${opName(op)}” uses two fractions, so the slide adds ${fs(b)}. Add a second fraction to choose your own.` }); }
  }
  return { P: Object.assign({}, P, { representation: rep, fractions: L }), W, nReal };
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P0 = withDefaults(params, raw);
  const R = schemaCheck(params, P0);
  if (R.length) return result(R);
  const F0 = P0.fractions.map((f, i) => { const v = parseFrac(f.value); if (v.error) R.push({ path: `fractions.${i}.value`, reason: v.error }); return v; });
  F0.forEach((f, i) => { if (f.d === 1) R.push({ path: `fractions.${i}.value`, reason: 'A fraction needs at least 2 equal parts. Use a denominator of 2 or more.' }); });
  if (R.length) return result(R);
  const E = eff(P0), P = E.P, Wn = E.W;
  const op = P.operation, rep = P.representation, L = P.fractions;
  const F = L.map(f => parseFrac(f.value));
  const [lo, hi] = COUNT[op];
  if (L.length < lo || L.length > hi) R.push({ path: 'fractions', reason: lo === hi ? `“${opName(op)}” uses ${card(lo)} fraction${lo > 1 ? 's' : ''}, but there ${L.length === 1 ? 'is' : 'are'} ${card(L.length)}. Add or remove one.` : `“${opName(op)}” needs two or three fractions.` });
  if (R.length) return result(R, Wn);
  const fin = () => result(R.map(r => { const m = /^fractions\.(\d+)\.value$/.exec(r.path); return m && +m[1] >= E.nReal ? { path: 'fractions', reason: r.reason } : r; }), Wn);
  const maxW = (op === 'compare' && (rep === 'circle' || rep === 'rectangle')) || ['wall', 'set', 'hundred'].includes(rep) || op === 'of' || op === 'convert' ? 1 : 3;
  F.forEach((f, i) => {
    const path = `fractions.${i}.value`;
    if (f.d > MAXD[rep]) R.push({ path, reason: rep === 'set' ? `Sharing into ${f.d} groups won’t fit on one slide. Use a denominator of 10 or less.` : rep === 'hundred' ? 'A hundred square shows hundredths at most. Use a denominator of 100 or less.' : `${REP_NAMES[rep][0].toUpperCase()}${REP_NAMES[rep].slice(1)} split into ${f.d} parts is too fine to see from the back of the room. Use a denominator of ${MAXD[rep]} or less${op === 'convert' ? ', or the hundred square' : ''}.` });
    else if (f.n > f.d * maxW) R.push({ path, reason: maxW === 1
      ? `${fs(f)} is more than one whole, and ${op === 'of' ? 'a fraction of an amount here takes part of the set' : op === 'convert' ? 'this conversion uses one whole' : REP_NAMES[rep] + ' here shows one whole'}. ${op === 'of' || op === 'convert' ? 'Use a fraction of 1 or less.' : 'Choose a bar, circle or number line, which can show more than one whole.'}`
      : `${fs(f)} needs more than 3 wholes, which won’t fit on one slide. Use a fraction of 3 or less.` });
  });
  if (R.length) return fin();
  if (op === 'equivalent') {
    const [a, b] = F, x = a.n * b.d, y = b.n * a.d;
    if (x !== y) {
      const sug = a.d * 2 <= MAXD[rep] ? `${a.n * 2}/${a.d * 2}` : (gcd(a.n, a.d) > 1 ? `${a.n / gcd(a.n, a.d)}/${a.d / gcd(a.n, a.d)}` : null);
      R.push({ path: 'fractions.1.value', reason: `${fs(a)} and ${fs(b)} are not equivalent: ${a.n} × ${b.d} = ${x}, but ${b.n} × ${a.d} = ${y}.${sug ? ` Try ${sug}.` : ''}` });
    }
  }
  if (op === 'add') {
    const [a, b] = F;
    if (a.d !== b.d) R.push({ path: 'fractions.1.value', reason: `Both fractions need the same denominator to add them this way, but ${fs(a)} is in ${ords(a.d)} and ${fs(b)} is in ${ords(b.d)}. Write them as equivalent fractions first, or choose “Equivalent fractions”.` });
    else if (a.n + b.n > a.d * 3) R.push({ path: 'fractions.1.value', reason: `${fs(a)} + ${fs(b)} is more than 3 wholes, which won’t fit on one slide.` });
  }
  if (op === 'of') {
    const f = F[0];
    if (f.d > P.amount || P.amount % f.d) {
      const near = [Math.floor(P.amount / f.d), Math.ceil(P.amount / f.d)].map(k => k * f.d).filter((v, i, a) => v >= f.d && v <= 40 && a.indexOf(v) === i);
      R.push({ path: 'amount', reason: `${P.amount} ${P.things} can’t be shared into ${f.d} equal groups without cutting them up. Choose an amount that ${f.d} goes into exactly${near.length ? `, like ${near.join(' or ')}` : ''}.` });
    }
  }
  return fin();
}

/* ------------------------------------------------------------------ builds */
function plan(P) {
  P = eff(P).P;
  const M = model(P); const { F, op, rep } = M; const f = F[0], items = [];
  const add = (key, caption) => items.push({ key, caption });
  const wholeW = String(P.whole || '1 whole').trim();
  const startCap = `Start with the whole: ${wholeW.charAt(0).toLowerCase()}${wholeW.slice(1)}.`;
  let summary = '';
  const wholesCap = M.nW > 1 ? `${card(M.nW)[0].toUpperCase()}${card(M.nW).slice(1)} wholes, all the same size.` : startCap;
  const mixedS = g => `${Math.floor(g.n / g.d)}${g.n % g.d ? ` ${g.n % g.d}/${g.d}` : ''}`;
  if (op === 'show') {
    add('whole', wholesCap);
    add('split', `Split ${M.nW > 1 ? 'each whole' : 'it'} into ${f.d} equal parts. Equal parts are the same size.`);
    add('shade', rep === 'line' ? `Count ${f.n} ${f.n === 1 ? ord(f.d) : ords(f.d)} from 0.` : `Shade ${f.n} of the equal parts.`);
    add('name', `${f.n} out of ${f.d} equal parts is ${fs(f)}${P.words ? `, ${fracWords(f.n, f.d)}` : ''}.`);
    summary = rep === 'line' ? (f.n > f.d ? `${fs(f)} = ${mixedS(f)}.` : `${fs(f)}: ${f.n} ${f.n === 1 ? ord(f.d) : ords(f.d)} from 0.`) : f.n > f.d ? `${fs(f)}: ${f.n} ${ords(f.d)} are shaded. That is ${mixedS(f)} wholes.` : `${fs(f)}: ${f.n} of ${f.d} equal parts ${f.n === 1 ? 'is' : 'are'} shaded.`;
  } else if (op === 'compare') {
    add('whole', `Each fraction is of the same whole, so the ${rep === 'circle' ? 'circles' : rep === 'line' ? 'lines' : 'wholes'} are the same size.`);
    F.forEach((g, i) => add(`f:${i}`, `${fs(g)}: split ${g.n > g.d ? 'each whole' : ''}${g.n > g.d ? ' ' : ''}into ${g.d} equal parts and shade ${g.n}.`));
    const c = M.cmp, [a, b] = F;
    const st = F.length === 2 ? `${fs(a)} is ${c > 0 ? 'greater than' : c < 0 ? 'less than' : 'equal to'} ${fs(b)}.` : `Smallest to largest: ${M.order.map(i => fs(F[i])).join(', ')}.`;
    add('compare', `Compare the shaded amounts. ${st}`);
    summary = st;
  } else if (op === 'equivalent') {
    const [a, b] = F;
    add('whole', rep === 'wall' ? 'The top row is one whole. Every row below is the same whole.' : startCap);
    add('split', `Split it into ${a.d} equal parts: ${ords(a.d)}.`);
    add('shade', `Shade ${a.n} of the ${a.d} parts.`);
    add('name', `That is ${fs(a)}.`);
    add('resplit', rep === 'wall' ? `The row of ${ords(b.d)}: ${b.n} of them cover the same length.` : `Split the same whole into ${b.d} equal parts. The shaded amount does not change.`);
    add('name2', `Now ${b.n} of ${b.d} parts are shaded: ${fs(a)} = ${fs(b)}.`);
    summary = `${fs(a)} and ${fs(b)} are equivalent: the same amount of the whole.`;
  } else if (op === 'add') {
    const [a, b] = F, s = M.sum;
    add('whole', wholesCap);
    add('split', `Split ${M.nW > 1 ? 'each whole' : 'it'} into ${a.d} equal parts: ${ords(a.d)}.`);
    add('a', `Shade ${fs(a)}: ${a.n} ${a.n === 1 ? ord(a.d) : ords(a.d)}.`);
    add('b', `Add ${fs(b)}: ${b.n} more of the same parts.`);
    add('sum', `${fs(a)} + ${fs(b)} = ${fs(s)}. Add the numerators; the denominator stays ${a.d}.`);
    summary = `${fs(a)} + ${fs(b)} = ${fs(s)}${s.n > s.d && s.n % s.d ? ` = ${Math.floor(s.n / s.d)} ${s.n % s.d}/${s.d}` : s.n % s.d === 0 && s.n ? ` = ${s.n / s.d}` : ''}.`;
  } else if (op === 'of') {
    add('whole', `The whole is ${P.amount} ${P.things}.`);
    add('share', `Share them into ${f.d} equal groups: ${M.share} in each group.`);
    add('shade', `${fs(f)} means ${f.n} of the ${f.d} groups.`);
    add('answer', `${fs(f)} of ${P.amount} is ${M.ans}: ${P.amount} ÷ ${f.d} = ${M.share}${f.n > 1 ? `, then ${M.share} × ${f.n} = ${M.ans}` : ''}.`);
    summary = `${fs(f)} of ${P.amount} is ${M.ans}.`;
  } else {
    const hund = rep === 'hundred', k = M.k;
    add('whole', hund ? '100 equal squares make one whole. Each square is one hundredth.' : 'The number line from 0 to 1 is one whole.');
    if (hund) {
      add('shade', `Shade ${fs(f)} of the whole: ${Number.isInteger(k) ? k : decStr(decParts(100 * f.n, f.d))} squares.`);
      add('hundredths', Number.isInteger(k) ? `${k} out of 100 squares: ${k}/100, ${k} hundredths.` : `That is ${decStr(M.pct)} out of 100 squares.`);
    } else {
      add('split', `Split it into ${f.d} equal parts: ${ords(f.d)}.`);
      add('mark', `Count ${f.n} ${f.n === 1 ? 'part' : 'parts'} from 0 to find ${fs(f)}.`);
      if (M.showDec) add('tenths', 'The same line in tenths: 0.1, 0.2, 0.3 and so on.');
    }
    if (M.showDec) add('decimal', `As a decimal, ${fs(f)} = ${decStr(M.dec)}${M.dec.rep ? ', a recurring decimal' : ''}.`);
    if (M.showPct) add('percent', `Per cent means out of 100: ${fs(f)} = ${decStr(M.pct)}%.`);
    summary = `${fs(f)}${M.showDec ? ` = ${decStr(M.dec)}` : ''}${M.showPct ? ` = ${decStr(M.pct)}%` : ''}.`;
  }
  return { M, items, summary };
}
export function builds(P) { const { items, summary } = plan(P); return { steps: items.map(({ key, caption }) => ({ key, caption: txt(P, `caption:${key}`, caption) })), summary: { caption: summary } }; }

export function notes(P) {
  P = eff(P).P;
  const { M, items } = plan(P); const { F, op, rep } = M; const f = F[0];
  const N = {
    whole: op === 'of' ? 'Use real objects first if you can: count the whole set together.' : 'Ask: what is the whole? A fraction only makes sense when we know the whole.',
    split: `Ask: are the parts equal? ${rep === 'circle' ? 'Cut through the centre so every part is the same size.' : 'Unequal parts are not ' + ords(f.d) + '.'}`,
    shade: op === 'of' ? `The denominator ${f.d} says how many equal groups; the numerator ${f.n} says how many groups we take.` : `The denominator (${f.d}) is how many equal parts; the numerator (${f.n}) is how many we ${rep === 'line' ? 'count from 0' : 'shaded'}.`,
    name: `Say it together: “${f.n} out of ${f.d} equal parts”${P.words ? `, “${fracWords(f.n, f.d)}”` : ''}.${f.n > f.d ? ` More than ${f.d} ${ords(f.d)} is more than one whole: ${fs(f)} = ${Math.floor(f.n / f.d)}${f.n % f.d ? ` ${f.n % f.d}/${f.d}` : ''}.` : ''}`,
    compare: F.length === 2 && F[0].d === F[1].d ? 'Same denominator: the bigger numerator is the bigger fraction.' : F.every(g => g.n === F[0].n) ? 'Same numerator: the more parts the whole is split into, the smaller each part, so the bigger denominator is the smaller fraction.' : 'Line the wholes up and compare the shaded lengths. Check by writing them with a common denominator.',
    resplit: op === 'equivalent' ? `Nothing was added or taken away. ${F[0].n} × ${F[1].d} = ${F[0].n * F[1].d} and ${F[1].n} × ${F[0].d} = ${F[1].n * F[0].d}: equal cross products mean equivalent fractions.` : '',
    name2: op === 'equivalent' ? (F[1].d % F[0].d === 0 ? `Multiply the numerator and the denominator by the same number: × ${F[1].d / F[0].d}.` : 'Simplify both to the same fraction to check.') : '',
    a: 'The parts are all the same size, so we can count them.',
    b: 'We are adding more parts of the same size, so the size (the denominator) does not change.',
    sum: op === 'add' ? `A common mistake is to add the denominators too: ${F[0].n}/${F[0].d} + ${F[1].n}/${F[1].d} is not ${M.sum.n}/${F[0].d * 2}.${gcd(M.sum.n, M.sum.d) > 1 && M.sum.n ? ` ${M.sum.n}/${M.sum.d} simplifies to ${M.sum.n / gcd(M.sum.n, M.sum.d)}/${M.sum.d / gcd(M.sum.n, M.sum.d)}.` : ''}` : '',
    share: op === 'of' ? `Deal them out one at a time, like sharing at a table. ${P.amount} ÷ ${f.d} = ${M.share}.` : '',
    answer: op === 'of' ? `Divide by the denominator, multiply by the numerator.` : '',
    hundredths: op === 'convert' && !Number.isInteger(M.k) ? `${fs(f)} does not make a whole number of hundredths, so one square is only partly shaded.` : 'Hundredths are the link between fractions, decimals and per cents.',
    mark: 'Fractions are numbers: each has its own place on the line.',
    tenths: 'Ten equal parts of the same whole: tenths. Compare where the fraction sits.',
    decimal: op === 'convert' ? (M.dec.rep ? `${f.n} ÷ ${f.d} never stops: the dots mark the digits that repeat for ever.` : `${f.n} ÷ ${f.d} = ${decStr(M.dec)}.`) : '',
    percent: 'Per cent means “out of 100”, so the hundredths give the per cent.',
  };
  if (op === 'equivalent' && rep === 'wall') N.split = `The ${ords(F[0].d)} row: ${F[0].d} equal parts of the same whole.`;
  const steps = items.map(it => it.key.startsWith('f:') ? `${fs(F[+it.key.slice(2)])}: ${F[+it.key.slice(2)].d} equal parts, ${F[+it.key.slice(2)].n} shaded.` : (N[it.key] || ''));
  const summary = { show: 'Ask: what fraction is not shaded?', compare: 'Ask: how could you prove it without drawing?', equivalent: 'Ask: can you find another fraction equal to these?', add: 'Ask: what would we need to make one whole?', of: `Ask: what is ${F[0].d > 1 ? `${F[0].d - 1}/${F[0].d}` : 'all'} of ${P.amount}?`, convert: 'Ask: which is easiest to compare, the fraction, the decimal or the per cent?' }[op];
  return { steps, summary };
}

/* ------------------------------------------------------------------ drawing helpers */
const fracW = (p, n, d) => Math.max(30, measure(p, String(n), 'ts-frac'), measure(p, String(d), 'ts-frac')) + 6;
const BL = { 'ts-label': 11, 'ts-h3': 12, 'ts-num': 14, 'ts-big': 18, 'ts-small': 9 };

/** A row of pieces centred (or started) at x; y is the fraction line. Pieces:
 *  {f:[n,d], col, cp, edit, a} stacked fraction; {t, cls, col, cp, edit, a} text;
 *  {dec: parts, suffix, cls, col, cp, a} a decimal with recurring dots. */
function row(p, x, y, pieces, { anchor = 'middle', gap = 16, maxW = GRID.right - GRID.left } = {}) {
  const g = h('g', {}, p);
  const W = pieces.map(q => q.f ? fracW(g, q.f[0], q.f[1]) : measure(g, q.dec ? decText(q.dec) + (q.suffix || '') : q.t, q.cls || (q.dec ? 'ts-num' : 'ts-label'), q.strong ? { cls: 'strong' } : undefined));
  // a wording piece marked `wrap` takes what is left of the live width and wraps (then shrinks) inside it
  const wi = pieces.findIndex(q => q.wrap);
  if (wi >= 0) { const rest = W.reduce((s, w, i) => i === wi ? s : s + w, 0) + gap * (pieces.length - 1); W[wi] = Math.min(W[wi], Math.max(120, maxW - rest)); }
  const tot = W.reduce((s, w) => s + w, 0) + gap * (pieces.length - 1);
  let cx = anchor === 'middle' ? x - tot / 2 : anchor === 'end' ? x - tot : x;
  pieces.forEach((q, i) => {
    const pg = h('g', q.a || {}, g), w = W[i];
    if (q.f) fracText(pg, cx + w / 2, y, q.f[0], q.f[1], { col: q.col || 'var(--ink)', computed: q.cp, edit: q.edit });
    else if (q.dec) decimal(pg, cx, y + BL[q.cls || 'ts-num'], q.dec, q.suffix || '', q.cls || 'ts-num', q.col, q.cp);
    else if (q.wrap) { const tb = textBlock(pg, cx, y + BL[q.cls || 'ts-label'], q.t, { cls: q.cls || 'ts-label', maxW: w, maxLines: 2, lh: 30, edit: q.edit, a: { fill: q.col || 'var(--ink)' } }); if (tb.lines.length > 1) tb.el.setAttribute('y', y + BL[q.cls || 'ts-label'] - (tb.lines.length - 1) * tb.lh / 2); }
    else { const t = T(pg, cx, y + (BL[q.cls || 'ts-label'] || 11), q.t, q.cls || 'ts-label', { fill: q.col || 'var(--ink)', cls: q.strong ? 'strong' : null }); if (q.cp) computed(t, q.cp); else editable(t, q.edit); }
    cx += w + gap;
  });
  g.box = { x: anchor === 'middle' ? x - tot / 2 : anchor === 'end' ? x - tot : x, y: y - 36, w: tot, h: 74 };
  return g;
}
const decText = q => !q.pre && !q.rep ? String(q.int) : `${q.int}.${q.pre}${q.rep.length > 6 ? q.rep.slice(0, 6) + '…' : q.rep}`;
/** Decimal text starting at x (baseline y); recurring digits get a dot over the first and last. */
function decimal(p, x, y, q, suffix, cls, col, cp) {
  const s = decText(q) + suffix;
  const t = T(p, x, y, s, cls, { fill: col || 'var(--ink)' }); computed(t, cp);
  if (q.rep && q.rep.length <= 6) {
    const i0 = `${q.int}.${q.pre}`.length, i1 = i0 + q.rep.length - 1;
    const fsz = cls === 'ts-num' ? 40 : cls === 'ts-big' ? 52 : 30;
    for (const i of i1 === i0 ? [i0] : [i0, i1]) {
      const xl = measure(p, s.slice(0, i), cls), wd = measure(p, s[i], cls);
      h('circle', { cx: x + xl + wd / 2, cy: y - fsz * .86, r: fsz * .075, fill: col || 'var(--ink)' }, p);
    }
  }
  return t;
}

/** Wholes laid out in a box: circles, rectangles, bars, or one number line from 0 to nW.
 *  Layers keep the drawing order: paper, shading, split lines, rims, then words. */
function makeTrack(Ly, rep, nW, box, { pizza = false } = {}) {
  const t = { rep, nW, wholes: [], pizza: pizza && rep === 'circle' };
  if (rep === 'line') {
    const len = Math.min(box.w, 1000), x0 = box.x + (box.w - len) / 2, y = box.y + box.h / 2;
    Object.assign(t, { X: u => x0 + u / nW * len, y, top: y - 24, bottom: y + 24, x0, x1: x0 + len, cx: x0 + len / 2 });
  } else {
    let ww, hh, gap;
    if (rep === 'circle') { gap = 56; ww = hh = Math.min(300, box.h, (box.w - (nW - 1) * gap) / nW); }
    else if (rep === 'bar') { gap = 28; ww = (Math.min(box.w, 1040) - (nW - 1) * gap) / nW; hh = Math.min(box.h, 120); }
    else { gap = 48; ww = Math.min(380, (box.w - (nW - 1) * gap) / nW); hh = Math.min(box.h, ww * .6); }
    const tot = nW * ww + (nW - 1) * gap, x0 = box.x + (box.w - tot) / 2, y0 = box.y + (box.h - hh) / 2;
    for (let k = 0; k < nW; k++) { const x = x0 + k * (ww + gap); t.wholes.push({ x, y: y0, w: ww, h: hh, cx: x + ww / 2, cy: y0 + hh / 2, r: ww / 2 }); }
    Object.assign(t, { top: y0, bottom: y0 + hh, x0, x1: x0 + tot, cx: x0 + tot / 2 });
    // x where a fraction u of the wholes ends (bars and rectangles)
    t.X = u => { const k = clamp(Math.ceil(u - 1e-9) - 1, 0, nW - 1), W0 = t.wholes[k]; return W0.x + clamp(u - k, 0, 1) * W0.w; };
  }
  const rim = { fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)' };
  t.base = (a, wholeLabels = true) => {
    const g = h('g', a, Ly.base), gr = h('g', a, Ly.rim);
    if (rep === 'line') {
      h('line', { x1: t.x0, x2: t.x1, y1: t.y, y2: t.y, stroke: 'var(--axis)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, gr);
      for (let k = 0; k <= nW; k++) {
        h('line', { x1: t.X(k), x2: t.X(k), y1: t.y - 22, y2: t.y + 22, stroke: 'var(--axis)', 'stroke-width': 'var(--sw-struct)' }, gr);
        if (wholeLabels) computed(T(gr, t.X(k), t.y + 60, String(k), 'ts-label', { 'text-anchor': 'middle', fill: 'var(--ink)' }), 'fractions');
      }
    } else for (const W0 of t.wholes) {
      if (t.pizza) {
        // a pizza on its board: crust ring, cheese, a few slices of pepperoni (fixed places, so it is deterministic)
        h('circle', { cx: W0.cx, cy: W0.cy, r: W0.r + 18, fill: 'var(--board)', cls: 'lift' }, g);
        h('circle', { cx: W0.cx, cy: W0.cy, r: W0.r, fill: 'var(--crust)' }, g);
        h('circle', { cx: W0.cx, cy: W0.cy, r: W0.r * .85, fill: 'var(--cheese)' }, g);
        for (const [a0, rr] of [[.3, .5], [1.25, .62], [2.2, .42], [2.9, .64], [3.75, .5], [4.6, .63], [5.5, .45], [0, .12]]) {
          const px = W0.cx + Math.cos(a0) * rr * W0.r, py = W0.cy + Math.sin(a0) * rr * W0.r;
          h('circle', { cx: px, cy: py, r: W0.r * .1, fill: 'color-mix(in oklab,var(--heat) 78%,var(--crust))' }, g);
        }
        h('circle', Object.assign({ cx: W0.cx, cy: W0.cy, r: W0.r }, rim), gr);
      } else if (rep === 'circle') { h('circle', { cx: W0.cx, cy: W0.cy, r: W0.r, fill: 'var(--paper)', cls: 'lift body' }, g); h('circle', Object.assign({ cx: W0.cx, cy: W0.cy, r: W0.r }, rim), gr); }
      else { h('rect', { x: W0.x, y: W0.y, width: W0.w, height: W0.h, rx: 'var(--r-mark)', fill: 'var(--paper)', cls: 'lift body' }, g); h('rect', Object.assign({ x: W0.x, y: W0.y, width: W0.w, height: W0.h, rx: 'var(--r-mark)' }, rim), gr); }
    }
    return g;
  };
  /** Equal parts: split lines (or ticks with fraction labels on a line). */
  t.split = (d, a = {}, { labels = 'above', only = null, sw = 'var(--sw-rule)', cp } = {}) => {
    const g = h('g', a, Ly.split);
    if (rep === 'line') {
      const step = (t.x1 - t.x0) / (nW * d), all = step >= 64;
      for (let k = 1; k < nW * d; k++) {
        if (k % d === 0) continue;
        const x = t.X(k / d); h('line', { x1: x, x2: x, y1: t.y - 14, y2: t.y + 14, stroke: 'var(--axis)', 'stroke-width': 'var(--sw-rule)' }, g);
        if (labels && (all || (only && only.includes(k)))) fracText(g, x, labels === 'above' ? t.y - 70 : t.y + 74, k, d, { col: 'var(--ink-2)', computed: cp });
      }
      return g;
    }
    for (const W0 of t.wholes) for (let j = 1; j < d; j++) {
      let dd;
      if (rep === 'circle') { const a0 = -Math.PI / 2 + j * 2 * Math.PI / d; dd = `M${W0.cx} ${W0.cy} L${(W0.cx + W0.r * Math.cos(a0)).toFixed(2)} ${(W0.cy + W0.r * Math.sin(a0)).toFixed(2)}`; }
      else { const x = W0.x + j * W0.w / d; dd = `M${x} ${W0.y} V${W0.y + W0.h}`; }
      h('path', { d: dd, stroke: 'var(--ink-2)', 'stroke-width': sw, fill: 'none', cls: 'draw', pathLength: 1, delay: j * 70 }, g);
    }
    if (rep === 'circle') for (const W0 of t.wholes) if (d > 1) h('path', { d: `M${W0.cx} ${W0.cy} L${W0.cx} ${W0.cy - W0.r}`, stroke: 'var(--ink-2)', 'stroke-width': sw, fill: 'none', cls: 'draw', pathLength: 1 }, g);
    return g;
  };
  /** Shade u0..u1 wholes. */
  t.shade = (u0, u1, col, a = {}) => {
    const g = h('g', a, Ly.shade);
    if (rep === 'line') {
      const x0 = t.X(u0), x1 = t.X(u1);
      if (x1 - x0 > 1) h('rect', { x: x0, y: t.y - 9, width: x1 - x0, height: 18, rx: 'var(--r-pill)', fill: col, cls: 'wipe' }, g);
      h('circle', { cx: x1, cy: t.y, r: 12, fill: col, stroke: 'var(--bg)', 'stroke-width': 'var(--sw-struct)' }, g);
      return g;
    }
    t.wholes.forEach((W0, k) => {
      const a0 = clamp(u0 - k, 0, 1), a1 = clamp(u1 - k, 0, 1); if (a1 - a0 <= 1e-9) return;
      if (rep === 'circle') {
        const op = t.pizza ? { 'fill-opacity': .62 } : {};
        if (a1 - a0 >= 1 - 1e-9) h('circle', Object.assign({ cx: W0.cx, cy: W0.cy, r: W0.r, fill: col }, op), g);
        else { const A0 = -Math.PI / 2 + a0 * 2 * Math.PI, A1 = -Math.PI / 2 + a1 * 2 * Math.PI, P = A => `${(W0.cx + W0.r * Math.cos(A)).toFixed(2)} ${(W0.cy + W0.r * Math.sin(A)).toFixed(2)}`;
          h('path', Object.assign({ d: `M${W0.cx} ${W0.cy} L${P(A0)} A${W0.r} ${W0.r} 0 ${A1 - A0 > Math.PI ? 1 : 0} 1 ${P(A1)} Z`, fill: col }, op), g); }
      } else h('rect', { x: W0.x + a0 * W0.w, y: W0.y, width: (a1 - a0) * W0.w, height: W0.h, fill: col, cls: 'wipe', delay: k * 300 }, g);
    });
    return g;
  };
  return t;
}

/** Fraction wall rows: [{d, n, a, shadeA, label}] — d = 1 is the whole row (its words from `whole`). */
function wall(Ly, P, rows, { x = 232, w = 900, y0 = 140, y1 = 500, cp }) {
  const R = rows.length, gap = 10, rowH = Math.min(112, (y1 - y0 - gap * (R - 1)) / R);
  const out = [];
  rows.forEach((r, i) => {
    const y = y0 + i * (rowH + gap), cw = w / r.d;
    const g = h('g', r.a || {}, Ly.base), gs = h('g', r.shadeA || r.a || {}, Ly.shade), gt = h('g', r.a || {}, Ly.text);
    const hue = r.hue || 'var(--part)';
    for (let j = 0; j < r.d; j++) h('rect', { x: x + j * cw, y, width: cw, height: rowH, fill: r.d === 1 ? 'color-mix(in oklab,var(--ink) 5%,var(--paper))' : `color-mix(in oklab,${hue} 7%,var(--paper))`, stroke: r.d === 1 ? 'var(--ink-3)' : `color-mix(in oklab,${hue} 45%,var(--paper))`, 'stroke-width': 'var(--sw-rule)', cls: 'body' }, g);
    for (let j = 0; j < (r.n || 0); j++) h('rect', { x: x + j * cw, y, width: cw, height: rowH, fill: `color-mix(in oklab,${hue} 32%,var(--paper))`, stroke: hue, 'stroke-width': 'var(--sw-struct)', cls: 'wipe', delay: j * 120 }, gs);
    if (r.d === 1) { const tb = textBlock(gt, x + w / 2, y + rowH / 2 + 11, P.whole || '1 whole', { cls: 'ts-h3', maxW: w - 48, maxLines: 2, lh: 34, anchor: 'middle', edit: 'whole', a: { fill: 'var(--ink)' } }); if (tb.lines.length > 1) tb.el.setAttribute('y', y + rowH / 2 + 10 - (tb.lines.length - 1) * tb.lh / 2); }
    else if (cw >= 56 && rowH >= 80) for (let j = 0; j < r.d; j++) fracText(gt, x + (j + .5) * cw, y + rowH / 2 - 2, 1, r.d, { col: j < (r.n || 0) ? (r.hueText || 'var(--part-text)') : 'var(--ink-2)', computed: cp });
    out.push({ y, h: rowH, cw, cy: y + rowH / 2 });
  });
  return { rows: out, x, w, X: u => x + u * w, top: y0, bottom: out[R - 1].y + out[R - 1].h };
}

/* ------------------------------------------------------------------ render */
export function render(root, P, ctx) {
  const E = eff(P); P = E.P;
  const { M } = plan(P); const { F, op, rep } = M; const b = ctx.b, N = ctx.N;
  const bi = k => b[k] ?? 0;
  const pizza = /pizza/i.test(P.whole || '');
  // the page: faint squared maths paper behind the work (a pizza sits on its board instead)
  // drawn as one page-sized pattern (it is the page, not a mark), shown only between the title band and the foot rule
  if (!pizza) { const gc = 'color-mix(in oklab,var(--grid-line) 55%,var(--bg))', id = `${ctx.uid}-sq`, defs = h('defs', {}, root);
    const pt = h('pattern', { id: id + 'p', patternUnits: 'userSpaceOnUse', x: 32, y: 100, width: 40, height: 40 }, defs);
    h('path', { d: 'M0 0H40M0 40H40M0 0V40M40 0V40', fill: 'none', stroke: gc, 'stroke-width': 'var(--sw-hair)' }, pt);
    h('rect', { x: 0, y: 99, width: 1280, height: GRID.foot - 99 }, h('clipPath', { id: id + 'c' }, defs));
    h('rect', { x: 0, y: 0, width: 1280, height: 720, fill: `url(#${id}p)`, 'clip-path': `url(#${id}c)` }, root); }
  const Ly = { base: h('g', {}, root), shade: h('g', {}, root), split: h('g', {}, root), rim: h('g', {}, root), text: h('g', {}, root) };
  const f = F[0], CX = 640;
  // a distinct colour per fraction (so per denominator on a wall): purple, teal, gold
  const HUE = ['var(--part)', 'var(--compare)', 'var(--era-5)'], HUE_T = ['var(--part-text)', 'var(--compare-text)', 'var(--era-5-text)'];
  const fp = i => i < E.nReal ? `fractions.${i}.value` : 'fractions';
  // a fraction the slide supplied (not in the list) is computed: clicking it focuses the list
  const ed = i => i < E.nReal ? { edit: fp(i) } : { cp: 'fractions' }, edF = i => i < E.nReal ? { edit: fp(i) } : { computed: 'fractions' };
  const words = (n, d) => P.words && d <= 100 && n <= 100 ? fracWords(n, d) : null;
  // one label under each whole, so two pizzas are never called 'One pizza'
  const wholeLabel = (t, y, a) => {
    const g = h('g', a, Ly.text), line = t.rep === 'line';
    const xs = line ? Array.from({ length: t.nW }, (_, k) => t.X(k + .5)) : t.wholes.map(W0 => W0.cx);
    const mw = t.nW > 1 ? (line ? (t.x1 - t.x0) / t.nW : t.wholes[0].w + 40) - 24 : 900;
    for (const x of xs) textBlock(g, x, y, P.whole || '1 whole', { cls: 'ts-h3', maxW: mw, maxLines: 2, lh: 34, anchor: 'middle', edit: 'whole', a: { fill: 'var(--ink-2)' } });
    return g;
  };
  const nameRow = (y, n, d, edit, a) => {
    const pcs = [{ f: [n, d], col: 'var(--part-text)', edit }];
    if (n > d && d > 1) { pcs.push({ t: '=', cls: 'ts-num' }); if (n % d) pcs.push({ t: String(Math.floor(n / d)), cls: 'ts-num', cp: edit }, { f: [n % d, d], col: 'var(--part-text)', cp: edit }); else pcs.push({ t: String(n / d), cls: 'ts-num', cp: edit }); }
    const wd = words(n, d); if (wd) pcs.push({ t: wd, cls: 'ts-label', col: 'var(--ink-2)', cp: edit });
    const g = row(Ly.text, CX, y, pcs, { gap: 18 }); applyA(g, a); return g;
  };
  const applyA = (g, a) => { if (!a) return; if (a.s != null) g.dataset.s = a.s; if (a.hide != null) g.dataset.h = a.hide; if (a.c) g.dataset.c = a.c; if (a.cls) g.setAttribute('class', a.cls); };
  const check = (box, what) => { if (box.x < GRID.left - 30 || box.x + box.w > GRID.right + 30) ctx.warn(`${what} is too wide for the slide`); };

  /* ---------------- show / equivalent / add on wholes or a line */
  if ((op === 'show' || op === 'equivalent' || op === 'add') && rep !== 'wall') {
    const nW = M.nW, isL = rep === 'line';
    const box = isL ? { x: 140, y: 250, w: 1000, h: 80 } : rep === 'circle' ? { x: 64, y: 130, w: 1152, h: 330 } : rep === 'bar' ? { x: 64, y: 200, w: 1152, h: 120 } : { x: 64, y: 150, w: 1152, h: 240 };
    const t = makeTrack(Ly, rep, nW, box, { pizza });
    const below = isL ? t.y + (op === 'equivalent' ? 118 : 74) : t.bottom;
    const nameY = Math.min(560, below + (isL ? 90 : 96));
    t.base({ s: bi('whole') });
    wholeLabel(t, below + 54, { s: bi('whole'), hide: bi(op === 'add' ? 'a' : 'name') });
    const d = f.d;
    if (op === 'show') {
      t.split(d, { s: bi('split') }, { only: [f.n], cp: fp(0) });
      t.shade(0, f.n / d, 'var(--part)', { s: bi('shade') });
      const g = nameRow(nameY, f.n, d, fp(0), { s: bi('name'), cls: 'rise' }); check(g.box, 'The name');
    } else if (op === 'equivalent') {
      const [a, c] = F; const keep = c.d % a.d === 0;
      t.split(a.d, { s: bi('split'), hide: keep ? null : bi('resplit') }, { only: [a.n], sw: 'var(--sw-struct)', cp: fp(0) });
      t.shade(0, a.n / a.d, 'var(--part)', { s: bi('shade') });
      t.split(c.d, { s: bi('resplit') }, { labels: 'below', only: [c.n], cp: fp(1) });
      const g = row(Ly.text, CX, nameY, [
        { f: [a.n, a.d], col: 'var(--part-text)', edit: fp(0), a: { s: bi('name'), cls: 'rise' } },
        { t: '=', cls: 'ts-num', a: { s: bi('name2'), cls: 'rise' } },
        { f: [c.n, c.d], col: 'var(--part-text)', ...ed(1), a: { s: bi('name2'), cls: 'rise' } }], { gap: 22 });
      check(g.box, 'The equivalence');
    } else {
      const [a, c] = F, s = M.sum;
      t.split(d, { s: bi('split') }, { only: [a.n, s.n], cp: fp(0) });
      t.shade(0, a.n / d, 'var(--part)', { s: bi('a') });
      t.shade(a.n / d, s.n / d, 'var(--compare)', { s: bi('b') });
      const pcs = [
        { f: [a.n, a.d], col: 'var(--part-text)', edit: fp(0), a: { s: bi('a'), cls: 'rise' } },
        { t: '+', cls: 'ts-num', a: { s: bi('b'), cls: 'rise' } },
        { f: [c.n, c.d], col: 'var(--compare-text)', ...ed(1), a: { s: bi('b'), cls: 'rise' } },
        { t: '=', cls: 'ts-num', a: { s: bi('sum'), cls: 'rise' } },
        { f: [s.n, s.d], cp: fp(1), a: { s: bi('sum'), cls: 'rise' } }];
      if (s.n > s.d) { pcs.push({ t: '=', cls: 'ts-num', a: { s: bi('sum'), cls: 'rise' } }); if (s.n % s.d) pcs.push({ t: String(Math.floor(s.n / s.d)), cls: 'ts-num', cp: fp(1), a: { s: bi('sum'), cls: 'rise' } }, { f: [s.n % s.d, s.d], cp: fp(1), a: { s: bi('sum'), cls: 'rise' } }); else pcs.push({ t: String(s.n / s.d), cls: 'ts-num', cp: fp(1), a: { s: bi('sum'), cls: 'rise' } }); }
      const g = row(Ly.text, CX, nameY, pcs, { gap: 20 }); check(g.box, 'The sum');
    }
    return {};
  }

  /* ---------------- fraction wall: show, equivalent, compare */
  if (rep === 'wall') {
    let rows, labels = [];
    if (op === 'show') rows = [{ d: 1, a: { s: bi('whole') } }, { d: f.d, n: f.n, a: { s: bi('split'), cls: 'rise' }, shadeA: { s: bi('shade') } }];
    else if (op === 'equivalent') rows = [{ d: 1, a: { s: bi('whole') } }, { d: F[0].d, n: F[0].n, a: { s: bi('split'), cls: 'rise' }, shadeA: { s: bi('shade') } }, { d: F[1].d, n: F[1].n, a: { s: bi('resplit'), cls: 'rise' }, hue: HUE[1], hueText: HUE_T[1] }];
    else rows = [{ d: 1, a: { s: bi('whole') } }, ...F.map((g, i) => ({ d: g.d, n: g.n, a: { s: bi(`f:${i}`), cls: 'rise' }, hue: HUE[i], hueText: HUE_T[i] }))];
    const Wl = wall(Ly, P, rows, { y0: 140, y1: op === 'show' ? 380 : 520, cp: 'fractions' });
    // the value of each fraction row, on the left
    const lab = (ri, fi, a) => { const g = h('g', a, Ly.text); fracText(g, 166, Wl.rows[ri].cy - 2, F[fi].n, F[fi].d, { col: HUE_T[fi], ...edF(fi) }); return g; };
    if (op === 'show') { nameRow(Wl.bottom + 100, f.n, f.d, fp(0), { s: bi('name'), cls: 'rise' }); }
    else if (op === 'equivalent') {
      lab(1, 0, { s: bi('name'), cls: 'rise' }); lab(2, 1, { s: bi('name2'), cls: 'rise' });
      const x = Wl.X(F[0].n / F[0].d);
      h('line', { x1: x, x2: x, y1: Wl.rows[1].y - 8, y2: Wl.rows[2].y + Wl.rows[2].h + 8, stroke: 'var(--ink)', 'stroke-width': 'var(--sw-lead)', 'stroke-dasharray': '7 6', s: bi('resplit'), cls: 'draw', pathLength: 1 }, Ly.rim);
      row(Ly.text, CX, Wl.bottom + 82, [
        { f: [F[0].n, F[0].d], col: 'var(--part-text)', edit: fp(0), a: { s: bi('name2'), cls: 'rise' } },
        { t: '=', cls: 'ts-num', a: { s: bi('name2'), cls: 'rise' } },
        { f: [F[1].n, F[1].d], col: HUE_T[1], ...ed(1), a: { s: bi('name2'), cls: 'rise' } }], { gap: 22 });
    } else {
      F.forEach((g, i) => lab(i + 1, i, { s: bi(`f:${i}`), cls: 'rise' }));
      compareRow(Wl.bottom + 82);
    }
    return {};
  }

  /* ---------------- compare: rows of bars or lines, or side by side shapes */
  function compareRow(y) {
    const pcs = []; const ord2 = F.length === 2 ? [0, 1] : M.order;
    ord2.forEach((i, j) => {
      if (j) { const p = F[ord2[j - 1]], q = F[i], s = Math.sign(q.n * p.d - p.n * q.d); pcs.push({ t: F.length === 2 ? (M.cmp > 0 ? '>' : M.cmp < 0 ? '<' : '=') : (s > 0 ? '<' : '='), cls: 'ts-num', a: { s: bi('compare') } }); }
      pcs.push({ f: [F[i].n, F[i].d], col: 'var(--part-text)', ...ed(i), a: { s: bi('compare') } });
    });
    const g = row(Ly.text, CX, y, pcs, { gap: 22 }); applyA(g, { cls: 'rise' }); g.dataset.s = bi('compare'); check(g.box, 'The comparison');
  }
  if (op === 'compare') {
    const k = F.length;
    if (rep === 'bar' || rep === 'line') {
      const y0 = 150, y1 = 500, span = (y1 - y0) / k, ends = [];
      F.forEach((g, i) => {
        const cy = y0 + span * (i + .5), hh = rep === 'bar' ? Math.min(84, span - 36) : 50;
        const t = makeTrack(Ly, rep, M.nW, { x: 220, y: cy - hh / 2, w: 940, h: hh });
        t.base({ s: bi('whole') }, rep === 'line' && i === k - 1);
        t.split(g.d, { s: bi(`f:${i}`) }, { labels: null });
        t.shade(0, g.n / g.d, 'var(--part)', { s: bi(`f:${i}`) });
        const lg = h('g', { s: bi(`f:${i}`), cls: 'rise' }, Ly.text); fracText(lg, 140, cy - 2, g.n, g.d, { col: 'var(--part-text)', ...edF(i) });
        ends.push({ x: t.X(g.n / g.d), top: t.top, bottom: t.bottom });
      });
      const top = ends[0].top - 14, bot = ends[k - 1].bottom + 14;
      for (const e of ends) h('line', { x1: e.x, x2: e.x, y1: top, y2: bot, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '6 6', s: bi('compare') }, Ly.rim);
      compareRow(rep === 'line' ? 590 : 580);
    } else {
      const pw = 1152 / k;
      F.forEach((g, i) => {
        const t = makeTrack(Ly, rep, 1, { x: 64 + i * pw + 20, y: 150, w: pw - 40, h: rep === 'circle' ? 250 : 230 }, { pizza });
        t.base({ s: bi('whole') });
        t.split(g.d, { s: bi(`f:${i}`) });
        t.shade(0, g.n / g.d, 'var(--part)', { s: bi(`f:${i}`) });
        const lg = h('g', { s: bi(`f:${i}`), cls: 'rise' }, Ly.text); fracText(lg, t.cx, t.bottom + 62, g.n, g.d, { col: 'var(--part-text)', ...edF(i) });
      });
      compareRow(590);
    }
    return {};
  }

  /* ---------------- fraction of an amount: a set shared into groups, or a bar */
  if (op === 'of') {
    const d = f.d, m = M.share, A = P.amount;
    if (rep === 'set') {
      // groups first: they set the counter size, so counters keep their size when dealt
      const gw = Math.min(270, (1152 - (d - 1) * 24) / d); let rr = 32, cols, rowsG;
      for (; ; rr--) { cols = Math.max(1, Math.min(m, Math.floor((gw - 20) / (rr * 2.6)))); rowsG = Math.ceil(m / cols); if (rowsG * rr * 2.6 + 24 <= 180 || rr <= 9) break; }
      const gh = rowsG * rr * 2.6 + 24;
      const perRow = A <= 20 ? A : Math.ceil(A / 2), rowsW = Math.ceil(A / perRow), sp = Math.max(rr * 2.6, Math.min(54, 1100 / perRow));
      const bottom0 = 200 + (rowsW - 1) * sp + rr + 90 + gh + 172, wy0 = clamp(200 + (630 - bottom0) / 2, 200, 260), wx0 = CX - (perRow - 1) * sp / 2;
      const labY = wy0 + (rowsW - 1) * sp + rr + 46;
      const gy = labY + 44, totW = d * gw + (d - 1) * 24, gx0 = CX - totW / 2;
      const gxs = Array.from({ length: d }, (_, j) => gx0 + j * (gw + 24));
      const cu = Math.min(cols, m);
      const stagger = Math.min(220, 2600 / A);
      gxs.forEach((gx, j) => {
        h('rect', { x: gx, y: gy, width: gw, height: gh, rx: 'var(--r-card)', fill: 'var(--paper)', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)', cls: 'lift body', s: bi('share') }, Ly.base);
        if (j < f.n) h('rect', { x: gx, y: gy, width: gw, height: gh, rx: 'var(--r-card)', fill: PALE, stroke: 'var(--part)', 'stroke-width': 'var(--sw-struct)', s: bi('shade'), delay: j * 150 }, Ly.shade);
        const lt = T(Ly.text, gx + gw / 2, gy + gh + 50, String(m), 'ts-num', { 'text-anchor': 'middle', fill: j < f.n ? 'var(--part-text)' : 'var(--ink-2)', s: bi('share'), delay: A * stagger + 300 });
        computed(lt, 'amount');
      });
      for (let i = 0; i < A; i++) {
        const sx = wx0 + (i % perRow) * sp, sy = wy0 + Math.floor(i / perRow) * sp;
        const j = i % d, q = Math.floor(i / d), cx = gxs[j] + gw / 2 + ((q % cols) - (cu - 1) / 2) * rr * 2.6, cy = gy + 12 + rr * 1.3 + Math.floor(q / cols) * rr * 2.6;
        counter(Ly.text, sx, sy, rr, 'var(--counter)', { s: bi('whole'), hide: bi('share'), cls: 'snap', delay: i * stagger });
        const fg = h('g', { s: bi('share'), cls: 'fly', delay: i * stagger, vars: { '--fx': `${(sx - cx).toFixed(1)}px`, '--fy': `${(sy - cy).toFixed(1)}px` } }, Ly.text);
        counter(fg, cx, cy, rr);
      }
      const wl = row(Ly.text, CX, labY - 12, [{ t: String(A), cls: 'ts-h3', cp: 'amount' }, { t: P.things, cls: 'ts-h3', edit: 'things' }], { gap: 10 });
      applyA(wl, { s: bi('whole'), hide: bi('share') });
      const ay = Math.min(604, gy + gh + 132);
      const g = row(Ly.text, CX, ay, [{ f: [f.n, d], col: 'var(--part-text)', edit: fp(0) }, { t: txt(P, 'label:of', 'of'), edit: 'text.label:of', wrap: true }, { t: String(A), cp: 'amount' }, { t: '=', cls: 'ts-num' }, { t: String(M.ans), cls: 'ts-num', col: 'var(--part-text)', cp: 'amount' }], { gap: 16 });
      applyA(g, { s: bi('answer'), cls: 'rise' });
      if (gy + gh + 60 > 640 || ay + 38 > 650) ctx.warn('Fraction of an amount: the groups do not fit; use a smaller amount');
    } else {
      const t = makeTrack(Ly, 'bar', 1, { x: 64, y: 220, w: 1152, h: 120 });
      t.base({ s: bi('whole') });
      const wl = row(Ly.text, CX, t.top - 44, [{ t: String(A), cls: 'ts-h3', cp: 'amount' }, { t: P.things, cls: 'ts-h3', edit: 'things' }], { gap: 10 }); applyA(wl, { s: bi('whole') });
      t.split(d, { s: bi('share') });
      t.shade(0, f.n / d, PALE, { s: bi('shade') });
      for (let j = 0; j < d; j++) { const W0 = t.wholes[0]; computed(T(Ly.text, W0.x + (j + .5) * W0.w / d, W0.cy + 14, String(m), 'ts-num', { 'text-anchor': 'middle', fill: j < f.n ? 'var(--part-text)' : 'var(--ink-2)', s: bi('share'), delay: 400 }), 'amount'); }
      bracket(Ly.text, t.x0, t.X(f.n / d), t.bottom + 30, String(M.ans), { a: { s: bi('answer'), cls: 'rise' }, computedPath: 'amount' });
      const g = row(Ly.text, CX, 572, [{ f: [f.n, d], col: 'var(--part-text)', edit: fp(0) }, { t: txt(P, 'label:of', 'of'), edit: 'text.label:of', wrap: true }, { t: String(A), cp: 'amount' }, { t: '=', cls: 'ts-num' }, { t: String(M.ans), cls: 'ts-num', col: 'var(--part-text)', cp: 'amount' }], { gap: 16 });
      applyA(g, { s: bi('answer'), cls: 'rise' });
    }
    return {};
  }

  /* ---------------- convert: hundred square or number line */
  if (rep === 'hundred') {
    const cs = 44, gx = 150, gy = 130, k = M.k, full = Math.floor(k + 1e-9), part = k - full;
    h('rect', { x: gx, y: gy, width: cs * 10, height: cs * 10, fill: 'var(--paper)', cls: 'lift body', s: bi('whole') }, Ly.base);
    const gl = h('g', { s: bi('whole') }, Ly.base);
    for (let i = 1; i < 10; i++) {
      h('line', { x1: gx + i * cs, x2: gx + i * cs, y1: gy, y2: gy + 10 * cs, stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }, gl);
      h('line', { x1: gx, x2: gx + 10 * cs, y1: gy + i * cs, y2: gy + i * cs, stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }, gl);
    }
    // shaded squares are tiles set just inside their cells, so the paper shows as a clean gap between them
    const ins = 2.5;
    for (let c = 0; c < 10; c++) {
      const cg = h('g', { s: bi('shade'), delay: c * 110 }, Ly.shade);
      for (let r = 0; r < 10; r++) { const i = c * 10 + r, x = gx + c * cs + ins, y = gy + r * cs + ins;
        if (i < full) h('rect', { x, y, width: cs - 2 * ins, height: cs - 2 * ins, rx: 'var(--r-mark)', fill: 'var(--part)' }, cg);
        else if (i === full && part > 1e-6) h('rect', { x, y, width: cs - 2 * ins, height: Math.max(2, cs * part - 2 * ins), fill: 'var(--part)' }, cg); }
    }
    h('rect', { x: gx, y: gy, width: cs * 10, height: cs * 10, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', s: bi('whole') }, Ly.rim);
    const hl = h('g', { s: bi('whole') }, Ly.text);
    const hTxt = txt(P, 'label:hundred', '100 squares make 1 whole'), hWide = measure(hl, hTxt, 'ts-label') > cs * 10 + 40;
    // centred under the square; a long edit may use the free width left of the chain bands
    textBlock(hl, hWide ? (GRID.left + 636) / 2 : gx + cs * 5, gy + cs * 10 + 44, hTxt, { cls: 'ts-label', maxW: hWide ? 636 - 12 - GRID.left : cs * 10 + 40, maxLines: 2, lh: 32, anchor: 'middle', edit: 'text.label:hundred', a: { fill: 'var(--ink-2)' } });
    // the chain: fraction, hundredths, decimal, per cent; the newest row sits on a band, earlier rows step back
    const rowsC = [{ key: 'shade', pcs: [{ f: [f.n, f.d], col: 'var(--part-text)', edit: fp(0) }], note: words(f.n, f.d), noteCp: fp(0) }];
    rowsC.push({ key: 'hundredths', pcs: Number.isInteger(k) ? [{ t: '=', cls: 'ts-num' }, { f: [k, 100], cp: fp(0) }] : [{ t: '=', cls: 'ts-num' }, { dec: M.pct, cp: fp(0) }, { t: 'hundredths', cls: 'ts-label', cp: fp(0) }], note: Number.isInteger(k) ? `${k} out of 100 squares` : 'one square is only partly shaded', noteCp: fp(0) });
    if (M.showDec) rowsC.push({ key: 'decimal', pcs: [{ t: '=', cls: 'ts-num' }, { dec: M.dec, cp: fp(0) }], note: M.dec.rep ? txt(P, 'label:recurring', 'the dots mean the digits repeat for ever') : placeWords(M.dec), noteEdit: M.dec.rep ? 'text.label:recurring' : null, noteCp: M.dec.rep ? null : fp(0) });
    if (M.showPct) rowsC.push({ key: 'percent', pcs: [{ t: '=', cls: 'ts-num' }, { dec: M.pct, suffix: '%', cp: fp(0) }], note: txt(P, 'label:percent', 'per cent means out of 100'), noteEdit: 'text.label:percent' });
    const cx0 = 664, span = Math.min(130, 400 / (rowsC.length - 1 || 1));
    rowsC.forEach((r, i) => {
      const y = 190 + i * span, a = { s: bi(r.key), cls: 'rise', c: ctx.rc(r.key, null, 'soft') };
      const rg = row(Ly.text, cx0, y, r.pcs, { anchor: 'start', gap: 16 }); applyA(rg, a);
      const nx = Math.max(cx0 + 190, rg.box.x + rg.box.w + 28), under = r.note && GRID.right - nx < 220;
      const band = h('rect', { x: cx0 - 28, y: y - 52, width: GRID.right + 12 - (cx0 - 28), height: under ? 140 : 104, rx: 'var(--r-card)', fill: 'var(--part-pale)', s: bi(r.key), hide: i < rowsC.length - 1 ? bi(rowsC[i + 1].key) : N }, Ly.base);
      band.setAttribute('class', 'rise');
      if (r.note) { const ng = h('g', a, Ly.text); applyA(ng, a);
        const tb = under
          ? textBlock(ng, cx0, y + 70, r.note, { cls: 'ts-label', maxW: GRID.right - cx0, maxLines: 1, lh: 32, edit: r.noteEdit, a: { fill: 'var(--ink-2)' } })
          : textBlock(ng, nx, y + 10, r.note, { cls: 'ts-label', maxW: GRID.right - nx, maxLines: 3, lh: 32, edit: r.noteEdit, a: { fill: 'var(--ink-2)' } });
        if (r.noteCp) { tb.el.removeAttribute('data-edit'); computed(tb.el, r.noteCp); } if (!under && tb.lines.length > 1) tb.el.setAttribute('y', y + 10 - (tb.lines.length - 1) * tb.lh / 2); }
    });
    return {};
  }
  // number line from 0 to 1
  const t = makeTrack(Ly, 'line', 1, { x: 140, y: 250, w: 1000, h: 80 });
  t.base({ s: bi('whole') });
  t.split(f.d, { s: bi('split') }, { only: [f.n], cp: fp(0) });
  t.shade(0, f.n / f.d, 'var(--part)', { s: bi('mark') });
  if (M.showDec) {
    const tg = h('g', { s: bi('tenths') }, Ly.split);
    for (let i = 1; i < 10; i++) { const x = t.X(i / 10); h('line', { x1: x, x2: x, y1: t.y, y2: t.y + 18, stroke: 'var(--compare)', 'stroke-width': 'var(--sw-rule)' }, tg); computed(T(tg, x, t.y + 52, `0.${i}`, 'ts-axis', { 'text-anchor': 'middle', fill: 'var(--compare-text)' }), fp(0)); }
  }
  const pcs = [{ f: [f.n, f.d], col: 'var(--part-text)', edit: fp(0), a: { s: bi('mark'), cls: 'rise' } }];
  if (M.showDec) pcs.push({ t: '=', cls: 'ts-num', a: { s: bi('decimal'), cls: 'rise' } }, { dec: M.dec, cp: fp(0), a: { s: bi('decimal'), cls: 'rise' } });
  if (M.showPct) pcs.push({ t: '=', cls: 'ts-num', a: { s: bi('percent'), cls: 'rise' } }, { dec: M.pct, suffix: '%', cp: fp(0), a: { s: bi('percent'), cls: 'rise' } });
  row(Ly.text, CX, 500, pcs, { gap: 22 });
  return {};
}
