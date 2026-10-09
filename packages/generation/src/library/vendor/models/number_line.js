// Number line: whole numbers, decimals or fractions on a line with equal spaces. One model for
// counting on and back in jumps, negative numbers (jumps across zero), rounding (the two
// multiples either side, the halfway line, the nearest one) and finding where a number sits.
// Every number on the slide is worked out from the settings: jump sizes are the true
// differences, answers are computed, and rounding follows "halfway rounds up".
import {
  h, T, measure, clamp, textBlock, labelGround,
  editable, computed, txt, TEXT_PARAM, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { numberLine, fmtNum } from '../kit/batch-A.js';

export const meta = {
  id: 'number_line', name: 'Number line', kind: 'info', version: 1,
  subjects: ['Maths', 'Science', 'Geography'],
  years: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'],
  teaches: 'Where numbers sit on a line with equal spaces, and how counting on, counting back, rounding and negative numbers move along it.',
};

const TASKS = ['count-on', 'count-back', 'negatives', 'round', 'position'];
const TASK_LABELS = ['Counting on (jumps forwards)', 'Counting back (jumps backwards)', 'Negative numbers (jumps either way, across 0)', 'Rounding', 'Finding where a number goes'];
const NUM = { type: 'string', minLength: 1, maxLength: 12, description: 'Like 7, −6, 2.5, 3/4 or 1 1/4.' };
const ROUND_TO = ['1', '10', '100', '1000', '0.1'];
const ROUND_WORDS = { 1: 'whole number', 10: '10', 100: '100', 1000: '1,000', 0.1: 'tenth' };

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Number line',
  properties: {
    title: TITLE_PARAM('A number line'),
    task: { type: 'string', title: 'What the line shows', enum: TASKS, 'x-labels': TASK_LABELS, default: 'count-on' },
    numberType: { type: 'string', title: 'Kind of numbers', enum: ['integer', 'decimal', 'fraction'], 'x-labels': ['Whole numbers', 'Decimals', 'Fractions'], default: 'integer' },
    from: Object.assign({}, NUM, { title: 'Line starts at', default: '0', description: 'Not used for rounding: that line runs between the two nearest multiples.' }),
    to: Object.assign({}, NUM, { title: 'Line ends at', default: '10' }),
    step: Object.assign({}, NUM, { title: 'Each space is worth', default: '1', description: 'The gap between ticks, like 1, 10, 0.1 or 1/4. It has to fit the line exactly.' }),
    labels: { type: 'string', title: 'Numbers under the ticks', enum: ['all', 'ends', 'none'], 'x-labels': ['As many as fit', 'The ends (and whole numbers on a fractions line)', 'None'], default: 'all' },
    jumps: {
      type: 'array', title: 'Jumps', description: 'For counting on, counting back and negative numbers. Each jump starts where the last one landed. The size of each jump is worked out for you.',
      'x-item': 'a jump', maxItems: 6, default: [{ from: '3', to: '5' }],
      items: { type: 'object', required: ['from', 'to'], default: { from: '0', to: '1' }, properties: {
        from: Object.assign({}, NUM, { title: 'From' }), to: Object.assign({}, NUM, { title: 'Lands on' }),
      } },
    },
    marks: {
      type: 'array', title: 'Numbers to find', description: 'For “Finding where a number goes”. Each one appears in its own step.',
      'x-item': 'a number', maxItems: 6, default: [],
      items: { type: 'object', required: ['value'], default: { value: '5', label: '' }, properties: {
        value: Object.assign({}, NUM, { title: 'Number' }),
        label: { type: 'string', title: 'Words under it', description: 'Optional, like “three quarters” or “Ali’s guess”.', maxLength: 60, default: '' },
      } },
    },
    round: {
      type: 'object', title: 'Rounding', description: 'For “Rounding” only.', default: { value: '346', to: '10' },
      properties: {
        value: Object.assign({}, NUM, { title: 'Number to round', default: '346', description: 'A positive number, like 346 or 3.7.' }),
        to: { type: 'string', title: 'Round to the nearest', enum: ROUND_TO, 'x-labels': ['Whole number', '10', '100', '1,000', 'Tenth (one decimal place)'], default: '10' },
      },
    },
    unit: { type: 'string', title: 'Unit', description: 'Like °C, m or £. Shown with the jumps and the answer. Leave empty for plain numbers.', maxLength: 8, default: '' },
    simplify: { type: 'boolean', title: 'Write fractions in simplest form', description: 'Fractions only: 2/4 shows as 1/2.', default: false, 'x-panel': 'advanced' },
    text: TEXT_PARAM,
  },
};

export const presets = [
  { id: 'y1-count-on', name: 'Year 1: count on 3 from 7', params: {
    title: 'Count on from 7', task: 'count-on', numberType: 'integer', from: '0', to: '15', step: '1', labels: 'all',
    jumps: [{ from: '7', to: '8' }, { from: '8', to: '9' }, { from: '9', to: '10' }],
  } },
  { id: 'y3-fractions', name: 'Year 3: quarters on a number line', params: {
    title: 'Fractions on a number line', task: 'position', numberType: 'fraction', from: '0', to: '2', step: '1/4', labels: 'ends',
    jumps: [], marks: [{ value: '3/4', label: 'three quarters' }, { value: '1 1/4', label: '' }],
  } },
  { id: 'y4-round', name: 'Year 4: round 346 to the nearest 10', params: {
    title: 'Round 346 to the nearest 10', task: 'round', labels: 'all', jumps: [], round: { value: '346', to: '10' },
  } },
  { id: 'y6-temperature', name: 'Year 6: from −6 °C to 4 °C', params: {
    title: 'Count on from −6 °C to 4 °C', task: 'negatives', numberType: 'integer', from: '−10', to: '10', step: '1', labels: 'all', unit: '°C',
    jumps: [{ from: '−6', to: '0' }, { from: '0', to: '4' }],
  } },
];

/* ------------------------------------------------------------------ numbers */
const MINUS = '−';
const fix = x => +(+x).toFixed(9);
const isMult = (x, s) => { const r = x / s; return Math.abs(r - Math.round(r)) < 1e-7; };
const gcd = (a, b) => b ? gcd(b, a % b) : a;
/** "7", "−6", "2.5", "1,000", "3/4", "1 1/4" -> {v, d (denominator if typed as a fraction), dp, raw} */
export function parseNum(s) {
  const raw = String(s == null ? '' : s).trim();
  const t = raw.replace(/[−–]/g, '-').replace(/,/g, '').replace(/\s+/g, ' ');
  let m;
  const bad = { error: `“${raw}” is not a number the line can place. Write it like 7, −6, 2.5, 3/4 or 1 1/4.` };
  if ((m = t.match(/^(-)?(\d+)(?:\.(\d+))?$/))) return { v: fix((m[1] ? -1 : 1) * parseFloat(`${m[2]}.${m[3] || 0}`)), dp: (m[3] || '').length, raw };
  if ((m = t.match(/^(-)?(?:(\d+) )?(\d+)\/(\d+)$/))) {
    const d = +m[4]; if (!d) return { error: `“${raw}” divides by zero, which has no place on a line.` };
    return { v: fix((m[1] ? -1 : 1) * ((+m[2] || 0) + +m[3] / d)), d, dp: 0, raw };
  }
  return bad;
}
const DEN_WORDS = { 2: ['half', 'halves'], 3: ['third', 'thirds'], 4: ['quarter', 'quarters'], 5: ['fifth', 'fifths'], 6: ['sixth', 'sixths'], 7: ['seventh', 'sevenths'], 8: ['eighth', 'eighths'], 9: ['ninth', 'ninths'], 10: ['tenth', 'tenths'], 11: ['eleventh', 'elevenths'], 12: ['twelfth', 'twelfths'] };
const COUNT_WORDS = { 1: 'ones', 2: 'twos', 3: 'threes', 4: 'fours', 5: 'fives', 10: 'tens', 25: 'twenty-fives', 50: 'fifties', 100: 'hundreds', 1000: 'thousands', 0.1: 'tenths', 0.01: 'hundredths' };

