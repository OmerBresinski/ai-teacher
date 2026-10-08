// Data charts: tally chart, pictogram, block chart, bar chart, line chart or pie chart from one
// list of groups and values. Builds: the empty chart and its scale -> each group appears in
// order (the line draws in real time) -> one value read off the scale -> the question's answer
// highlighted. Scales start at 0, pictogram keys must divide the values, pie angles are worked
// out in code and sum to 360, and a line chart is refused for separate groups.
// A side column holds one card at a time: the key or scale, how one value is read, then the answer.
import {
  h, T, measure, fmtInt, GRID, textBlock, lanePlace,
  editable, computed, txt, TEXT_PARAM_FOR, LABEL_PARAM, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { barChart, pictogram, pictoSymbol, lineChart, pie, pieAngles, tally, niceTop, pictogramCheck, PICTO_SYMBOLS } from '../kit/batch-C.js';

export const meta = {
  id: 'data_chart', name: 'Data chart', kind: 'info', version: 1,
  subjects: ['Maths', 'Science', 'Geography'],
  years: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'],
  teaches: 'How to show data as a tally, pictogram, block, bar, line or pie chart, read a value off the scale and answer a question from it.',
};

const KINDS = ['tally', 'pictogram', 'block', 'bar', 'line', 'pie'];
export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Data chart',
  properties: {
    title: TITLE_PARAM('Our favourite fruit'),
    chart: { type: 'string', title: 'Kind of chart', enum: KINDS, 'x-labels': ['Tally chart', 'Pictogram', 'Block chart', 'Bar chart', 'Line chart', 'Pie chart'], default: 'bar' },
    dataKind: { type: 'string', title: 'What the data is', description: 'A line chart is only for something measured over time. A pie chart is only for groups that make up one whole.',
      enum: ['groups', 'time'], 'x-labels': ['Separate groups (like favourite fruits)', 'Measured over time (like the temperature each hour)'], default: 'groups' },
    categoryName: { type: 'string', title: 'What the groups are', description: 'Names the first column or the bottom of the chart, like “Fruit” or “Time”.', default: 'Fruit', maxLength: 30 },
    valueName: { type: 'string', title: 'What the numbers are', description: 'Names the scale, like “Number of children”.', default: 'Number of children', maxLength: 34 },
    unit: { type: 'string', title: 'Unit', description: 'Said after a number, like “children”, “books” or “°C”.', default: 'children', maxLength: 16 },
    data: {
      type: 'array', title: 'Data', 'x-item': 'a group', minItems: 2, maxItems: 8,
      default: [{ label: 'Apples', value: 5 }, { label: 'Bananas', value: 7 }, { label: 'Grapes', value: 3 }, { label: 'Oranges', value: 4 }],
      items: { type: 'object', required: ['label', 'value'], default: { label: 'New group', value: 1 }, properties: {
        label: Object.assign(LABEL_PARAM('Name', 'New group'), { minLength: 1 }),
        value: { type: 'number', title: 'How many', minimum: 0, maximum: 100000 },
      } },
    },
    scaleStep: { type: 'number', title: 'Scale goes up in', description: 'Bar and line charts. 0 picks a step for you. A block chart always counts in ones.', default: 0, minimum: 0 },
    keyUnit: { type: 'integer', title: 'Each picture stands for', description: 'Pictograms only. Half a picture is allowed when this is an even number.', default: 2, minimum: 1, maximum: 100 },
    symbol: { type: 'string', title: 'Picture', enum: PICTO_SYMBOLS, 'x-labels': ['Circle', 'Square', 'Star', 'Person', 'Apple', 'Ball', 'Book'], default: 'disc' },
    show: { type: 'string', title: 'Pie labels show', enum: ['angle', 'percent', 'value'], 'x-labels': ['Angles (degrees)', 'Percentages', 'The numbers'], default: 'angle' },
    question: { type: 'string', title: 'Question to answer', enum: ['none', 'most', 'least', 'difference', 'total'], 'x-labels': ['None', 'Which is most?', 'Which is least?', 'How many more?', 'How many altogether?'], default: 'most' },
    between: {
      type: 'object', title: '“How many more” compares', 'x-panel': 'advanced', description: 'Group numbers in the list, counting from 1. Leave both at 0 to compare the most with the least.',
      default: { first: 0, second: 0 },
      properties: { first: { type: 'integer', title: 'This group', minimum: 0, maximum: 8, default: 0 }, second: { type: 'integer', title: 'With this group', minimum: 0, maximum: 8, default: 0 } },
    },
    text: TEXT_PARAM_FOR({ key: 'label', tally: 'label', total: 'label', scale: 'phrase', read: 'phrase', question: 'phrase' }),
  },
};

export const presets = [
  { id: 'y1-fruit', name: 'Year 1: our favourite fruit (block chart)', params: {
    title: 'Our favourite fruit', chart: 'block', categoryName: 'Fruit', valueName: 'Number of children', unit: 'children', question: 'most',
    data: [{ label: 'Apples', value: 5 }, { label: 'Bananas', value: 7 }, { label: 'Grapes', value: 3 }, { label: 'Oranges', value: 4 }, { label: 'Pears', value: 2 }],
  } },
  { id: 'y2-books', name: 'Year 2: books we read (pictogram)', params: {
    title: 'Books we read this week', chart: 'pictogram', categoryName: 'Day', valueName: 'Number of books', unit: 'books', symbol: 'book', keyUnit: 2, question: 'total',
    data: [{ label: 'Monday', value: 6 }, { label: 'Tuesday', value: 9 }, { label: 'Wednesday', value: 4 }, { label: 'Thursday', value: 7 }, { label: 'Friday', value: 10 }],
  } },
  { id: 'y3-sport', name: 'Year 3: bar chart in steps of 5', params: {
    title: 'Favourite sports in Year 3', chart: 'bar', categoryName: 'Sport', valueName: 'Number of children', unit: 'children', scaleStep: 5, question: 'difference',
    data: [{ label: 'Football', value: 23 }, { label: 'Swimming', value: 15 }, { label: 'Netball', value: 12 }, { label: 'Cricket', value: 8 }, { label: 'Tennis', value: 17 }],
  } },
  { id: 'y6-travel', name: 'Year 6: pie chart of a class survey', params: {
    title: 'How our class gets to school', chart: 'pie', categoryName: 'How we travel', valueName: 'Number of children', unit: 'children', show: 'angle', question: 'most',
    data: [{ label: 'Walk', value: 12 }, { label: 'Car', value: 8 }, { label: 'Bus', value: 6 }, { label: 'Bike', value: 4 }],
  } },
];

