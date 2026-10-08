// Bar model: part–whole, comparison, "times as many", fraction of an amount, percentage of an
// amount and ratio sharing, on one or more bars drawn to scale. The teacher enters the whole
// problem (every number) and picks which amount is the question mark; the code works out the
// whole, the difference, one part and the answer, so the bar never shows a false sum.
// Builds: the bar, the split, the known values, the unknown, the calculation, the answer.
import {
  h, T, measure, GRID, textBlock, bracket, picture, findSubject, LABEL_PARAM,
  editable, computed, txt, TEXT_PARAM_FOR, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';

export const meta = {
  id: 'bar_model', name: 'Bar model', kind: 'info', version: 1,
  subjects: ['Maths'],
  years: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'],
  teaches: 'Drawing a word problem as bars to scale, so you can see which amount is missing and which calculation finds it.',
};

const TYPES = ['part-whole', 'comparison', 'multiplicative', 'fraction', 'percentage', 'ratio'];
const TYPE_LABELS = ['Parts and a whole', 'Comparing two amounts (more or fewer)', 'Times as many', 'Fraction of an amount', 'Percentage of an amount', 'Sharing in a ratio'];

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Bar model',
  properties: {
    title: TITLE_PARAM('A bar model'),
    story: { type: 'string', title: 'The problem in words', description: 'Shown under the title. Leave empty for none.', maxLength: 112 /* libfix: the lane under the title holds the presets (110) but cut at 140 (tools/laneFit) */, default: '' },
    type: { type: 'string', title: 'Kind of problem', enum: TYPES, 'x-labels': TYPE_LABELS, default: 'part-whole' },
    parts: {
      type: 'array', title: 'Parts or bars', description: 'Parts of the whole, the two amounts being compared, or the people sharing in a ratio.',
      'x-item': 'a part', minItems: 1, maxItems: 5,
      default: [{ label: 'Red', value: 6, units: 1 }, { label: 'Blue', value: 4, units: 1 }],
      items: { type: 'object', required: ['label'], default: { label: 'Part', value: 5, units: 1 }, properties: {
        label: { type: 'string', title: 'Name', maxLength: 60, minLength: 1 },
        value: { type: 'number', title: 'Amount', description: 'Not used for fractions, percentages or ratios.', minimum: 0, default: 5 },
        units: { type: 'integer', title: 'Ratio parts', description: 'Ratio only: 2 for the “2” in 2 : 3.', minimum: 1, maximum: 12, default: 1 },
        picture: LABEL_PARAM('Picture for this part', '', { description: 'A thing to draw on this part, like “apple”. Leave empty to use the picture for every part.' }),
      } },
    },
    amount: { type: 'number', title: 'The whole amount', description: 'For fractions, percentages and ratios: the amount being split or shared.', minimum: 0, default: 40 },
    fraction: { type: 'object', title: 'Fraction', default: { n: 3, d: 5 }, properties: {
      n: { type: 'integer', title: 'Top number (parts taken)', minimum: 1, maximum: 12, default: 3 },
      d: { type: 'integer', title: 'Bottom number (equal parts)', minimum: 2, maximum: 12, default: 5 },
    } },
    percent: { type: 'integer', title: 'Percentage', minimum: 1, maximum: 100, default: 30 },
    times: { type: 'integer', title: 'How many times as many', description: 'Times as many only.', minimum: 2, maximum: 12, default: 3 },
    unknown: { type: 'string', title: 'The question mark goes on', enum: ['whole', 'part', 'difference'], 'x-labels': ['The whole (all together)', 'One part or bar', 'The difference'], default: 'part' },
    unknownPart: { type: 'integer', title: 'Which part or bar is unknown', description: 'Counting from the top or the left. Not used for fractions and percentages.', minimum: 1, maximum: 5, default: 2 },
    unit: { type: 'string', title: 'Unit', description: 'Like £, cm or kg. Leave empty for plain numbers.', maxLength: 10, default: '' },
    colours: { type: 'string', title: 'Colour the parts', description: 'Each equal part (or each part of the whole) in its own colour, so the parts can be counted and named.', enum: ['plain', 'parts'], 'x-labels': ['One colour', 'A colour for each part'], default: 'plain' },
    picture: LABEL_PARAM('Picture on every part', '', { description: 'The thing being shared, like “sweet” or “pencil”, drawn on each part. Leave empty for none. A thing the picture library does not have is drawn as a labelled card.' }),
    answerLabel: LABEL_PARAM('Words with the answer', '', { description: 'Shown under the answer brace with the answer, like “eaten” or “Sam’s share”. Leave empty for none.' }),
    item: { type: 'string', title: 'What is being counted', description: 'A small picture beside the amounts, so the bars read as the story’s things.', enum: ['none', 'counters', 'coins', 'people'], 'x-labels': ['Nothing (plain numbers)', 'Marbles or counters', 'Money (coins)', 'People'], default: 'none' },
    // “altogether” beside the brace and the word joining two calculation steps are short labels
    text: TEXT_PARAM_FOR({ total: 'label', then: 'label' }),
  },
};

export const presets = [
  { id: 'y2-more-than', name: 'Year 2: Sam has 8 more than Ali', params: {
    title: 'How many more?', story: 'Ali has 12 marbles. Sam has 8 more than Ali. How many marbles does Sam have?',
    type: 'comparison', parts: [{ label: 'Ali', value: 12 }, { label: 'Sam', value: 20 }], unknown: 'part', unknownPart: 2, item: 'counters',
  } },
  { id: 'y3-part-whole', name: 'Year 3: the missing part', params: {
    title: 'Finding a missing part', story: '45 children in Year 3. 12 bring a packed lunch and 20 have school dinners. The rest go home. How many go home?',
    type: 'part-whole', parts: [{ label: 'Packed lunch', value: 12 }, { label: 'School dinners', value: 20 }, { label: 'Go home', value: 13 }], unknown: 'part', unknownPart: 3, item: 'people',
  } },
  { id: 'y4-fraction-of', name: 'Year 4: 3/5 of 40', params: {
    title: 'A fraction of an amount', story: 'What is 3/5 of 40?',
    type: 'fraction', amount: 40, fraction: { n: 3, d: 5 }, unknown: 'part',
  } },
  { id: 'y5-fraction-pictures', name: 'Year 5: 3/4 of 28, a colour and a picture on each part', params: {
    title: 'Three quarters of 28', story: 'Mia gives away 3/4 of her 28 apples. How many is that?',
    type: 'fraction', amount: 28, fraction: { n: 3, d: 4 }, unknown: 'part', colours: 'parts', picture: 'apple', answerLabel: 'given away',
  } },
  { id: 'y6-ratio-share', name: 'Year 6: share £45 in the ratio 2 : 3', params: {
    title: 'Sharing in a ratio', story: 'Amy and Ben share £45 in the ratio 2 : 3. How much does Ben get?',
    type: 'ratio', parts: [{ label: 'Amy', units: 2 }, { label: 'Ben', units: 3 }], amount: 45, unit: '£', unknown: 'part', unknownPart: 2, item: 'coins',
  } },
];

