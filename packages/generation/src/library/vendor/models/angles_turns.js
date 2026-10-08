// Angles and turns: one turn (or several in a row) of an arrow, the minute hand of a clock, a
// protractor reading, or angles on a straight line / round a point with one worked out.
// Builds: the start ray -> each turn sweeps -> the arc and its size -> its name -> the fact used.
// Every angle is drawn true to its value (maths convention: 0 = right, anticlockwise positive).
// Built on the kit and the batch C geometry parts (arcD, rightAngleMark) and the batch B clock.
import {
  h, T, measure, eIO, clamp, GRID, headD, overlaps,
  textBlock, editable, computed, txt, TEXT_PARAM, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { arcD, rightAngleMark } from '../kit/batch-C.js';
import { clockFace } from '../kit/batch-B.js';

export const meta = {
  id: 'angles_turns', name: 'Angles and turns', kind: 'info', version: 1,
  subjects: ['Maths'],
  years: ['Y2', 'Y3', 'Y4', 'Y5', 'Y6'],
  teaches: 'An angle is an amount of turn: quarter and half turns, right, acute, obtuse and reflex angles, measuring with a protractor, and angles on a line or round a point.',
};

const CONTEXTS = ['turn', 'clock', 'protractor', 'line', 'point'];
export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Angles and turns',
  required: ['context', 'angles'],
  properties: {
    title: TITLE_PARAM('Angles and turns'),
    context: { type: 'string', title: 'Show it as', enum: CONTEXTS, 'x-labels': ['An arrow turning', 'The minute hand of a clock', 'Measuring with a protractor', 'Angles on a straight line', 'Angles round a point'], default: 'turn' },
    angles: {
      type: 'array', title: 'Angles', description: 'In degrees. For a turn or a clock, each one is a turn after the last. On a line or round a point, tick “missing” on one to have it worked out.',
      'x-item': 'an angle', minItems: 1, maxItems: 4, default: [{ size: 90 }],
      items: { type: 'object', required: ['size'], default: { size: 45 }, properties: {
        size: { type: 'integer', title: 'Size (degrees)', minimum: 1, maximum: 360, default: 45 },
        letter: { type: 'string', title: 'Letter (like a or x)', maxLength: 3, default: '' },
        missing: { type: 'boolean', title: 'Missing: work it out', default: false },
      } },
    },
    direction: { type: 'string', title: 'Turning direction', enum: ['clockwise', 'anticlockwise'], 'x-labels': ['Clockwise', 'Anticlockwise'], default: 'clockwise' },
    units: { type: 'string', title: 'Say the size in', enum: ['degrees', 'turns', 'both'], 'x-labels': ['Degrees', 'Turns (quarter, half…)', 'Degrees and turns'], default: 'degrees' },
    showName: { type: 'boolean', title: 'Name the angle (acute, right, obtuse, reflex)', default: true },
    fact: { type: 'string', title: 'Finish with the fact', enum: ['auto', 'none'], 'x-labels': ['Yes (the fact that fits)', 'No'], default: 'auto' },
    start: { type: 'string', title: 'Start line points', description: 'For an arrow or angles round a point.', enum: ['auto', 'up', 'right', 'down', 'left'], 'x-labels': ['Automatic', 'Up', 'Right', 'Down', 'Left'], default: 'auto', 'x-panel': 'advanced' },
    text: TEXT_PARAM,
  },
};

export const presets = [
  { id: 'y2-quarter-half', name: 'Year 2: quarter and half turns', params: {
    title: 'Quarter and half turns', context: 'turn', angles: [{ size: 90 }, { size: 90 }], direction: 'clockwise', units: 'turns', showName: false, start: 'up' } },
  { id: 'y4-acute-obtuse', name: 'Year 4: acute or obtuse?', params: {
    title: 'Acute or obtuse?', context: 'turn', angles: [{ size: 130 }], direction: 'anticlockwise', units: 'degrees', showName: true, start: 'right' } },
  { id: 'y5-protractor', name: 'Year 5: measure with a protractor', params: {
    title: 'Measuring an angle', context: 'protractor', angles: [{ size: 65 }], direction: 'clockwise', units: 'degrees', showName: true } },
  { id: 'y6-missing-line', name: 'Year 6: missing angle on a straight line', params: {
    title: 'The missing angle', context: 'line', angles: [{ size: 65 }, { size: 115, letter: 'a', missing: true }], direction: 'anticlockwise', units: 'degrees', showName: false } },
];

/* ------------------------------------------------------------------ angle words */
const R = Math.PI / 180;
const deg = v => `${v}°`;
const TURN = { 90: 'a quarter turn', 180: 'a half turn', 270: 'a three-quarter turn', 360: 'a whole turn' };
const TURN_SHORT = { 90: 'quarter turn', 180: 'half turn', 270: 'three-quarter turn', 360: 'whole turn' };
const kindOf = v => v < 90 ? 'acute' : v === 90 ? 'right' : v < 180 ? 'obtuse' : v === 180 ? 'straight' : v < 360 ? 'reflex' : 'whole';
const NAME = { acute: 'an acute angle', right: 'a right angle', obtuse: 'an obtuse angle', straight: 'a straight angle', reflex: 'a reflex angle', whole: 'a whole turn' };
const SHORT = { acute: 'acute', right: 'right angle', obtuse: 'obtuse', straight: 'straight', reflex: 'reflex', whole: 'whole turn' };
const RULE = { acute: 'less than 90°', right: 'exactly 90°', obtuse: 'more than 90° and less than 180°', straight: 'exactly 180°', reflex: 'more than 180° and less than 360°', whole: 'all the way round' };
const RULE_T = { right: 'exactly a quarter turn', straight: 'exactly a half turn', reflex: 'more than a half turn and less than a whole turn', whole: 'all the way round' };
const NUMW = { 1: 'one', 2: 'two', 3: 'three', 4: 'four' };
const cap1 = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const START_A = { up: 90, right: 0, down: 270, left: 180 };
const WHOLE = { line: 180, point: 360 };
const clockSize = v => Math.max(6, Math.round(v / 6) * 6);