/* ------------------------------------------------------------------ model of the line */
// Each jump starts where the last one landed: only the first jump's start is read, so changing where
// one jump lands never locks against the next one's start. {i, a, b, d, typedFrom}
function chain(js) {
  const out = []; let prev = null;
  (js || []).forEach((j, i) => { const t = parseNum(j.from), b = parseNum(j.to).v; const a = prev == null ? t.v : prev;
    out.push({ i, a, b, d: fix(b - a), typedFrom: t }); prev = b; });
  return out;
}
function model(P) {
  const task = P.task, round = task === 'round';
  const M = { task, round, jumpsTask: ['count-on', 'count-back', 'negatives'].includes(task), position: task === 'position', unit: P.unit || '' };
  if (round) {
    const v = parseNum(P.round.value).v, r = +P.round.to;
    const lo = fix(Math.floor(fix(v / r)) * r), hi = fix(lo + r);
    Object.assign(M, { from: lo, to: hi, step: fix(r / 10), D: null, frac: false, value: v, r, lo, hi, half: fix(lo + r / 2) });
    M.ans = v >= M.half - 1e-9 ? hi : lo;
  } else {
    const st = parseNum(P.step);
    Object.assign(M, { from: parseNum(P.from).v, to: parseNum(P.to).v, step: st.v, frac: P.numberType === 'fraction' });
    M.D = M.frac ? (st.d || 1) : null;
  }
  M.n = Math.round((M.to - M.from) / M.step);
  // fractions: the line's own denominator first, then the smallest that fits; else a decimal
  M.parts = v => {
    if (!M.frac) return null;
    const ds = [M.D, ...Array.from({ length: 11 }, (_, i) => i + 2)];
    for (const D of ds) { const k = Math.round(v * D); if (Math.abs(v * D - k) < 1e-7) {
      const neg = k < 0, a = Math.abs(k); let whole = Math.floor(a / D), n = a % D, d = D;
      if (n && P.simplify) { const g = gcd(n, d); n /= g; d /= g; }
      return { neg, whole, n, d };
    } }
    return null;
  };
  M.fmt = v => {
    const p = M.parts(v);
    if (!p) return fmtNum(fix(v));
    if (!p.n) return (p.neg && p.whole ? MINUS : '') + p.whole;
    return (p.neg ? MINUS : '') + (p.whole ? `${p.whole} ` : '') + `${p.n}/${p.d}`;
  };
  M.fu = v => M.unit ? `${M.fmt(v)} ${M.unit}` : M.fmt(v);
  M.signed = d => `${d < 0 ? MINUS : '+'}${M.fu(Math.abs(d))}`;
  const all = M.jumpsTask ? chain(P.jumps) : [];
  M.jumps = all.filter(j => j.d);
  // jumps that do not move are left out; the slide says so rather than dropping them silently
  M.still = all.filter(j => !j.d);
  M.marks = M.position ? (P.marks || []).map((m, i) => ({ i, v: parseNum(m.value).v, label: m.label || '' })) : [];
  if (M.jumps.length) {
    M.start = M.jumps[0].a; M.end = M.jumps[M.jumps.length - 1].b; M.total = fix(M.end - M.start);
    const dirs = new Set(M.jumps.map(j => Math.sign(j.d)));
    const terms = dirs.size === 1 ? [M.total] : M.jumps.map(j => j.d);
    M.eqLeft = `${M.fu(M.start)} ${terms.map(d => `${d < 0 ? MINUS : '+'} ${M.fu(Math.abs(d))}`).join(' ')}`;
    M.eq = `${M.eqLeft} = ${M.fu(M.end)}`;
  }
  M.stepWords = () => {
    if (M.frac) { const p = M.parts(M.step); if (p && !p.whole && p.n === 1 && DEN_WORDS[p.d]) return DEN_WORDS[p.d][1]; return `steps of ${M.fmt(M.step)}`; }
    return COUNT_WORDS[M.step] || `steps of ${M.fmt(M.step)}`;
  };
  return M;
}

// rough width of a highlighted number at label size (no DOM in validate)
const estW = (M, v) => { const p = M.parts(v); if (!p || !p.n) return M.fmt(v).length * 23; return (Math.max(String(p.n).length, String(p.d).length) + (p.whole ? String(p.whole).length + .5 : 0) + (p.neg ? 1 : 0)) * 23; };
const X0 = 96, X1 = 1184, LY = 430;
/* Arc heights for a run of jumps (spans [a, b] in slide x). A jump over a stretch no other jump covers
   keeps its natural height. Jumps that share a stretch take tiers (40, 110, 180), narrowest first, the lowest
   that clears every earlier arc there by 70, so their labels never sit on each other; a fourth over the
   same stretch has no tier left (clear: false). Shared by validate(), which refuses that, and render(). */