/* ------------------------------------------------------------------ numbers */
const NEG = '−';
const near = (a, b) => Math.abs(a - b) < 1e-6;
const exact2 = v => near(Math.round(v * 100), v * 100);
const gcd = (a, b) => b ? gcd(b, a % b) : a;
// A currency symbol goes before the number (£5), every other unit after it (5 cm).
const unitBefore = u => /^[£$€₹¥]/.test((u || '').trim());
function fmtFor(P) {
  const money = P.unit && unitBefore(P.unit);
  const num = v => { const r = Math.round(v * 100) / 100; const o = money && !Number.isInteger(r) ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 2 }; return r.toLocaleString('en-GB', o).replace('-', NEG); };
  const unit = (P.unit || '').trim();
  const u = v => !unit ? num(v) : unitBefore(unit) ? unit + num(v) : `${num(v)} ${unit}`;
  return { num, u };
}
const own = s => `${s}’s`;

/* ------------------------------------------------------------------ model of the problem */
// Every type becomes: rows (one bar, or one per amount), the unknown region, the answer and the
// calculation. Values are all worked out here so the drawing and the captions share one truth.
function model(P) {
  const t = P.type, F = fmtFor(P), parts = P.parts || [];
  const uk = P.unknown, ui = Math.max(0, (P.unknownPart || 1) - 1);
  const m = { t, uk, ui, F, single: ['part-whole', 'fraction', 'percentage'].includes(t), parts };
  if (t === 'part-whole') {
    m.vals = parts.map(p => +p.value); m.W = m.vals.reduce((a, b) => a + b, 0);
    m.ans = uk === 'whole' ? m.W : m.vals[ui];
    m.desc = uk === 'whole' ? 'the whole' : parts[ui] && `the part “${parts[ui].label}”`;
    const others = m.vals.filter((_, i) => i !== ui).map(F.u);
    m.eq = uk === 'whole' ? [`${m.vals.map(F.u).join(' + ')} = `] : [`${F.u(m.W)} ${NEG} ${others.join(` ${NEG} `)} = `];
  } else if (t === 'comparison' || t === 'multiplicative') {
    const a = +parts[0].value, k = P.times;
    m.vals = t === 'comparison' ? [a, +parts[1].value] : [a, a * k];
    m.big = m.vals[0] >= m.vals[1] ? 0 : 1; m.small = 1 - m.big;
    m.diff = Math.abs(m.vals[0] - m.vals[1]); m.W = m.vals[0] + m.vals[1];
    m.ans = uk === 'whole' ? m.W : uk === 'difference' ? m.diff : m.vals[ui];
    m.desc = uk === 'whole' ? 'both together' : uk === 'difference' ? 'the difference' : `${own(parts[ui].label)} amount`;
    const [x, y] = m.vals.map(F.u);
    if (t === 'comparison') m.eq = uk === 'whole' ? [`${x} + ${y} = `] : uk === 'difference' ? [`${F.u(m.vals[m.big])} ${NEG} ${F.u(m.vals[m.small])} = `]
      : ui === m.big ? [`${F.u(m.vals[m.small])} + ${F.u(m.diff)} = `] : [`${F.u(m.vals[m.big])} ${NEG} ${F.u(m.diff)} = `];
    else { m.k = k; m.unitV = a;
      m.eq = uk === 'whole' ? [`${x} × ${k + 1} = `] : uk === 'difference' ? [`${x} × ${k - 1} = `] : ui === 1 ? [`${x} × ${k} = `] : [`${y} ÷ ${k} = `]; }
  } else if (t === 'fraction' || t === 'percentage') {
    const W = +P.amount; let n, d;
    if (t === 'fraction') { n = P.fraction.n; d = P.fraction.d; } else { const g = gcd(P.percent, 100); n = P.percent / g; d = 100 / g; }
    Object.assign(m, { W, n, d, unitV: W / d, A: W / d * n });
    m.ans = uk === 'whole' ? W : m.A;
    m.fracWords = t === 'fraction' ? `${n}/${d}` : `${P.percent}%`;
    m.desc = uk === 'whole' ? 'the whole amount' : `${m.fracWords} of ${F.u(W)}`;
    const u = F.u(m.unitV);
    m.eq = uk === 'whole' ? (n === 1 ? [`${u} × ${d} = `] : [`${F.u(m.A)} ÷ ${n} = ${u}`, `${u} × ${d} = `]) : (n === 1 ? [`${F.u(W)} ÷ ${d} = `] : [`${F.u(W)} ÷ ${d} = ${u}`, `${u} × ${n} = `]);
  } else { // ratio
    m.units = parts.map(p => p.units || 1); m.S = m.units.reduce((a, b) => a + b, 0); m.W = +P.amount;
    m.unitV = m.W / m.S; m.vals = m.units.map(u => u * m.unitV);
    m.ans = uk === 'whole' ? m.W : m.vals[ui];
    m.desc = uk === 'whole' ? 'the total' : `${own(parts[ui].label)} share`;
    const u = F.u(m.unitV);
    // a total that does not share exactly: one step, rounded, marked ≈ (validate warns)
    m.approx = uk !== 'whole' && !exact2(m.unitV);
    m.eq = m.approx ? [`${F.u(m.W)} ÷ ${m.S} × ${m.units[ui]} ≈ `]
      : uk === 'whole' ? [`${F.u(m.vals[ui])} ÷ ${m.units[ui]} = ${u}`, `${u} × ${m.S} = `] : [`${F.u(m.W)} ÷ ${m.S} = ${u}`, `${u} × ${m.units[ui]} = `];
  }
  return m;
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const W = [];
  if (R.length) return result(R);
  // libfix: the whole is written as a sum of the parts with their unit on one line; past what that line
  // holds it is refused, never cut or pushed off the slide
  { const u = String(P.unit || '').length, n = (P.parts || []).length, need = n * (u + 7);
    if (need > 64) R.push({ path: u > 2 ? 'unit' : 'parts', reason: `The sum of ${n} parts with the unit “${P.unit}” is too long for one line. Use a shorter unit (like “cm” or “kg”) or fewer parts.` });
    if (R.length) return result(R); }
  const t = P.type, parts = P.parts, F = fmtFor(P), uk = P.unknown, ui = P.unknownPart - 1;
  const need = { 'part-whole': [2, 5], comparison: [2, 2], multiplicative: [2, 2], ratio: [2, 3] }[t];
  const tl = TYPE_LABELS[TYPES.indexOf(t)].toLowerCase();
  if (need && (parts.length < need[0] || parts.length > need[1])) R.push({ path: 'parts', reason: need[0] === need[1] ? `“${TYPE_LABELS[TYPES.indexOf(t)]}” uses exactly ${need[0]} bars; you have ${parts.length}. Add or remove one.` : `“${TYPE_LABELS[TYPES.indexOf(t)]}” needs ${need[0]} to ${need[1]} parts; you have ${parts.length}.` });
  if (uk === 'difference' && !['comparison', 'multiplicative'].includes(t)) R.push({ path: 'unknown', reason: `Only a comparison or “times as many” has a difference to find. Put the question mark on the whole or on one part.` });
  if (need && (uk !== 'whole' || t === 'ratio') && ui >= parts.length) R.push({ path: 'unknownPart', reason: `There is no part ${ui + 1}: there are only ${parts.length}. Pick a number from 1 to ${parts.length}.` });
  if (R.length) return result(R);
  const dp = (path, v, what) => { if (!exact2(v)) R.push({ path, reason: `${what} has more than 2 decimal places. Use an amount with at most 2.` }); };
  if (t === 'part-whole' || t === 'comparison' || t === 'multiplicative') parts.forEach((p, i) => { if (!(p.value > 0)) R.push({ path: `parts.${i}.value`, reason: `${own(p.label)} amount must be more than 0 to draw a bar.` }); else dp(`parts.${i}.value`, p.value, `${own(p.label)} amount`); });
  if (['fraction', 'percentage', 'ratio'].includes(t)) { if (!(P.amount > 0)) R.push({ path: 'amount', reason: 'The whole amount must be more than 0.' }); else dp('amount', P.amount, 'The whole amount'); }
  if (R.length) return result(R);
  if (t === 'part-whole') {
    const tot = parts.reduce((a, p) => a + p.value, 0);
    parts.forEach((p, i) => { if (p.value / tot < 1 / 14) R.push({ path: `parts.${i}.value`, reason: `${p.label} (${F.u(p.value)}) is too small next to the whole (${F.u(tot)}) to draw to scale and still label. Bar models suit parts of a similar size.` }); });
  }
  if (t === 'comparison') {
    const [a, b] = parts.map(p => p.value);
    if (near(a, b)) R.push({ path: 'parts.1.value', reason: `Both amounts are ${F.u(a)}, so there is nothing to compare: one bar is not longer than the other. Change one of them.` });
    if (Math.min(a, b) / Math.max(a, b) < 1 / 14) R.push({ path: 'parts.0.value', reason: `${F.u(Math.min(a, b))} is too small next to ${F.u(Math.max(a, b))} to draw both bars to scale.` });
  }
  if (t === 'multiplicative') {
    const [a, b] = parts.map(p => p.value);
    if (!near(b, a * P.times)) R.push({ path: 'parts.1.value', reason: `${P.times} times ${own(parts[0].label)} ${F.u(a)} is ${F.u(a * P.times)}, not ${F.u(b)}. Change ${own(parts[1].label)} amount or “How many times as many”.` });
  }
  if (t === 'fraction') {
    const { n, d } = P.fraction;
    if (n > d) R.push({ path: 'fraction.n', reason: `${n}/${d} is more than one whole, and this bar is one whole. Use a top number of ${d} or less.` });
    else if (!exact2(P.amount / d)) R.push({ path: 'fraction.d', reason: `${F.u(P.amount)} does not split into ${d} equal parts exactly (each would be about ${F.num(P.amount / d)}). Pick an amount that divides by ${d}.` });
  }
  if (t === 'percentage') {
    const d = 100 / gcd(P.percent, 100);
    if (d > 20) R.push({ path: 'percent', reason: `${P.percent}% needs the bar cut into ${d} equal parts, too many to draw. Use a multiple of 5%.` });
    else if (!exact2(P.amount / d)) R.push({ path: 'amount', reason: `${F.u(P.amount)} does not split into ${d} equal parts of ${100 / d}% exactly. Pick an amount that divides by ${d}.` });
  }
  if (t === 'ratio') {
    const S = parts.reduce((a, p) => a + p.units, 0);
    // the total is typed, so a share that is not exact is rounded and shown with ≈; but when the
    // total is the unknown, the known share would itself be a rounded number, which is not true
    if (!exact2(P.amount / S)) {
      const why = `${F.u(P.amount)} does not share into ${S} equal parts exactly (each would be about ${F.u(P.amount / S)})`;
      if (uk === 'whole') R.push({ path: 'amount', reason: `${why}. Pick a total that divides by ${S}.` });
      else W.push({ path: 'amount', reason: `${why}, so the answer is rounded and shown with ≈. For an exact answer, pick a total that divides by ${S}.` });
    }
  }
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
function plan(P) {
  const M = model(P), F = M.F, t = M.t, L = M.parts.map(p => p.label);
  const ans = (M.approx ? 'about ' : '') + F.u(M.ans);
  const bar = t === 'part-whole' ? 'One bar stands for the whole amount.'
    : M.single ? 'One bar stands for the whole amount.'
    : t === 'ratio' ? `One bar for each share: ${L.join(', ')}.`
    : `One bar for ${L[0]}, one for ${L[1]}, starting from the same line.`;
  const split = t === 'part-whole' ? `Split it into ${L.length} parts. A longer part is a bigger amount.`
    : t === 'comparison' ? `${L[M.big]} has the same as ${L[M.small]}, and then some more: the difference.`
    : t === 'multiplicative' ? `${own(L[1])} bar is ${M.k} equal parts, each as long as ${own(L[0])}.`
    : t === 'fraction' ? `Split the bar into ${M.d} equal parts and take ${M.n} of them: ${M.n}/${M.d}.`
    : t === 'percentage' ? `The whole bar is 100%. Split it into ${M.d} equal parts of ${100 / M.d}% and take ${M.n}.`
    : `${M.units.join(' : ')} means equal parts: ${M.units.map((u, i) => `${u} for ${L[i]}`).join(', ')}.`;
  let known;
  if (t === 'part-whole') known = M.uk === 'whole' ? `We know every part: ${M.vals.map(F.u).join(', ')}.` : `We know the whole, ${F.u(M.W)}, and the other parts.`;
  else if (t === 'comparison') known = M.uk === 'part' ? `We know ${own(L[1 - M.ui])} amount, ${F.u(M.vals[1 - M.ui])}, and the difference, ${F.u(M.diff)}.` : `We know both amounts: ${F.u(M.vals[0])} and ${F.u(M.vals[1])}.`;
  else if (t === 'multiplicative') known = M.uk === 'part' && M.ui === 0 ? `We know ${own(L[1])} amount: ${F.u(M.vals[1])}.` : `We know ${own(L[0])} amount: ${F.u(M.vals[0])}.`;
  else if (M.single) known = M.uk === 'whole' ? `We know ${M.fracWords} of the amount is ${F.u(M.A)}.` : `We know the whole: ${F.u(M.W)}.`;
  else known = M.uk === 'whole' ? `We know ${own(L[M.ui])} share: ${F.u(M.vals[M.ui])}.` : `We know the total: ${F.u(M.W)}.`;
  const steps = [
    { key: 'bar', caption: bar }, { key: 'split', caption: split }, { key: 'known', caption: known },
    { key: 'unknown', caption: `The question mark is what we need to find: ${M.desc}.` },
    { key: 'calc', caption: M.eq.length > 1 ? `Find one part first, then the ${M.uk === 'whole' ? 'whole' : 'parts we need'}.` : `Work it out: ${M.eq[0]}?` },
    { key: 'answer', caption: `So ${M.desc} is ${ans}.` },
  ];
  const D = M.desc[0].toUpperCase() + M.desc.slice(1);
  return { M, steps, summary: `${D} is ${ans}: the bar shows why.` };
}
export function builds(P) { const { steps, summary } = plan(P); return { steps, summary: { caption: summary } }; }

export function notes(P) {
  const { M } = plan(P); const t = M.t;
  const scale = 'The bars are drawn to scale: equal amounts have equal lengths. Ask: which bar is longer, and how can you tell?';
  const split = t === 'part-whole' ? 'Parts sit end to end; together they make the whole bar. Ask which part looks biggest before any numbers go on.'
    : t === 'comparison' ? 'Line the bars up on the left. The extra piece on the longer bar is the difference: “more than” and “fewer than” both point at it.'
    : t === 'multiplicative' ? `“${M.k} times as many” means ${M.k} copies of the smaller bar. Check the parts are all the same length.`
    : t === 'ratio' ? 'In a ratio every small box is worth the same amount. That is why we can find one box first.'
    : 'The parts must be equal, or the fraction is not true. Count the parts out loud.';
  const unknown = 'Point at the question mark. Ask: is it a part, the whole, or the difference? That tells you whether to add, subtract, multiply or divide.';
  const calc = M.eq.length > 1 ? 'Two steps: divide to find one equal part, then multiply for the parts you need.' : (t === 'part-whole' && M.uk !== 'whole') || (t === 'comparison' && (M.uk === 'difference' || M.ui === M.small)) ? 'Whole take away the known part gives the missing part.' : 'Read the calculation straight off the bar.';
  return { steps: [scale, split, 'Write each known number on its own part of the bar.', unknown, calc, 'Check: does the answer make the bar add up? Put the number back into the story.'], summary: 'Ask the class to tell the story back using the bar: what was known, what was missing, how they found it.' };
}

/* ------------------------------------------------------------------ render */
const NUM_CLS = ['ts-num', 'ts-label', 'ts-small', 'ts-tiny'];
function fitCls(p, s, maxW, from = 0) { for (let i = from; i < NUM_CLS.length; i++) if (measure(p, s, NUM_CLS[i]) <= maxW) return NUM_CLS[i]; return null; }
// labels at number size (label weight), so names read from the back of the room
const BIG = { 'font-weight': 'var(--w-label)' };
const ITEM_W = 40;
// One small flat picture of what is being counted, centred on cx, cy (about 36 units tall).
function itemGlyph(p, kind, cx, cy, a) {
  if (!kind || kind === 'none') return null;
  const g = h('g', Object.assign({ transform: `translate(${cx} ${cy})` }, a || {}), p);
  if (kind === 'counters') {
    for (const [x, y] of [[-10, 7], [10, 7], [0, -10]]) h('circle', { cx: x, cy: y, r: 9.5, fill: 'var(--compare)', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-hair)' }, g);
  } else if (kind === 'coins') {
    h('circle', { r: 17, fill: 'color-mix(in oklab,var(--hue-gold) 55%,var(--paper))', stroke: 'color-mix(in oklab,var(--hue-gold) 60%,var(--ink))', 'stroke-width': 'var(--sw-struct)' }, g);
    h('circle', { r: 10.5, fill: 'none', stroke: 'color-mix(in oklab,var(--hue-gold) 60%,var(--ink))', 'stroke-width': 'var(--sw-hair)' }, g);
  } else if (kind === 'people') {
    h('circle', { cy: -10, r: 8, fill: 'var(--ink-2)' }, g);
    h('path', { d: 'M-14 18 V11 A14 11 0 0 1 14 11 V18 Z', fill: 'var(--ink-2)' }, g);
  }
  return g;
}

// A colour for each part (colours: 'parts'): pale, flat hues from the theme, in a fixed order, so a
// part keeps its colour from build to build. Ink numbers read on every one.
const PART_HUES = ['teal', 'gold', 'red', 'blue', 'green', 'purple', 'orange', 'brown'];
const partFill = (i, night) => night
  ? `color-mix(in oklab,var(--hue-${PART_HUES[i % PART_HUES.length]}) 48%,var(--bg))`
  : `color-mix(in oklab,var(--hue-${PART_HUES[i % PART_HUES.length]}) 30%,var(--paper))`;
const PIC_H = 64; // the picture band at the top of a part when pictures are on

export function render(root, P, ctx) {
  const { M } = plan(P); const b = ctx.b, N = ctx.N, F = M.F, t = M.t;
  const kB = b.bar, kS = b.split, kK = b.known, kU = b.unknown, kC = b.calc, kA = b.answer;
  const story = (P.story || '').trim();
  let top = GRID.top + 10;
  if (story) {
    const sb = textBlock(root, GRID.left, 156, story, { cls: 'ts-label', maxW: GRID.right - GRID.left, maxLines: 2, lh: 44, a: { fill: 'var(--ink-2)', 'font-size': 'calc(var(--fs-label) * 1.2)' }, edit: 'story' });
    top = 156 + (sb.lines.length - 1) * sb.lh + 30;
  }
  // Night: empty and known segments are lifted off the page so they read at 3:1 or better
  const night = ctx.name === 'night';
  const FILL = {
    empty: night ? 'color-mix(in oklab,var(--ink) 42%,var(--bg))' : 'var(--paper)',
    known: night ? 'color-mix(in oklab,var(--compare) 55%,var(--bg))' : 'var(--compare-pale)',
    ans: night ? 'color-mix(in oklab,var(--focus) 42%,var(--bg))' : 'var(--focus-pale)',
  };
  const item = P.item || 'none';
  const coloured = P.colours === 'parts';
  const picOf = i => String(((M.parts[i] || {}).picture || P.picture || '')).trim();
  const anyPic = !!String(P.picture || '').trim() || (M.parts || []).some(p => String(p.picture || '').trim());
  // The thing on a part, in its top band. At `s` one picture says what is counted; at `sCount` it
  // becomes the count, so a pupil never reads one apple as one when the part is 7: up to 10 small
  // cut-outs in a neat grid, else one picture tagged "×7" (and always the tag for a labelled card,
  // which is unreadable small). The count comes no earlier than the part's number does, so a
  // question slide never shows a count that gives the answer away.
  const partPicture = (name, cx, y, w, s, count, sCount, path) => {
    if (!name || w < 40) return;
    const solo = (p, x, bw) => picture(p, name, x, y + PIC_H / 2 + 6, bw, PIC_H - 4, { a: {} });
    const whole = Number.isInteger(count) && count > 0;
    const one = h('g', Object.assign({ s, cls: 'rise' }, whole && sCount != null ? { hide: sCount } : {}), gPic);
    solo(one, cx, Math.min(w - 12, 110));
    if (!whole || sCount == null) return;
    const g = h('g', { s: sCount, cls: 'rise' }, gPic);
    const drawn = !!findSubject(name);
    if (drawn && count <= 10) {
      const rows = count <= 5 ? 1 : 2, cols = Math.ceil(count / rows);
      const cw = Math.min((w - 16) / cols, 48), ch = (PIC_H - 2) / rows;
      for (let i = 0; i < count; i++) {
        const r = Math.floor(i / cols), c = i % cols, inRow = r < rows - 1 ? cols : count - cols * (rows - 1);
        picture(g, name, cx + (c - (inRow - 1) / 2) * cw, y + 6 + ch * (r + .5), cw, ch, { area: .9, a: {} });
      }
    } else {
      // one picture and its count beside it, the pair centred on the part
      const tag = `×${count}`, tw = measure(g, tag, 'ts-label') + 10;
      const pg = h('g', {}, g); solo(pg, 0, Math.min(w - 24 - tw, 80));
      let bb = { x: -30, width: 60 }; try { bb = pg.getBBox(); } catch (e) { /* not laid out */ }
      const left = cx - (bb.width + tw) / 2;
      pg.setAttribute('transform', `translate(${(left - bb.x).toFixed(1)} 0)`);
      computed(T(g, left + bb.width + 10, y + PIC_H / 2 + 16, tag, 'ts-label', { 'text-anchor': 'start', fill: 'var(--ink)', 'font-weight': 'var(--w-label)' }), path);
    }
  };

  const content = h('g', {}, root);
  const gFill = h('g', {}, content), gAns = h('g', {}, content), gLine = h('g', {}, content), gPic = h('g', {}, content), gText = h('g', {}, content);
  const picsIn = M.single && anyPic; // pictures sit inside the parts of a single bar
  const BH = M.single ? 144 : 114;
  const valY = (y, hh) => picsIn ? y + hh - 26 : y + hh / 2 + 14; // a value under its part's picture
  const ansS = (M.approx ? '≈ ' : '') + F.u(M.ans); // a rounded share says so where it is drawn
  const ansPath = { whole: t === 'part-whole' ? 'parts' : 'amount', part: 'unknownPart', difference: 'unknown' }[M.uk] || 'unknown';
  // a value slot: known (shows at the known build) or the unknown (? at unknown, answer at answer)
  const slot = (x, y, s, { known, anchor = 'middle', maxW = 400, path, from = 0 }) => {
    if (known) { const c = fitCls(gText, s, maxW, from); if (!c) ctx.warn(`No room for “${s}”.`); return computed(T(gText, x, y, s, c || 'ts-tiny', { 'text-anchor': anchor, fill: 'var(--ink)', s: kK, cls: 'rise' }), path); }
    computed(T(gText, x, y, '?', 'ts-num', { 'text-anchor': anchor, fill: 'var(--focus-text)', s: kU, hide: kA, cls: 'pop' }), 'unknown');
    const c = fitCls(gText, ansS, maxW, from); if (!c) ctx.warn(`No room for the answer “${ansS}”.`);
    return computed(T(gText, x, y, ansS, c || 'ts-tiny', { 'text-anchor': anchor, fill: 'var(--focus-text)', s: kA, cls: 'pop' }), ansPath);
  };
  const box = (x, y, w, hh, fill, a) => h('rect', Object.assign({ x, y, width: Math.max(0, w), height: hh, fill }, a || {}), gFill);
  const outline = (x, y, w, hh, a) => h('rect', Object.assign({ x, y, width: w, height: hh, rx: 'var(--r-mark)', fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)' }, a || {}), gLine);
  const divider = (x, y, hh, a) => h('line', Object.assign({ x1: x, x2: x, y1: y, y2: y + hh, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)' }, a || {}), gLine);
  const unknownRegion = (x, y, w, hh) => {
    // coloured parts keep their colours at the answer: the solid ring marks it instead
    if (!coloured) h('rect', { x, y, width: w, height: hh, fill: FILL.ans, s: kA, cls: 'wipe' }, gAns);
    h('rect', { x: x + 3, y: y + 3, width: Math.max(0, w - 6), height: hh - 6, rx: 'var(--r-mark)', fill: 'none', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)', 'stroke-dasharray': '10 7', s: kU, hide: N, cls: 'pop' }, gLine);
    // the recap: the answer's bar is ringed solid, so the still points at the result
    h('rect', { x: x + 3, y: y + 3, width: Math.max(0, w - 6), height: hh - 6, rx: 'var(--r-mark)', fill: 'none', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-data)', s: N, cls: 'pop' }, gLine);
  };
  const cellValues = (x, y, cw, n, hh) => { // the value of one equal part, in every part, at the calc build
    if (M.approx) return; // a rounded box value would not add back up to the total
    const s = F.u(M.unitV), c = fitCls(gText, s, cw - 12, 0);
    if (!c) return;
    const g = h('g', { s: kC, cls: 'rise' }, gText);
    for (let i = 0; i < n; i++) computed(T(g, x + (i + .5) * cw, valY(y, hh), s, c, { 'text-anchor': 'middle', fill: 'var(--ink)' }), t === 'multiplicative' ? 'parts.0.value' : 'amount');
  };
  let eqY;

  if (M.single) {
    /* one bar: part–whole, fraction, percentage */
    const fr = t !== 'part-whole';
    const X0 = GRID.left + 40, X1 = GRID.right - 40, BW = X1 - X0, BY = top + 100;
    box(X0, BY, BW, BH, FILL.empty, { rx: 'var(--r-mark)', s: kB, cls: 'wipe body' });
    outline(X0, BY, BW, BH, { s: kB, cls: 'wipe' });
    // segments
    let edges;
    if (fr) edges = Array.from({ length: M.d + 1 }, (_, i) => X0 + i * BW / M.d);
    else { let acc = 0; edges = [X0, ...M.vals.map(v => X0 + (acc += v) / M.W * BW)]; }
    for (let i = 1; i < edges.length - 1; i++) divider(edges[i], BY, BH, { s: kS, cls: 'rise' });
    const topKnown = M.uk !== 'whole';
    // the counted thing sits beside the whole amount
    const wTop = Math.max(measure(gText, F.u(M.W), 'ts-num'), topKnown ? 0 : measure(gText, F.u(M.ans), 'ts-num'));
    itemGlyph(gText, item, (X0 + X1) / 2 - wTop / 2 - 34, BY - 58, { s: topKnown ? kK : kU, cls: 'rise' });
    if (fr) {
      // the parts taken, shaded at the split
      if (coloured) for (let i = 0; i < M.n; i++) box(edges[i], BY, edges[i + 1] - edges[i], BH, partFill(i, night), { s: kS, cls: 'wipe' });
      else box(X0, BY, edges[M.n] - X0, BH, FILL.known, { s: kS, cls: 'wipe' });
      if (picsIn) for (let i = 0; i < M.d; i++) partPicture(picOf(-1), (edges[i] + edges[i + 1]) / 2, BY, edges[i + 1] - edges[i], kS, M.unitV, M.approx ? null : kC, 'amount');
      cellValues(X0, BY, BW / M.d, M.d, BH);
      // whole on top, the parts taken underneath
      const botX1 = edges[M.n];
      const tb = bracket(gLine, X0, X1, BY - 24, '', { below: false, a: { s: topKnown ? kK : kU, cls: 'rise' } }); tb.label.remove();
      slot((X0 + X1) / 2, BY - 44, F.u(M.W), { known: topKnown, path: 'amount' });
      const bb = bracket(gLine, X0, botX1, BY + BH + 24, '', { a: { s: topKnown ? kU : kK, cls: 'rise' } }); bb.label.remove();
      const bx = (X0 + botX1) / 2, by = BY + BH + 84;
      slot(bx, by, F.u(M.A), { known: !topKnown, path: 'amount', maxW: Math.max(botX1 - X0, 200) });

      // the fraction names the bracket it sits under, beside its value, so the bar never moves
      const lab = h('g', { s: kS, cls: 'rise' }, gText); // named with the split it describes
      const wv = Math.max(measure(gText, '?', 'ts-num'), measure(gText, F.u(M.A), 'ts-num'));
      let labSide = 'left';
      if (t === 'fraction') {
        const fw = Math.max(40, measure(lab, String(M.n), 'ts-num'), measure(lab, String(M.d), 'ts-num')) + 8;
        let cx = bx - wv / 2 - 32 - fw / 2; if (cx - fw / 2 < X0) cx = bx + wv / 2 + 32 + fw / 2;
        const cy = by - 12;
        computed(T(lab, cx, cy - 9, String(M.n), 'ts-num', { 'text-anchor': 'middle', fill: 'var(--compare-text)' }), 'fraction.n');
        computed(T(lab, cx, cy + 41, String(M.d), 'ts-num', { 'text-anchor': 'middle', fill: 'var(--compare-text)' }), 'fraction.d');
        h('line', { x1: cx - fw / 2, x2: cx + fw / 2, y1: cy, y2: cy, stroke: 'var(--compare-text)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, lab);
        eqY = BY + BH + (picsIn ? 184 : 200);
        labSide = cx > bx ? 'right' : 'left';
      } else {
        const s = `${P.percent}%`, pw = measure(lab, s, 'ts-num');
        let x = bx - wv / 2 - 32; let anchor = 'end'; if (x - pw < X0) { x = bx + wv / 2 + 32; anchor = 'start'; }
        computed(T(lab, x, by, s, 'ts-num', { 'text-anchor': anchor, fill: 'var(--compare-text)' }), 'percent');
        eqY = BY + BH + 180;
        labSide = anchor === 'start' ? 'right' : 'left';
      }
      // the answer brace's words (answerLabel), beside its number on the side the fraction leaves
      // free: they come with the brace, before the number, so a question slide can say what the
      // brace is without giving the answer
      const aw = String(P.answerLabel || '').trim();
      if (aw) {
        const right = labSide === 'left';
        const x = right ? bx + wv / 2 + 24 : X0;
        const room = right ? GRID.right - x : Math.max(0, bx - wv / 2 - 24 - X0);
        const ab = textBlock(gText, right ? x : bx - wv / 2 - 24, by - 6, aw, { cls: 'ts-label', maxW: Math.max(160, room), maxLines: 2, lh: 32, anchor: right ? 'start' : 'end', a: { fill: 'var(--ink-2)', s: topKnown ? kU : kK, cls: 'rise' }, edit: 'answerLabel' });
        if (ab.lines.length > 1) ab.el.setAttribute('y', by - 6 - (ab.lines.length - 1) * ab.lh / 2);
      }
      if (topKnown) unknownRegion(X0, BY, botX1 - X0, BH); else unknownRegion(X0, BY, BW, BH);
    } else {
      // part–whole: known parts tinted at the split, the unknown left plain until the answer
      M.vals.forEach((v, i) => {
        const xa = edges[i], xb = edges[i + 1], w = xb - xa;
        const isU = M.uk === 'part' && i === M.ui;
        if (!isU || coloured) box(xa, BY, w, BH, coloured ? partFill(i, night) : FILL.known, { s: kS, cls: 'wipe' });
        if (isU) unknownRegion(xa, BY, w, BH);
        if (picsIn) partPicture(picOf(i), (xa + xb) / 2, BY, w, kS, v, isU ? kA : kK, `parts.${i}.value`);
        slot((xa + xb) / 2, valY(BY, BH), F.u(v), { known: !isU, path: `parts.${i}.value`, maxW: w - 14 });
        if (w < 64) ctx.warn(`The part “${M.parts[i].label}” is too narrow to name.`);
        textBlock(gText, (xa + xb) / 2, BY + BH + 48, M.parts[i].label, { cls: 'ts-num', maxW: Math.max(40, w - 16), maxLines: 2, lh: 42, anchor: 'middle', a: Object.assign({ fill: 'var(--ink)', s: kS, cls: 'rise' }, BIG), edit: `parts.${i}.label` });
      });
      const tb = bracket(gLine, X0, X1, BY - 24, '', { below: false, a: { s: topKnown ? kK : kU, cls: 'rise' } }); tb.label.remove();
      slot((X0 + X1) / 2, BY - 44, F.u(M.W), { known: topKnown, path: 'parts' });
      if (!topKnown) unknownRegion(X0, BY, BW, BH);
      eqY = BY + BH + 150;
    }
  } else {
    /* one bar per amount: comparison, times as many, ratio */
    const rows = M.parts.length;
    const tmp = h('g', {}, root);
    const nameW = Math.min(240, Math.max(...M.parts.map(p => textBlock(tmp, 0, 0, p.label, { cls: 'ts-num', maxW: 240, maxLines: 2, a: BIG }).w)));
    tmp.remove();
    const glyphW = anyPic ? 72 : item !== 'none' ? ITEM_W + 16 : 0;
    const x0 = GRID.left + glyphW + nameW + 28;
    const showBrace = M.uk === 'whole' || t === 'ratio';
    const valLabels = M.vals.map(F.u);
    const valW = Math.max(measure(root, ansS, 'ts-num'), ...valLabels.map(s => measure(root, s, 'ts-num'))) + 28;
    const word = txt(P, 'label:total', 'altogether');
    const WORD = { fill: 'var(--ink-2)', 'font-weight': 'var(--w-body)' };
    // the word under the total wraps in a column no wider than WORD_W, so a long edit never squeezes the bars
    const WORD_W = 220, wordCls = measure(root, word, 'ts-num', WORD) <= WORD_W ? 'ts-num' : 'ts-label';
    const wordBlock = (p, x, y, a) => textBlock(p, x, y, word, { cls: wordCls, maxW: WORD_W, maxLines: 3, lh: 32, a: Object.assign({}, WORD, a) });
    const tmpW = h('g', {}, root); const wordW = showBrace ? wordBlock(tmpW, 0, 0).w : 0; tmpW.remove();
    const braceW = showBrace ? 44 + Math.max(measure(root, F.u(M.W), 'ts-num'), wordW) + 8 : 0;
    const barMax = GRID.right - x0 - valW - braceW;
    const pitch = rows === 3 ? 150 : 168, RY = top + 40;
    let widths, unitW = null;
    if (t === 'comparison') { const k = barMax / Math.max(...M.vals); widths = M.vals.map(v => v * k); }
    else if (t === 'multiplicative') { unitW = barMax / M.k; widths = [unitW, unitW * M.k]; }
    else { unitW = barMax / Math.max(...M.units); widths = M.units.map(u => u * unitW); }
    const ry = i => RY + i * pitch;
    M.parts.forEach((p, i) => {
      const y = ry(i), w = widths[i];
      const nb = textBlock(gText, x0 - 22, y + BH / 2 + 13, p.label, { cls: 'ts-num', maxW: nameW, maxLines: 3, lh: 42, anchor: 'end', a: Object.assign({ fill: 'var(--ink)', s: kB, cls: 'rise' }, BIG), edit: `parts.${i}.label` });
      nb.el.setAttribute('y', y + BH / 2 + 13 - (nb.lines.length - 1) * nb.lh / 2);
      // what each bar counts, beside its name
      if (anyPic) { if (picOf(i)) { const pg = h('g', { s: kB, cls: 'rise' }, gPic); picture(pg, picOf(i), GRID.left + 30, y + BH / 2, 60, BH - 20, { a: {} }); } }
      else itemGlyph(gText, item, GRID.left + ITEM_W / 2, y + BH / 2, { s: kB, cls: 'rise' });
      box(x0, y, w, BH, coloured ? partFill(i, night) : FILL.known, { rx: 'var(--r-mark)', s: kB, cls: 'wipe' });
      outline(x0, y, w, BH, { s: kB, cls: 'wipe' });
      // equal units: multiplicative's long bar and every ratio bar
      const nU = t === 'ratio' ? M.units[i] : t === 'multiplicative' && i === 1 ? M.k : 0;
      for (let j = 1; j < nU; j++) divider(x0 + j * unitW, y, BH, { s: kS, cls: 'rise' });
      if (t === 'ratio' || t === 'multiplicative') cellValues(x0, y, unitW, t === 'ratio' ? M.units[i] : (i === 1 ? M.k : 1), BH);
    });
    // the difference: the extra piece of the longer bar
    if (t !== 'ratio') {
      const yb = ry(M.big), xs = x0 + widths[M.small], xe = x0 + widths[M.big];
      if (t === 'comparison') {
        // the shared start line steps back once the split has been seen, so the values carry the next build
        h('line', { x1: xs, x2: xs, y1: ry(0) - 8, y2: ry(1) + BH + 8, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '6 6', s: kS, cls: 'rise', c: ctx.rc('split') }, gLine);
        h('rect', { x: xs, y: yb, width: xe - xs, height: BH, fill: FILL.empty, s: kS, cls: 'wipe' }, gFill);
        divider(xs, yb, BH, { s: kS });
      }
      if (M.uk === 'difference') unknownRegion(xs, yb, xe - xs, BH);
      if (t === 'comparison' && (M.uk === 'part' || M.uk === 'difference')) slot((xs + xe) / 2, yb + BH / 2 + 14, F.u(M.diff), { known: M.uk !== 'difference', path: `parts.${M.big}.value`, maxW: xe - xs - 12 });
      else if (M.uk === 'difference') slot((xs + xe) / 2, yb + BH / 2 + 14, F.u(M.diff), { known: false, maxW: xe - xs - 12 });
    }
    // amounts at the end of each bar
    M.parts.forEach((p, i) => {
      const y = ry(i), xe = x0 + widths[i];
      let state = null; // 'known' | 'unknown' | null
      if (t === 'ratio') state = M.uk === 'part' ? (i === M.ui ? 'unknown' : null) : (i === M.ui ? 'known' : null);
      else if (M.uk === 'part') state = i === M.ui ? 'unknown' : 'known';
      else if (t === 'comparison') state = 'known';
      else state = i === 0 ? 'known' : null;
      if (!state) return;
      slot(xe + 16, y + BH / 2 + 14, F.u(M.vals[i]), { known: state === 'known', anchor: 'start', path: t === 'ratio' ? 'amount' : `parts.${i}.value` });
      if (state === 'unknown') unknownRegion(x0, y, widths[i], BH);
    });
    // the whole: a brace down the right of every bar, drawn light so the total carries the build
    if (showBrace) {
      const bx = x0 + Math.max(...widths) + valW + 8, y1 = ry(0), y2 = ry(rows - 1) + BH, ym = (y1 + y2) / 2;
      const known = M.uk !== 'whole';
      h('path', { d: `M${bx - 12} ${y1} H ${bx} V ${y2} H ${bx - 12}`, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', s: known ? kK : kU, cls: 'rise' }, gLine);
      slot(bx + 22, ym + 4, F.u(M.W), { known, anchor: 'start', path: t === 'ratio' ? 'amount' : 'parts' });
      editable(wordBlock(gText, bx + 22, ym + (wordCls === 'ts-num' ? 48 : 42), { s: known ? kK : kU, cls: 'rise' }).el, 'text.label:total');
      if (!known) M.parts.forEach((_, i) => unknownRegion(x0, ry(i), widths[i], BH));
    }
    eqY = ry(rows - 1) + BH + 110;
  }

  /* the calculation: one line, centred; the answer replaces the question mark */
  const eq = h('g', { s: kC, cls: 'rise' }, gText);
  // steps sit side by side, joined by an editable arrow; the last ends with the answer slot
  const then = txt(P, 'label:then', '→'), GAP = 30;
  const stepS = M.eq.map(x => x.trim());
  const wSteps = stepS.map(x => measure(eq, x, 'ts-num')), wThen = measure(eq, then, 'ts-num');
  const wAns = Math.max(measure(eq, '?', 'ts-num'), measure(eq, F.u(M.ans), 'ts-num'));
  const wPre = wSteps.reduce((a, w) => a + w, 0) + (stepS.length - 1) * (wThen + 2 * GAP) + 14;
  // one line; a long joining word wraps in the room left between the steps (never across them)
  const nJ = stepS.length - 1, wFix = wSteps.reduce((a, w) => a + w, 0) + nJ * 2 * GAP + 14 + wAns;
  const roomJ = nJ ? Math.floor((GRID.right - GRID.left - 20 - wFix) / nJ) : 0;
  const wrapThen = nJ > 0 && wThen > roomJ;
  let thenB = null;
  if (wrapThen) { const tmpT = h('g', {}, root); thenB = textBlock(tmpT, 0, 0, then, { cls: 'ts-label', maxW: roomJ, maxLines: 3, lh: 30 }); tmpT.remove(); }
  const wJ = wrapThen ? thenB.w : wThen;
  let ex = 640 - (wFix + nJ * wJ) / 2, ey = eqY;
  stepS.forEach((x, i) => {
    computed(T(eq, ex, ey, x, 'ts-num', { 'text-anchor': 'start', fill: 'var(--ink)' }), 'unknown'); ex += wSteps[i];
    if (i === nJ) return;
    if (!wrapThen) editable(T(eq, ex + GAP, ey, then, 'ts-num', { 'text-anchor': 'start', fill: 'var(--ink-2)' }), 'text.label:then');
    else {
      const tb = textBlock(eq, ex + GAP + wJ / 2, ey, then, { cls: 'ts-label', maxW: roomJ, maxLines: 3, lh: 30, anchor: 'middle', a: { fill: 'var(--ink-2)' }, edit: 'text.label:then' });
      tb.el.setAttribute('y', ey - 6 - (tb.lines.length - 1) * tb.lh / 2); // centred on the numbers' middle
    }
    ex += wJ + 2 * GAP;
  });
  ex += 14;
  computed(T(eq, ex, ey, '?', 'ts-num', { 'text-anchor': 'start', fill: 'var(--focus-text)', hide: kA }), 'unknown');
  computed(T(eq, ex, ey, F.u(M.ans), 'ts-num', { 'text-anchor': 'start', fill: 'var(--focus-text)', s: kA, cls: 'pop' }), ansPath);

  // centre the whole diagram in the space under the problem
  const bb = content.getBBox(), room = GRID.bottom - top;
  if (bb.height > room + 1) ctx.warn('The bar model is too tall for the slide.');
  content.setAttribute('transform', `translate(0 ${Math.round(top + Math.max(0, (room - bb.height) / 2) - bb.y)})`);
  return {};
}