function model(P) {
  const c = P.context, dir = c === 'clock' ? -1 : (P.direction === 'clockwise' ? -1 : 1);
  const dirWord = dir < 0 ? 'clockwise' : 'anticlockwise';
  let items = (P.angles || []).map((a, i) => ({ i, size: +a.size, letter: String(a.letter || '').trim(), missing: !!a.missing && !!WHOLE[c] }));
  // a clock shows whole minutes: each turn is read to the nearest minute (6°)
  if (c === 'clock') items.forEach(a => { a.size = clockSize(a.size); });
  // only one angle can be worked out: the first one ticked; the others use the sizes typed in
  let seen = false; items.forEach(a => { if (a.missing) { if (seen) a.missing = false; seen = true; } });
  if (c === 'protractor') items = items.slice(0, 1);
  const whole = WHOLE[c] || null; const miss = items.find(a => a.missing) || null; const known = items.filter(a => !a.missing);
  if (whole && miss) miss.size = whole - known.reduce((s, a) => s + a.size, 0);
  const total = items.reduce((s, a) => s + a.size, 0);
  const startName = c === 'turn' ? (P.start === 'auto' ? 'up' : P.start) : c === 'point' ? (P.start === 'auto' ? 'right' : P.start) : null;
  const a0 = c === 'clock' ? 90 : (c === 'protractor' || c === 'line') ? (dir > 0 ? 0 : 180) : START_A[startName];
  const rays = [a0]; for (const a of items) rays.push(rays[rays.length - 1] + dir * a.size);
  const sweep = c === 'turn' || c === 'clock' || c === 'protractor';
  const turnsOK = v => v % 90 === 0;
  const useTurns = P.units !== 'degrees' && items.every(a => turnsOK(a.size)) && turnsOK(total);
  const useDeg = P.units !== 'turns' || !useTurns;
  const sizeWords = v => useTurns ? (useDeg ? `${TURN[v]} (${deg(v)})` : TURN[v]) : deg(v);
  const nameOf = a => a.letter || (a.missing ? '?' : '');
  const turnsOnly = useTurns && !useDeg;
  // turns only: say every size in quarter turns, never in degrees (degrees are taught from Year 5)
  const qWords = () => { const n = total / 90; return n === 1 ? 'Four quarter turns make a whole turn.' : `${cap1(NUMW[n])} quarter turns make ${TURN[total]}.`; };
  const nameCap = () => { const k = kindOf(total); return turnsOnly ? (k === 'whole' ? 'A whole turn goes all the way round.' : `${cap1(TURN[total])} makes ${NAME[k]}.`) : `${deg(total)} is ${NAME[k]}: ${RULE[k]}.`; };
  return { c, dir, dirWord, items, whole, miss, known, total, rays, a0, startName, sweep, useTurns, useDeg, turnsOnly, qWords, nameCap, sizeWords, nameOf,
    name: P.showName !== false, fact: P.fact !== 'none', minutes: total / 6 };
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const Rf = schemaCheck(params, P); const W = [];
  if (Rf.length) return result(Rf);
  const c = P.context, last = `angles.${P.angles.length - 1}.size`;
  const firstMiss = WHOLE[c] ? P.angles.findIndex(a => a.missing) : -1;
  const A = P.angles.map((a, i) => Object.assign({}, a, { missing: i === firstMiss, size: c === 'clock' ? clockSize(a.size) : a.size }));
  if (WHOLE[c] && P.angles.filter(a => a.missing).length > 1) W.push({ path: 'angles', reason: `Only one angle can be missing, so angle ${firstMiss + 1} is worked out and the others use the sizes typed in.` });
  const sum = arr => arr.reduce((s, a) => s + a.size, 0);
  if (c === 'turn' || c === 'clock') {
    const t = sum(A);
    if (t > 360) Rf.push({ path: last, reason: `These turns add up to ${t}°, which is more than a whole turn (360°). Make them add up to 360° or less.` });
  }
  if (c === 'clock') {
    if (P.direction !== 'clockwise') W.push({ path: 'direction', reason: 'The hands of a clock only turn clockwise, so the minute hand is shown turning clockwise.' });
    P.angles.forEach((a, i) => { if (a.size % 6) W.push({ path: `angles.${i}.size`, reason: `The minute hand turns 6° each minute, so ${a.size}° is shown as ${clockSize(a.size)}°, the nearest whole minute.` }); });
  }
  if (c === 'protractor') {
    if (A[0].size > 180) Rf.push({ path: 'angles.0.size', reason: `A protractor measures angles up to 180°. To show ${A[0].size}°, measure the ${360 - A[0].size}° on the other side and take it from 360°, or show it as an arrow turning.` });
    if (A.length > 1) W.push({ path: 'angles', reason: 'A protractor measures one angle at a time, so only the first angle is shown.' });
  }
  if (WHOLE[c]) {
    const whole = WHOLE[c], where = c === 'line' ? 'on a straight line' : 'round a point';
    const miss = A.filter(a => a.missing), known = A.filter(a => !a.missing), ks = sum(known);
    if (A.length < 2) Rf.push({ path: 'angles', reason: `Angles ${where} need at least two angles. Add another one, or tick “missing” on it to have it worked out.` });
    else if (miss.length === 1 && ks >= whole) Rf.push({ path: `angles.${A.findIndex(a => !a.missing)}.size`, reason: `Angles ${where} add up to ${whole}°, but the angles you know already make ${ks}°, so there is nothing left for the missing one. Make them add up to less than ${whole}°.` });
    else if (!miss.length && ks !== whole) Rf.push({ path: last, reason: `Angles ${where} add up to ${whole}°, but these make ${ks}°. Change one so they make ${whole}°, or tick “missing” on one to have it worked out.` });
    A.forEach((a, i) => { if (!a.missing && c === 'line' && a.size >= 180 && A.length > 1 && !Rf.some(r => r.path === `angles.${i}.size`)) Rf.push({ path: `angles.${i}.size`, reason: `An angle on a straight line next to another angle is less than 180°. ${a.size}° does not fit on a straight line.` }); });
  } else if (P.angles.some(a => a.missing)) W.push({ path: 'angles', reason: '“Missing” only works for angles on a straight line or round a point, so every size is shown.' });
  if (!Rf.length && P.units === 'turns') {
    const M = model(P); const bad = [...M.items.map(a => a.size), M.total].find(v => v % 90);
    if (bad) Rf.push({ path: 'units', reason: `${bad}° is not a whole number of quarter turns, so it cannot be said in turns. Choose degrees, or use 90°, 180°, 270° or 360°.` });
  }
  if (!Rf.length && P.units === 'both') { const M = model(P); if (!M.useTurns) W.push({ path: 'units', reason: 'Not every angle is a whole number of quarter turns, so sizes are shown in degrees only.' }); }
  return result(Rf, W);
}