/* ------------------------------------------------------------------ model of the data */
const fmtN = v => Number.isInteger(v) ? fmtInt(v) : String(+v.toFixed(2));
const SING = { children: 'child', people: 'person', men: 'man', women: 'woman', feet: 'foot', teeth: 'tooth', mice: 'mouse', geese: 'goose' };
/** The unit for exactly one: children -> child, books -> book, people -> person; °C and cm stay. */
const unitOne = U => { const l = U.toLowerCase(); if (SING[l]) return SING[l];
  if (/[^aeiou]ies$/.test(l)) return U.slice(0, -3) + 'y'; if (/(ss|sh|ch|x)es$/.test(l)) return U.slice(0, -2);
  return /[a-z][^s]s$/.test(l) ? U.slice(0, -1) : U; };
const withU = (v, U) => U ? `${fmtN(v)} ${v === 1 ? unitOne(U) : U}` : fmtN(v);
const joinNames = a => a.length <= 1 ? (a[0] || '') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
/** Times or plain numbers in labels, so a line chart's even spacing can be checked. */
function timeVal(s) {
  s = String(s).trim().toLowerCase(); let m;
  if ((m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)$/))) return { v: (+m[1] % 12 + (m[3] === 'pm' ? 12 : 0)) * 60 + (+m[2] || 0), t: true };
  if ((m = s.match(/^(\d{1,2}):(\d{2})$/))) return { v: +m[1] * 60 + +m[2], t: true };
  if (/^-?\d+(\.\d+)?$/.test(s)) return { v: +s, t: false };
  return null;
}
const COUNTS = ['tally', 'pictogram', 'block'];
function model(P) {
  const kind = P.chart, U = P.unit || '';
  const D = (P.data || []).map((d, i) => ({ label: d.label, v: +d.value || 0, i }));
  const vals = D.map(d => d.v), n = D.length, total = vals.reduce((s, v) => s + v, 0);
  const max = Math.max(...vals), min = Math.min(...vals);
  const nt = kind === 'block' ? niceTop(Math.max(1, max), 1) : niceTop(Math.max(1, max), P.scaleStep > 0 ? P.scaleStep : undefined);
  const key = P.keyUnit || 1, q = P.question || 'none';
  let A = [], pair = null;
  if (q === 'most') A = D.filter(d => d.v === max).map(d => d.i);
  else if (q === 'least') A = D.filter(d => d.v === min).map(d => d.i);
  else if (q === 'difference') {
    const bw = P.between || {};
    let a = bw.first > 0 ? bw.first - 1 : D.findIndex(d => d.v === max), b = bw.second > 0 ? bw.second - 1 : D.findIndex(d => d.v === min);
    if (a === b) b = a === 0 ? 1 : 0;
    if ((vals[a] ?? 0) < (vals[b] ?? 0)) [a, b] = [b, a];
    pair = [a, b]; A = [a, b];
  }
  // the value read off the scale: never the answer, and preferably one that needs real reading
  const pool = D.filter(d => !A.includes(d.i)).length ? D.filter(d => !A.includes(d.i)) : D;
  const offLine = d => Math.abs(d.v / nt.step - Math.round(d.v / nt.step)) > 1e-9;
  let rt;
  if (kind === 'bar' || kind === 'line') rt = (pool.find(offLine) || pool[0]).i;
  else if (kind === 'pictogram') rt = (pool.find(d => Math.abs(d.v / key - Math.floor(d.v / key + 1e-9) - .5) < 1e-9 && d.v > key) || pool.find(d => d.v / key >= 2) || pool[0]).i;
  else if (kind === 'tally') rt = ([...pool].sort((x, y) => y.v - x.v).find(d => d.v > 5 && d.v % 5) || pool.reduce((x, y) => y.v > x.v ? y : x)).i;
  else if (kind === 'block') rt = (pool.find(d => d.v >= 3) || pool[0]).i;
  else rt = pool[0].i;
  const angles = pieAngles(vals), exact = vals.map(v => total > 0 && Math.abs(v * 360 / total - Math.round(v * 360 / total)) < 1e-9);
  return { kind, U, D, vals, n, total, max, min, nt, key, q, A, pair, rt, angles, exact };
}

