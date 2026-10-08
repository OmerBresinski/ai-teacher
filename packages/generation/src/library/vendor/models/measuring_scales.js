// Reading scales: a ruler, tape, measuring jug, kitchen scale, thermometer or force meter with
// honest graduations. Builds: the instrument -> its numbers -> work out what one mark is worth
// (count the gaps) -> the reading moves to the value -> a magnifier reads it close up.
// Built on the kit and the batch B gauge; the force meter is drawn here (model-private).
import {
  h, T, clamp, lerp, eIO, GRID, textBlock, magnifier,
  editable, computed, txt, TEXT_PARAM, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { gauge, fmtNum, locale, INSTRUMENT_UNITS } from '../kit/batch-B.js';

export const meta = {
  id: 'measuring_scales', name: 'Reading scales', kind: 'scene', version: 1,
  subjects: ['Maths', 'Science'],
  years: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'],
  teaches: 'How to read a scale: find what the numbers go up in, work out what each unmarked step is worth, then read the value.',
};

const INSTRUMENTS = ['ruler', 'tape', 'jug', 'scale', 'thermometer', 'force'];
const INST_LABELS = ['Ruler', 'Tape measure', 'Measuring jug', 'Kitchen scale (dial)', 'Thermometer', 'Force meter (newton meter)'];
const UNITS = ['auto', 'mm', 'cm', 'm', 'in', 'ft', 'ml', 'l', 'fl oz', 'g', 'kg', 'oz', 'lb', '°C', '°F', 'N'];
const UNIT_LABELS = ['Usual unit for this instrument', 'millimetres (mm)', 'centimetres (cm)', 'metres (m)', 'inches (in)', 'feet (ft)', 'millilitres (ml)', 'litres (l)', 'fluid ounces (fl oz)', 'grams (g)', 'kilograms (kg)', 'ounces (oz)', 'pounds (lb)', 'degrees Celsius (°C)', 'degrees Fahrenheit (°F)', 'newtons (N)'];
const UNIT_WORDS = { mm: 'millimetres', cm: 'centimetres', m: 'metres', in: 'inches', ft: 'feet', ml: 'millilitres', l: 'litres', 'fl oz': 'fluid ounces', g: 'grams', kg: 'kilograms', oz: 'ounces', lb: 'pounds', '°C': 'degrees Celsius', '°F': 'degrees Fahrenheit', N: 'newtons' };
const QUANTITY = { length: 'length', capacity: 'capacity', mass: 'mass', temperature: 'temperature', force: 'force' };
const INST_NAME = { ruler: 'A ruler', tape: 'A tape measure', jug: 'A measuring jug', scale: 'A kitchen scale', thermometer: 'A thermometer', force: 'A force meter' };

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Reading scales',
  properties: {
    title: TITLE_PARAM('Reading a scale'),
    instrument: { type: 'string', title: 'Instrument', enum: INSTRUMENTS, 'x-labels': INST_LABELS, default: 'jug' },
    unit: { type: 'string', title: 'Unit', description: 'It has to suit the instrument: no grams on a jug.', enum: UNITS, 'x-labels': UNIT_LABELS, default: 'auto' },
    min: { type: 'number', title: 'Scale starts at', default: 0 },
    max: { type: 'number', title: 'Scale ends at', default: 500 },
    interval: { type: 'number', title: 'Each mark is worth', description: 'The step between one mark and the next. It must divide the scale exactly.', minimum: 0.001, default: 50 },
    value: { type: 'number', title: 'The reading', description: 'Where the level, pointer or end sits on the scale.', default: 350 },
    unlabelledTicks: { type: 'boolean', title: 'Leave some marks without numbers', description: 'On: pupils work out what the unnumbered marks are worth. Off: every mark has a number.', default: true },
    numbersEvery: { type: 'number', title: 'Numbers written every', description: '0 chooses for you. Must be a whole number of marks.', minimum: 0, default: 0 },
    thing: { type: 'string', title: 'What is being measured', description: 'Shown with the reading, like “water” or “the pencil”. Leave empty for none.', maxLength: 56 /* libfix: what the lane holds at the most items (tools/laneFit); longer is refused, never cut */, default: '' },
    zoom: { type: 'boolean', title: 'Magnify the reading', description: 'A last step that shows the reading close up.', default: true },
    locale: { type: 'string', title: 'Country (units)', enum: ['GB', 'US', 'EU', 'IN'], 'x-labels': ['United Kingdom', 'United States', 'Europe', 'India'], default: 'GB', 'x-panel': 'advanced' },
    text: TEXT_PARAM,
  },
};