/* ------------------------------------------------------------------ builds */
function factLines(M, P) {
  const { c, total, whole, miss, known, items } = M; const L = miss ? M.nameOf(miss) : '';
  const say = c === 'turn' ? (M.turnsOnly ? M.qWords() : 'A quarter turn is 90°.') : c === 'clock' ? (M.turnsOnly ? 'The minute hand makes a quarter turn every 15 minutes.' : 'Each minute, the minute hand turns 6°.') : c === 'protractor' ? 'Read from the 0 on the start line.'
    : c === 'line' ? 'Angles on a straight line add up to 180°.' : 'Angles round a point add up to 360°.';
  let eq = [];
  if (c === 'turn' && !M.turnsOnly) { const n = total / 90; eq = Number.isInteger(n) ? (n > 1 ? [`${n} × 90° = ${deg(total)}`] : []) : [`${deg(total)} ${total < 90 ? '<' : '>'} 90°`]; }
  if (c === 'clock') eq = [M.turnsOnly ? `${M.minutes} minutes: ${TURN_SHORT[total]}` : `${deg(total)} ÷ 6° = ${M.minutes} minute${M.minutes === 1 ? '' : 's'}`];
  if (c === 'protractor') eq = total === 90 ? [] : [`${deg(total)}, not ${deg(180 - total)}`];
  if (whole) eq = miss ? [`${L} = ${deg(whole)} − ${known.map(a => deg(a.size)).join(' − ')}`, `${L} = ${deg(miss.size)}`] : [`${items.map(a => deg(a.size)).join(' + ')} = ${deg(whole)}`];
  return { say: txt(P, 'label:fact', say), eq };
}
function plan(P) {
  const M = model(P); const { c, items, total, dirWord } = M; const steps = [];
  const startCap = { turn: `Start here: the arrow points ${M.startName}.`, clock: 'The minute hand starts at 12.',
    protractor: 'Put the centre of the protractor on the corner, with 0 on the start line.',
    line: 'A straight line with a point on it.', point: 'A point, with a line going out from it.' }[c];
  steps.push({ key: 'start', caption: startCap });
  if (M.sweep) {
    if (c === 'protractor') steps.push({ key: 'turn:0', caption: `The second line turns ${dirWord} from the start line.` });
    else items.forEach((a, i) => {
      const how = c === 'clock' ? `${a.size / 6} minute${a.size === 6 ? '' : 's'} pass${a.size === 6 ? 'es' : ''}: the minute hand turns clockwise.` : `it turns ${M.sizeWords(a.size)} ${dirWord}.`;
      steps.push({ key: `turn:${i}`, caption: i === 0 ? cap1(how) : c === 'clock' ? `Then ${how[0].toLowerCase()}${how.slice(1)}` : `Then ${how}` });
    });
    const sz = c === 'protractor' ? `Count up from 0 on the scale that starts on the start line: ${deg(total)}.`
      : c === 'clock' ? `The minute hand ${M.turnsOnly ? `made ${TURN[total]}` : `turned ${deg(total)}`} in ${M.minutes} minute${M.minutes === 1 ? '' : 's'}.`
      : items.length > 1 ? (M.turnsOnly ? `${cap1(items.map(a => TURN_SHORT[a.size]).join(' + '))} = ${TURN_SHORT[total]}.` : `${items.map(a => deg(a.size)).join(' + ')} = ${deg(total)}${M.useTurns ? `: ${TURN[total]}` : ''}.`)
      : `The arc shows the turn: ${M.sizeWords(total)}.`;
    steps.push({ key: 'size', caption: sz });
    if (M.name) steps.push({ key: 'name', caption: M.nameCap() });
  } else {
    items.forEach((a, i) => steps.push({ key: `angle:${i}`, caption: a.missing ? `Angle ${M.nameOf(a)} is missing. We can work it out.` : `${i === 0 ? 'One' : 'The next'} angle is ${deg(a.size)}.` }));
    if (M.name) { const ws = items.filter(a => !a.missing).map(a => `${deg(a.size)} is ${SHORT[kindOf(a.size)]}`); steps.push({ key: 'name', caption: cap1(ws.join(', ')) + (M.miss ? '.' : '.') }); }
  }
  if (M.fact) {
    const F = factLines(M, P); const L = M.miss ? M.nameOf(M.miss) : '';
    const cap = c === 'turn' ? (M.turnsOnly ? M.qWords() : total % 90 === 0 ? (total === 90 ? 'A quarter turn makes a right angle: 90°.' : `${total / 90} quarter turns make ${TURN[total]}: ${deg(total)}.`) : `A quarter turn is 90°, so ${deg(total)} is ${total < 90 ? 'less' : 'more'} than a quarter turn.`)
      : c === 'clock' ? (M.turnsOnly ? `A quarter turn is 15 minutes, so ${TURN[total]} is ${M.minutes} minutes.` : `Each minute is 6°, so ${deg(total)} is ${M.minutes} minute${M.minutes === 1 ? '' : 's'}.`)
      : c === 'protractor' ? (total === 90 ? 'Read from the 0 on the start line: 90° on both scales.' : `Read from the 0 on the start line: ${deg(total)}, not ${deg(180 - total)} on the other scale.`)
      : M.miss ? `${F.say.replace(/\.$/, '')}, so ${L} = ${deg(M.whole)} − ${M.known.map(a => deg(a.size)).join(' − ')} = ${deg(M.miss.size)}.`
      : `${F.say.replace(/\.$/, '')}: ${items.map(a => deg(a.size)).join(' + ')} = ${deg(M.whole)}.`;
    steps.push({ key: 'fact', caption: cap });
  }
  const summary = c === 'turn' ? (M.turnsOnly ? (total === 90 ? `The arrow made a quarter turn ${dirWord}.` : M.qWords()) : M.useTurns ? `${cap1(TURN[total])} is ${deg(total)}.` : `The arrow turned ${deg(total)} ${dirWord}${M.name ? `: ${NAME[kindOf(total)]}` : ''}.`)
    : c === 'clock' ? `In ${M.minutes} minute${M.minutes === 1 ? '' : 's'} the minute hand ${M.turnsOnly ? `makes ${TURN[total]}` : `turns ${M.useTurns ? `${TURN[total]}, ` : ''}${deg(total)}`}.`
    : c === 'protractor' ? `The angle measures ${deg(total)}${M.name ? `: ${NAME[kindOf(total)]}` : ''}.`
    : M.miss ? `The missing angle ${M.nameOf(M.miss)} is ${deg(M.miss.size)}.` : `The angles add up to ${deg(M.whole)}.`;
  return { M, steps, summary };
}
export function builds(P) { const { steps, summary } = plan(P); return { steps, summary: { caption: summary } }; }