/* ------------------------------------------------------------------ wording (computed from the data) */
function questionWords(M) {
  const L = M.kind === 'line', Pi = M.kind === 'pie';
  return { most: L ? 'When was it highest?' : Pi ? 'Which is the biggest slice?' : 'Which has the most?',
    least: L ? 'When was it lowest?' : Pi ? 'Which is the smallest slice?' : 'Which has the fewest?',
    difference: L ? 'What is the difference?' : 'How many more?', total: 'How many altogether?' }[M.q] || '';
}
/** Reading card: {sentence, result, path}. */
function reading(M) {
  const d = M.D[M.rt], st = M.nt.step, path = `data.${d.i}.value`;
  if (M.kind === 'bar' || M.kind === 'line') {
    const lo = Math.floor(d.v / st + 1e-9) * st, hi = lo + st; const where = M.kind === 'line' ? `At ${d.label} the line is` : `The bar for ${d.label} ends`;
    const sentence = Math.abs(d.v - lo) < 1e-9 ? `${where} on the ${fmtN(lo)} line.` : `${where} between the ${fmtN(lo)} and ${fmtN(hi)} lines.`;
    return { sentence, result: withU(d.v, M.U), path };
  }
  if (M.kind === 'block') return { sentence: `Count the blocks for ${d.label}.`, result: withU(d.v, M.U), path };
  if (M.kind === 'pictogram') {
    const full = Math.floor(d.v / M.key + 1e-9), half = d.v / M.key - full > .25;
    return { sentence: `${d.label}: ${full} picture${full === 1 ? '' : 's'}${half ? ' and a half' : ''}.`, result: `${full} × ${fmtN(M.key)}${half ? ` + ${fmtN(M.key / 2)}` : ''} = ${fmtN(d.v)}`, path: 'keyUnit' };
  }
  if (M.kind === 'tally') {
    const seq = []; for (let k = 5; k <= d.v; k += 5) seq.push(k); for (let k = seq.length * 5 + 1; k <= d.v; k++) seq.push(k);
    return { sentence: `Count the tally for ${d.label} in fives, then ones.`, result: seq.length > 6 ? `${seq.slice(0, 2).join(', ')} … ${fmtN(d.v)}` : seq.join(', '), path };
  }
  // pie: the angle for one
  const per = 360 / M.total; const perS = Number.isInteger(per) ? `${per}°` : `about ${per.toFixed(1)}°`;
  return { sentence: `${withU(M.total, M.U)} share the 360° of the circle, so each one is:`, result: `360° ÷ ${fmtN(M.total)} = ${perS}`, path: 'data' };
}
/** Answer card and caption. */
function answer(M) {
  const D = M.D, names = M.A.map(i => D[i].label), L = M.kind === 'line', Pi = M.kind === 'pie';
  const deg = i => `${M.exact[i] ? '' : 'about '}${M.angles[i]}°`;
  if (M.q === 'most' || M.q === 'least') {
    const v = M.q === 'most' ? M.max : M.min, i0 = M.A[0];
    const sentence = L ? `${M.q === 'most' ? 'Highest' : 'Lowest'} at ${joinNames(names)}.`
      : Pi ? `${joinNames(names)}: the ${M.q === 'most' ? 'biggest' : 'smallest'} slice${names.length > 1 ? 's' : ''}, ${deg(i0)}.`
      : `${joinNames(names)} ${names.length > 1 ? 'have' : 'has'} the ${M.q === 'most' ? 'most' : 'fewest'}.`;
    const caption = L ? `The ${M.q === 'most' ? 'highest' : 'lowest'} reading is ${withU(v, M.U)}, at ${joinNames(names)}.`
      : `${joinNames(names)} ${names.length > 1 ? 'have' : 'has'} the ${M.q === 'most' ? 'most' : 'fewest'}: ${withU(v, M.U)}.`;
    return { sentence, result: withU(v, M.U), path: `data.${i0}.value`, caption };
  }
  if (M.q === 'difference') {
    const [a, b] = M.pair, va = D[a].v, vb = D[b].v, d = va - vb;
    return { sentence: `${D[a].label} (${fmtN(va)}) and ${D[b].label} (${fmtN(vb)}).`, result: `${fmtN(va)} − ${fmtN(vb)} = ${fmtN(d)}`, path: `data.${a}.value`,
      caption: L ? `Between ${D[Math.min(a, b)].label} and ${D[Math.max(a, b)].label} the difference is ${fmtN(va)} − ${fmtN(vb)} = ${withU(d, M.U)}.` : `${D[a].label} has ${fmtN(d)} more than ${D[b].label}: ${fmtN(va)} − ${fmtN(vb)} = ${fmtN(d)}.` };
  }
  if (M.q === 'total') return { sentence: `${M.vals.map(fmtN).join(' + ')}`, result: withU(M.total, M.U), path: 'data', caption: `Add them all up: there are ${withU(M.total, M.U)} altogether.` };
  return null;
}