const TIERS = [40, 110, 180];
function arcLifts(spans) {
  const S = spans.map(([a, b]) => ({ xa: Math.min(a, b), xb: Math.max(a, b) }));
  const meets = (p, q) => p.xa < q.xb - 1 && q.xa < p.xb - 1;
  // narrowest first, so a short jump nests under a longer one over the same numbers: its legs then stay
  // below the longer jump's label instead of running through it
  const out = [], order = S.map((_, i) => i).sort((p, q) => (S[p].xb - S[p].xa) - (S[q].xb - S[q].xa) || p - q);
  for (const i of order) {
    const sp = S[i];
    if (!S.some((q, j) => j !== i && meets(q, sp))) { out[i] = { lift: clamp((sp.xb - sp.xa) * .45, 56, 150), clear: true }; continue; }
    const near = out.filter((q, j) => q && meets(S[j], sp));
    const t = TIERS.find(L => near.every(q => Math.abs(q.lift - L) >= 70));
    out[i] = { lift: t ?? TIERS[TIERS.length - 1], clear: t != null };
  }
  return out;
}
// a decimal the line can show exactly: at most 3 places once worked out (1/3 = 0.333… never ends)
const exact3 = v => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-7;
const ENDLESS = (r, fix3) => `${r.raw} is ${fmtNum(Math.trunc(r.v * 1000) / 1000)}…, which never ends. ${fix3 ? 'Use a decimal with 3 places at most.' : 'Use a fractions line instead.'}`;
const xOf = (M, v) => X0 + (v - M.from) / (M.to - M.from) * (X1 - X0);

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const W = [];
  if (R.length) return result(R);
  const task = P.task, nt = P.numberType;
  const num = (path, s) => { const r = parseNum(s); if (r.error) R.push({ path, reason: r.error }); return r; };
  const dp3 = (path, r) => { if (r.dp > 3) R.push({ path, reason: `${r.raw} has more than 3 decimal places, too fine to show on one line. Use at most 3.` }); };

  if (task === 'round') {
    const v = num('round.value', P.round.value); if (R.length) return result(R);
    dp3('round.value', v); const r = +P.round.to;
    if (!R.length && !exact3(v.v)) R.push({ path: 'round.value', reason: ENDLESS(v, true) });
    if (R.length) return result(R);
    if (v.v < 0) R.push({ path: 'round.value', reason: 'Use a positive number. Primary rounding stays above zero, where “halfway rounds up” is clear.' });
    else if (isMult(v.v, r)) R.push({ path: 'round.value', reason: `${fmtNum(v.v)} is already a multiple of ${fmtNum(r)}, so there is nothing to round. Pick a number between two multiples.` });
    else if (v.v / r > 99999) R.push({ path: 'round.to', reason: `${fmtNum(v.v)} is very large next to ${fmtNum(r)}. Round to a bigger place value.` });
    else if (r < 1 && v.dp > 2) R.push({ path: 'round.value', reason: `To round to the nearest tenth, use a number with 2 decimal places at most, like 3.47.` });
    if (R.length) return result(R, W);
    // a value close to halfway or to a multiple gets its own label row in render(), so it is never refused
    return result(R, W);
  }

  const from = num('from', P.from), to = num('to', P.to), st = num('step', P.step);
  const J = task === 'position' ? [] : (P.jumps || []).map((j, i) => [num(`jumps.${i}.from`, j.from), num(`jumps.${i}.to`, j.to)]);
  // jumps after the first start where the last one landed, whatever their own start says (a warning below)
  for (let i = 1; i < J.length; i++) if (!J[i][0].error && !J[i - 1][1].error && Math.abs(J[i][0].v - J[i - 1][1].v) > 1e-9) {
    W.push({ path: `jumps.${i}.from`, reason: `Jump ${i + 1} starts where jump ${i} landed, on ${J[i - 1][1].raw}, so the slide uses that instead of ${J[i][0].raw}.` });
    J[i][0] = Object.assign({}, J[i - 1][1]);
  }
  const K = task === 'position' ? (P.marks || []).map((m, i) => num(`marks.${i}.value`, m.value)) : [];
  if (R.length) return result(R);
  [['from', from], ['to', to], ['step', st]].forEach(([p, r]) => dp3(p, r));
  J.forEach(([a, b], i) => { dp3(`jumps.${i}.from`, a); dp3(`jumps.${i}.to`, b); });
  K.forEach((r, i) => dp3(`marks.${i}.value`, r));
  if (R.length) return result(R);
  if (nt !== 'fraction') {
    const all = [['from', from], ['to', to], ['step', st], ...J.flatMap(([a, b], i) => [[`jumps.${i}.from`, a], [`jumps.${i}.to`, b]]), ...K.map((r, i) => [`marks.${i}.value`, r])];
    for (const [p, r] of all) if (!exact3(r.v)) { R.push({ path: p, reason: ENDLESS(r) }); break; }
    if (R.length) return result(R);
  }
  if (to.v <= from.v) return result([{ path: 'to', reason: `The line has to end on a bigger number than it starts: ${to.raw} is not more than ${from.raw}.` }]);
  if (st.v <= 0) return result([{ path: 'step', reason: 'Each space has to be worth more than 0.' }]);
  if (Math.max(Math.abs(from.v), Math.abs(to.v)) > 10000000) return result([{ path: 'to', reason: 'Keep the line within ten million either side of 0.' }]);

  if (nt === 'integer') {
    const all = [['from', from], ['to', to], ['step', st], ...J.flatMap(([a, b], i) => [[`jumps.${i}.from`, a], [`jumps.${i}.to`, b]]), ...K.map((r, i) => [`marks.${i}.value`, r])];
    for (const [p, r] of all) if (!Number.isInteger(r.v)) { R.push({ path: p, reason: `${r.raw} is not a whole number, but the line is set to whole numbers. Change “Kind of numbers” to decimals or fractions.` }); break; }
  }
  if (nt === 'fraction' && !st.d) R.push({ path: 'step', reason: 'A fractions line counts in a fraction, such as 1/4 or 1/3. Write the step as a fraction, or choose whole numbers or decimals.' });
  else if (nt === 'fraction' && st.d > 12) R.push({ path: 'step', reason: `${st.raw} cuts each whole into ${st.d} parts, too many to read. Use twelfths or bigger, or use decimals.` });
  if (R.length) return result(R);

  const n = (to.v - from.v) / st.v;
  if (!isMult(to.v - from.v, st.v)) return result([{ path: 'step', reason: `Spaces of ${st.raw} do not fit exactly between ${from.raw} and ${to.raw}: the last space would be a different size. Choose a step that divides ${fmtNum(fix(to.v - from.v))}, or move an end.` }]);
  if (Math.round(n) > 40) return result([{ path: 'step', reason: `That makes ${Math.round(n)} spaces, too many to tell apart from the back of the room. Use a bigger step or a shorter line (40 spaces at most).` }]);
  if (Math.round(n) < 2) return result([{ path: 'step', reason: 'The line needs at least 2 spaces to show a step. Use a smaller step or a longer line.' }]);
  if (from.v < 0 && to.v > 0 && !isMult(0 - from.v, st.v)) R.push({ path: 'from', reason: `0 has to sit on a tick when the line crosses zero. Starting at ${from.raw} in steps of ${st.raw} misses it.` });
  if (task === 'negatives' && from.v >= 0) R.push({ path: 'from', reason: 'To show negative numbers, start the line below 0, like −10.' });

  const inR = v => v >= from.v - 1e-9 && v <= to.v + 1e-9;
  const pxPer = (X1 - X0) / (to.v - from.v);
  if (task !== 'position') {
    // no jumps yet (just switched from rounding or finding a number): the line shows on its own
    if (!J.length) W.push({ path: 'jumps', reason: 'Add a jump to count with. Until then the slide shows the line on its own.' });
    J.forEach(([a, b], i) => {
      if (!inR(a.v)) R.push({ path: `jumps.${i}.from`, reason: `${a.raw} is off the line (${from.raw} to ${to.raw}). Move the jump or widen the line.` });
      else if (!inR(b.v)) R.push({ path: `jumps.${i}.to`, reason: `${b.raw} is off the line (${from.raw} to ${to.raw}). Move the jump or widen the line.` });
      else if (Math.abs(a.v - b.v) < 1e-9) W.push({ path: `jumps.${i}.to`, reason: `Jump ${i + 1} starts and lands on ${b.raw}, so it does not move. The slide leaves it out.` });
      else if (Math.abs(b.v - a.v) * pxPer < 40) R.push({ path: `jumps.${i}.to`, reason: `The jump from ${a.raw} to ${b.raw} is too small to see on a line from ${from.raw} to ${to.raw}. Use a shorter line.` });
      // the jumps decide the direction drawn, so switching task never locks against them: a mismatch is a warning
      else if (task === 'count-on' && b.v < a.v) W.push({ path: `jumps.${i}.to`, reason: `Jump ${i + 1} goes back, from ${a.raw} to ${b.raw}, so the slide counts back there. Land it on a bigger number to count on.` });
      else if (task === 'count-back' && b.v > a.v) W.push({ path: `jumps.${i}.to`, reason: `Jump ${i + 1} goes forwards, from ${a.raw} to ${b.raw}, so the slide counts on there. Land it on a smaller number to count back.` });
    });
    // jumps that go back over the same stretch again and again stack their arcs; past three deep the arcs and
    // their labels would sit on each other, so the slide refuses rather than draw a tangle
    if (!R.length) {
      const S0 = v => X0 + (v - from.v) * pxPer, moving = J.map((j, i) => [j, i]).filter(([[a, b]]) => Math.abs(a.v - b.v) > 1e-9);
      const lifts = arcLifts(moving.map(([[a, b]]) => [S0(a.v), S0(b.v)]));
      moving.forEach(([, i], n) => { if (!lifts[n].clear)
        R.push({ path: `jumps.${i}.to`, reason: `Jump ${i + 1} goes over numbers that three other jumps already cover, so the arcs would pile up and hide each other. Use at most three jumps over any stretch, or split them across two slides.` }); });
    }
  } else {
    if (!K.length) W.push({ path: 'marks', reason: 'Add a number to find. Until then the slide shows the line on its own.' });
    K.forEach((r, i) => { if (!inR(r.v)) R.push({ path: `marks.${i}.value`, reason: `${r.raw} is off the line (${from.raw} to ${to.raw}). Change the number or widen the line.` });
      else if (K.slice(0, i).some(q => Math.abs(q.v - r.v) < 1e-9)) R.push({ path: `marks.${i}.value`, reason: `${r.raw} is already on the list.` }); });
  }
  if (R.length) return result(R, W);
  // highlighted numbers share the label row: they must not touch
  const M = model(P);
  const hi = [];
  if (from.v < 0 && to.v > 0) hi.push({ v: 0, path: 'from' });
  if (M.jumps.length) hi.push({ v: M.start, path: 'jumps.0.from' }, { v: M.end, path: `jumps.${M.jumps.length - 1}.to` });
  M.marks.forEach(m => hi.push({ v: m.v, path: `marks.${m.i}.value` }));
  const u = hi.filter((q, i) => hi.findIndex(z => Math.abs(z.v - q.v) < 1e-9) === i).sort((a, b) => a.v - b.v);
  for (let i = 1; i < u.length; i++) {
    const gap = (xOf(M, u[i].v) - xOf(M, u[i - 1].v)) - (estW(M, u[i].v) + estW(M, u[i - 1].v)) / 2;
    if (gap < 28) { R.push({ path: u[i].path === 'from' ? u[i - 1].path : u[i].path, reason: `${M.fmt(u[i - 1].v)} and ${M.fmt(u[i].v)} are too close to label clearly on a line from ${from.raw} to ${to.raw}. Use a shorter line or numbers further apart.` }); break; }
  }
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
function plan(P) {
  P = withDefaults(params, P); // a task switched in the panel can leave settings this task needs unset
  const M = model(P); const f = M.fmt; const items = [];
  let summary;
  if (M.round) {
    const rw = ROUND_WORDS[M.r]; const plural = M.r === 1 ? 'whole numbers' : M.r < 1 ? 'tenths' : `multiples of ${rw}`;
    items.push({ key: 'scale', caption: `${f(M.lo)} and ${f(M.hi)} are the ${plural} either side. Each space is ${f(M.step)}.` });
    items.push({ key: 'value', caption: `${f(M.value)} sits here, between ${f(M.lo)} and ${f(M.hi)}.` });
    items.push({ key: 'halfway', caption: `Halfway between ${f(M.lo)} and ${f(M.hi)} is ${f(M.half)}.` });
    const at = Math.abs(M.value - M.half) < 1e-9;
    items.push({ key: 'answer', caption: at ? `${f(M.value)} is exactly halfway, and halfway rounds up: ${f(M.hi)}.`
      : M.ans === M.hi ? `${f(M.value)} is past halfway, so it rounds up to ${f(M.hi)}.` : `${f(M.value)} is before halfway, so it rounds down to ${f(M.lo)}.` });
    summary = `${f(M.value)} rounded to the nearest ${rw} is ${f(M.ans)}.`;
  } else {
    const neg = M.from < 0;
    const stillNote = !M.still.length ? '' : M.still.length === 1 ? ` Jump ${M.still[0].i + 1} stays on ${M.fu(M.still[0].b)}, so it is left out.` : ` Jumps ${M.still.map(j => j.i + 1).join(' and ')} do not move, so they are left out.`;
    items.push({ key: 'scale', caption: (neg ? `Numbers below zero go to the left of 0. The line counts in ${M.stepWords()}.` : `The line counts in ${M.stepWords()} from ${f(M.from)} to ${f(M.to)}. Every space is the same size.`) + (M.jumps.length ? '' : stillNote) });
    if (M.position) M.marks.forEach(m => {
      const k = (m.v - M.from) / M.step, on = isMult(m.v - M.from, M.step);
      items.push({ key: `mark:${m.i}`, caption: on ? `${f(m.v)} is ${Math.round(k)} ${Math.round(k) === 1 ? 'space' : 'spaces'} on from ${f(M.from)}.` : `${f(m.v)} sits between ${f(M.from + Math.floor(k) * M.step)} and ${f(M.from + Math.ceil(k) * M.step)}.` });
    });
    else if (M.jumps.length) {
      // the jumps decide the direction drawn; when they disagree with the task, the slide says so
      const want = M.task === 'count-on' ? 1 : M.task === 'count-back' ? -1 : 0;
      const odd = want ? M.jumps.filter(j => Math.sign(j.d) !== want) : [];
      const cue = !odd.length ? '' : odd.length === M.jumps.length ? ` These jumps go ${want > 0 ? 'back' : 'forwards'}, so this counts ${want > 0 ? 'back' : 'on'}.`
        : ` Jump ${odd[0].i + 1} goes ${want > 0 ? 'back' : 'forwards'}, the other way.`;
      items.push({ key: 'start', caption: `Start at ${M.fu(M.start)}.${cue}` });
      M.jumps.forEach((j, q) => { const on = j.d > 0, sz = M.fu(Math.abs(j.d)), to = M.fu(j.b);
        // a jump typed from somewhere else starts where the last one landed: the caption says so
        const moved = q > 0 && !j.typedFrom.error && Math.abs(j.typedFrom.v - j.a) > 1e-9;
        items.push({ key: `jump:${j.i}`, caption: q === 0 ? `${on ? 'Count on' : 'Count back'} ${sz}, ${on ? 'up' : 'down'} to ${to}.`
          : moved ? `Then count ${on ? 'on' : 'back'} ${sz} more, from ${M.fu(j.a)} where the last jump landed, to ${to}.` : `Then count ${on ? 'on' : 'back'} ${sz} more, to ${to}.` }); });
      items.push({ key: 'answer', caption: `So ${M.eq}.${stillNote}` });
    }
    summary = !M.position && !M.jumps.length ? `The line counts in ${M.stepWords()} from ${f(M.from)} to ${f(M.to)}.${stillNote}` : M.position ? (M.marks.length === 1 ? `${f(M.marks[0].v)} has one true place on the line.` : 'Equal spaces mean every number has one true place on the line.') : `${M.eq}.`;
  }
  return { M, items, summary };
}
export function builds(P) { const { items, summary } = plan(P); return { steps: items.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }

export function notes(P) {
  const { M, items } = plan(P); const f = M.fmt;
  const steps = items.map(it => {
    if (it.key === 'scale') {
      if (M.round) return `Each space is ${f(M.step)}. Ask: which two ${M.r === 1 ? 'whole numbers' : M.r < 1 ? 'tenths' : `multiples of ${ROUND_WORDS[M.r]}`} is ${f(M.value)} between?`;
      return `Ask what one space is worth before anything moves: count the spaces between two numbers you know.${M.from < 0 ? ' Below zero, numbers get smaller as you go left, so −6 is less than −2.' : ''}${M.frac ? ' Each whole is cut into equal parts; the bottom number says how many.' : ''}`;
    }
    if (it.key === 'value') return `Ask: is ${f(M.value)} nearer to ${f(M.lo)} or to ${f(M.hi)}?`;
    if (it.key === 'halfway') return `The halfway number is the deciding line. By convention, a number exactly on halfway rounds up.`;
    if (it.key === 'answer' && M.round) return `${f(M.value)} is ${f(fix(Math.abs(M.hi - M.value)))} from ${f(M.hi)} and ${f(fix(Math.abs(M.value - M.lo)))} from ${f(M.lo)}.`;
    if (it.key === 'start') return 'Put a finger on the start. Count the jumps, not the tick you start on.';
    if (it.key.startsWith('jump:')) {
      const j = M.jumps.find(z => z.i === +it.key.slice(5));
      if (j.b === 0 || j.a === 0) return `Using 0 as a stepping stone splits the jump into two easier parts.`;
      return `The jump is ${M.signed(j.d)}: count the spaces it covers, not the lines.`;
    }
    if (it.key === 'answer') { const inv = `${M.fu(M.end)} ${M.total > 0 ? MINUS : '+'} ${M.fu(Math.abs(M.total))} = ${M.fu(M.start)}`; return `Check by doing the inverse: ${inv}.`; }
    if (it.key.startsWith('mark:')) { const m = M.marks[+it.key.slice(5)]; return isMult(m.v - M.from, M.step) ? `Count the spaces from ${f(M.from)}, one ${M.frac && M.parts(M.step) && M.parts(M.step).n === 1 && DEN_WORDS[M.parts(M.step).d] ? DEN_WORDS[M.parts(M.step).d][0] : 'step'} at a time.` : `It is not on a tick, so estimate: which tick is it nearer to?`; }
    return '';
  });
  return { steps, summary: M.round ? 'Ask for another number that rounds to the same answer, and one that does not.' : M.position ? 'Ask: what number is halfway between two of these?' : 'Ask the class to tell the story of the jumps, then check with the inverse.' };
}

/* ------------------------------------------------------------------ render */
// A run of letters wider than the box (no spaces to wrap at) is split with hyphens, so it wraps
// like any other words instead of being cut short with "…".
function breakLong(root, s, cls, maxW) {
  return String(s).split(' ').map(w => {
    if (!w || measure(root, w, cls) <= maxW) return w;
    const out = []; let cur = '';
    for (const ch of w) { if (cur && measure(root, `${cur}${ch}-`, cls) > maxW) { out.push(`${cur}-`); cur = ch; } else cur += ch; }
    out.push(cur); return out.join(' ');
  }).join(' ');
}

export function render(root, P, ctx) {
  P = withDefaults(params, P);
  const { M } = plan(P); const b = ctx.b, N = ctx.N; const bi = k => b[k] ?? 0;
  const bg = h('g', {}, root); // tinted regions sit under everything
  const nl = numberLine(root, { from: M.from, to: M.to, step: M.step, x0: X0, x1: X1, y: LY, labels: 'none', s: 0 });
  const S = nl.S;
  // a heavier line, ticks and arrowheads, readable from the back of the room
  nl.g.querySelectorAll(':scope > line').forEach((l, i) => {
    if (i === 0) l.style.setProperty('stroke-width', 'var(--sw-data)');
    else { l.setAttribute('y1', LY - 22); l.setAttribute('y2', LY + 22); l.style.setProperty('stroke-width', 'var(--sw-struct)'); }
  });
  nl.g.querySelectorAll(':scope > path').forEach((pth, i) => { const tx = i === 0 ? X1 + 34 : X0 - 34; pth.setAttribute('transform', `translate(${tx} ${LY}) scale(1.6) translate(${-tx} ${-LY})`); });
  const TICK = { 'font-size': 'calc(var(--fs-min) * 1.5)' };
  const big = M.frac ? { num: 62, bar: 73, den: 110, one: 86, under: 146 } : { one: 66, under: 118 };
  const small = M.frac ? { num: 58, bar: 68, den: 99, one: 79 } : { one: 62 };

  // one number in the label row: plain text, or a stacked fraction (whole part to its left)
  const parts = v => { const p = M.parts(v); return p && p.n ? p : null; };
  const widthOf = (v, isBig) => {
    const cls = isBig ? 'ts-num' : 'ts-axis', a = isBig ? {} : TICK; const p = parts(v);
    if (!p) return measure(root, M.fmt(v), cls, a);
    const ws = p.whole || p.neg ? measure(root, (p.neg ? MINUS : '') + (p.whole || ''), cls, a) + 6 : 0;
    return ws + Math.max(measure(root, String(p.n), cls, a), measure(root, String(p.d), cls, a)) + 4;
  };
  const drawNum = (v, isBig, col, path, a, dy = 0) => {
    const g = h('g', a, root); const x = S(v); const cls = isBig ? 'ts-num' : 'ts-axis', st = isBig ? {} : TICK;
    const L0 = isBig ? big : small; const L = {}; for (const key in L0) L[key] = L0[key] + dy;
    const fill = col ? { fill: col } : {}; const p = parts(v); const w = widthOf(v, isBig);
    if (!p) { computed(T(g, x, LY + L.one, M.fmt(v), cls, Object.assign({ 'text-anchor': 'middle' }, st, fill)), path); }
    else {
      const left = x - w / 2; const wp = (p.neg ? MINUS : '') + (p.whole || '');
      const ww = wp ? measure(root, wp, cls, st) + 6 : 0; const fw = w - ww; const fx = left + ww + fw / 2;
      if (wp) computed(T(g, left, LY + L.one, wp, cls, Object.assign({ 'text-anchor': 'start' }, st, fill)), path);
      computed(T(g, fx, LY + L.num, String(p.n), cls, Object.assign({ 'text-anchor': 'middle' }, st, fill)), path);
      h('line', { x1: fx - fw / 2 + 2, x2: fx + fw / 2 - 2, y1: LY + L.bar, y2: LY + L.bar, stroke: col || 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)', 'stroke-linecap': 'round' }, g);
      computed(T(g, fx, LY + L.den, String(p.d), cls, Object.assign({ 'text-anchor': 'middle' }, st, fill)), path);
    }
    g.box = { x0: x - w / 2, x1: x + w / 2 };
    return g;
  };

  /* highlighted numbers: each appears at its build; the plain tick label under it gives way */
  const E = [];
  const crossesZero = M.from < 0 && M.to > 0;
  if (crossesZero) E.push({ v: 0, k: 0, col: 'var(--ink)', path: 'from' });
  if (M.round) {
    E.push({ v: M.lo, k: 0, col: 'var(--ink)', path: 'round.to' }, { v: M.hi, k: 0, col: 'var(--ink)', path: 'round.to' });
    E.push({ v: M.value, k: bi('value'), col: 'var(--focus-text)', path: 'round.value' });
    if (Math.abs(M.half - M.value) > 1e-9) E.push({ v: M.half, k: bi('halfway'), col: 'var(--compare-text)', path: 'round.to' });
    E.push({ v: M.ans, k: bi('answer'), col: 'var(--focus-text)', path: 'round.value' });
  }
  if (M.jumps.length) {
    E.push({ v: M.start, k: bi('start'), col: 'var(--ink)', path: 'jumps.0.from' });
    E.push({ v: M.end, k: bi('answer'), col: 'var(--focus-text)', path: `jumps.${M.jumps.length - 1}.to` });
  }
  M.marks.forEach(m => E.push({ v: m.v, k: bi(`mark:${m.i}`), col: 'var(--focus-text)', path: `marks.${m.i}.value`, mark: m }));
  E.forEach(e => { e.x0 = S(e.v) - widthOf(e.v, true) / 2; e.x1 = S(e.v) + widthOf(e.v, true) / 2; });
  // a later highlight of the same number replaces the earlier one at its build
  E.forEach((e, i) => { const later = E.filter((z, j) => j !== i && Math.abs(z.v - e.v) < 1e-9 && z.k > e.k).map(z => z.k); e.until = later.length ? Math.min(...later) : null; });
  const dupSame = (e, i) => E.some((z, j) => j < i && Math.abs(z.v - e.v) < 1e-9 && z.k === e.k);
  const live = E.filter((e, i) => !dupSame(e, i));
  const touch = (a, c) => Math.abs(a.v - c.v) > 1e-9 && a.k < (c.until ?? Infinity) && c.k < (a.until ?? Infinity) && a.x0 < c.x1 + 28 && c.x0 < a.x1 + 28;
  // rounding: a value close to halfway or to a multiple drops to a second label row instead of being refused
  const ROW = 52;
  live.forEach((e, i) => { e.row = 0; if (M.round) while (e.row < 2 && live.slice(0, i).some(c => c.row === e.row && touch(c, e))) e.row++; });
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], c = live[j];
    if (a.row === c.row && touch(a, c)) ctx.warn(`Highlighted numbers ${M.fmt(a.v)} and ${M.fmt(c.v)} would touch.`);
  }

  /* plain tick labels: thinned so neighbours keep 28 apart, ends kept */
  if (P.labels !== 'none') {
    const ticks = nl.ticks; const nT = ticks.length - 1; const ws = ticks.map(v => widthOf(v, false));
    const pick = every => { const idx = []; for (let i = 0; i <= nT; i++) if (P.labels === 'all' ? i % every === 0 : (i === 0 || i === nT || (M.frac && isMult(ticks[i], 1)))) idx.push(i); if (idx[idx.length - 1] !== nT) idx.push(nT); return idx; };
    const fits = idx => idx.every((i, q) => q === 0 || S(ticks[i]) - ws[i] / 2 - (S(ticks[idx[q - 1]]) + ws[idx[q - 1]] / 2) >= 28);
    let idx = null;
    for (const e of [1, 2, 4, 5, 10, 20, 25, 50]) { const c = pick(e); if (fits(c)) { idx = c; break; } const c2 = c.slice(); c2.splice(c2.length - 2, 1); if (c2.length > 1 && fits(c2) && c2.length > 2) { idx = c2; break; } }
    if (!idx) idx = [0, nT];
    // where a jump lands is always numbered: a thinned tick label next to it gives way (never an end)
    if (P.labels === 'all') for (const j of M.jumps) {
      const li = ticks.findIndex(v => Math.abs(v - j.b) < 1e-9); if (li < 0 || idx.includes(li)) continue;
      const clash = q => Math.abs(S(ticks[q]) - S(ticks[li])) < (ws[q] + ws[li]) / 2 + 28;
      const landed = new Set(M.jumps.map(z => z.b).concat(M.jumps.length ? [M.start] : []).map(v => ticks.findIndex(t => Math.abs(t - v) < 1e-9)));
      if (idx.some(q => clash(q) && (q === 0 || q === nT || landed.has(q)))) continue;
      idx = idx.filter(q => !clash(q)).concat(li).sort((p, q) => p - q);
    }
    for (const i of idx) {
      const v = ticks[i]; const x0 = S(v) - ws[i] / 2, x1 = S(v) + ws[i] / 2;
      // A plain label under a highlight of the same number gives way to it; a close neighbour gives way
      // too, but an end of the line never does: the learner always sees where the line starts and stops.
      // A highlight that would really overlap an end label drops to the second label row instead.
      const isEnd = i === 0 || i === nT;
      const same = e => Math.abs(e.v - v) < 1e-9;
      const hits = E.filter(e => same(e) || (!isEnd && e.x0 < x1 + 16 && x0 < e.x1 + 16));
      if (isEnd) for (const e of live) if (!same(e) && e.x0 < x1 + 8 && x0 < e.x1 + 8) e.row = Math.max(e.row, 1);
      if (hits.some(e => e.k === 0)) continue;
      const hide = hits.length ? Math.min(...hits.map(e => e.k)) : null;
      drawNum(v, false, null, 'step', { s: 0, hide });
    }
  }
  // zero stands taller so the two sides read at a glance
  if (crossesZero) h('line', { x1: S(0), x2: S(0), y1: LY - 40, y2: LY + 26, stroke: 'var(--ink)', 'stroke-width': 'var(--sw-data)', 'stroke-linecap': 'round', s: 0 }, root);

  /* one quiet, topic-fitting ground per line: flat tints, words in ink */
  const RY0 = LY - 196, RY1 = LY + 125 + (live.some(e => e.row) ? 30 : 0), RLY = LY - 164;
  // the tinted ground is drawn now; its words are placed last, once every other mark is on the slide
  const regs = [];
  const region = (x0, x1, fill, k, label, path, anchor) => {
    const g = h('g', { s: k, cls: k ? 'rise' : null }, bg);
    const rect = h('rect', { x: x0, y: RY0, width: x1 - x0, height: RY1 - RY0, fill }, g);
    if (label) regs.push({ g, rect, x0, x1, label, path, anchor: anchor || 'middle' });
  };
  if (crossesZero) {
    const temp = /°/.test(M.unit);
    region(X0 - 34, S(0), temp ? 'var(--sea-hi)' : 'var(--panel)', 0, txt(P, 'label:below', 'below zero'), 'text.label:below', 'start');
    if (temp) region(S(0), X1 + 34, 'var(--plate)', 0, txt(P, 'label:above', 'above zero'), 'text.label:above', 'end');
  } else if (M.round) {
    const kh = bi('halfway'), up = M.value >= M.half - 1e-9;
    region(S(M.lo), S(M.half), up ? 'var(--panel)' : 'var(--focus-pale)', kh, txt(P, 'label:closerLo', `closer to ${M.fmt(M.lo)}`), 'text.label:closerLo');
    region(S(M.half), S(M.hi), up ? 'var(--focus-pale)' : 'var(--panel)', kh, txt(P, 'label:closerHi', `closer to ${M.fmt(M.hi)}`), 'text.label:closerHi');
  } else if (M.frac) {
    const w0 = Math.ceil(M.from - 1e-9), w1 = Math.floor(M.to + 1e-9);
    if (w1 - w0 >= 1 && w1 - w0 <= 4) for (let w = w0; w < w1; w++) region(S(w), S(w + 1), (w - w0) % 2 ? 'var(--panel)' : 'var(--plate)', 0, txt(P, 'label:whole', 'one whole'), 'text.label:whole');
  } else if (M.jumps.length) {
    region(Math.min(S(M.start), S(M.end)), Math.max(S(M.start), S(M.end)), 'var(--focus-pale)', bi('answer'), null);
  }

  /* rounding: the halfway line, then the arc to the nearest multiple */
  if (M.round) {
    const kh = bi('halfway');
    const hg = h('g', { s: kh, cls: 'rise' }, root);
    const hx = S(M.half);
    h('line', { x1: hx, x2: hx, y1: LY - 128, y2: LY + 22, stroke: 'var(--compare)', 'stroke-width': 'var(--sw-struct)', 'stroke-dasharray': '6 6' }, hg);
    // a value a hair from its answer (301 to 300) gets no arc: it would only be a loop on the spot
    let arcBox = null;
    if (Math.abs(S(M.ans) - S(M.value)) >= 40) {
      const lift = clamp(Math.abs(S(M.ans) - S(M.value)) * .45, 56, 150);
      nl.jump(M.value, M.ans, null, { s: bi('answer'), col: 'var(--focus)', lift });
      arcBox = { x0: Math.min(S(M.value), S(M.ans)) - 6, x1: Math.max(S(M.value), S(M.ans)) + 6, y0: LY - 18 - lift * .75 - 6, y1: LY };
    }
    // The word sits at label size, like the other words on the line. A short one stands centred on top of
    // the dashed line; a longer one, or one that would meet the arc, stands beside the dashed line on the
    // side the arc is not on (the arc always stays on one side of halfway), wrapping upwards.
    const hOpt = { cls: 'ts-small', lh: 28, a: { fill: 'var(--compare-text)', cls: 'strong halo' }, edit: 'text.label:halfway' };
    const hWord = breakLong(root, txt(P, 'label:halfway', 'halfway'), 'ts-small', 480);
    const meetsArc = bx => arcBox && bx.x < arcBox.x1 + 12 && arcBox.x0 < bx.x + bx.width + 12 && bx.y < arcBox.y1 && arcBox.y0 < bx.y + bx.height + 8;
    let tb = textBlock(hg, hx, LY - 140, hWord, Object.assign({ maxW: 220, maxLines: 1, anchor: 'middle' }, hOpt));
    if (tb.lines.length !== 1 || /…$/.test(tb.lines[0]) || tb.cls !== 'ts-small' || meetsArc(tb.el.getBBox())) {
      tb.el.remove();
      const right = M.ans === M.lo; // rounds down: the arc is on the left, so the words go right
      const x = right ? hx + 14 : hx - 14, room = right ? S(M.hi) - 18 - x : x - (S(M.lo) + 18);
      tb = textBlock(hg, x, LY - 88, hWord, Object.assign({ maxW: room, maxLines: 4, anchor: right ? 'start' : 'end' }, hOpt));
      if (tb.lines.length > 1) tb.el.setAttribute('y', LY - 88 - (tb.lines.length - 1) * tb.lh);
    }
  }
  /* jumps: each its own build; the size is the true difference */
  const lifts = arcLifts(M.jumps.map(j => [S(j.a), S(j.b)]));
  for (const [n, j] of M.jumps.entries()) {
    const k = bi(`jump:${j.i}`);
    const { lift } = lifts[n];
    const jr = nl.jump(j.a, j.b, M.signed(j.d), { s: k, col: 'var(--focus)', computedPath: `jumps.${j.i}.to`, lift });
    // a jump label never straddles the edge between the two tints at zero: it slides to one side, inside its arc
    if (crossesZero && jr.label) {
      const w = jr.label.getComputedTextLength(), cx = (S(j.a) + S(j.b)) / 2, z = S(0);
      if (cx - w / 2 - 10 < z && z < cx + w / 2 + 10) jr.label.setAttribute('x', cx < z ? z - w / 2 - 12 : z + w / 2 + 12);
    }
    // once the next jump (or the answer) arrives, this one turns grey: it stays readable but stops competing
    jr.g.dataset.h = k + 1;
    const gr = jr.g.cloneNode(true); jr.g.after(gr); gr.dataset.s = k + 1; delete gr.dataset.h;
    gr.querySelectorAll('[data-s]').forEach(e => { e.dataset.s = k + 1; e.style.removeProperty('--d'); });
    gr.querySelectorAll('.draw').forEach(e => e.classList.remove('draw'));
    gr.querySelectorAll('path').forEach(e => { if (e.style.stroke) e.style.setProperty('stroke', 'var(--ink-3)'); if (e.style.fill) e.style.setProperty('fill', 'var(--ink-3)'); });
    gr.querySelectorAll('text').forEach(e => { e.style.setProperty('fill', 'var(--ink-2)'); e.style.removeProperty('--d'); });
  }

  /* highlighted numbers and their dots */
  for (const e of live) {
    const a = { s: e.k, cls: e.k ? 'pop' : null, hide: e.until };
    drawNum(e.v, true, e.col, e.path, a, e.row * ROW);
  }
  const dot = (v, k, col, extra) => h('circle', Object.assign({ cx: S(v), cy: LY, r: 16, fill: col, stroke: 'var(--bg)', 'stroke-width': 'var(--sw-rule)', s: k, cls: 'pop' }, extra || {}), root);
  if (M.jumps.length) { dot(M.start, bi('start'), 'var(--ink)'); dot(M.end, bi('answer'), 'var(--focus)'); }
  if (M.round) dot(M.value, bi('value'), 'var(--focus)');

  /* words for a number to find. Each label stands right next to its own number: under it, or just
     above its dot. All labels share one size, tried from roomy (2 lines) to compact (3-4 lines at the
     minimum size) until every label has its own spot next to its mark. Only if none fits does a label
     stack further up, joined to its dot by a leader line that crosses no other words. */
  const placed = [], leads = [];
  const SLOT_GAP = 28, BOT = 640, TOP = 160, ABOVE = LY - 34;
  const hitBox = (box, list, gx, gy) => list.some(q => q.x0 < box.x1 + gx && box.x0 < q.x1 + gx && q.y0 < box.y1 + gy && box.y0 < q.y1 + gy);
  const words = M.marks.filter(m => m.label);
  const slotFor = (m, opt, which) => {
    const text = breakLong(root, m.label, opt.cls, opt.maxW - 4);
    const tmp = h('g', {}, root); const tb = textBlock(tmp, 0, 0, text, opt); const bx = tb.el.getBBox(); tmp.remove();
    if (/…$/.test(tb.lines[tb.lines.length - 1] || '') && !/…$/.test(text.trim())) return null;
    const cx = clamp(S(m.v), 64 + tb.w / 2, 1216 - tb.w / 2);
    const y = which === 'under' ? LY + big.under : which === 'under2' ? LY + big.under + 64 : ABOVE - which * 64 - (bx.y + bx.height);
    const box = { x0: cx - tb.w / 2, x1: cx + tb.w / 2, y0: y + bx.y, y1: y + bx.y + bx.height };
    if (box.y1 > BOT || box.y0 < TOP || hitBox(box, placed, SLOT_GAP, 6)) return null;
    // a stacked label needs a clear path for its leader, and must not sit on another one
    const lead = typeof which === 'number' && which > 0 ? { x0: S(m.v) - 3, x1: S(m.v) + 3, y0: box.y1 + 4, y1: LY - 20 } : null;
    if (hitBox(box, leads, 8, 0) || (lead && hitBox(lead, placed, 8, 4))) return null;
    return { cx, y, box, lead, opt, text };
  };
  const base = { cls: 'ts-small', lh: 28, anchor: 'middle', a: { fill: 'var(--focus-text)' } };
  const LEVELS = [{ maxW: 380, maxLines: 2 }, { maxW: 300, maxLines: 3 }, { maxW: 244, maxLines: 3 }, { maxW: 244, maxLines: 3, cls: 'ts-tiny', lh: 26 }, { maxW: 200, maxLines: 4, cls: 'ts-tiny', lh: 26 }, { maxW: 520, maxLines: 4, cls: 'ts-tiny', lh: 26 }]
    .map(o => Object.assign({}, base, o));
  const commit = (m, spot) => { placed.push(spot.box); if (spot.lead) leads.push(spot.lead); m.spot = spot; };
  let ok = false;
  for (const opt of LEVELS) {
    placed.length = 0; leads.length = 0; ok = true;
    for (const m of words) { const sp = slotFor(m, opt, 'under') || slotFor(m, opt, 0); if (!sp) { ok = false; break; } commit(m, sp); }
    if (ok) break;
  }
  if (!ok) { // no shared size fits side by side: each label takes the roomiest free spot, stacking with a leader
    placed.length = 0; leads.length = 0;
    for (const m of words) {
      let sp = null;
      for (const opt of LEVELS) { for (const w of ['under', 0, 1, 2, 'under2']) { sp = slotFor(m, opt, w); if (sp) break; } if (sp) break; }
      if (!sp) { // nowhere free: the smallest size, cut short, under the line
        ctx.warn(`No room for the words “${m.label}”.`);
        sp = { cx: clamp(S(m.v), 64 + 150, 1216 - 150), y: LY + big.under, box: { x0: 0, x1: 0, y0: 0, y1: 0 }, lead: null, text: m.label, opt: Object.assign({}, base, { cls: 'ts-tiny', maxW: 300, maxLines: 2 }) };
      }
      commit(m, sp);
    }
  }
  for (const m of M.marks) dot(m.v, bi(`mark:${m.i}`), 'var(--focus)');
  for (const m of words) {
    const g = h('g', { s: bi(`mark:${m.i}`), cls: 'rise' }, root);
    const sp = m.spot;
    if (sp.lead) h('line', { x1: S(m.v), x2: S(m.v), y1: LY - 20, y2: sp.box.y1 + 6, stroke: 'var(--focus)', 'stroke-width': 'var(--sw-rule)', 'stroke-linecap': 'round' }, g);
    textBlock(g, sp.cx, sp.y, sp.text, Object.assign({}, sp.opt, { edit: `marks.${m.i}.label` }));
  }

  /* the result, written as a number sentence, above the line */
  // pieces: [text, colour, edit path | null, computed path | null]; laid out left to right, centred
  const sentence = M.round ? [[M.fmt(M.value), 'var(--ink)', null, 'round.value'], [txt(P, 'label:roundsTo', 'rounds to'), 'var(--ink-2)', 'text.label:roundsTo', null], [M.fmt(M.ans), 'var(--focus-text)', null, 'round.to']]
    : M.jumps.length ? [[M.eqLeft, 'var(--ink)', null, 'jumps'], ['=', 'var(--ink)', null, 'jumps'], [M.fu(M.end), 'var(--focus-text)', null, `jumps.${M.jumps.length - 1}.to`]] : null;
  let sentG = null;
  if (sentence) sentG = drawSentence(root, sentence, h('g', { s: bi('answer'), cls: 'rise' }, root), ctx);

  /* words on the tinted grounds: wrap, then shrink, then move to a free spot; the ground grows to hold them */
  placeRegionLabels(root, bg, regs, sentG, ctx, RY0, RY1, RLY);
  return {};
}