export function notes(P) {
  const { M, steps } = plan(P); const { c, total } = M;
  const out = steps.map(s => {
    const k = s.key.split(':')[0];
    if (k === 'start') return { turn: 'Ask the class to stand and face the same way as the arrow. They will turn on the spot with it.', clock: 'An angle is an amount of turn. The minute hand makes a whole turn every hour.',
      protractor: 'The centre cross sits exactly on the corner of the angle, and the straight edge lies along one line.', line: 'A straight line is a half turn: 180°.', point: 'All the way round a point is one whole turn: 360°.' }[c];
    if (k === 'turn') return c === 'protractor' ? 'Ask: before we measure, is this angle more or less than a right angle? Estimate first.' : c === 'clock' ? '15 minutes is a quarter turn, 30 minutes a half turn, 60 minutes a whole turn.' : 'Turn with the arrow. Clockwise is the way clock hands go; anticlockwise is the other way.';
    if (k === 'size') return c === 'protractor' ? 'A protractor has two scales. Follow the one whose 0 sits on the start line and count up round the curve.' : 'The angle is how far it turned, not how long the lines are. The drawing is exact, so you can check it with a real protractor on the board.';
    if (k === 'angle') return 'Each angle is drawn to its true size. Ask: is it bigger or smaller than a right angle?';
    if (k === 'name') return 'Acute: less than 90°. Right: exactly 90°. Obtuse: between 90° and 180°. Reflex: between 180° and 360°.';
    if (k === 'fact') return c === 'protractor' ? `A common slip is reading the other scale: ${180 - total}°. Check against the estimate: the angle is ${total < 90 ? 'smaller' : total > 90 ? 'bigger' : 'neither bigger nor smaller'} than a right angle.`
      : M.whole ? 'Check the answer: add all the angles and you should get the total again.' : c === 'clock' ? 'Ask: how many degrees does the minute hand turn in 5 minutes? (30°)' : 'Four quarter turns make a whole turn: 360°.';
    return '';
  });
  return { steps: out, summary: M.whole ? 'Ask: if one angle got bigger, what would happen to the others?' : 'Ask the class to show the same turn with their arm, then the other way.' };
}