export const presets = [
  { id: 'y2-jug', name: 'Year 2: a jug holding 350 ml', params: {
    title: 'How much water is in the jug?', instrument: 'jug', unit: 'ml', min: 0, max: 500, interval: 50, numbersEvery: 100, value: 350, thing: 'Water', zoom: true } },
  { id: 'y3-ruler', name: 'Year 3: a ruler, 75 mm', params: {
    title: 'How long is the pencil?', instrument: 'ruler', unit: 'mm', min: 0, max: 150, interval: 1, numbersEvery: 10, value: 75, thing: 'The pencil', zoom: true } },
  { id: 'y4-scale', name: 'Year 4: a kitchen scale, 650 g', params: {
    title: 'How heavy is the flour?', instrument: 'scale', unit: 'g', min: 0, max: 1000, interval: 50, numbersEvery: 100, value: 650, thing: 'Flour', zoom: true } },
  { id: 'y5-thermometer', name: 'Year 5: a thermometer at −3 °C', params: {
    title: 'How cold is it?', instrument: 'thermometer', unit: '°C', min: -10, max: 30, interval: 1, numbersEvery: 10, value: -3, thing: 'Outside at 7 am', zoom: true } },
];

/* ------------------------------------------------------------------ the scale, in code */
const near = (a, b) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
const isMult = (v, m) => near(v / m, Math.round(v / m));
const LABEL_MULTS = [1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
// pixels per unit and the gap a label row needs, per instrument (matches the layout in render)
const GEOM = {
  ruler: { len: 1032, dir: 'h' }, tape: { len: 1032, dir: 'h' },
  jug: { len: 400, dir: 'v' }, thermometer: { len: 400, dir: 'v' }, force: { len: 180, dir: 'v' },
  scale: { len: 190 * 300 * Math.PI / 180, labelLen: 130 * 300 * Math.PI / 180, dir: 'h' },
};
// ts-axis (22 units): digits and minus about 12.5 wide, commas and points about 5
const estW = s => [...s].reduce((w, c) => w + (c === ',' || c === '.' ? 5 : 12.5), 0);
const unitOf = P => {
  if (P.unit && P.unit !== 'auto') return P.unit;
  const us = P.locale === 'US';
  return { ruler: us ? 'in' : 'cm', tape: us ? 'in' : 'cm', jug: 'ml', scale: 'g', thermometer: us ? '°F' : '°C', force: 'N' }[P.instrument] || '';
};
const withUnit = (v, u) => `${fmtNum(v)} ${u}`;
function labelFits(P, LE) {
  const G = GEOM[P.instrument], span = P.max - P.min;
  const px = (G.labelLen || G.len) / span * LE;
  const w = Math.max(estW(fmtNum(P.min)), estW(fmtNum(P.max)));
  const need = G.dir === 'v' ? 34 : P.instrument === 'scale' ? w + 12 : w + 28; // dial labels sit round a circle, so they need less
  return px >= need;
}
const floorTo = (v, L) => +(Math.floor(v / L + 1e-9) * L).toFixed(10);
const ceilTo = (v, L) => +(Math.ceil(v / L - 1e-9) * L).toFixed(10);
// every unit any country uses for this instrument's quantity (inches on a British ruler are fine)
const unitsAnywhere = inst => [...new Set(['GB', 'US', 'EU', 'IN'].flatMap(c => locale(c).unitsFor(inst)))].filter(u => UNIT_WORDS[u]);
const usualUnit = P => unitOf(Object.assign({}, P, { unit: 'auto' }));
/** Fit the settings to one honest scale. Settings the instrument decides (its unit family, a ruler
 *  starting at 0) are derived with a note, the scale widens to start and end on a number, and the
 *  numbers are spaced as often as they fit. Returns the fitted settings, refusals and notes. */
function fit(P0) {
  const P = Object.assign({}, P0), R = [], W = [], inst = P.instrument, fam = INSTRUMENT_UNITS[inst];
  if (P.unit !== 'auto' && !unitsAnywhere(inst).includes(P.unit)) {
    const u = usualUnit(P);
    W.push({ path: 'unit', reason: `${INST_NAME[inst]} measures ${QUANTITY[fam]}, so it can’t be marked in ${UNIT_WORDS[P.unit] || P.unit}. This one is marked in ${UNIT_WORDS[u]}.` });
    P.unit = u;
  }
  const unit = unitOf(P);
  let forced = false;
  if ((inst === 'ruler' || inst === 'tape') && P.min !== 0) { W.push({ path: 'min', reason: `A ${inst === 'tape' ? 'tape measure' : 'ruler'} starts at 0, at the first mark (not at the end), so the scale starts at 0.` }); P.min = 0; forced = true; }
  else if ((inst === 'jug' || inst === 'scale' || inst === 'force') && P.min < 0) { W.push({ path: 'min', reason: `${INST_NAME[inst]} can’t read less than nothing, so the scale starts at 0.` }); P.min = 0; forced = true; }
  if (forced && P.value < P.min) { W.push({ path: 'value', reason: `The reading can’t be below 0 on this instrument, so it shows 0.` }); P.value = P.min; }
  if (!(P.max > P.min)) { R.push({ path: 'max', reason: `The scale has to end above where it starts: ${fmtNum(P.max)} is not more than ${fmtNum(P.min)}.` }); return { P, R, W }; }
  const iv = P.interval, at = L => Object.assign({}, P, { min: floorTo(P.min, L), max: ceilTo(P.max, L) });
  let LE = null;
  if (!P.unlabelledTicks) { if (labelFits(at(iv), iv)) LE = iv; }
  else if (P.numbersEvery > 0) { // numbers sit on marks: the nearest whole number of steps, written less often if they would touch
    const n0 = Math.max(1, Math.round(P.numbersEvery / iv)), ne0 = +(n0 * iv).toFixed(10);
    if (!near(ne0, P.numbersEvery)) W.push({ path: 'numbersEvery', reason: `Numbers have to sit on marks, so they are written every ${fmtNum(ne0)} (${n0} step${n0 === 1 ? '' : 's'} of ${withUnit(iv, unit)}), not every ${fmtNum(P.numbersEvery)}.` });
    for (const m of LABEL_MULTS) { const L = +(ne0 * m).toFixed(10); if (labelFits(at(L), L)) { LE = L; break; } }
    if (LE != null && !near(LE, ne0)) W.push({ path: 'numbersEvery', reason: `Numbers every ${fmtNum(ne0)} would touch each other, so they are written every ${fmtNum(LE)}.` });
  }
  if (R.length) return { P, R, W };
  if (LE == null) {
    for (const m of LABEL_MULTS.slice(1)) { const L = iv * m; if (labelFits(at(L), L)) { LE = L; break; } }
    if (LE == null) { R.push({ path: 'interval', reason: 'No spacing of numbers fits this scale. Choose a bigger step or a shorter scale.' }); return { P, R, W }; }
    if (!P.unlabelledTicks) W.push({ path: 'unlabelledTicks', reason: `A number on every mark would touch the next, so numbers are written every ${withUnit(LE, unit)}.` });
  }
  const lo = floorTo(P.min, LE), hi = ceilTo(P.max, LE);
  if (lo !== P.min || hi !== P.max) W.push({ path: hi !== P.max ? 'max' : 'min', reason: `The scale runs from ${fmtNum(lo)} to ${fmtNum(hi)}, so it starts and ends on a number.` });
  Object.assign(P, { min: lo, max: hi, numbersEvery: LE, unlabelledTicks: LE > iv + 1e-9 });
  const tickPx = GEOM[inst].len / ((hi - lo) / iv);
  if (tickPx < 6) { const better = LABEL_MULTS.map(m => iv * m).find(s => GEOM[inst].len / ((hi - lo) / s) >= 6); R.push({ path: 'interval', reason: `${Math.round((hi - lo) / iv)} marks are too close together to see on one slide.${better ? ` Use marks every ${withUnit(better, unit)} or more.` : ' Use a shorter scale.'}` }); }
  return { P, R, W };
}
// the settings every part of the model draws from (fitted when they fit)
const prep = raw => { const P = withDefaults(params, raw), F = fit(P); return F.R.length ? Object.assign(P, { numbersEvery: P.max - P.min, unlabelledTicks: true }) : F.P; };
function model(P) {
  const unit = unitOf(P), step = P.interval, LE = P.numbersEvery || (P.max - P.min);
  const v = P.value, labels = [];
  for (let x = P.min; x <= P.max + 1e-9; x += LE) labels.push(+x.toFixed(10));
  let L0 = labels.filter(x => x <= v + 1e-9).pop(); if (L0 == null) L0 = P.min;
  if (near(L0, P.max) && labels.length > 1) L0 = labels[labels.length - 2];
  const L1 = +(L0 + LE).toFixed(10), gaps = Math.round(LE / step);
  const fromHigh = v - L0 > L1 - v; const from = fromHigh ? L1 : L0;
  const marks = Math.round(Math.abs(v - from) / step);
  const onMark = isMult(v - P.min, step);
  return { unit, step, LE, labels, L0, L1, gaps, from, fromHigh, marks, onMark, v };
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P0 = withDefaults(params, raw);
  const R0 = schemaCheck(params, P0);
  if (R0.length) return result(R0);
  const { P, R, W } = fit(P0);
  if (R.length) return result(R, W);
  const unit = unitOf(P), fam = INSTRUMENT_UNITS[P.instrument];
  if (fam === 'temperature') { const az = unit === '°F' ? -459.67 : -273.15; if (P.min < az || P.value < az) R.push({ path: P.value < az ? 'value' : 'min', reason: `Nothing can be colder than absolute zero (${withUnit(az, unit)}).` }); }
  if (P.value < P.min - 1e-9 || P.value > P.max + 1e-9) R.push({ path: 'value', reason: `${withUnit(P.value, unit)} is off the scale, which runs from ${fmtNum(P.min)} to ${fmtNum(P.max)}. Change the reading or the scale.` });
  if (R.length) return result(R, W);
  if (!isMult(P.value - P.min, P.interval)) W.push({ path: 'value', reason: `${withUnit(P.value, unit)} is between two marks, so pupils can only estimate it.` });
  return result(R, W);
}

/* ------------------------------------------------------------------ builds and notes */
const READ = {
  ruler: (M, u) => `Read where the end lines up, counting from 0 (not the edge): ${withUnit(M.v, u)}.`,
  tape: (M, u) => `Read where the end lines up, counting from 0: ${withUnit(M.v, u)}.`,
  jug: (M, u) => `Read the mark level with the top of the liquid: ${withUnit(M.v, u)}.`,
  scale: (M, u) => `The pointer turns and stops at ${withUnit(M.v, u)}.`,
  thermometer: (M, u) => M.v < 0 ? `The liquid stops ${fmtNum(-M.v)} degrees below zero: ${withUnit(M.v, u)}.` : `The liquid stops at ${withUnit(M.v, u)}.`,
  force: (M, u) => `The spring stretches and the pointer stops at ${withUnit(M.v, u)}.`,
};
function plan(P) {
  const M = model(P), u = M.unit, inst = P.instrument, fam = INSTRUMENT_UNITS[inst];
  const items = [];
  items.push({ key: 'instrument', caption: `${INST_NAME[inst]} measures ${QUANTITY[fam]}. This one is marked in ${UNIT_WORDS[u] || u}.` });
  const neg = P.min < 0 ? ' Below zero the numbers are negative.' : '';
  items.push({ key: 'numbers', caption: `The numbers go up in ${fmtNum(M.LE)}s.${neg}` });
  items.push({ key: 'interval', caption: M.gaps > 1 ? `From ${fmtNum(M.L0)} to ${fmtNum(M.L1)} there are ${M.gaps} gaps, so each mark is worth ${withUnit(M.step, u)}.` : `Every mark has a number, so each mark is worth ${withUnit(M.step, u)}.` });
  const approx = M.onMark ? '' : 'about ';
  items.push({ key: 'reading', caption: READ[inst](M, u).replace(/: (\S+ \S+)\.$/, `: ${approx}$1.`) });
  if (P.zoom) items.push({ key: 'zoom', caption: !M.onMark ? `Close up: it is between two marks, so we estimate ${withUnit(M.v, u)}.`
    : M.marks === 0 ? `Close up: it is exactly on the ${withUnit(M.from, u)} mark.`
    : `Close up: count ${M.fromHigh ? 'back' : 'on'} ${M.marks} mark${M.marks === 1 ? '' : 's'} of ${withUnit(M.step, u)} from ${fmtNum(M.from)} to reach ${fmtNum(M.v)}.` });
  const th = (P.thing || '').trim(), val = `${approx}${withUnit(M.v, u)}`;
  const summary = {
    ruler: th ? `${th} is ${val} long.` : `It is ${val} long.`, tape: th ? `${th} is ${val} long.` : `It is ${val} long.`,
    jug: th ? `The jug holds ${val} of ${th.toLowerCase()}.` : `The jug holds ${val}.`,
    scale: `The scale reads ${val}.`,
    thermometer: `The temperature is ${val}.`, force: `The force is ${val}.`,
  }[inst];
  return { M, items, summary };
}
export function builds(P) { P = prep(P); const { items, summary } = plan(P); return { steps: items.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }
export function notes(P) {
  P = prep(P); const { M, items } = plan(P); const u = M.unit, inst = P.instrument;
  const steps = items.map(it => ({
    instrument: `Ask: what does this measure, and what unit is it marked in? ${inst === 'ruler' || inst === 'tape' ? 'Point out that 0 is a mark a little way in from the end.' : inst === 'jug' ? 'Readings are taken with your eye level with the liquid.' : ''}`.trim(),
    numbers: `Ask: what do the numbers go up in? Count along them together${P.min < 0 ? ', and count down past zero into the negative numbers' : ''}.`,
    interval: M.gaps > 1 ? `Method: the difference between two numbers ÷ the number of gaps. ${fmtNum(M.L1)} − ${M.L0 < 0 ? `(${fmtNum(M.L0)})` : fmtNum(M.L0)} = ${fmtNum(M.LE)}, and ${fmtNum(M.LE)} ÷ ${M.gaps} = ${fmtNum(M.step)}. Count gaps, not marks.` : 'Every mark is numbered here. Next step: hide some numbers and work them out.',
    reading: `${M.onMark ? '' : 'The reading is between marks, so it can only be estimated. '}Ask: which numbered mark is it nearest to?`,
    zoom: !M.onMark ? (() => { const X = +(P.min + Math.floor((M.v - P.min) / M.step + 1e-9) * M.step).toFixed(6); return `It lies between ${fmtNum(X)} and ${fmtNum(+(X + M.step).toFixed(6))} (the marks either side), so estimate.`; })()
      : M.marks ? `Count ${M.fromHigh ? 'back' : 'on'} in ${fmtNum(M.step)}s from ${fmtNum(M.from)}: ${Array.from({ length: Math.min(M.marks, 6) }, (_, i) => fmtNum(+(M.from + (M.fromHigh ? -1 : 1) * (i + 1) * M.step).toFixed(6))).join(', ')}${M.marks > 6 ? ' …' : ''}.` : 'The reading sits on a numbered mark, so no counting is needed.',
  }[it.key]));
  // only ask about a neighbour that is on the scale
  const up = +(M.v + M.step).toFixed(6), dn = +(M.v - M.step).toFixed(6), hiOk = up <= P.max + 1e-9, loOk = dn >= P.min - 1e-9;
  const summary = hiOk && loOk ? `Ask: what would the reading be one mark higher? And one mark lower? (${withUnit(up, u)} and ${withUnit(dn, u)}.)`
    : hiOk ? `Ask: what would the reading be one mark higher? (${withUnit(up, u)}.)`
    : `Ask: what would the reading be one mark lower? (${withUnit(dn, u)}.)`;
  return { steps, summary };
}

/* ------------------------------------------------------------------ force meter (model-private) */
function forceMeter(p, o) {
  const { x, y, len, min, max, step, LE } = o, bw = 56, y0 = y + 20, yb = y0 + len + 20;
  const g = h('g', o.a || {}, p), S = v => y0 + (v - min) / (max - min) * len, cx = x + bw / 2;
  h('circle', { cx, cy: y - 22, r: 16, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-struct)' }, g);
  h('line', { x1: cx, x2: cx, y1: y - 6, y2: y, stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-struct)' }, g);
  h('rect', { x, y, width: bw, height: yb - y, rx: 'var(--r-mark)', fill: 'var(--paper)', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)', cls: 'body' }, g);
  const mv = h('g', {}, g); // pointer, rod and hook move together with the spring
  h('line', { x1: cx, x2: cx, y1: S(min), y2: yb + 16, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)' }, mv);
  h('rect', { x: x + 6, y: S(min) - 4, width: bw - 6, height: 8, rx: 3, fill: 'var(--heat)' }, mv);
  h('path', { d: `M${cx} ${yb + 16} v10 a10 10 0 1 1 -10 10`, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, mv);
  const load = h('g', o.loadA || {}, mv);
  h('rect', { x: cx - 30, y: yb + 46, width: 60, height: 34, rx: 'var(--r-mark)', fill: 'var(--metal)', cls: 'body' }, load);
  const n = Math.round((max - min) / step), labels = [];
  for (let i = 0; i <= n; i++) {
    const v = +(min + i * step).toFixed(10), yy = S(v), big = isMult(v - min, LE), mid = !big && isMult(LE / 2, step) && isMult(v - min, LE / 2);
    const l = big ? 30 : mid ? 20 : 12;
    h('line', { x1: x + bw - l, x2: x + bw, y1: yy, y2: yy, stroke: 'var(--axis)', 'stroke-width': big || mid ? 'var(--sw-rule)' : 'var(--sw-hair)' }, g);
    if (big) labels.push(computed(T(g, x + bw + 14, yy + 8, fmtNum(v), 'ts-axis', { 'text-anchor': 'start' }), o.computedPath));
  }
  const ut = T(g, x + bw + 14, y - 14, o.unit, 'ts-small', { 'text-anchor': 'start' });
  const needle = v => mv.setAttribute('transform', `translate(0 ${(S(clamp(v, min, max)) - S(min)).toFixed(2)})`);
  needle(o.value ?? min);
  return { g, S, at: v => [x + bw, S(v)], needle, tickPx: len / n, box: { x, y: y - 40, w: bw + 90, h: yb + 80 + len - y + 40 }, unitEl: ut };
}

/* ------------------------------------------------------------------ render */
export function render(root, P, ctx) {
  P = prep(P);
  const { M } = plan(P); const b = ctx.b, N = ctx.N, inst = P.instrument, u = M.unit;
  const kN = b.numbers, kI = b.interval, kR = b.reading, kZ = P.zoom ? b.zoom : null;
  const horiz = inst === 'ruler' || inst === 'tape';
  // a thermometer starts from 0 when the scale crosses it (the temperature falls or rises from there);
  // the pencil lies on the ruler from the start, so only the reading line appears
  const start = inst === 'ruler' ? M.v : inst === 'thermometer' && P.min < 0 && P.max > 0 && !near(P.value, 0) ? 0 : P.min;
  const common = { min: P.min, max: P.max, step: M.step, labelEvery: M.LE, value: start, unit: u, computedPath: 'numbersEvery', warn: ctx.warn };

  /* layout: the instrument, the lens and the cards each keep their own place */
  const RY = 280;                                   // ruler: top edge (the pencil rests on it)
  const DX = 640, DY = 414, DR = 198;               // dial: centre and radius
  const VX = inst === 'jug' ? 250 : 400;            // jug, thermometer, force meter: left edge
  const COL = { x: 916, w: 300 };                   // right column for cards
  const th = (P.thing || '').trim();

  /* the instrument */
  let G, kind = { ruler: 'ruler', tape: 'ruler', jug: 'jug', scale: 'dial', thermometer: 'thermometer' }[inst];
  const under = h('g', {}, root);
  if (inst === 'tape') { // the tape's case sits beyond the end of the scale, the hook before 0
    h('rect', { x: 1150, y: RY - 30, width: 112, height: 140, rx: 'var(--r-card)', fill: 'var(--metal)', cls: 'body' }, under);
    h('rect', { x: 84, y: RY - 4, width: 14, height: 70, rx: 3, fill: 'var(--metal-shade)' }, under);
  }
  if (inst === 'scale' && th) { // the flour in a bowl on the pan: it goes on, then the pointer turns
    const py = DY - DR - 64, fg = h('g', { s: kR, cls: 'rise' }, under);
    h('path', { d: `M${DX - 104} ${py - 34} Q${DX} ${py - 70} ${DX + 104} ${py - 34} Z`, fill: 'var(--sand)', stroke: 'var(--wood-line)', 'stroke-width': 'var(--sw-hair)' }, fg);
    h('path', { d: `M${DX - 118} ${py - 34} H${DX + 118} Q${DX + 104} ${py} ${DX + 60} ${py} H${DX - 60} Q${DX - 104} ${py} ${DX - 118} ${py - 34} Z`, fill: 'var(--metal-shade)', cls: 'body' }, fg);
  }
  if (kind === 'ruler') G = gauge(root, 'ruler', Object.assign(inst === 'ruler' ? { x: GRID.left, len: GRID.right - GRID.left - 56 } : { x: 96, len: GEOM.ruler.len }, { y: RY, readA: { s: kR } }, common));
  else if (kind === 'jug') G = gauge(root, 'jug', Object.assign({ x: VX, y: 124, len: 440, width: 250, readA: { s: kR } }, common));
  else if (kind === 'thermometer') G = gauge(root, 'thermometer', Object.assign({ x: VX, y: 140, len: 400 }, common));
  else if (kind === 'dial') G = gauge(root, 'dial', Object.assign({ x: DX, y: DY, r: DR, readA: { s: kR } }, common));
  else G = forceMeter(root, Object.assign({ x: VX, y: 150, len: GEOM.force.len, LE: M.LE, loadA: { s: kR, cls: 'rise' } }, common));
  // the numbers (and the unit) are their own build; the unit word comes from the unit setting
  const texts = [...G.g.querySelectorAll('text')], tickTs = texts.slice(0, M.labels.length);
  for (const t of texts) {
    if (t.dataset.computed === undefined) computed(t, 'unit');
    t.dataset.s = kN; t.classList.add('rise');
  }
  // tick numbers as big as the spacing allows (a row of numbers keeps a 28 gap)
  const labelPx = G.tickPx / M.step * M.LE;
  for (const fs of kind === 'dial' ? ['--fs-cap'] : ['--fs-label', '--fs-cap', '--fs-small', '--fs-min']) {
    for (const t of tickTs) t.style.fontSize = `var(${fs})`;
    const w = Math.max(0, ...tickTs.map(t => t.getComputedTextLength())), size = { '--fs-label': 30, '--fs-cap': 26, '--fs-small': 24, '--fs-min': 22 }[fs];
    if (kind === 'ruler' ? labelPx - w >= 28 : kind === 'dial' || labelPx - size >= 28) break;
  }
  if (kind === 'dial') { // each number the same distance in from its tick, whatever its width
    const rIn = DR - 8 - 30 - 12;
    M.labels.forEach((v, i) => {
      const t = tickTs[i]; if (!t) return;
      const a = G.S(v), c = Math.cos(a), s = Math.sin(a), bb = t.getBBox();
      const R = rIn - (Math.abs(c) * bb.width / 2 + Math.abs(s) * bb.height * .36);
      t.setAttribute('x', +t.getAttribute('x') + DX + R * c - (bb.x + bb.width / 2));
      t.setAttribute('y', +t.getAttribute('y') + DY + R * s - (bb.y + bb.height / 2));
    });
  }
  if (inst === 'ruler') { // the pencil lies on the ruler, its end at 0 (not the ruler's edge)
    const bar = G.g.querySelector('g[data-s] > rect'); if (bar) bar.style.display = 'none'; // the gauge's plain bar gives way to the pencil
    const x0 = G.S(P.min), xv = G.S(M.v), tip = Math.min(46, (xv - x0) * .3), y1 = RY - 1, y0 = y1 - 34, ym = (y0 + y1) / 2;
    const pg = h('g', {}, G.g); G.g.insertBefore(pg, G.g.firstChild);
    h('rect', { x: x0, y: y0, width: Math.max(0, xv - tip - x0), height: y1 - y0, rx: 3, fill: 'var(--compare)', cls: 'body' }, pg);
    h('line', { x1: x0 + 4, x2: xv - tip, y1: ym, y2: ym, stroke: 'var(--compare-text)', 'stroke-width': 'var(--sw-hair)' }, pg);
    h('path', { d: `M${xv - tip} ${y0} L${xv} ${ym} L${xv - tip} ${y1} Z`, fill: 'var(--sand)' }, pg);
    h('path', { d: `M${xv - tip * .3} ${ym - 5} L${xv} ${ym} L${xv - tip * .3} ${ym + 5} Z`, fill: 'var(--ink-2)' }, pg);
  }

  /* work out the interval: the gaps between two numbers, each its own dash */
  const brk = clamp(G.tickPx * .2, 2, 6); // the break between dashes, so each gap can be counted
  const seg = (va, vb) => {
    if (kind === 'ruler') { const y = RY + 88; return ['line', { x1: G.S(va) + brk, x2: G.S(vb) - brk, y1: y, y2: y }]; }
    if (kind === 'dial') { const pts = [], r = DR + 9, da = brk / r, a0 = G.S(va) + da, a1 = G.S(vb) - da; for (let i = 0; i <= 8; i++) { const a = lerp(a0, a1, i / 8); pts.push(`${(DX + r * Math.cos(a)).toFixed(1)} ${(DY + r * Math.sin(a)).toFixed(1)}`); } return ['path', { d: 'M' + pts.join(' L'), fill: 'none' }]; }
    const x = G.at(va)[0] + 7, y1 = G.S(va), y2 = G.S(vb), d = y2 > y1 ? brk : -brk; return ['line', { x1: x, x2: x, y1: y1 + d, y2: y2 - d }];
  };
  const recede = [ctx.rc('interval'), `${N}:soft`].filter(Boolean).join(',');
  const ig = h('g', { s: kI, c: recede }, root);
  for (let i = 0; i < M.gaps; i++) {
    const va = M.L0 + i * M.step, vb = M.L0 + (i + 1) * M.step, [tag, a] = seg(va, vb);
    h(tag, Object.assign(a, { stroke: 'var(--focus)', 'stroke-width': 'var(--sw-data)', 'stroke-linecap': 'round', cls: 'pop', delay: Math.round(i * Math.min(160, 900 / M.gaps)), s: kI }), ig);
  }

  /* where the lens, the method card and the answer card go */
  const kRead = P.zoom ? kZ : kR;
  const dialLeft = kind === 'dial' && Math.cos(G.S(M.v)) < 0; // the lens and answer go on the reading's side
  let lens, iPos, rPos;
  if (horiz) {
    const r = 104; lens = { r, cx: clamp(G.S((M.L0 + M.L1) / 2), GRID.left + 300 + 40 + r, GRID.right - 300 - 40 - r), cy: RY + 100 + 24 + r };
    iPos = { x: GRID.left, y: 440, w: 300 }; rPos = { x: GRID.right - 300, y: 440, w: 300, right: true };
  } else if (kind === 'dial') {
    const lx = dialLeft ? GRID.left : COL.x;
    lens = { r: 118, cx: lx + 150, cy: 470 };
    iPos = { x: dialLeft ? COL.x : GRID.left, y: 140, w: 300 }; rPos = { x: lx, y: P.zoom ? 160 : 440, w: 300 };
  } else {
    lens = { r: 124, cx: 780, cy: 340 };
    iPos = { x: COL.x, y: 140, w: 300 }; rPos = { x: COL.x, y: P.zoom ? 430 : 300, w: 300 };
  }

  /* the cards: how much one mark is worth, and the reading */
  const card = (x, y, w, rows, a, anchorRight) => {
    const g = h('g', a, root), bg = h('rect', { x, y, width: w, height: 10, rx: 'var(--r-card)', fill: 'var(--paper)', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)', cls: 'lift body' }, g);
    let yy = y + 18, wMax = 0; const els = [];
    for (const r of rows) {
      if (r.big) { const t = T(g, x + 22, yy + 50, r.s, 'ts-big', { fill: r.fill || 'var(--ink)' }); computed(t, r.computed); yy += 66; wMax = Math.max(wMax, t.getComputedTextLength()); els.push(t); continue; }
      const tb = textBlock(g, x + 22, yy + 26, r.s, { cls: r.cls || 'ts-small', maxW: w - 44, maxLines: r.lines || 2, lh: 30, edit: r.edit, a: r.fill ? { fill: r.fill } : {} });
      if (r.computed) computed(tb.el, r.computed); yy += tb.h + 4; wMax = Math.max(wMax, tb.w); els.push(tb.el);
    }
    const cw = Math.min(w, wMax + 44); bg.setAttribute('height', yy - y + 12); bg.setAttribute('width', cw);
    if (anchorRight) { const dx = w - cw; bg.setAttribute('x', x + dx); for (const e of els) { e.setAttribute('x', +e.getAttribute('x') + dx); for (const s of e.querySelectorAll('tspan')) s.setAttribute('x', +s.getAttribute('x') + dx); } }
    return { g, box: { x: anchorRight ? x + w - cw : x, y, w: cw, h: yy - y + 12 } };
  };
  const iRows = M.gaps > 1
    ? [{ s: `${fmtNum(M.L0)} to ${fmtNum(M.L1)}: ${M.gaps} gaps`, computed: 'interval' }, { s: `${fmtNum(M.LE)} ÷ ${M.gaps} = ${withUnit(M.step, u)}`, cls: 'ts-label', computed: 'interval', fill: 'var(--focus-text)' }]
    : [{ s: 'Each mark is worth', computed: 'interval' }, { s: withUnit(M.step, u), cls: 'ts-label', computed: 'interval', fill: 'var(--focus-text)' }];
  // the method card leaves once the answer shows, so the lens and the answer are the only focus
  const iCard = card(iPos.x, iPos.y, iPos.w, iRows, { s: kI, hide: kRead, cls: 'rise', c: recede });
  const rRows = [...(th ? [{ s: th, edit: 'thing', lines: kind === 'dial' ? 3 : 4 }] : []), { s: `${M.onMark ? '' : '≈ '}${withUnit(M.v, u)}`, big: true, computed: 'value' }];
  const rCard = card(rPos.x, rPos.y, rPos.w, rRows, { s: kRead, cls: 'rise', delay: P.zoom ? 700 : 1200 }, rPos.right);

  // the dial's lens sits under the answer card, however many lines the card's wording takes
  if (kind === 'dial') { const top = rCard.box.y + rCard.box.h + 14, bot = GRID.bottom ? GRID.bottom - 12 : 648; lens.cy = Math.max(lens.cy, top + lens.r); if (lens.cy + lens.r > bot) { lens.r = Math.max(80, (bot - top) / 2); lens.cy = top + lens.r; } }

  /* the magnifier: the same scale, close up, centred between the two numbers either side */
  if (P.zoom) {
    const mid = (M.L0 + M.L1) / 2;
    let sx, sy, f;
    if (kind === 'ruler') { sx = G.S(mid); sy = RY + 46; f = .95; }
    else if (kind === 'dial') { const a = G.S(mid); sx = DX + (DR - 50) * Math.cos(a); sy = DY + (DR - 50) * Math.sin(a); f = .65; }
    else { const [ax, ay] = G.at(mid); sx = ax + 30; sy = ay; f = .85; }
    const { cx, cy, r } = lens;
    const zr = clamp(Math.max(1.8 * G.tickPx, f * labelPx), r / 2.8, r / 1.25), zz = r / zr;
    const mg = magnifier(ctx, root, { id: 'read', sx, sy, sr: zr, cx, cy, r, a: { s: kZ, cls: 'pop', c: `${N}:soft` } });
    G.needle(M.v); const clone = G.g.cloneNode(true); G.needle(start);
    for (const el of [clone, ...clone.querySelectorAll('[data-s],[data-c],[data-h]')]) { delete el.dataset.s; delete el.dataset.c; delete el.dataset.h; el.classList.remove('rise', 'off'); }
    const holder = h('g', { transform: `translate(${cx} ${cy}) scale(${zz.toFixed(3)}) translate(${-sx} ${-sy})` }, mg.inner);
    holder.appendChild(clone);
    // a number the lens would cut is left out of the lens, so it can never be misread
    for (const t of [...clone.querySelectorAll('text')]) {
      const bb = t.getBBox(), iy = bb.height * .15;
      const far = Math.max(...[[bb.x, bb.y + iy], [bb.x + bb.width, bb.y + iy], [bb.x, bb.y + bb.height - iy], [bb.x + bb.width, bb.y + bb.height - iy]].map(([x, y]) => Math.hypot(x - sx, y - sy)));
      if (far > zr - 2) t.remove();
    }
    mg.rim();
    root.appendChild(ig); // the counted gaps stay on top of the cone
  }
  // the cards sit above the lens, so its cone and close-up pass under them
  root.appendChild(iCard.g); root.appendChild(rCard.g);

  /* the scale's words go on top, so the magnifier's ring and cone pass under them, never through */
  const topT = h('g', {}, root);
  for (const t of texts) { if (kind === 'ruler') t.classList.add('halo-paper'); topT.appendChild(t); }

  /* the reading moves in real time during its build */
  const dur = { reading: 1400 };
  return {
    dur,
    reset() { G.needle(start); },
    still() { G.needle(M.v); },
    tick(k, uu) { if (k < kR) G.needle(start); else if (k === kR) G.needle(lerp(start, M.v, eIO(uu))); else G.needle(M.v); },
  };
}