/** Key card for the first build: what one mark or one step of the scale stands for. */
function keyWords(M) {
  const U = M.U, st = M.nt.step;
  if (M.kind === 'bar' || M.kind === 'line') return { sentence: 'Each step up the scale is', result: withU(st, U), path: 'scaleStep' };
  if (M.kind === 'block') return { sentence: 'Each block stands for', result: withU(1, U), path: 'data' };
  if (M.kind === 'pictogram') return { sentence: `Each picture stands for${M.key % 2 === 0 ? ` ${fmtN(M.key)}, and half a picture for ${fmtN(M.key / 2)}` : ''}:`, result: withU(M.key, U), path: 'keyUnit' };
  if (M.kind === 'tally') return { sentence: 'One line is one. Four lines and one across make a gate of', result: withU(5, U), path: 'data' };
  return { sentence: `The whole circle is all ${withU(M.total, U)}:`, result: '360°', path: 'data' };
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const W = [];
  if (R.length) return result(R);
  // libfix: a bar's name sits in its share of the axis, so the more bars, the fewer letters fit (measured
  // with tools/laneFit): longer is refused, never cut
  { const n = P.data.length, rows = P.chart === 'tally' || P.chart === 'pictogram', most = rows ? 32 : n >= 7 ? 16 : n >= 5 ? 24 : 36;
    P.data.forEach((d, i) => { if (String(d.label).length > most) R.push({ path: `data.${i}.label`, reason: rows ? `Each row's name has room for ${most} letters; “${d.label}” has ${String(d.label).length}. Shorten it.` : `With ${n} bars, each name has room for ${most} letters; “${d.label}” has ${String(d.label).length}. Shorten it, or use fewer bars.` }); });
    if (R.length) return result(R); }
  const kind = P.chart, D = P.data, vals = D.map(d => +d.value), name = { tally: 'tally chart', pictogram: 'pictogram', block: 'block chart' }[kind];
  // counts are whole numbers
  if (COUNTS.includes(kind)) D.forEach((d, i) => { if (!Number.isInteger(+d.value)) R.push({ path: `data.${i}.value`, reason: `A ${name} counts things, so ${d.label} needs a whole number (not ${d.value}).` }); });
  if (R.length) return result(R);
  const M = model(P);
  if (kind === 'line') {
    if (P.dataKind !== 'time') R.push({ path: 'chart', reason: 'A line chart joins the points, which only makes sense for something measured over time, like the temperature each hour. For separate groups, use a bar chart.' });
    if (D.length < 3) R.push({ path: 'data', reason: 'A line chart needs at least three readings to show a change over time.' });
    // even spacing: the chart spaces readings equally, so the times must be equally spaced
    const tv = D.map(d => timeVal(d.label));
    if (!R.length && tv.every(Boolean) && tv.every(t => t.t === tv[0].t)) {
      const gaps = tv.slice(1).map((t, i) => t.v - tv[i].v); const u = tv[0].t ? ' minutes' : '';
      const back = gaps.findIndex(g => g <= 0);
      if (back >= 0) R.push({ path: `data.${back + 1}.label`, reason: `The readings must be in time order: ${D[back + 1].label} comes before ${D[back].label}.` });
      else { const odd = gaps.findIndex(g => Math.abs(g - gaps[0]) > 1e-9); if (odd >= 0) R.push({ path: `data.${odd + 1}.label`, reason: `The readings are not equally spaced in time (${D[0].label} to ${D[1].label} is ${gaps[0]}${u}, but ${D[odd].label} to ${D[odd + 1].label} is ${gaps[odd]}${u}). The chart spaces them evenly, so add the missing readings or use equal gaps.` }); }
    }
  }
  if (kind === 'pie') {
    if (P.dataKind === 'time') W.push({ path: 'dataKind', reason: 'A pie chart shows how one whole is shared between groups. Readings over time are not parts of a whole: switch to a line chart.' });
    if (D.length > 6) R.push({ path: 'data', reason: `A pie chart with ${D.length} slices is hard to read from the back of the room. Use six groups or fewer, or a bar chart.` });
    D.forEach((d, i) => { if (!(+d.value > 0)) R.push({ path: `data.${i}.value`, reason: `${d.label} is 0, so it has no slice. Take it out of the pie chart.` }); });
    // every angle is stated as exact, so every share of 360 must be a whole number of degrees
    // angles that are not whole degrees are rounded to the nearest degree and said to be "about"
    const tot = vals.reduce((s, v) => s + v, 0), odd = vals.findIndex(v => Math.abs(v * 360 / tot - Math.round(v * 360 / tot)) > 1e-9);
    if (!R.length && tot > 0 && odd >= 0) W.push({ path: 'data', reason: `With a total of ${fmtN(tot)}, some angles are not whole degrees (${D[odd].label} is ${+(vals[odd] * 360 / tot).toFixed(1)}°), so the chart rounds them to the nearest degree. For exact angles, use a total that divides 360, like 10, 12, 20, 24, 30, 36, 40, 60 or 72.` });
  }
  if (P.question === 'total' && kind === 'line') R.push({ path: 'question', reason: 'Readings on a line chart are not added together; ask for the highest, lowest or the difference.' });
  if (kind === 'block') { const bi = vals.findIndex(v => v > 15); if (bi >= 0) R.push({ path: `data.${bi}.value`, reason: `A block chart has one block for each, and ${D[bi].label} (${vals[bi]}) is too many blocks to count on one slide. Use 15 or fewer, or a bar chart with a scale.` }); }
  if (kind === 'tally') { const bi = vals.findIndex(v => v > 30); if (bi >= 0) R.push({ path: `data.${bi}.value`, reason: `${vals[bi]} tally marks for ${D[bi].label} is too many to count on one slide. Use 30 or fewer, or a bar chart.` }); }
  if (kind === 'pictogram') {
    const bad = pictogramCheck(vals, M.key);
    if (bad.length) { const i = bad[0]; R.push({ path: `data.${i}.value`, reason: `With each picture standing for ${M.key}, ${D[i].label} (${vals[i]}) cannot be drawn: it needs whole pictures${M.key % 2 === 0 ? ` or a half (${M.key / 2})` : ''}. Change the value or what each picture stands for.` }); }
    else { const big = vals.findIndex(v => v / M.key > 12); if (big >= 0) R.push({ path: 'keyUnit', reason: `${D[big].label} would need ${Math.ceil(vals[big] / M.key)} pictures, too many for one row. Make each picture stand for more.` }); }
  }
  if ((kind === 'bar' || kind === 'line') && P.scaleStep > 0) {
    const lines = M.nt.top / P.scaleStep;
    if (lines > 15) R.push({ path: 'scaleStep', reason: `Steps of ${fmtN(P.scaleStep)} up to ${fmtN(M.nt.top)} make ${Math.round(lines)} lines, too many to read. Use bigger steps, or leave it at 0 to pick one.` });
    else if (P.scaleStep > M.max) W.push({ path: 'scaleStep', reason: 'The steps are bigger than the tallest bar, so the scale shows only one line.' });
  }
  if (P.question === 'difference') {
    const bw = P.between || {};
    for (const k of ['first', 'second']) if (bw[k] > D.length) R.push({ path: `between.${k}`, reason: `There are only ${D.length} groups, so there is no group ${bw[k]}.` });
    if (bw.first > 0 && bw.first === bw.second) R.push({ path: 'between.second', reason: '“How many more” needs two different groups.' });
  }
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
function plan(P) {
  const M = model(P); const items = []; const U = M.U; const st = M.nt.step;
  const stepWords = st === 1 ? 'ones' : `${fmtN(st)}s`;
  const axesCap = {
    bar: `The scale goes up in ${stepWords}, starting from 0.`,
    block: 'Each block stands for one. The scale counts up in ones from 0.',
    pictogram: `Each picture stands for ${fmtN(M.key)}.${M.key % 2 === 0 ? ` Half a picture stands for ${fmtN(M.key / 2)}.` : ''}`,
    tally: 'Each line stands for one. The fifth line crosses the other four to make a gate of five.',
    line: `The scale goes up in ${stepWords} from 0. Time goes along the bottom.`,
    pie: `The whole circle is all ${withU(M.total, U)}: 360°.`,
  }[M.kind];
  items.push({ key: 'axes', caption: axesCap });
  if (M.kind === 'line') items.push({ key: 'line', caption: 'The line joins the readings in time order.' });
  else M.D.forEach(d => {
    const full = Math.floor(d.v / M.key + 1e-9), half = d.v / M.key - full > .25;
    const cap = {
      bar: `${d.label}: the bar rises to ${withU(d.v, U)}.`, block: `${d.label}: ${fmtN(d.v)} block${d.v === 1 ? '' : 's'}.`,
      pictogram: `${d.label}: ${full} picture${full === 1 ? '' : 's'}${half ? ' and a half' : ''}.`, tally: `${d.label}: ${fmtN(d.v)} tally mark${d.v === 1 ? '' : 's'}.`,
      pie: `${d.label}: ${fmtN(d.v)} out of ${fmtN(M.total)}, so ${M.exact[d.i] ? '' : 'about '}${M.angles[d.i]}° of the circle.`,
    }[M.kind];
    items.push({ key: `item:${d.i}`, caption: cap });
  });
  const rd = reading(M);
  items.push({ key: 'read', caption: M.kind === 'pie' ? `Each one of the ${withU(M.total, U)} is ${rd.result}.` : M.kind === 'tally' ? `${rd.sentence.replace(/\.$/, ':')} ${rd.result}.` : M.kind === 'pictogram' ? `${rd.sentence.replace(/\.$/, ',')} so ${rd.result}.` : `${rd.sentence} It shows ${rd.result}.` });
  const an = answer(M);
  if (an) items.push({ key: 'answer', caption: an.caption });
  const summary = an ? an.caption : M.kind === 'line' ? `The line shows how it changed from ${M.D[0].label} to ${M.D[M.n - 1].label}.` : `${M.n} groups, ${withU(M.total, U)} altogether.`;
  return { M, items, summary, rd, an };
}
export function builds(P) { const { items, summary } = plan(P); return { steps: items.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }

export function notes(P) {
  const { M, items } = plan(P);
  const steps = items.map(it => {
    if (it.key === 'axes') return {
      bar: 'The scale starts at 0, so the heights of the bars compare fairly. Ask: what does each line on the scale stand for?',
      block: 'One block is one. Count with the class as each column builds.',
      pictogram: `Check the key first. ${M.key % 2 === 0 ? `A half picture is ${fmtN(M.key / 2)}.` : 'This key is odd, so there are no half pictures.'} Ask: how many is three pictures?`,
      tally: 'Tally marks are grouped in fives so they are quick to count. Ask the class to count in fives along each row.',
      line: 'A line chart is for something measured over time. The line between two readings is an estimate: nobody measured there.',
      pie: 'The angles are worked out from the data: each one is its share of 360°. Measure one with a protractor to check.',
    }[M.kind];
    if (it.key === 'line') return 'Ask: when did it rise fastest? Where is the line steepest?';
    if (it.key.startsWith('item:')) { const d = M.D[+it.key.slice(5)]; return M.kind === 'pie' ? `${fmtN(d.v)} ÷ ${fmtN(M.total)} × 360 = ${M.angles[d.i]}°${Number.isInteger(d.v * 360 / M.total) ? '' : ' (rounded to the nearest degree)'}.` : `Ask: is ${d.label} more or less than the one before?`; }
    if (it.key === 'read') return {
      bar: 'Run a ruler across from the top of the bar to the scale. Between two lines, work out what the halfway point is worth.',
      line: 'Read up from the time to the line, then across to the scale.', block: 'Each block is one, so counting the blocks gives the value.',
      pictogram: 'Multiply the whole pictures by the key, then add the half if there is one.', tally: 'Count each gate as five, then count on in ones.',
      pie: 'Divide 360 by the total to find the angle for one, then multiply by each group.',
    }[M.kind];
    if (it.key === 'answer') return M.q === 'difference' ? 'Find the difference by counting on from the smaller to the larger, or by taking away.' : M.q === 'total' ? 'Add the values. Ask: can we check by adding in a different order?' : 'Ask: how did you know without counting every one?';
    return '';
  });
  return { steps, summary: 'Ask a question the chart cannot answer, and why. Then ask what else we could find out from it.' };
}

/* ------------------------------------------------------------------ render */
const CH = { x: GRID.left, y: 128, w: 856, h: 512 };   // chart area
const CARD = { x: 952, w: 264 };                        // side column: one card at a time
const CHR = CH.x + CH.w;
// type for the back of the room: about 1.5× the kit's chart text, built from the type tokens
const F = { tick: 'calc(var(--fs-min) * 1.5)', title: 'calc(var(--fs-small) * 1.4)', body: 'calc(var(--fs-small) * 1.4)', val: 'var(--fs-label)' };
const fsA = (fs, ink) => ({ style: `font-size:${fs}${ink ? ';fill:var(--ink)' : ''}` });

/** textBlock at the large size; when the wording is too long for that, fall back to the kit's own wrap-then-shrink. */
function tblock(p, x, y, s, o) {
  const tb = textBlock(p, x, y, s, o); if (tb.cls !== 'ts-tiny' || o.cls === 'ts-tiny') return tb;
  tb.el.remove(); const a = Object.assign({}, o.a); delete a.style;
  return textBlock(p, x, y, s, Object.assign({}, o, { a, lh: Math.min(o.lh, 30) }));
}
/** A card: heading (editable), a computed sentence and a computed result. Returns its height. */
function card(p, y, { head, headEdit, sentence, result: res, path, accent, ink, a }) {
  const g = h('g', a, p); const x = CARD.x + 22, w = CARD.w - 22;
  let base = y + 30;
  const hb = tblock(g, x, base, head, { cls: 'ts-small', maxW: w, maxLines: 4, lh: 38, edit: headEdit, a: Object.assign({ cls: 'strong' }, fsA(F.title, true)) });
  base += (hb.lines.length - 1) * hb.lh + 46;
  const sb = tblock(g, x, base, sentence, { cls: 'ts-small', maxW: w, maxLines: 5, lh: 40, a: fsA(F.body, true) }); computed(sb.el, path);
  const big = measure(g, res, 'ts-num') <= w;
  base += (sb.lines.length - 1) * sb.lh + (big ? 54 : 42);
  const rb = textBlock(g, x, base, res, { cls: big ? 'ts-num' : 'ts-label', maxW: w, maxLines: 2, lh: big ? 44 : 34, a: { fill: ink, cls: 'strong' } }); computed(rb.el, path);
  base += (rb.lines.length - 1) * rb.lh + 16;
  h('line', { x1: CARD.x, x2: CARD.x, y1: y, y2: base, stroke: accent, 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g);
  return base - y;
}
/** Re-set a one-line label as a wrapped block when it is too wide for its room. */
function rewrap(el, maxW, ctx, what) {
  if (!el || el.getComputedTextLength() <= maxW) return null;
  const p = el.parentNode, x = +el.getAttribute('x'), y = +el.getAttribute('y'), anchor = el.getAttribute('text-anchor') || 'start';
  const cls = (el.getAttribute('class') || 'ts-label').split(' ')[0];
  const tb = textBlock(p, x, y - 13, el.textContent, { cls, maxW, maxLines: 2, lh: 26, anchor, edit: el.dataset.edit });
  if (tb.lines.length === 1) tb.el.setAttribute('y', y);
  el.remove();
  if (tb.w > maxW + 1) ctx.warn(`The ${what} “${tb.lines.join(' ')}” is wider than its space.`);
  else if (/…$/.test(tb.lines[tb.lines.length - 1])) ctx.warn(`The ${what} “${el.textContent}” is too long for its space and is cut short.`);
  return tb;
}
/** An open book with a spine, centred on (x, y), half-width r: the pictogram's book picture. */
function book(g, x, y, r) {
  const t = y - r * .44, b = y + r * .56, e = r * .8;
  h('path', { d: `M${x} ${b + r * .12} L${x - e - r * .08} ${b - r * .04} L${x - e - r * .08} ${t + r * .06} L${x} ${t + r * .2} L${x + e + r * .08} ${t + r * .06} L${x + e + r * .08} ${b - r * .04} Z`, fill: 'var(--water)', 'stroke-linejoin': 'round' }, g);
  for (const s of [-1, 1]) {
    h('path', { d: `M${x} ${t + r * .1} Q${x + s * e * .5} ${t - r * .14} ${x + s * e} ${t - r * .02} L${x + s * e} ${b - r * .16} Q${x + s * e * .5} ${b - r * .28} ${x} ${b} Z`, fill: 'var(--paper)', stroke: 'var(--water)', 'stroke-width': 'var(--sw-rule)', 'stroke-linejoin': 'round', cls: 'body' }, g);
    for (const k of [0, 1, 2]) { const yy = t + r * (.24 + k * .24); h('line', { x1: x + s * e * .22, x2: x + s * e * .78, y1: yy, y2: yy, stroke: 'var(--water)', 'stroke-width': 'var(--sw-hair)', 'stroke-linecap': 'round' }, g); }
  }
}
/** Larger tick numbers where the scale lines are far enough apart for them. */
function bigTicks(g, gap) { if (gap >= 40) g.querySelectorAll('.ts-axis').forEach(t => { t.style.fontSize = F.tick; if (t.getAttribute('text-anchor') === 'end') t.setAttribute('y', +t.getAttribute('y') + 4); }); }

export function render(root, P, ctx) {
  const { M, rd, an } = plan(P); const b = ctx.b, N = ctx.N;
  const bi = k => b[k] ?? 0; const kr = bi('read'), ka = an ? bi('answer') : null; const s0 = bi('item:0');
  const under = h('g', {}, root);   // highlight bands sit beneath the chart
  const chartG = h('g', {}, root);
  const softFrom = i => (ka != null && M.A.length && !M.A.includes(i)) ? `${ka}:soft` : null;
  const readA = ka != null ? { s: kr, hide: ka } : { s: kr, c: `${N}:soft` };
  const data = M.D.map(d => ({ label: d.label, value: d.v }));
  const bigTitle = sel => { const el = chartG.querySelector(`[data-edit="${sel}"]`); if (el) { el.style.fontSize = F.title; el.style.fill = 'var(--ink)'; } };

  if (M.kind === 'bar' || M.kind === 'block') {
    const left = CH.x + 80, slot = (CHR - left) / M.n;
    // the group names: as large as 1.5× while the longest word still fits its slot
    const words = M.D.flatMap(d => String(d.label).split(/\s+/).filter(Boolean));
    const w36 = Math.max(1, ...words.map(w => measure(root, w, 'ts-small', fsA('calc(var(--fs-small) * 1.5)'))));
    const fsc = Math.max(22, Math.min(36, Math.floor(36 * (slot - 16) / w36))), catA = fsA(`calc(var(--fs-small) * ${(fsc / 24).toFixed(3)})`, true), lh = Math.round(fsc * 1.12);
    // too many groups for the names side by side: alternate them on two rows, one line each
    const stagger = w36 * fsc / 36 > slot - 16, lw = stagger ? 2 * slot - 28 : slot - 16, ml = stagger ? 1 : 4;
    const probe = h('g', {}, root);
    const nl = Math.max(1, ...M.D.map(d => tblock(probe, 0, 0, d.label, { cls: 'ts-small', maxW: lw, maxLines: ml, lh, a: catA }).lines.length)) + (stagger ? 1 : 0); probe.remove();
    const catH = P.categoryName ? 46 : 0, baseY = GRID.bottom - catH - (fsc + 14 + (nl - 1) * lh);
    const box = { x: CH.x + 10, y: CH.y + 24, w: CHR - CH.x - 10, h: baseY - CH.y - 24 + 64 };   // headroom for the value over the tallest bar
    const C = barChart(chartG, box, data, { step: M.nt.step, block: M.kind === 'block', sFrom: s0, yLabel: P.valueName, yLabelEdit: 'valueName', scalePath: 'scaleStep', labelPath: i => `data.${i}.label` });
    bigTicks(chartG, C.baseY - C.S(M.nt.step)); bigTitle('valueName');
    { const yl = chartG.querySelector('[data-edit="valueName"]'); if (yl) yl.setAttribute('y', CH.y + 12); }
    if (M.kind === 'block') [...chartG.querySelectorAll('line')].filter(l => l.style.stroke === 'var(--grid-line)').forEach(l => l.remove());   // the blocks are the count
    if (P.categoryName) editable(T(chartG, (left + CHR) / 2, GRID.bottom - 6, P.categoryName, 'ts-small', Object.assign({ 'text-anchor': 'middle', cls: 'strong' }, fsA(F.title, true))), 'categoryName');
    const bw = Math.min(150, slot * .74);
    C.bars.forEach((bar, i) => {
      bar.el.querySelectorAll('.body').forEach(r => { r.setAttribute('x', bar.x - bw / 2); r.setAttribute('width', bw); }); bar.w = bw;
      if (bar.label) bar.label.el.remove();
      bar.label = tblock(bar.el, bar.x, C.baseY + fsc + 8 + (stagger && i % 2 ? lh : 0), M.D[i].label, { cls: 'ts-small', maxW: lw, maxLines: ml, lh, anchor: 'middle', edit: `data.${i}.label`, a: catA });
      if (/…$/.test(bar.label.lines[bar.label.lines.length - 1])) ctx.warn(`The name “${M.D[i].label}” is too long for its bar and is cut short. Shorten it, or use fewer groups.`);
      else if (bar.label.w > lw + 8) ctx.warn(`The name “${M.D[i].label}” is wider than its bar's space.`);
      // a block chart says its count as each column lands
      if (M.kind === 'block') computed(T(bar.el, bar.x, bar.top - 14, fmtN(bar.value), 'ts-num', { 'text-anchor': 'middle', cls: 'halo' }), `data.${i}.value`);
      const sf = softFrom(i); if (sf) bar.el.dataset.c = sf;
    });
    // the reading: across from the top of the bar to the scale, and the value above it
    { const bar = C.bars[M.rt], y = C.S(bar.value); const g = h('g', readA, chartG);
      h('line', { x1: left, x2: bar.x - bar.w / 2, y1: y, y2: y, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '6 6' }, g);
      if (M.kind === 'bar') computed(T(g, bar.x, y - 14, fmtN(bar.value), 'ts-num', { 'text-anchor': 'middle', cls: 'halo' }), `data.${M.rt}.value`); }
    // the answer: the bars it is about turn to the focus colour
    if (ka != null) {
      for (const i of M.A) { const ov = h('g', { s: ka }, chartG); C.bars[i].el.querySelectorAll('.body').forEach(sh => { const c = sh.cloneNode(false); c.removeAttribute('class'); c.style.setProperty('fill', 'var(--focus)'); ov.appendChild(c); }); }
      if (M.pair) {
        const [a, bb] = M.pair, A1 = C.bars[a], B1 = C.bars[bb], ya = C.S(A1.value), yb = C.S(B1.value), dir = B1.x > A1.x ? 1 : -1;
        const g = h('g', { s: ka }, chartG);
        // the reference across from the taller bar shows where the gap starts, then fades for the summary
        h('line', { x1: A1.x + dir * A1.w / 2, x2: B1.x + dir * 12, y1: ya, y2: ya, stroke: 'var(--focus)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '6 6', hide: N > ka ? N : null }, g);
        if (yb - ya > 4) { h('line', { x1: B1.x, x2: B1.x, y1: ya, y2: yb - 4, stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)' }, g);
          h('line', { x1: B1.x - 12, x2: B1.x + 12, y1: ya, y2: ya, stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)' }, g); }
        const dl = fmtN(A1.value - B1.value), sd = B1.x + 18 + measure(g, dl, 'ts-big') > CHR ? -1 : dir;   // keep the number off the side column
        computed(T(g, B1.x + sd * 18, (ya + yb) / 2 + 18, dl, 'ts-big', { 'text-anchor': sd > 0 ? 'start' : 'end', fill: 'var(--focus-text)', cls: 'halo' }), `data.${a}.value`);
      }
    }
  }

  if (M.kind === 'pictogram') {
    const box = { x: CH.x, y: CH.y + 70, w: CH.w, h: GRID.bottom - CH.y };
    const C = pictogram(chartG, box, data, { key: M.key, symbol: P.symbol, sFrom: s0, labelPath: i => `data.${i}.label`, keyPath: 'keyUnit' });
    const rowH = Math.min(78, (box.h - 70) / M.n);
    const labW = Math.min(260, Math.max(...M.D.map(d => measure(root, d.label, 'ts-label'))) + 24);
    // the kit's key floats under the rows; the key is pinned above them instead, larger
    const kk = chartG.querySelector('[data-computed="keyUnit"]'); if (kk) kk.parentNode.remove();
    if (P.symbol === 'book') [...chartG.querySelectorAll('rect.body')].filter(r => r.style.fill === 'var(--water)').forEach(r => { const g = r.parentNode, rr = +r.getAttribute('width') / 1.6, x = +r.getAttribute('x') + rr * .8, y = +r.getAttribute('y') + rr * .62; while (g.firstChild) g.firstChild.remove(); book(g, x, y, rr); });
    { const kg = h('g', {}, chartG), ky = CH.y + 26, ks = Math.min(56, C.symbolSize * 1.1);
      { const kb = textBlock(kg, CH.x + labW - 24, ky - 5, txt(P, 'label:key', 'Key'), { cls: 'ts-label', maxW: labW - 24, maxLines: 2, lh: 26, anchor: 'end', edit: 'text.label:key', a: { cls: 'strong' } });
        if (kb.lines.length === 1) kb.el.setAttribute('y', ky + 12); }
      if (P.symbol === 'book') { const g = h('g', {}, kg); book(g, CH.x + labW + ks / 2, ky, ks / 2); } else pictoSymbol(kg, P.symbol, CH.x + labW + ks / 2, ky, ks);
      computed(T(kg, CH.x + labW + ks + 16, ky + 14, `= ${withU(M.key, M.U)}`, 'ts-num'), 'keyUnit');
      h('line', { x1: CH.x - 12, x2: CHR, y1: CH.y + 62, y2: CH.y + 62, stroke: 'var(--rule)', 'stroke-width': 'var(--sw-hair)' }, kg); }
    C.rows.forEach((r, i) => { rewrap(r.g.querySelector('[data-edit]'), labW - 24, ctx, 'name'); const sf = softFrom(i); if (sf) r.g.dataset.c = sf; });
    const band = (i, fill, a) => h('rect', Object.assign({ x: CH.x - 12, y: C.rows[i].y - rowH / 2 + 3, width: CH.w + 12, height: rowH - 6, rx: 'var(--r-mark)', fill }, a), under);
    band(M.rt, 'var(--focus-pale)', readA);
    if (ka != null) for (const i of M.A) band(i, 'var(--focus-pale)', { s: ka });
  }

  if (M.kind === 'tally') {
    const top = CH.y + 30, headH = 46, rowH = Math.min(72, (CH.y + CH.h - 20 - top - headH) / M.n);
    const labW = Math.min(300, Math.max(measure(root, P.categoryName || '', 'ts-small', Object.assign({ cls: 'strong' }, fsA(F.title))), ...M.D.map(d => measure(root, d.label, 'ts-label'))) + 32);
    const tx = CH.x + labW + 24, totX = CHR - 40;
    const hd = h('g', {}, chartG); const hA = Object.assign({ cls: 'strong' }, fsA(F.title, true));
    editable(T(hd, CH.x, top + 28, P.categoryName || '', 'ts-small', hA), 'categoryName');
    editable(T(hd, tx, top + 28, txt(P, 'label:tally', 'Tally'), 'ts-small', hA), 'text.label:tally');
    editable(T(hd, totX, top + 28, txt(P, 'label:total', 'Total'), 'ts-small', Object.assign({ 'text-anchor': 'middle' }, hA)), 'text.label:total');
    h('line', { x1: CH.x - 12, x2: CHR, y1: top + headH, y2: top + headH, stroke: 'var(--axis)', 'stroke-width': 'var(--sw-rule)' }, hd);
    for (const x of [tx - 18, totX - 56]) h('line', { x1: x, x2: x, y1: top, y2: top + headH + rowH * M.n, stroke: 'var(--rule)', 'stroke-width': 'var(--sw-hair)' }, hd);
    const th = Math.min(44, rowH * .6);
    M.D.forEach((d, i) => {
      const yc = top + headH + rowH * (i + .5); const rg = h('g', { s: bi(`item:${i}`), cls: 'rise', c: softFrom(i) }, chartG);
      const tb = textBlock(rg, CH.x, yc + 9, d.label, { cls: 'ts-label', maxW: labW - 32, maxLines: 3, lh: 26, edit: `data.${i}.label` }); // libfix: a third line before any cut
      if (tb.lines.length > 1) tb.el.setAttribute('y', yc + 9 - 13);
      const tl = tally(rg, tx, yc + th / 2, d.v, { h: th });
      if (tx + tl.w > totX - 70) ctx.warn(`The tally for ${d.label} runs into the totals.`);
      h('line', { x1: CH.x - 12, x2: CHR, y1: yc + rowH / 2, y2: yc + rowH / 2, stroke: 'var(--rule)', 'stroke-width': 'var(--sw-hair)' }, chartG);
      // the totals column fills in when the tally is counted
      computed(T(chartG, totX, yc + 10, fmtN(d.v), 'ts-label', { 'text-anchor': 'middle', cls: 'strong', s: kr, c: softFrom(i) }), `data.${i}.value`);
    });
    const band = (i, fill, a) => h('rect', Object.assign({ x: CH.x - 12, y: top + headH + rowH * i + 3, width: CH.w + 12, height: rowH - 6, rx: 'var(--r-mark)', fill }, a), under);
    band(M.rt, 'var(--focus-pale)', readA);
    if (ka != null) for (const i of M.A) band(i, 'var(--focus-pale)', { s: ka });
  }

  let lineHook = null;
  if (M.kind === 'line') {
    const box = { x: CH.x + 10, y: CH.y, w: CH.w - 10, h: CH.h - 24 };
    const pts = M.D.map(d => ({ x: d.i, y: d.v }));
    const C = lineChart(chartG, box, pts, { xMin: 0, xMax: Math.max(1, M.n - 1), xStep: 1, xFmt: () => '', step: M.nt.step, yLabel: P.valueName, yLabelEdit: 'valueName', xLabel: P.categoryName, xLabelEdit: 'categoryName', scalePath: 'scaleStep', xPath: 'data' });
    const baseY = box.y + box.h - 70;
    bigTicks(chartG, baseY - C.S(M.nt.step)); bigTitle('valueName'); bigTitle('categoryName');
    { const yl = chartG.querySelector('[data-edit="valueName"]'); if (yl) yl.setAttribute('y', CH.y + 8); }
    { const xl = chartG.querySelector('[data-edit="categoryName"]'); if (xl) { xl.setAttribute('x', (box.x + 70 + box.x + box.w - 20) / 2); xl.setAttribute('y', baseY + 86); xl.setAttribute('text-anchor', 'middle'); } }
    const kl = bi('line'); C.path.dataset.s = kl; C.dots.forEach(d => { d.dataset.s = kl; });
    const lane = [], xA = fsA('calc(var(--fs-small) * 1.3)', true);
    M.D.forEach(d => { const w = measure(root, d.label, 'ts-small', xA); const x = C.X(d.i); const pl = lanePlace(lane, w, x, { gap: 28, shift: 0, min: CH.x, max: CHR + 20 });
      if (pl) editable(T(chartG, x, baseY + 40, d.label, 'ts-small', Object.assign({ 'text-anchor': 'middle' }, xA)), `data.${d.i}.label`); });
    { const x = C.X(M.rt), y = C.S(M.D[M.rt].v); const g = h('g', readA, chartG);
      h('path', { d: `M${x} ${baseY} V${y} H${box.x + 70}`, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '6 6' }, g);
      computed(T(g, x, y - 22, fmtN(M.D[M.rt].v), 'ts-num', { 'text-anchor': 'middle', cls: 'halo' }), `data.${M.rt}.value`); }
    if (ka != null) for (const i of M.A) h('circle', { cx: C.X(i), cy: C.S(M.D[i].v), r: 17, fill: 'none', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)', s: ka, cls: 'pop' }, chartG);
    lineHook = { kl, set: C.set };
  }

  if (M.kind === 'pie') {
    // the circle gives way (down to radius 150) so long names have room beside it on two lines
    const longest = Math.max(...M.D.map(d => measure(root, d.label, 'ts-label'))), need = Math.min(longest, longest / 2 + 40);
    const cx = (CH.x + CHR) / 2, cy = CH.y + 244, r = Math.round(Math.max(150, Math.min(200, 200 - (need - 172))));
    h('circle', { cx, cy, r, fill: 'none', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-struct)' }, chartG);
    const C = pie(chartG, cx, cy, r, data, { sFrom: s0, show: P.show, labelPath: i => `data.${i}.label` });
    C.sectors.forEach((sec, i) => {
      const side = Math.cos(sec.mid * Math.PI / 180) >= 0 ? 1 : -1; const lab = sec.g.querySelector('[data-edit]');
      const room = side > 0 ? CHR - (cx + r + 56) : (cx - r - 56) - CH.x;
      const tb = rewrap(lab, room, ctx, 'name');
      const v = sec.g.querySelector('[data-computed]'); v.style.fontSize = F.val; v.style.fill = 'var(--ink)';
      if ((P.show || 'angle') === 'angle' && !M.exact[i]) v.textContent = `about ${v.textContent}`;   // a rounded angle says so
      v.setAttribute('y', +v.getAttribute('y') + 6 + (tb && tb.lines.length > 1 ? 13 : 0));
      const sf = softFrom(i); if (sf) sec.g.dataset.c = sf;
    });
    if (ka != null) { let a = 0; M.angles.forEach((deg, i) => { const a0 = (90 - a) * Math.PI / 180, a1 = (90 - a - deg) * Math.PI / 180; a += deg; if (!M.A.includes(i)) return;
      const d = deg >= 360 ? `M${cx} ${cy - r} A${r} ${r} 0 1 1 ${cx - .01} ${cy - r} Z` : `M${cx} ${cy} L${cx + r * Math.cos(a0)} ${cy - r * Math.sin(a0)} A${r} ${r} 0 ${deg > 180 ? 1 : 0} 1 ${cx + r * Math.cos(a1)} ${cy - r * Math.sin(a1)} Z`;
      h('path', { d, fill: 'none', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-data)', 'stroke-linejoin': 'round', s: ka }, chartG); }); }
  }

  /* the side column, one card at a time: the key or scale, then how one value is read, then the answer */
  const kw = keyWords(M), y0 = CH.y + 8;
  card(root, y0, { head: txt(P, 'label:scale', M.kind === 'bar' || M.kind === 'line' ? 'The scale' : 'The key'), headEdit: 'text.label:scale', sentence: kw.sentence, result: kw.result, path: kw.path,
    accent: 'var(--ink-3)', ink: 'var(--ink)', a: { hide: kr } });
  card(root, y0, { head: txt(P, 'label:read', 'Reading the chart'), headEdit: 'text.label:read', sentence: rd.sentence, result: rd.result, path: rd.path,
    accent: 'var(--ink-3)', ink: 'var(--ink)', a: Object.assign({ cls: 'rise' }, ka != null ? { s: kr, hide: ka } : { s: kr }) });
  if (an) card(root, y0, { head: txt(P, 'label:question', questionWords(M)), headEdit: 'text.label:question', sentence: an.sentence, result: an.result, path: an.path,
    accent: 'var(--focus)', ink: 'var(--focus-text)', a: { s: ka, cls: 'rise' } });

  if (!lineHook) return {};
  const L = lineHook;
  return {
    dur: { line: 2400 },
    still() { L.set(1); },
    reset() { L.set(0); },
    tick(k, u) { L.set(k > L.kl ? 1 : k === L.kl ? u : 0); },
  };
}