// One number sentence, centred at y 182: one line at the biggest size that fits; else the teacher's
// words wrap beside the numbers; else the terms wrap onto up to 3 lines. Never leaves the grid.
function drawSentence(root, pieces, g, ctx) {
  const sp = 22, SY = 182, MAXW = 1120;
  const put = (x, y, s, cls, col, ed, cp) => { const t = T(g, x, y, s, cls, { fill: col }); if (ed) editable(t, ed); else computed(t, cp); return t; };
  for (const cls of ['ts-eq', 'ts-num', 'ts-label']) {
    const ws = pieces.map(p => measure(root, p[0], cls)); const tot = ws.reduce((a, c) => a + c, 0) + sp * (ws.length - 1);
    if (tot > MAXW) continue;
    let x = 640 - tot / 2; pieces.forEach(([s, col, ed, cp], i) => { put(x, SY, s, cls, col, ed, cp); x += ws[i] + sp; });
    return g;
  }
  const cls = 'ts-label', wi = pieces.findIndex(p => p[2]);
  if (wi >= 0) {
    const ws = pieces.map((p, i) => i === wi ? 0 : measure(root, p[0], cls)); const others = ws.reduce((a, c) => a + c, 0) + sp * (ws.length - 1);
    if (others < MAXW - 200) {
      const opt = { cls, maxW: MAXW - others, maxLines: 2, lh: 32, anchor: 'start', a: { fill: pieces[wi][1] }, edit: pieces[wi][2] };
      const tmp = h('g', {}, root); const m = textBlock(tmp, 0, 0, pieces[wi][0], opt); tmp.remove();
      ws[wi] = m.w; let x = 640 - (others + m.w) / 2;
      pieces.forEach(([s, col, ed, cp], i) => {
        if (i === wi) { const tb = textBlock(g, x, SY, s, opt); tb.el.setAttribute('y', SY - (tb.lines.length - 1) * tb.lh / 2); }
        else put(x, SY, s, cls, col, ed, cp);
        x += ws[i] + sp;
      });
      return g;
    }
  }
  // computed terms only: split at each + or − and wrap the terms
  const toks = [];
  pieces.forEach(([s, col, ed, cp]) => String(s).split(/ (?=[+−=] )/).forEach(t => toks.push([t, col, ed, cp])));
  for (const c of ['ts-label', 'ts-small']) {
    const ws = toks.map(t => measure(root, t[0], c)); const rows = [[]]; let w = 0;
    toks.forEach((t, i) => { if (rows[rows.length - 1].length && w + sp + ws[i] > MAXW) { rows.push([]); w = 0; } w += (rows[rows.length - 1].length ? sp : 0) + ws[i]; rows[rows.length - 1].push(i); });
    if (rows.length > 3 && c !== 'ts-small') continue;
    if (rows.length > 3) ctx.warn('The number sentence is too long for three lines.');
    const lh = c === 'ts-label' ? 36 : 30; const y0 = SY + 18 - (rows.length - 1) * lh;
    rows.forEach((r, ri) => { const tw = r.reduce((a, i) => a + ws[i], 0) + sp * (r.length - 1); let x = 640 - tw / 2;
      r.forEach(i => { const [s, col, ed, cp] = toks[i]; put(x, y0 + ri * lh, s, c, col, ed, cp); x += ws[i] + sp; }); });
    return g;
  }
  return g;
}