/* ------------------------------------------------------------------ render */
export function render(root, P, ctx) {
  const { M, steps } = plan(P); const b = ctx.b, N = ctx.N; const { c, items, rays, dir, total } = M;
  const has = k => b[k] != null;
  const PX0 = 840, PX1 = GRID.right, PW = PX1 - PX0;
  // the figure fills the stage left of the reading panel, or the whole stage when there is no panel
  const panelOn = !!((M.sweep && (c === 'clock' || items.length > 1)) || (M.sweep && M.name) || M.fact);
  const AX0 = GRID.left, AX1 = panelOn ? PX0 - 24 : GRID.right, AY0 = GRID.top, AY1 = GRID.bottom;
  const ACX = (AX0 + AX1) / 2, ACY = (AY0 + AY1) / 2, AW = AX1 - AX0, AH = AY1 - AY0;
  const KF = 1.4; // the figure's marks are drawn 1.4x the old size
  let V, Lr, PR = 0, CR = 0, QUADS = [], stLab = null;
  const QUIET0 = { 'font-weight': 'var(--w-body)', fill: 'var(--ink-2)' };
  if (c === 'turn' || c === 'point') {
    // the quarters the turn passes through get a compass ground, so they count in the fit too
    const quads = new Set(); items.forEach((a, i) => { const lo = Math.min(rays[i], rays[i + 1]), hi = Math.max(rays[i], rays[i + 1]); for (let t = lo + .5; t < hi; t += 1) quads.add(((Math.floor(t / 90) % 4) + 4) % 4); });
    QUADS = [...quads];
    const u = [[0, 0], ...rays.map(a => [Math.cos(a * R), -Math.sin(a * R)]), ...QUADS.flatMap(q => [q * 90, q * 90 + 90].map(a => [.9 * Math.cos(a * R), -.9 * Math.sin(a * R)]))];
    const xs = u.map(p => p[0]), ys = u.map(p => p[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const padX = 60, padY = c === 'point' ? 40 : 16;
    Lr = Math.min((c === 'point' ? 215 : 225) * KF, (AW - 2 * padX) / Math.max(x1 - x0, .01), (AH - 2 * padY) / Math.max(y1 - y0, .01));
    V = [ACX - Lr * (x0 + x1) / 2, ACY - Lr * (y0 + y1) / 2];
  } else if (c === 'line') {
    Lr = Math.min(330 * KF, (AW - 24) / 2); const top = Math.max(...rays.map(a => Math.sin(a * R)), .5);
    V = [ACX, Math.min(AY1 - 70, ACY + Lr * top / 2)];
  } else if (c === 'protractor') {
    // the start line's name sits under the base: a long edit wraps there, and the protractor rises to make room
    PR = Math.min(290 * KF, (AW - 16) / 2 - 20, AH - 80); Lr = PR + 20;
    const ex = ACX + (dir > 0 ? Lr : -Lr), stW = dir > 0 ? ex - GRID.left : AX1 - ex;
    const tm = h('g', {}, root); const sm = textBlock(tm, 0, 0, txt(P, 'label:start', 'start line'), { cls: 'ts-h3', maxW: stW, maxLines: 3, lh: 38, a: QUIET0 }); tm.remove();
    const extra = Math.max(0, sm.h - 38);
    if (extra) { PR = Math.min(PR, AH - 80 - extra); Lr = PR + 20; }
    V = [ACX, Math.min(AY1 - 70 - extra, ACY + (PR - 60) / 2)];
    stLab = { x: ACX + (dir > 0 ? Lr : -Lr), maxW: dir > 0 ? ACX + Lr - GRID.left : AX1 - (ACX - Lr) };
  } else { CR = Math.min(220 * KF, AH / 2 - 8); Lr = CR; V = [ACX, ACY]; }
  const pt = (a, r) => [V[0] + r * Math.cos(a * R), V[1] - r * Math.sin(a * R)];
  const partKey = i => M.sweep ? (c === 'protractor' ? 'turn:0' : `turn:${i}`) : `angle:${i}`;
  const COLS = ['var(--focus)', 'var(--compare)'], PALE = ['var(--focus-pale)', 'var(--compare-pale)'];
  const SW = 'calc(var(--sw-data) * 1.3)', SWA = 'calc(var(--sw-struct) * 1.3)';
  const QUIET = { 'font-weight': 'var(--w-body)', fill: 'var(--ink-2)' }; // a small label set large but light
  const layer = () => h('g', {}, root);
  const gBack = layer(), gBody = layer(), gArc = layer(), gRay = layer(), gLab = layer();
  const segs = []; // ray segments other labels must not cross: [x1,y1,x2,y2]
  const rayLine = (p, a, r0, r1, at = {}) => { const [x1, y1] = pt(a, r0), [x2, y2] = pt(a, r1); return h('line', Object.assign({ x1, y1, x2, y2, stroke: 'var(--ink)', 'stroke-width': SW, 'stroke-linecap': 'round' }, at), p); };
  const ghost = (p, a, r, at) => rayLine(p, a, 0, r, Object.assign({ stroke: 'var(--ink-3)', 'stroke-width': SWA, 'stroke-dasharray': '12 10' }, at));
  const sweepers = []; // things the tick hook moves: {i, set(u)}
  const boxes = [];   // placed labels
  const hitsSeg = (bx) => segs.some(([x1, y1, x2, y2]) => { for (let t = 0; t <= 1; t += .02) { const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t; if (x > bx.x - 4 && x < bx.x + bx.w + 4 && y > bx.y - 4 && y < bx.y + bx.h + 4) return true; } return false; });
  const lhOf = cls => cls === 'ts-num' ? 46 : cls === 'ts-h3' ? 40 : 34;
  /** a label block at the middle of an arc, pushed outward until it meets no ray and no other label */
  const arcLabel = (mid, rows, rMin, rMax, at) => {
    const ws = rows.map(r => Math.max(...[].concat(r.alt || [], r.s).map(s => measure(gLab, s, r.cls, r.a)))); const H0 = rows.reduce((s, r) => s + lhOf(r.cls), 0);
    const cs = Math.cos(mid * R); const anchor = cs > .35 ? 'start' : cs < -.35 ? 'end' : 'middle'; const w = Math.max(...ws);
    const boxAt = r => { const [x, y] = pt(mid, r); const x0 = anchor === 'start' ? x - 6 : anchor === 'end' ? x - w + 6 : x - w / 2; return { x: x0, y: y - H0 / 2, w, h: H0, px: x, py: y }; };
    let bx = null; for (let r = rMin; r <= rMax; r += 8) { const t = boxAt(r); if (!hitsSeg(t) && !boxes.some(o => overlaps(o, t, 10)) && t.x > 40 && t.x + t.w < AX1 + 8 && t.y > GRID.top - 8 && t.y + t.h < GRID.bottom + 8) { bx = t; break; } }
    if (!bx) { bx = boxAt(rMin); ctx.warn(`No clear room for the angle label “${rows[0].s}”.`); }
    boxes.push(bx);
    const g = h('g', at || {}, gLab); const out = []; let yy = bx.y;
    rows.forEach(r => { const ax = anchor === 'start' ? bx.x + 6 : anchor === 'end' ? bx.x + bx.w - 6 : bx.x + bx.w / 2; const lh = lhOf(r.cls);
      const ra = Object.assign({}, r.a || {}); const el = T(g, ax, yy + lh * .78, r.s, r.cls, Object.assign(ra, { 'text-anchor': anchor, cls: ['halo', ra.cls].filter(Boolean).join(' ') }));
      yy += lh; if (r.edit) editable(el, r.edit); if (r.computed) computed(el, r.computed); out.push(el); });
    return { g, els: out, box: bx };
  };
  const sizeRows = (a, extra = {}) => {
    const rows = [];
    if (M.useDeg || !M.useTurns) rows.push(Object.assign({ s: deg(a.size), cls: 'ts-num', computed: `angles.${a.i}.size`, a: { fill: 'var(--ink)' } }, extra));
    if (M.useTurns) rows.push({ s: TURN_SHORT[a.size], cls: 'ts-h3', computed: `angles.${a.i}.size`, a: M.useDeg ? Object.assign({}, QUIET) : { fill: 'var(--ink)' } });
    return rows;
  };
  const sector = (p, col, pale, r, at) => { const g = h('g', at || {}, p); const f = h('path', { d: '', fill: pale, stroke: 'none' }, g); const s = h('path', { d: '', fill: 'none', stroke: col, 'stroke-width': SWA, 'stroke-linecap': 'round' }, g);
    g.set = (a0, a1) => { if (Math.abs(a1 - a0) < .2) { f.setAttribute('d', ''); s.setAttribute('d', ''); return; } const d = arcD(V[0], V[1], r, a0, a1); s.setAttribute('d', d); f.setAttribute('d', d + ` L${V[0]} ${V[1]} Z`); }; return g; };

  /* ---------------- the scene for each context */
  let mover = null; // the turning arrow / hand / ray: set(angle)
  const sk = b.start;
  if (c === 'turn' || c === 'point') {
    // a compass ground: the quarters the turn passes through, alternate ones tinted, so quarter turns can be counted
    const QR = Lr * .9, qg = h('g', { s: sk, cls: 'rise' }, gBack);
    QUADS.forEach(q => h('path', { d: arcD(V[0], V[1], QR, q * 90, q * 90 + 90) + ` L${V[0]} ${V[1]} Z`, fill: q % 2 ? 'none' : 'var(--panel)', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)', 'stroke-linejoin': 'round' }, qg));
  }
  if (c === 'turn') {
    ghost(gRay, M.a0, Lr - 10, { s: b['turn:0'] }); segs.push([...V, ...pt(M.a0, Lr)]);
    // later ghosts: where each earlier turn ended
    rays.slice(1, -1).forEach((a, i) => { ghost(gRay, a, Lr - 10, { s: b[`turn:${i + 1}`] }); segs.push([...V, ...pt(a, Lr)]); });
    segs.push([...V, ...pt(rays[rays.length - 1], Lr)]);
    const arr = h('g', { s: sk, cls: 'rise' }, gRay); const inner = h('g', {}, arr); const hs = ctx.tk.head * 1.5 * 1.3;
    h('line', { x1: V[0], y1: V[1], x2: V[0] + Lr - hs * .7, y2: V[1], stroke: 'var(--ink)', 'stroke-width': SW, 'stroke-linecap': 'round' }, inner);
    h('path', { d: headD(V[0] + Lr, V[1], 0, hs), fill: 'var(--ink)' }, inner);
    h('circle', { cx: V[0], cy: V[1], r: 15, fill: 'var(--ink)' }, arr);
    mover = a => inner.setAttribute('transform', `rotate(${-a} ${V[0]} ${V[1]})`);
    // the start label sits beside the tip of the start line, on the side away from the turn
    const sl = txt(P, 'label:start', 'start');
    // a long edit wraps (then shrinks) in the free room beside the start line, never off the slide:
    // the usual place first, then more lines there, then the other places round the tip
    const QR0 = Lr * .9;
    const inGround = bx => { for (let x = bx.x; x <= bx.x + bx.w; x += 8) for (let y = bx.y; y <= bx.y + bx.h; y += 8) { const dx = x - V[0], dy = V[1] - y, r = Math.hypot(dx, dy); if (r > QR0 + 6) continue; const an = ((Math.atan2(dy, dx) / R) + 360) % 360; if (QUADS.includes(Math.floor(an / 90) % 4)) return true; } return false; };
    const tmpS = h('g', {}, root);
    const lab = { cls: 'halo', s: b['turn:0'] };
    const measureAt = (x, y, anchor, maxW, maxLines, grow) => {
      const t = textBlock(tmpS, 0, 0, sl, { cls: 'ts-h3', maxW, maxLines, lh: 38, anchor, a: Object.assign({}, lab, QUIET) }); t.el.remove();
      if (t.lines[t.lines.length - 1].endsWith('…') && !sl.endsWith('…')) return null;
      const by = grow === 'up' ? y - (t.lines.length - 1) * t.lh : y;
      const bx = { x: anchor === 'start' ? x : anchor === 'end' ? x - t.w : x - t.w / 2, y: by - 30, w: t.w, h: t.h + 4 };
      if (bx.x < GRID.left || bx.x + bx.w > AX1 || bx.y < GRID.top || bx.y + bx.h > GRID.bottom) return null;
      if (hitsSeg(bx) || inGround(bx) || boxes.some(o => overlaps(o, bx, 10))) return null;
      return { x, y: by, anchor, maxW, maxLines, bx };
    };
    const side = M.a0 - dir * 90, [tx, ty] = pt(M.a0, Lr - 30); const ox = Math.cos(side * R) * 28, oy = -Math.sin(side * R) * 28;
    const sa = Math.abs(ox) < 2 ? 'middle' : ox > 0 ? 'start' : 'end';
    const sy = ty + oy + (oy > 2 ? 28 : oy < -2 ? -6 : 11);
    const room = sa === 'start' ? AX1 - (tx + ox) : sa === 'end' ? tx + ox - GRID.left : 2 * Math.min(tx - GRID.left, AX1 - tx);
    const cands = [[tx + ox, sy, sa, clamp(room, 120, 320), 3, oy < -2 ? 'up' : 'down']];
    for (let n = 4; n <= 6; n++) cands.push([tx + ox, sy, sa, clamp(room, 120, 420), n, oy < -2 ? 'up' : 'down']);
    // round the tip: both sides of the start line, the text running back along it or out from it
    const [ex, ey] = pt(M.a0, Lr), horiz = Math.abs(Math.cos(M.a0 * R)) > .5;
    const around = horiz ? [[ex, ey + 56, 'down'], [ex, ey - 22, 'up']].flatMap(([x, y, g]) => ['end', 'start', 'middle'].map(an => [x, y, an, g]))
      : [[ex - 28, ey + (ey < V[1] ? 11 : 0), 'end'], [ex + 28, ey + (ey < V[1] ? 11 : 0), 'start']].flatMap(([x, y, an]) => [[x, y, an, ey < V[1] ? 'down' : 'up']]);
    for (const [x, y, an, g] of around) for (let n = 2; n <= 6; n++) { const mw = an === 'start' ? AX1 - x : an === 'end' ? x - GRID.left : 2 * Math.min(x - GRID.left, AX1 - x); cands.push([x, y, an, clamp(mw, 120, 640), n, g]); }
    let pick = null; for (const cd of cands) { pick = measureAt(...cd); if (pick) break; }
    tmpS.remove();
    if (!pick) { ctx.warn('No clear room for the start label.'); pick = { x: tx + ox, y: sy, anchor: sa, maxW: clamp(room, 120, 320), maxLines: 3 }; }
    const sb = textBlock(gLab, pick.x, pick.y, sl, { cls: 'ts-h3', maxW: pick.maxW, maxLines: pick.maxLines, lh: 38, anchor: pick.anchor, edit: 'text.label:start', a: Object.assign({}, lab, QUIET) });
    boxes.push(pick.bx || { x: pick.anchor === 'start' ? pick.x : pick.anchor === 'end' ? pick.x - sb.w : pick.x - sb.w / 2, y: pick.y - 30, w: sb.w, h: sb.h + 4 });
  }
  if (c === 'clock') {
    const F = clockFace(gBody, 0, 0, { cx: V[0], cy: V[1], r: CR, a: { s: sk, cls: 'rise' }, hourA: { display: 'none' }, computedPath: 'angles.0.size' });
    const behind = F.g.childNodes[2];
    items.forEach((a, i) => { const sct = sector(F.g, COLS[i % 2], PALE[i % 2], CR - 8, { s: b[`turn:${i}`] }); F.g.insertBefore(sct, behind); sweepers.push({ i, set: u => sct.set(rays[i], rays[i] + dir * a.size * u) }); });
    const gh = ghost(null, 90, CR * .8, { s: b['turn:0'] }); F.g.insertBefore(gh, F.minute.parentNode.parentNode);
    mover = a => F.set(0, (90 - a) / 6);
  }
  if (c === 'protractor') {
    const TB = 36, RN = PR - TB - 32, ARM = RN - 54; // tick band, numeral ring, and the arm stops inside the numerals
    const g = h('g', { s: sk, cls: 'rise' }, gBody);
    // a flat plastic protractor: a straight base edge and a printed scale band, no shadow
    h('rect', { x: V[0] - PR, y: V[1], width: 2 * PR, height: 16, fill: 'var(--panel)', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }, g);
    h('path', { d: `M${V[0] - PR} ${V[1]} A${PR} ${PR} 0 0 1 ${V[0] + PR} ${V[1]} Z`, fill: 'var(--paper)', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', cls: 'body' }, g);
    h('path', { d: `M${V[0] - PR} ${V[1]} A${PR} ${PR} 0 0 1 ${V[0] + PR} ${V[1]} L${V[0] + PR - TB} ${V[1]} A${PR - TB} ${PR - TB} 0 0 0 ${V[0] - PR + TB} ${V[1]} Z`, fill: 'var(--panel)', stroke: 'none' }, g);
    h('path', { d: `M${V[0] - 120} ${V[1]} A120 120 0 0 1 ${V[0] + 120} ${V[1]}`, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }, g);
    for (let t = 0; t <= 180; t += 5) { const l = t % 30 === 0 ? TB : t % 10 === 0 ? 24 : 13; const [x1, y1] = pt(t, PR), [x2, y2] = pt(t, PR - l); h('line', { x1, y1, x2, y2, stroke: t % 10 ? 'var(--ink-3)' : 'var(--ink-2)', 'stroke-width': t % 10 ? 'var(--sw-hair)' : 'var(--sw-rule)' }, g); }
    h('circle', { cx: V[0], cy: V[1], r: 6, fill: 'var(--ink-2)' }, g);
    // one scale in large numerals: the one that counts up from 0 on the start line
    const val = t => dir > 0 ? t : 180 - t;
    const scale = at => { const sg = h('g', at, gLab);
      for (let t = 0; t <= 180; t += 30) { const [x, y] = pt(clamp(t, 8, 172), RN); computed(T(sg, x, y + 14, String(val(t)), 'ts-num', { 'text-anchor': 'middle', cls: 'halo-paper' }), 'angles.0.size'); }
      return sg; };
    scale({ s: sk, cls: 'rise' });
    const hi = scale({ s: b.size }); hi.querySelectorAll('text').forEach(t => { t.style.fill = 'var(--focus-text)'; });
    // the other scale is left as ticks only, so no numeral is doubled
    // the zero the reading starts from, ringed in the fact step
    if (has('fact')) { const [zx, zy] = pt(dir > 0 ? 8 : 172, RN); h('circle', { cx: zx, cy: zy, r: 32, fill: 'none', stroke: 'var(--focus)', 'stroke-width': SWA, s: b.fact, cls: 'pop' }, gLab); }
    rayLine(gRay, M.a0, 0, Lr, { s: sk, cls: 'rise' }); segs.push([...V, ...pt(M.a0, Lr)]);
    const mv = h('g', { s: b['turn:0'] }, gRay); const inner = h('g', {}, mv); rayLine(inner, 0, 0, ARM);
    mover = a => inner.setAttribute('transform', `rotate(${-a} ${V[0]} ${V[1]})`);
    segs.push([...V, ...pt(rays[1], ARM)]);
    // the start line is named under its own end, clear of the scale
    textBlock(gLab, stLab.x, V[1] + 54, txt(P, 'label:start', 'start line'), { cls: 'ts-h3', maxW: stLab.maxW, maxLines: 3, lh: 38, anchor: dir > 0 ? 'end' : 'start', edit: 'text.label:start', a: Object.assign({ s: sk }, QUIET) });
  }
  if (c === 'line' || c === 'point') {
    const g = h('g', { s: sk, cls: 'rise' }, gRay);
    if (c === 'line') { rayLine(g, 0, 0, Lr); rayLine(g, 180, 0, Lr); segs.push([...pt(0, Lr), ...pt(180, Lr)]); }
    else { rayLine(g, M.a0, 0, Lr); segs.push([...V, ...pt(M.a0, Lr)]); }
    h('circle', { cx: V[0], cy: V[1], r: 11, fill: 'var(--ink)' }, g);
    // each angle's new ray turns out from the last one (the final angle closes on a ray already drawn)
    items.forEach((a, i) => { if (i === items.length - 1) return; const mv = h('g', { s: b[`angle:${i}`] }, gRay); const inner = h('g', {}, mv); rayLine(inner, 0, 0, Lr);
      const to = rays[i + 1]; segs.push([...V, ...pt(to, Lr)]);
      sweepers.push({ i, set: u => inner.setAttribute('transform', `rotate(${-(rays[i] + dir * a.size * u)} ${V[0]} ${V[1]})`) }); });
  }

  /* ---------------- arcs and their labels */
  if (c !== 'clock') items.forEach((a, i) => {
    const small = a.size < 40, r = KF * (c === 'protractor' ? 60 : c === 'turn' ? (small ? 120 : 82) : small ? 100 : 70);
    const k = partKey(i), col = a.missing ? COLS[1] : COLS[c === 'turn' ? i % 2 : 0], pale = a.missing ? PALE[1] : PALE[c === 'turn' ? i % 2 : 0];
    const sct = sector(gArc, col, pale, r, { s: b[k] });
    sweepers.push({ i, set: u => sct.set(rays[i], rays[i] + dir * a.size * u) });
    const mid = rays[i] + dir * a.size / 2;
    if (a.size === 90 && !a.missing) rightAngleMark(gArc, V, Math.min(rays[i], rays[i + 1]), { size: 40, col, a: { s: M.sweep ? b.size : b[k] } });
    // labels: a sweep context shows sizes in the size step; a line or point shows each as it appears
    const showAt = M.sweep ? b.size : b[k];
    let rows;
    if (a.missing) rows = [{ s: M.nameOf(a), cls: 'ts-num', edit: `angles.${a.i}.letter`, a: { fill: 'var(--compare-text)', hide: has('fact') ? b.fact : null }, alt: has('fact') ? [`${M.nameOf(a)} = ${deg(a.size)}`] : [] }];
    else rows = sizeRows(a);
    if (!M.sweep && M.name && has('name')) rows.push({ s: SHORT[kindOf(a.size)], cls: 'ts-h3', computed: `angles.${a.i}.size`, a: Object.assign({ s: b.name, cls: 'rise' }, QUIET) });
    const rMax = c === 'protractor' ? PR - 150 : Lr + 70; const rMin = c === 'protractor' ? r + 40 : r + 30;
    const L = arcLabel(mid, rows, rMin, rMax, { s: showAt, cls: 'rise' });
    if (a.missing && has('fact')) { const el = L.els[0]; const done = T(L.g, el.getAttribute('x'), el.getAttribute('y'), `${M.nameOf(a)} = ${deg(a.size)}`, 'ts-num', { 'text-anchor': el.getAttribute('text-anchor'), cls: 'halo', fill: 'var(--compare-text)', s: b.fact }); computed(done, `angles.${M.known[0].i}.size`); }
  });

  /* ---------------- the reading panel on the right: size (several turns or a clock), name, fact */
  // one section per build; an earlier section clears when the next arrives, and comes back soft in the summary
  const G = h('g', {}, root); const tmp = h('g', {}, root); const rows = []; const secs = [];
  const section = key => { const g = h('g', {}, G); secs.push({ key, g }); return g; };
  const block = (g, s, cls, lh, a, mark, maxLines = 3) => { const hgt = textBlock(tmp, 0, 0, s, { cls, maxW: PW, maxLines, lh, a }).h; rows.push({ h: hgt + 10, draw: y => { const tb = textBlock(g, PX0, y + lh - 8, s, { cls, maxW: PW, maxLines, lh, a }); mark(tb.el); } }); };
  const comp = p => el => computed(el, p), ed = p => el => editable(el, p);
  const p0 = `angles.${items[0].i}.size`;
  if (M.sweep && (c === 'clock' || items.length > 1)) {
    const g = section('size'), at = { s: b.size, cls: 'rise' };
    if (c === 'clock') { block(g, M.turnsOnly ? cap1(TURN[total]) : deg(total), M.turnsOnly ? 'ts-h3' : 'ts-big', M.turnsOnly ? 40 : 60, Object.assign({ fill: 'var(--focus-text)' }, at), comp(p0)); block(g, `${M.minutes} minute${M.minutes === 1 ? '' : 's'}${M.useTurns && !M.turnsOnly ? `: ${TURN[total]}` : ''}`, 'ts-h3', 40, Object.assign({ fill: 'var(--ink)' }, at), comp(p0)); }
    else if (M.turnsOnly) block(g, `${cap1(items.map(a => TURN_SHORT[a.size]).join(' + '))} = ${TURN_SHORT[total]}`, 'ts-h3', 40, Object.assign({ fill: 'var(--focus-text)' }, at), comp(p0));
    else { block(g, `${items.map(a => deg(a.size)).join(' + ')} = ${deg(total)}`, 'ts-h3', 40, Object.assign({ fill: 'var(--ink)' }, at), comp(p0)); if (M.useTurns) block(g, cap1(TURN[total]), 'ts-label', 36, Object.assign({ fill: 'var(--focus-text)' }, at), comp(p0)); }
    rows.push({ h: 18, draw: () => {} });
  }
  if (M.sweep && M.name) {
    const k = kindOf(total), g = section('name'), at = { s: b.name, cls: 'rise' };
    block(g, cap1(NAME[k]), 'ts-h3', 40, Object.assign({ fill: 'var(--ink)' }, at), comp(p0));
    block(g, cap1((M.turnsOnly ? RULE_T : RULE)[k]) + '.', 'ts-h3', 38, Object.assign({}, at, QUIET), comp(p0));
    rows.push({ h: 18, draw: () => {} });
  }
  if (M.fact) {
    const F = factLines(M, P), g = section('fact'), at = { s: b.fact, cls: 'rise' };
    block(g, F.say, 'ts-label', 36, Object.assign({ fill: F.eq.length ? 'var(--ink-2)' : 'var(--ink)' }, at), ed('text.label:fact'), 5);
    F.eq.forEach((e, j) => block(g, e, 'ts-h3', 40, Object.assign({ fill: j < F.eq.length - 1 ? 'var(--ink)' : M.miss ? 'var(--compare-text)' : 'var(--focus-text)' }, at), comp(M.whole && M.known.length ? `angles.${M.known[0].i}.size` : p0)));
  }
  secs.forEach((sc, j) => { if (j < secs.length - 1) { const nx = b[secs[j + 1].key]; sc.g.setAttribute('data-c', [nx < N ? `${nx}-${N}:off` : null, `${N}:soft`].filter(Boolean).join(',')); } });
  tmp.remove();
  const tot = rows.reduce((s, r) => s + r.h, 0), top0 = GRID.top + 30, bot0 = GRID.bottom - 10;
  if (tot > bot0 - top0) ctx.warn(`The reading panel needs ${tot | 0} units of height; there are ${bot0 - top0}.`);
  let y = Math.max(top0, (top0 + bot0) / 2 - tot / 2); for (const r of rows) { r.draw(y); y += r.h; }
  /* ---------------- motion: each part turns in its own step */
  const prog = (k, u) => items.map((a, i) => { const bk = b[partKey(i)]; return k > bk ? 1 : k === bk ? u : 0; });
  const at = pr => {
    if (mover) { let a = M.a0; if (c === 'protractor') a += dir * items[0].size * pr[0]; else items.forEach((it, i) => { a += dir * it.size * pr[i]; }); mover(a); }
    for (const s of sweepers) s.set(pr[s.i]);
  };
  const dur = {}; steps.forEach(s => { if (/^(turn|angle):/.test(s.key)) { const a = items[+s.key.split(':')[1]]; dur[s.key] = clamp(900 + a.size * 3, 1000, 1900); } });
  return {
    dur,
    reset() { at(items.map(() => 0)); },
    still() { at(items.map(() => 1)); },
    tick(k, u) { at(prog(k, eIO(clamp(u)))); },
  };
}