// Words on a tinted ground. Tried in order: the usual spot (bottom line on the label row, extra lines
// growing upwards), the widest free gap on that row, higher up, then below the numbers. Each try wraps
// first, then shrinks to the minimum size. The ground grows to hold the words it carries.
function placeRegionLabels(root, bg, regs, sentG, ctx, RY0, RY1, RLY) {
  if (!regs.length) return;
  const bb = el => { const b = el.getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
  const obst = [], texts = [];
  root.querySelectorAll('text, path, circle, rect, line').forEach(el => {
    if (bg.contains(el) || el.closest('defs')) return; const b = bb(el); if (!b.w && !b.h) return;
    obst.push(b); if (el.tagName === 'text') texts.push(b);
  });
  const sb = sentG && sentG.childNodes.length ? bb(sentG) : null;
  const minTop = sb ? sb.y + sb.h + 14 : 150, maxBot = 628;
  const GX = 22, GY = 8, PAD = 18;
  const hit = b => obst.some(o => b.x < o.x + o.w + GX && o.x < b.x + b.w + GX && b.y < o.y + o.h + GY && o.y < b.y + b.h + GY);
  // where a ground grows, it may only take in whole texts: none may end up half on it
  const inside = (t, r) => t.x >= r.x && t.x + t.w <= r.x + r.w && t.y >= r.y && t.y + t.h <= r.y + r.h;
  const meets = (t, r) => t.x < r.x + r.w && r.x < t.x + t.w && t.y < r.y + r.h && r.y < t.y + t.h;
  const groundOK = r => [{ x: r.x, y: r.y, w: r.w, h: RY0 - r.y }, { x: r.x, y: RY1, w: r.w, h: r.y + r.h - RY1 }]
    .every(strip => strip.h <= 0 || texts.every(t => !meets(t, strip) || inside(t, r)));
  for (const R of regs) {
    const label = breakLong(root, R.label, 'ts-small', 220);
    const spans = [[R.x0 + PAD, R.x1 - PAD]];
    // free gaps on the label row between marks already there
    const row = obst.filter(o => o.y < RLY + 12 && o.y + o.h > RLY - 60 && o.x < R.x1 && o.x + o.w > R.x0).sort((a, b) => a.x - b.x);
    let cur = R.x0 + PAD; for (const o of row) { if (o.x - GX - cur > 120) spans.push([cur, o.x - GX]); cur = Math.max(cur, o.x + o.w + GX); }
    if (R.x1 - PAD - cur > 120) spans.push([cur, R.x1 - PAD]);
    spans.sort((a, b) => (b === spans[0]) - (a === spans[0]) || (b[1] - b[0]) - (a[1] - a[0]));
    // two lines anywhere first, then three, and only then one line cut short with “…”
    const tries = [];
    for (const [maxLines, allowCut] of [[2, false], [3, false], [1, true]]) {
      for (const sp of spans) tries.push({ sp, base: RLY, up: true, maxLines, allowCut });
      for (const sp of spans) for (let y = RLY - 6; y >= minTop + 20; y -= 6) tries.push({ sp, base: y, up: true, maxLines, allowCut });
      for (const sp of spans) for (let y = RY1 - 26; y <= maxBot - 4; y += 6) tries.push({ sp, base: y, up: false, maxLines, allowCut });
    }
    let done = null;
    for (const t of tries) {
      const [a, b] = t.sp; const x = R.anchor === 'start' ? a : R.anchor === 'end' ? b : (a + b) / 2;
      const g = h('g', {}, R.g);
      const tb = textBlock(g, x, t.base, label, { cls: 'ts-small', maxW: b - a, maxLines: t.maxLines, lh: 28, anchor: R.anchor, a: { cls: 'strong', fill: 'var(--ink-2)' }, edit: R.path });
      if (t.up && tb.lines.length > 1) tb.el.setAttribute('y', t.base - (tb.lines.length - 1) * tb.lh);
      const box = bb(tb.el);
      const cut = tb.lines.length && /…$/.test(tb.lines[tb.lines.length - 1]) && !/…$/.test(label.trim());
      const top = Math.min(RY0, box.y - 12), bot = Math.max(RY1, box.y + box.h + 12);
      const rr = { x: R.x0, y: top, w: R.x1 - R.x0, h: bot - top };
      if (box.y >= minTop && box.y + box.h <= maxBot && box.x >= R.x0 && box.x + box.w <= R.x1 && (!cut || t.allowCut) && !hit(box) && groundOK(rr)) { done = { g, box, rr }; break; }
      g.remove();
    }
    if (!done) { // last resort: one line, cut short with “…”, on the usual spot
      const g = h('g', {}, R.g); const [a, b] = spans[0]; const x = R.anchor === 'start' ? a : R.anchor === 'end' ? b : (a + b) / 2;
      const tb = textBlock(g, x, RLY, label, { cls: 'ts-small', maxW: b - a, maxLines: 1, lh: 28, anchor: R.anchor, a: { cls: 'strong', fill: 'var(--ink-2)' }, edit: R.path });
      const box = bb(tb.el); if (hit(box)) ctx.warn(`No clear room for the words “${R.label}”.`);
      done = { g, box, rr: { x: R.x0, y: RY0, w: R.x1 - R.x0, h: RY1 - RY0 } };
    }
    R.rect.setAttribute('y', done.rr.y); R.rect.setAttribute('height', done.rr.h);
    obst.push(done.box); texts.push(done.box); R.rr = done.rr;
  }
  // side-by-side grounds share one top and one bottom, so the tints read as one even band
  const top = Math.min(...regs.map(R => R.rr.y)), bot = Math.max(...regs.map(R => R.rr.y + R.rr.h));
  if (regs.every(R => groundOK({ x: R.x0, y: top, w: R.x1 - R.x0, h: bot - top })))
    regs.forEach(R => { R.rect.setAttribute('y', top); R.rect.setAttribute('height', bot - top); });
}
