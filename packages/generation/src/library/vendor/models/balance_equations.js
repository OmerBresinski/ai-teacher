// Balance and function machine. Two ways to see an equation:
//   balance: both sides on a pan balance. Level means equal; the heavier side goes down. With an
//            unknown, the code works out its value and solves it by doing the same to both sides
//            (take the same from both pans, then share into equal groups). Without one, it compares.
//   machine: a number goes through one to three operations; outputs are computed, and running it
//            backwards uses the inverse operations in reverse order.
// Year 1 and 2 missing numbers (one box beside cubes, up to 10 a side) use one centred balance and one
// number sentence: match cubes with cubes, ring what is left over, open the box. No working column.
// Every number on the slide is computed from the teacher's equation, so the pans never lie.
import {
  h, T, measure, clamp, lerp, eIO, GRID, textBlock, headD,
  editable, computed, txt, TEXT_PARAM, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
// Batch A parts are not re-exported by kit/index.js, so they are imported directly.
import { fmtNum, groupRing } from '../kit/batch-A.js';

export const meta = {
  id: 'balance_equations', name: 'Balance and function machine', kind: 'scene', version: 1,
  subjects: ['Maths'],
  years: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'],
  teaches: 'That = means both sides have the same value, how to find a missing number by matching cubes (Year 1 and 2) or by doing the same to both sides, and how inverse operations undo a function machine.',
};

const OPS = ['+', '−', '×', '÷'];
const INV = { '+': '−', '−': '+', '×': '÷', '÷': '×' };
const OP_WORD = { '+': 'add', '−': 'take away', '×': 'multiply by', '÷': 'divide by' };

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Balance and function machine',
  properties: {
    title: TITLE_PARAM('Keep it balanced'),
    mode: { type: 'string', title: 'Show it as', enum: ['balance', 'machine'], 'x-labels': ['A balance', 'A function machine'], default: 'balance' },
    balance: {
      type: 'object', title: 'Balance', description: 'Write each side with numbers, + and one unknown (like 3 + ? or 2a + 3). The answer is worked out for you.',
      default: { left: '3 + ?', right: '7', show: 'cubes', solve: true },
      properties: {
        left: { type: 'string', title: 'Left side', minLength: 1, maxLength: 24, default: '3 + ?' },
        right: { type: 'string', title: 'Right side', minLength: 1, maxLength: 24, default: '7' },
        show: { type: 'string', title: 'What goes on the pans', enum: ['cubes', 'weights'], 'x-labels': ['Cubes (each one is 1), up to 20 a side', 'Number weights (for bigger numbers)'], default: 'cubes' },
        solve: { type: 'boolean', title: 'Show the steps to find the unknown', default: true },
      },
    },
    unknown: { type: 'string', title: 'The unknown looks like', enum: ['box', 'shape', 'letter'], 'x-labels': ['A box with ?', 'A triangle △', 'A letter'], default: 'box' },
    letter: { type: 'string', title: 'Letter for the unknown', description: 'Used when the unknown is a letter.', minLength: 1, maxLength: 1, pattern: '^[A-Za-z]$', default: 'a', 'x-panel': 'advanced' },
    machine: {
      type: 'object', title: 'Function machine', default: { input: 6, steps: [{ op: '×', n: 4 }], findInput: false, backwards: true },
      properties: {
        input: { type: 'number', title: 'Number that goes in', default: 6, minimum: -9999, maximum: 9999 },
        steps: {
          type: 'array', title: 'What the machine does', 'x-item': 'a step', minItems: 1, maxItems: 3, default: [{ op: '×', n: 4 }],
          items: { type: 'object', required: ['op', 'n'], default: { op: '+', n: 2 }, properties: {
            op: { type: 'string', title: 'Operation', enum: OPS, 'x-labels': ['add (+)', 'take away (−)', 'multiply by (×)', 'divide by (÷)'], default: '+' },
            n: { type: 'number', title: 'By', default: 2, minimum: -999, maximum: 999 },
          } },
        },
        findInput: { type: 'boolean', title: 'Hide the input: the class works back from the output', default: false },
        backwards: { type: 'boolean', title: 'Run it backwards', default: true },
      },
    },
    text: TEXT_PARAM,
  },
};

export const presets = [
  { id: 'y1-missing', name: 'Year 1: 7 = 3 + ?', params: {
    title: 'What is missing?', mode: 'balance', unknown: 'box',
    balance: { left: '7', right: '3 + ?', show: 'cubes', solve: true },
  } },
  { id: 'y2-compare', name: 'Year 2: is 4 + 5 the same as 10?', params: {
    title: 'Is it equal?', mode: 'balance', unknown: 'box',
    balance: { left: '4 + 5', right: '10', show: 'cubes', solve: false },
  } },
  { id: 'y4-machine', name: 'Year 4: function machine × 4', params: {
    title: 'The × 4 machine', mode: 'machine',
    machine: { input: 6, steps: [{ op: '×', n: 4 }], findInput: false, backwards: true },
  } },
  { id: 'y6-algebra', name: 'Year 6: 2a + 3 = 11', params: {
    title: 'Solve 2a + 3 = 11', mode: 'balance', unknown: 'letter', letter: 'a',
    balance: { left: '2a + 3', right: '11', show: 'cubes', solve: true },
  } },
];

/* ------------------------------------------------------------------ parsing a side */
const UNK = /^[?□▢△▲]$/;
const isSym = t => t != null && (/^[A-Za-z]$/.test(t) || UNK.test(t));
/** "2a + 3" -> {terms:[{k:'unk',c:2,sym:'a'},{k:'num',v:3}], a:2, b:3, syms}. Only + between terms. */
function parseSide(s) {
  const src = String(s == null ? '' : s).trim();
  if (!src) return { error: 'empty' };
  const toks = src.replace(/[−–—]/g, '-').match(/\d+(?:\.\d+)?|[A-Za-z]|[?□▢△▲]|\S/g) || [];
  const terms = [], syms = new Set(); let i = 0;
  while (i < toks.length) {
    let t = toks[i];
    if (terms.length) {
      if (t === '+') { i++; t = toks[i]; }
      else if (t === '-') return { error: 'minus' };
      else if ('×*÷/'.includes(t)) return { error: 'times' };
      else return { error: 'syntax' };
    }
    if (t == null) return { error: 'syntax' };
    if (/^\d/.test(t)) {
      const v = +t; i++; let nx = toks[i];
      if (nx === '×' || nx === '*') { i++; nx = toks[i]; if (!isSym(nx)) return { error: 'times' }; }
      if (isSym(nx)) { terms.push({ k: 'unk', c: v, sym: nx }); syms.add(nx); i++; }
      else terms.push({ k: 'num', v });
    } else if (isSym(t)) { terms.push({ k: 'unk', c: 1, sym: t }); syms.add(t); i++; }
    else if (t === '-') return { error: 'minus' };
    else if ('×*÷/'.includes(t)) return { error: 'times' };
    else return { error: 'syntax' };
  }
  const a = terms.filter(t => t.k === 'unk').reduce((s2, t) => s2 + t.c, 0);
  const b = terms.filter(t => t.k === 'num').reduce((s2, t) => s2 + t.v, 0);
  return { terms, a, b, syms };
}
const glyphOf = P => P.unknown === 'letter' ? (P.letter || 'a') : P.unknown === 'shape' ? '△' : '?';
/** One side as words on the slide: letters as 2a, boxes and shapes repeated (? + ?). */
function unkStr(c, g, P) { if (c <= 0) return ''; if (P.unknown === 'letter') return (c === 1 ? '' : c) + g; return Array(c).fill(g).join(' + '); }
function sideStr(S, P) {
  const g = glyphOf(P);
  if (S.terms) return S.terms.map(t => t.k === 'num' ? fmtNum(t.v) : unkStr(t.c, g, P)).join(' + ');
  const parts = []; if (S.a > 0) parts.push(unkStr(S.a, g, P)); if (S.b > 0 || S.a === 0) parts.push(fmtNum(S.b));
  return parts.join(' + ');
}

/* ------------------------------------------------------------------ the maths of a balance */
function balanceModel(P) {
  const B = P.balance; const L = parseSide(B.left), R = parseSide(B.right);
  const g = glyphOf(P);
  const hasU = L.a + R.a > 0;
  const M = { L, R, g, hasU, solve: !!(B.solve && hasU), cubes: B.show !== 'weights' };
  if (!hasU) { M.x = 0; return M; }
  M.m = Math.min(L.a, R.a);                    // unknowns taken from both sides
  const aL = L.a - M.m, aR = R.a - M.m;
  M.uSide = aL > 0 ? 'L' : 'R';               // the side the unknowns stay on
  const U = M.uSide === 'L' ? L : R, O = M.uSide === 'L' ? R : L;
  M.aU = M.uSide === 'L' ? aL : aR; M.bU = U.b; M.bO = O.b;
  M.x = M.aU > 0 ? (M.bO - M.bU) / M.aU : NaN;
  // Year 1 and 2 missing number: one box beside some cubes, plain cubes on the other side. Solved by
  // matching cubes with cubes and looking at what is left over, not by algebra moves.
  M.match = M.solve && M.cubes && P.unknown !== 'letter' && M.m === 0 && M.aU === 1 && M.bU > 0
    && Number.isInteger(M.x) && M.x > 0 && M.bO <= 10 && U.terms.filter(t => t.k === 'unk').length === 1;
  return M;
}
const wOf = (S, x) => S.a * x + S.b;
function rel(a, b) { return a === b ? '=' : a < b ? '<' : '>'; }

/* ------------------------------------------------------------------ the maths of a machine */
function apply(v, op, n) { const r = op === '+' ? v + n : op === '−' ? v - n : op === '×' ? v * n : v / n; return +r.toFixed(9); }
function machineModel(P) {
  const Mc = P.machine; const steps = Mc.steps || [];
  const vals = [Mc.input]; steps.forEach((s, i) => vals.push(apply(vals[i], s.op, s.n)));
  return { steps, vals, findInput: !!Mc.findInput, back: !!(Mc.backwards || Mc.findInput) };
}

/* ------------------------------------------------------------------ validate */
const PARSE_REASON = {
  empty: 'Write something on this side, like 7 or 3 + ?.',
  minus: 'A balance can only show amounts added together, so there is no take-away on a pan. Write it as an addition (8 − ? = 5 becomes 5 + ? = 8), or use the function machine.',
  times: 'Write several of the unknown as 2a (or ? + ?). A balance cannot show × or ÷ between numbers; use the function machine for those.',
  syntax: 'Write this side with numbers, + and one unknown, like 3 + ? or 2a + 3.',
};
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const W = [];
  if (!R.some(r => r.path === 'letter') && !/^[A-Za-z]$/.test(String(P.letter))) R.push({ path: 'letter', reason: 'Use a single letter, like a or n.' });
  if (R.length) return result(R);
  if (P.mode === 'machine') {
    const Mc = P.machine; let v = Mc.input;
    (Mc.steps || []).forEach((s, i) => {
      if (R.length) return;
      const path = `machine.steps.${i}.n`;
      if (s.op === '÷' && s.n === 0) return R.push({ path, reason: 'Nothing can be divided by 0. Choose another number.' });
      if (s.op === '×' && s.n === 0 && (Mc.backwards || Mc.findInput)) return R.push({ path, reason: '× 0 turns every number into 0, so the machine cannot be run backwards. Choose another number, or turn off “Run it backwards”.' });
      const r = apply(v, s.op, s.n);
      if (s.op === '÷' && Math.abs(r * 100 - Math.round(r * 100)) > 1e-6) return R.push({ path, reason: `${fmtNum(v)} ÷ ${fmtNum(s.n)} does not come out exactly. Pick numbers that divide exactly.` });
      if (Math.abs(r) > 99999) return R.push({ path, reason: `This step makes ${fmtNum(r)}, too big to read on the slide. Use smaller numbers.` });
      v = r;
    });
    return result(R, W);
  }
  // balance
  const L = parseSide(P.balance.left), Rt = parseSide(P.balance.right);
  if (L.error) R.push({ path: 'balance.left', reason: PARSE_REASON[L.error] });
  if (Rt.error) R.push({ path: 'balance.right', reason: PARSE_REASON[Rt.error] });
  if (R.length) return result(R);
  const syms = new Set([...L.syms, ...Rt.syms]);
  if (syms.size > 1) return result([{ path: Rt.syms.size ? 'balance.right' : 'balance.left', reason: `Use one unknown only: this has ${[...syms].join(' and ')}. A balance can find one missing number at a time.` }]);
  for (const [S, path] of [[L, 'balance.left'], [Rt, 'balance.right']]) {
    if (S.terms.some(t => t.k === 'num' && !Number.isInteger(t.v)) || S.terms.some(t => t.k === 'unk' && !Number.isInteger(t.c))) R.push({ path, reason: 'Use whole numbers on a balance: every cube or weight is a whole amount.' });
    else if (S.terms.some(t => t.k === 'unk' && t.c === 0)) R.push({ path, reason: '0 lots of the unknown is nothing. Leave it out, or write 1 or more.' });
    else if (S.a > 4) R.push({ path, reason: `There are ${S.a} of the unknown on this side; one pan holds 4 at most.` });
    else if (P.balance.show === 'cubes' && S.b > 20) R.push({ path, reason: `That is ${S.b} cubes on one pan, too many to count on one slide (20 at most). Choose “Number weights” in “What goes on the pans”.` });
    else if (P.balance.show === 'weights' && S.terms.length > 4) R.push({ path, reason: 'One pan holds 4 weights at most. Add some numbers together first.' });
    else if (S.b > 9999) R.push({ path, reason: 'Numbers over 9,999 are too big to read on a weight. Use smaller numbers.' });
  }
  if (R.length) return result(R);
  const M = balanceModel(P);
  if (M.hasU) {
    const sideStrs = `${sideStr(L, P)} = ${sideStr(Rt, P)}`;
    if (M.aU === 0) R.push({ path: 'balance.right', reason: `Both sides have the same number of the unknown, so taking them away leaves ${fmtNum(L.b)} = ${fmtNum(Rt.b)}. ${L.b === Rt.b ? 'Any number works, so there is nothing to find.' : 'No number makes that true.'} Change one side.` });
    else if (M.x < 0) R.push({ path: M.uSide === 'L' ? 'balance.right' : 'balance.left', reason: `No amount makes ${sideStrs} balance: the side with the unknown is already heavier with nothing in it. Make the other side bigger.` });
    else if (!Number.isInteger(M.x)) R.push({ path: M.uSide === 'L' ? 'balance.right' : 'balance.left', reason: `This makes the unknown ${fmtNum(+M.x.toFixed(2))}, which is not a whole number of cubes, so it will not share equally. Change the numbers.` });
  }
  return result(R, W);
}

/* ------------------------------------------------------------------ plan: builds, captions, notes */
function matchPlan(P, M) {
  const { L, R, g } = M; const x = M.x, bU = M.bU, bO = M.bO;
  const cw = n => `${n} cube${n === 1 ? '' : 's'}`;
  const U = M.uSide === 'L' ? L : R;
  const withX = S => S.terms.map(t => t.k === 'num' ? fmtNum(t.v) : fmtNum(x)).join(' + ');
  const first = M.uSide === 'L' ? `${cw(bU)} and a box on this side.` : `${cw(bO)} on this side.`;
  const items = [
    { key: 'left', caption: first, note: 'Ask: what will happen when we put something on the other pan?', st: { L: [L.a, L.b], R: [0, 0] } },
    { key: 'right', caption: `The sides are equal. What is in the box?`, note: 'Level means both sides have the same value. Read = as “is equal to”, not “the answer comes next”. Every cube is the same; the box holds some cubes we cannot see.', st: { L: [L.a, L.b], R: [R.a, R.b] } },
    { key: 'match', caption: `${cw(bU)} match ${cw(bU)}.`, note: `Pair each cube beside the box with one cube on the other side. Those ${bU} are the same on both sides.`, st: { L: [L.a, L.b], R: [R.a, R.b] } },
    { key: 'leftover', caption: `${cw(x)} ${x === 1 ? 'is' : 'are'} left over.`, note: 'The pans are level, so the box must weigh the same as the cubes that have no partner. Ask: how many cubes are in the box?', st: { L: [L.a, L.b], R: [R.a, R.b] } },
  ];
  // the last click opens the box: the summary, so the final build carries a new idea, not a repeat
  const summary = `The box holds ${cw(x)}: ${withX(U)} = ${fmtNum(bO)}, so the missing number is ${fmtNum(x)}.`;
  const sNote = `Count all the cubes on the box side to check: ${withX(U)} = ${fmtNum(bO)}. Say it with the stem sentence: “${fmtNum(bO)} is equal to ${withX(U)}.” Ask: what if the other side had one more cube?`;
  return { M, items, lines: [], summary, sNote };
}
function balancePlan(P) {
  const M = balanceModel(P); if (M.match) return matchPlan(P, M);
  const { L, R, g } = M; const items = [];
  const cubesWord = n => `${n} cube${n === 1 ? '' : 's'}`;
  const put = S => M.cubes && S.a === 0 ? cubesWord(S.b) : sideStr(S, P);
  const lines = []; // working lines: {l:{a,b}|S, r, at, note}
  const eq = `${sideStr(L, P)} ${rel(wOf(L, M.x), wOf(R, M.x))} ${sideStr(R, P)}`;
  const wL = wOf(L, M.x), wR = wOf(R, M.x);
  items.push({ key: 'left', caption: `${put(L)} ${M.cubes && L.a === 0 && L.b === 1 ? 'goes' : M.cubes && L.a === 0 ? 'go' : 'goes'} on the left pan, so that side goes down.`,
    note: 'Ask: what will happen when we put something on the other pan?', st: { L: [L.a, L.b], R: [0, 0] } });
  const heavier = wL > wR ? 'left' : 'right';
  items.push({ key: 'right', caption: wL === wR ? `${put(R)} on the right. The pans are level, so ${sideStr(L, P)} = ${sideStr(R, P)}.` : `${put(R)} on the right. The ${heavier} side is heavier, so it goes down.`,
    note: wL === wR ? 'Level means both sides have the same value. That is what = means: “is the same as”, not “the answer comes next”.' : 'The heavier side goes down. Ask: what could we add to the lighter side to make it level?',
    st: { L: [L.a, L.b], R: [R.a, R.b] } });
  lines.push({ l: L, r: R, at: 'right', sign: rel(wL, wR) });
  if (!M.hasU) {
    const word = wL === wR ? 'is equal to' : wL < wR ? 'is less than' : 'is more than';
    items.push({ key: 'sign', caption: `${fmtNum(wL)} ${word} ${fmtNum(wR)}, so we write ${eq}.`, note: wL === wR ? 'Equal sides: the = sign.' : 'The wide end of < or > faces the bigger amount, the side that went down.', st: items[1].st });
  }
  let cur = { L: [L.a, L.b], R: [R.a, R.b] };
  const curS = s => ({ a: cur[s][0], b: cur[s][1] });
  if (M.solve) {
    if (M.m > 0) {
      cur = { L: [cur.L[0] - M.m, cur.L[1]], R: [cur.R[0] - M.m, cur.R[1]] };
      const what = P.unknown === 'letter' ? (M.m === 1 ? g : `${M.m}${g}`) : `${M.m === 1 ? 'one' : M.m} ${g}`;
      lines.push({ l: curS('L'), r: curS('R'), at: 'removeU', note: `take ${what} from both sides` });
      items.push({ key: 'removeU', caption: `Take ${what} from both sides. The pans stay level: ${sideStr(curS('L'), P)} = ${sideStr(curS('R'), P)}.`, note: 'Taking the same from both sides keeps the pans level.', st: { ...cur } });
    }
    if (M.bU > 0) {
      cur = { L: [cur.L[0], cur.L[1] - M.bU], R: [cur.R[0], cur.R[1] - M.bU] };
      lines.push({ l: curS('L'), r: curS('R'), at: 'removeC', note: `take ${fmtNum(M.bU)} from both sides` });
      items.push({ key: 'removeC', caption: `Take ${M.cubes ? cubesWord(M.bU) : fmtNum(M.bU)} from both sides. The pans stay level: ${sideStr(curS('L'), P)} = ${sideStr(curS('R'), P)}.`, note: 'Whatever you do to one side, do to the other, and it stays balanced.', st: { ...cur } });
    }
    if (M.aU > 1) {
      const one = { a: 1, b: 0 }, val = { a: 0, b: M.x };
      lines.push({ l: M.uSide === 'L' ? one : val, r: M.uSide === 'L' ? val : one, at: 'answer', noteAt: 'share', note: P.unknown === 'letter' ? `÷ ${M.aU} on both sides` : `share into ${M.aU} equal groups` });
      items.push({ key: 'share', caption: `Share the ${M.cubes ? cubesWord(M.aU * M.x) : fmtNum(M.aU * M.x)} into ${M.aU} equal groups, one for each ${g}.`, note: `Each ${g} is worth the same, so the other side shares equally between them.`, st: { ...cur } });
    }
    const last = lines[lines.length - 1];
    const needLine = !(last.l.a === 1 && last.l.b === 0 && last.r.a === 0);
    if (needLine) lines.push({ l: { a: 1, b: 0 }, r: { a: 0, b: M.x }, at: 'answer', note: '' });
    items.push({ key: 'answer', caption: M.aU > 1 ? `Each ${g} is worth ${fmtNum(M.x)}, so ${g} = ${fmtNum(M.x)}.` : `The ${g} is worth ${fmtNum(M.x)}, so ${g} = ${fmtNum(M.x)}.`, note: 'Check by putting the value back into the first line.', st: { ...cur } });
  }
  // summary
  let summary, sNote;
  const U = M.uSide === 'L' ? L : R;
  if (M.solve) {
    const sub = U.terms.map(t => t.k === 'num' ? fmtNum(t.v) : (t.c === 1 ? fmtNum(M.x) : P.unknown === 'letter' ? `${t.c} × ${fmtNum(M.x)}` : Array(t.c).fill(fmtNum(M.x)).join(' + '))).join(' + ');
    summary = `Check: ${sub} = ${fmtNum(wOf(U, M.x))}, the same as the other side. So ${g} = ${fmtNum(M.x)}.`;
    sNote = `Every cube weighs the same; the ${P.unknown === 'letter' ? `bag marked ${g}` : 'box'} holds an unknown number of cubes. Ask: what would happen if we only took ${fmtNum(M.bU || 1)} from one side?`;
  } else if (M.hasU) {
    summary = `The pans are level, so ${sideStr(L, P)} = ${sideStr(R, P)}. ${P.unknown === 'box' ? 'What is in the box?' : `What is ${g}?`}`;
    sNote = 'Ask for ways to find the missing number, then turn on “Show the steps”.';
  } else {
    summary = wL === wR ? `Level pans: ${eq}.` : `The heavier side goes down: ${eq}.`;
    sNote = 'Change one side so the pans balance, and say the new number sentence with “is the same as”.';
  }
  return { M, items, lines, summary, sNote };
}
function machinePlan(P) {
  const MM = machineModel(P); const { steps, vals } = MM; const n = steps.length; const items = [];
  const f = fmtNum;
  if (MM.findInput) items.push({ key: 'out', caption: `Out comes ${f(vals[n])}. What number went in?`, note: 'Ask for guesses first, then ask how we could undo the machine.' });
  else {
    items.push({ key: 'in', caption: `${f(vals[0])} goes into the machine.`, note: 'The machine does the same thing to every number that goes in.' });
    steps.forEach((s, i) => items.push({ key: `op:${i}`, caption: `${OP_WORD[s.op][0].toUpperCase()}${OP_WORD[s.op].slice(1)} ${f(s.n)}: ${f(vals[i])} ${s.op} ${f(s.n)} = ${f(vals[i + 1])}.${i === n - 1 ? ' That is the output.' : ''}`,
      note: i === n - 1 ? 'Ask: what would come out if 1 more went in?' : 'Each step works on the answer from the step before.' }));
  }
  if (MM.back) for (let i = n - 1; i >= 0; i--) {
    const s = steps[i], iv = INV[s.op];
    items.push({ key: `back:${i}`, caption: `Undo ${s.op} ${f(s.n)} with ${iv} ${f(s.n)}: ${f(vals[i + 1])} ${iv} ${f(s.n)} = ${f(vals[i])}.${i === 0 ? (MM.findInput ? ` So ${f(vals[0])} went in.` : ' Back to the input.') : ''}`,
      note: i === n - 1 && n > 1 ? 'Undo the last step first, like taking off your shoes before your socks.' : `${iv} is the inverse of ${s.op}: it undoes it.` });
  }
  const chain = `${f(vals[0])} ${steps.map((s, i) => `${s.op} ${f(s.n)}`).join(' ')} = ${f(vals[n])}`;
  const summary = MM.back ? `${f(vals[0])} goes in, ${f(vals[n])} comes out. The inverse steps in reverse order take ${f(vals[n])} back to ${f(vals[0])}.` : `${f(vals[0])} goes in, ${f(vals[n])} comes out.`;
  const sNote = n > 1 ? `Written in one line, working left to right: ${chain}. The inverse operations run in reverse order.` : `Inverse operations undo each other: ${steps[0].op} and ${INV[steps[0].op]}.`;
  return { MM, items, summary, sNote };
}
const plan = P => P.mode === 'machine' ? machinePlan(P) : balancePlan(P);
export function builds(raw) { const P = withDefaults(params, raw); const { items, summary } = plan(P); return { steps: items.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }
export function notes(raw) { const P = withDefaults(params, raw); const { items, sNote } = plan(P); return { steps: items.map(i => i.note || ''), summary: sNote }; }

/* ------------------------------------------------------------------ render */
export function render(root, raw, ctx) {
  const P = withDefaults(params, raw);
  if (P.mode === 'machine') return renderMachine(root, P, ctx);
  const M = balanceModel(P);
  return M.solve && !M.match ? renderBalance(root, P, ctx) : renderWide(root, P, ctx);
}

// balance geometry (slide units)
const CX = 482, PY = 522, ARM = 250, PAN_W = 332, PAN_Y = PY - 76, BASE_Y = 626;
const CG = 6, WT_H = 84;
const WORK_X0 = 920, WORK_X1 = GRID.right;

function renderBalance(root, P, ctx) {
  const { M, items, lines } = balancePlan(P); const b = ctx.b, N = ctx.N; const g = M.g;
  const bi = k => b[k] ?? -1;
  const kL = bi('left'), kR = bi('right');
  const kU = bi('removeU'), kC = bi('removeC'), kS = bi('share'), kA = bi('answer');

  /* stand: a flat triangle and base; a needle on the beam reads against the level mark */
  const stand = h('g', {}, root);
  h('polygon', { points: `${CX},${PY} ${CX - 74},${BASE_Y} ${CX + 74},${BASE_Y}`, fill: 'var(--metal-shade)', stroke: 'var(--metal-shade)', 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round', cls: 'body' }, stand);
  h('rect', { x: CX - 180, y: BASE_Y, width: 360, height: 24, rx: 'var(--r-mark)', fill: 'var(--ink-2)', cls: 'body' }, stand);
  // the level mark: the needle points here when both sides are equal
  h('path', { d: `M${CX - 9} ${PY + 96} L ${CX + 9} ${PY + 96} L ${CX} ${PY + 82} Z`, fill: 'var(--paper)' }, stand);

  const beam = h('g', {}, root);
  h('line', { x1: CX, x2: CX, y1: PY, y2: PY + 76, stroke: 'var(--focus)', 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round' }, beam);
  h('rect', { x: CX - ARM - 20, y: PY - 11, width: 2 * ARM + 40, height: 22, rx: 11, fill: 'var(--ink-2)', cls: 'body' }, beam);
  h('circle', { cx: CX, cy: PY, r: 15, fill: 'var(--paper)', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-arrow)' }, beam);

  /* pans and what sits on them */
  const pans = {};
  const pansG = h('g', {}, root);
  for (const side of ['L', 'R']) {
    const ex = CX + (side === 'L' ? -ARM : ARM);
    const pg = h('g', {}, pansG); pans[side] = { g: pg, ex };
    h('rect', { x: ex - 7, y: PAN_Y + 14, width: 14, height: PY - PAN_Y - 14, fill: 'var(--ink-2)' }, pg);
    h('path', { d: `M${ex - PAN_W / 2} ${PAN_Y} L ${ex + PAN_W / 2} ${PAN_Y} L ${ex + PAN_W / 2 - 22} ${PAN_Y + 18} L ${ex - PAN_W / 2 + 22} ${PAN_Y + 18} Z`, fill: 'var(--metal)', stroke: 'var(--metal-shade)', 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round', cls: 'body' }, pg);
  }
  const sideOf = side => side === 'L' ? M.L : M.R;
  const isU = side => M.solve && M.uSide === side;
  const isO = side => M.solve && M.uSide !== side;
  const placeAt = side => side === 'L' ? kL : kR;

  // pack items into rows bottom-up, centred on the pan; returns placed boxes
  const packRows = (rows, ex, baseY) => {
    let y = baseY; const out = [];
    for (const r of rows) {
      const gap = r.gap ?? CG; const rh = Math.max(...r.items.map(i => i.h));
      const rw = r.items.reduce((s, i) => s + i.w, 0) + (r.items.length - 1) * (r.sp ?? 8);
      let x = ex - rw / 2; y -= rh + (out.length ? gap : 4);
      for (const it of r.items) { it.x = x; it.y = y + rh - it.h; x += it.w + (r.sp ?? 8); out.push(it); }
    }
    return { items: out, top: y };
  };
  // items into rows no wider than the pan
  const wrapRows = list => { const out = []; let cr = []; for (const it of list) { if (cr.length && cr.reduce((s2, i) => s2 + i.w + 8, 0) + it.w > PAN_W) { out.push({ items: cr }); cr = []; } cr.push(it); } if (cr.length) out.push({ items: cr }); return out; };
  const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
  const wW = v => Math.max(96, measure(root, fmtNum(v), 'ts-big') + 40);
  // the largest cube that keeps the tallest pile inside the slide (tilt included)
  const pile = (S, side, cu) => {
    const per = Math.max(3, Math.min(6, Math.floor((PAN_W + CG) / (cu + CG)))), bag = Math.round(cu * 1.6);
    const bagRows = S.a ? Math.ceil(S.a / Math.max(1, Math.floor((PAN_W + 8) / (bag + 8)))) : 0;
    const isUs = M.solve && M.uSide === side, isOs = M.solve && M.uSide !== side;
    let cubeRows = 0;
    if (isOs) cubeRows = M.aU * Math.ceil(M.x / per) + Math.ceil(M.bU / per);
    else if (isUs) cubeRows = Math.ceil(M.bU / per);
    else cubeRows = Math.ceil(S.b / per);
    return bagRows * (bag + CG) + cubeRows * (cu + CG) + 36;
  };
  let CUBE = 64;
  if (M.cubes) while (CUBE > 30 && Math.max(pile(M.L, 'L', CUBE), pile(M.R, 'R', CUBE)) > PAN_Y - 30 - (GRID.top + 20)) CUBE -= 2;
  const PER_ROW = Math.max(3, Math.min(6, Math.floor((PAN_W + CG) / (CUBE + CG)))), BAG = Math.round(CUBE * 1.6);

  const drawBag = (p, it, a) => {
    const bg = h('g', a, p);
    h('rect', { x: it.x, y: it.y, width: it.w, height: it.h, rx: 10, fill: 'var(--focus-pale)', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)', cls: 'body' }, bg);
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    const sym = T(bg, cx, cy + 2, g, 'ts-big', { 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: 'var(--focus-text)', hide: it.reveal >= 0 ? it.reveal : null });
    computed(sym, P.unknown === 'letter' ? 'letter' : 'unknown');
    if (it.reveal >= 0) computed(T(bg, cx, cy + 2, fmtNum(M.x), 'ts-big', { 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: 'var(--focus-text)', s: it.reveal, cls: 'pop' }), M.uSide === 'L' ? 'balance.right' : 'balance.left');
    return bg;
  };
  const drawCube = (p, it, a) => cubeMark(p, it.x, it.y, CUBE, a);
  const drawWeight = (p, it, a, path) => {
    const wg = h('g', a, p);
    h('path', { d: `M${it.x + 8} ${it.y + it.h} L ${it.x} ${it.y + 12} Q ${it.x} ${it.y} ${it.x + 12} ${it.y} L ${it.x + it.w - 12} ${it.y} Q ${it.x + it.w} ${it.y} ${it.x + it.w} ${it.y + 12} L ${it.x + it.w - 8} ${it.y + it.h} Z`, fill: 'var(--panel)', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)', 'stroke-linejoin': 'round', cls: 'body' }, wg);
    const t = T(wg, it.x + it.w / 2, it.y + it.h / 2 + 3, fmtNum(it.v), 'ts-big', { 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    computed(t, path);
    return wg;
  };

  for (const side of ['L', 'R']) {
    const S = sideOf(side), { g: pg, ex } = pans[side]; const k0 = placeAt(side);
    const cont = h('g', {}, pg);
    const path = side === 'L' ? 'balance.left' : 'balance.right';
    // bags: the ones that stay first, then the ones taken from both sides
    const nTake = M.solve ? M.m : 0;
    const bagW = M.solve ? Math.max(BAG, measure(root, fmtNum(M.x), 'ts-big') + 24) : BAG;
    const bags = Array.from({ length: S.a }, (_, i) => ({ kind: 'bag', w: bagW, h: BAG, take: i >= S.a - nTake, reveal: M.solve && !(i >= S.a - nTake) ? kA : -1 }));
    const rows = [];
    if (M.cubes) {
      wrapRows(bags).forEach(r => rows.push(r));
      const take = isU(side) || isO(side) ? M.bU : 0;
      if (isO(side)) {
        const groups = M.aU;
        for (let gi = 0; gi < groups; gi++) chunk(Array.from({ length: M.x }, () => ({ kind: 'cube', w: CUBE, h: CUBE, grp: gi })), PER_ROW).forEach((r, ri) => rows.push({ items: r, sp: CG, gap: ri === 0 && gi > 0 ? 18 : CG, grp: gi }));
      } else if (!isU(side)) chunk(Array.from({ length: S.b }, () => ({ kind: 'cube', w: CUBE, h: CUBE })), PER_ROW).forEach(r => rows.push({ items: r, sp: CG }));
      chunk(Array.from({ length: take }, () => ({ kind: 'cube', w: CUBE, h: CUBE, take: true })), PER_ROW).forEach((r, ri) => rows.push({ items: r, sp: CG, gap: ri === 0 && rows.length ? 14 : CG }));
      const { items: placed } = packRows(rows, ex, PAN_Y);
      placed.forEach((it, j) => {
        const gone = it.kind === 'bag' ? (it.take ? kU : -1) : (it.take ? kC : -1);
        const a = { s: k0, cls: 'pop', delay: 60 + j * 35, hide: gone >= 0 ? gone : null };
        if (it.kind === 'bag') drawBag(cont, it, a); else drawCube(cont, it, a);
      });
      // one ring per equal group when sharing
      if (isO(side) && M.aU > 1 && kS >= 0) for (let gi = 0; gi < M.aU; gi++) {
        const gs = placed.filter(i => i.grp === gi); if (!gs.length) continue;
        const x0 = Math.min(...gs.map(i => i.x)), y0 = Math.min(...gs.map(i => i.y)), x1 = Math.max(...gs.map(i => i.x + i.w)), y1 = Math.max(...gs.map(i => i.y + i.h));
        groupRing(cont, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, { pad: 6, s: kS, col: 'var(--focus)' });
      }
    } else {
      // number weights: one weight per number the teacher wrote; after a step, the new amount
      const nums = S.terms.filter(t => t.k === 'num').map(t => ({ kind: 'wt', v: t.v, w: wW(t.v), h: WT_H, take: isU(side) || isO(side) }));
      const rowsW = wrapRows([...bags, ...nums]);
      const { items: placed } = packRows(rowsW, ex, PAN_Y);
      placed.forEach((it, j) => {
        const gone = it.kind === 'bag' ? (it.take ? kU : -1) : (it.take ? (kC >= 0 ? kC : isO(side) ? kS : -1) : -1);
        const a = { s: k0, cls: 'pop', delay: 60 + j * 80, hide: gone >= 0 ? gone : null };
        if (it.kind === 'bag') drawBag(cont, it, a); else drawWeight(cont, it, a, path);
      });
      if (isO(side) && kC >= 0) {
        // the other side's weights become one weight of what is left, then (sharing) equal weights
        const firstNum = placed.find(i => i.kind === 'wt');
        const baseY = firstNum ? firstNum.y + firstNum.h : PAN_Y;
        const left = M.bO - M.bU;
        const one = packRows([{ items: [{ kind: 'wt', v: left, w: wW(left), h: WT_H }] }], ex, baseY).items[0];
        drawWeight(cont, one, { s: kC, cls: 'pop', delay: 500, hide: kS >= 0 ? kS : null }, path);
        if (kS >= 0) {
          const eqs = Array.from({ length: M.aU }, () => ({ kind: 'wt', v: M.x, w: wW(M.x), h: WT_H }));
          packRows(wrapRows(eqs), ex, baseY).items.forEach((it, j) => drawWeight(cont, it, { s: kS, cls: 'pop', delay: 300 + j * 120 }, path));
        }
      } else if (isO(side) && kS >= 0) {
        // nothing to take first: the other side's weights become equal weights, one for each unknown
        const firstNum = placed.find(i => i.kind === 'wt');
        const baseY = firstNum ? firstNum.y + firstNum.h : PAN_Y;
        const eqs = Array.from({ length: M.aU }, () => ({ kind: 'wt', v: M.x, w: wW(M.x), h: WT_H }));
        packRows(wrapRows(eqs), ex, baseY).items.forEach((it, j) => drawWeight(cont, it, { s: kS, cls: 'pop', delay: 300 + j * 120 }, path));
      }
    }
  }

  /* the working: one line per build, = signs lined up; earlier lines recede */
  const work = h('g', {}, root);
  const lineTxt = ln => ({ l: sideStr(ln.l, P), r: sideStr(ln.r, P) });
  const strs = lines.map(lineTxt);
  // largest type that fits the column, so the working reads as part of the model
  const span = c => Math.max(...strs.map(s => measure(root, s.l, c))) + Math.max(...strs.map(s => measure(root, s.r, c))) + measure(root, '=', c) + 40;
  const cls = ['ts-eq', 'ts-big', 'ts-num', 'ts-label'].find(c => span(c) <= WORK_X1 - WORK_X0) || 'ts-label';
  if (span(cls) > WORK_X1 - WORK_X0) ctx.warn(`The working is ${Math.round(span(cls))} units wide; the column has ${WORK_X1 - WORK_X0}.`);
  const EG = measure(root, '=', cls) / 2 + 14; // room either side of the = sign
  const maxL = Math.max(...strs.map(s => measure(root, s.l, cls)));
  const eqX = Math.min(WORK_X0 + maxL + EG + 6, WORK_X1 - Math.max(...strs.map(s => measure(root, s.r, cls))) - EG - 6);
  // step labels: one line if it fits the column, else two balanced lines
  const noteLines = lines.map(ln => {
    if (!ln.note) return [];
    const ws = ln.note.split(' ');
    if (measure(root, ln.note, 'ts-frac') <= WORK_X1 - WORK_X0 || ws.length < 2) return [ln.note];
    let best = null;
    for (let j = 1; j < ws.length; j++) { const a = ws.slice(0, j).join(' '), bb = ws.slice(j).join(' '); const m = Math.max(measure(root, a, 'ts-frac'), measure(root, bb, 'ts-frac')); if (!best || m < best[0]) best = [m, [a, bb]]; }
    return best[1];
  });
  // each line takes the room its label needs; the column is centred on the pans, beside the right pan
  const NOTE_LH = 32, hOf = i => noteLines[i].length ? 44 + (noteLines[i].length - 1) * NOTE_LH : 0;
  const ys = []; let yy = 0; lines.forEach((ln, i) => { ys.push(yy); yy += Math.max(96, hOf(i) + 74); });
  const colH = ys[ys.length - 1] + hOf(lines.length - 1);
  const y0 = clamp(392 - colH / 2, GRID.top + 60, Math.max(GRID.top + 60, 630 - colH));
  lines.forEach((ln, i) => {
    const y = y0 + ys[i]; const k = bi(ln.at); const last = i === lines.length - 1;
    const nx = lines[i + 1], kNext = last ? -1 : bi(nx.noteAt || nx.at), kNote = ln.noteAt ? bi(ln.noteAt) : k;
    // the current line in full colour; once the next line arrives it is redrawn in --ink-2 (AA contrast, no fading)
    for (const past of kNext >= 0 ? [false, true] : [false]) {
      const fill = past ? 'var(--ink-2)' : last && M.solve ? 'var(--focus-text)' : 'var(--ink)';
      const vis = past ? { s: kNext } : { s: k, hide: kNext >= 0 ? kNext : null, cls: 'rise' };
      const lg = h('g', {}, work);
      const lt = T(lg, eqX - EG, y, strs[i].l, cls, { 'text-anchor': 'end', fill, ...vis });
      const rt = T(lg, eqX + EG, y, strs[i].r, cls, { 'text-anchor': 'start', fill, ...vis, delay: past || i === 0 ? 0 : 150 });
      const signNow = i === 0 && !M.hasU;
      const sg = T(lg, eqX, y, i === 0 ? ln.sign : '=', cls, { 'text-anchor': 'middle', fill: signNow ? 'var(--focus-text)' : fill, ...vis, s: signNow ? bi('sign') : vis.s, cls: past ? null : signNow ? 'pop' : 'rise' });
      // comparing: a quiet ? holds the sign's place until the class has decided
      if (signNow) computed(T(lg, eqX, y, '?', cls, { 'text-anchor': 'middle', fill: 'var(--ink-2)', s: k, hide: bi('sign') }), 'balance.right');
      if (i === 0) { editable(lt, 'balance.left'); editable(rt, 'balance.right'); computed(sg, 'balance.right'); }
      else { computed(lt, 'balance.left'); computed(rt, 'balance.right'); computed(sg, 'balance.right'); }
      // the operation: bold, full-strength teal while it is the current step
      if (!ln.note) continue;
      const nl = noteLines[i], CW = WORK_X1 - WORK_X0;
      nl.forEach((t, j) => {
        const nw = measure(root, t, 'ts-frac'), nX = clamp(eqX, WORK_X0 + nw / 2, Math.max(WORK_X0 + nw / 2, WORK_X1 - nw / 2));
        if (nw > CW && !past) ctx.warn(`The step label is ${Math.round(nw)} units wide; the column has ${CW}.`);
        computed(T(lg, nX, y + 44 + j * NOTE_LH, t, 'ts-frac', { 'text-anchor': 'middle', fill: past ? 'var(--ink-2)' : 'var(--compare-text)', ...(past ? { s: kNext } : { s: kNote, hide: kNext >= 0 ? kNext : null, cls: 'rise', delay: 300 }) }), 'balance.left');
      });
    }
  });

  /* tilt: worked out from what is on each pan after every build (heavier side down) */
  const angOf = st => { const wl = st.L[0] * (M.x || 0) + st.L[1], wr = st.R[0] * (M.x || 0) + st.R[1]; if (wl === wr) return 0; const d = wr - wl; return Math.sign(d) * clamp(2 + 4 * Math.abs(d) / Math.max(wl, wr, 1), 2, 6); };
  const A = items.map(it => angOf(it.st));
  const setAng = deg => {
    beam.setAttribute('transform', `rotate(${deg} ${CX} ${PY})`);
    const r = deg * Math.PI / 180;
    for (const side of ['L', 'R']) { const s = side === 'L' ? -1 : 1; pans[side].g.setAttribute('transform', `translate(${s * ARM * (Math.cos(r) - 1)} ${s * ARM * Math.sin(r)})`); }
  };
  setAng(A[A.length - 1]);
  const dur = Object.fromEntries(items.map((it, i) => [it.key, i < 2 ? 1700 : 1300]));
  return {
    dur,
    still() { setAng(A[A.length - 1]); },
    reset() { setAng(0); },
    tick(k, u) { if (k >= A.length) return setAng(A[A.length - 1]); const from = k === 0 ? 0 : A[k - 1]; const v = k < 2 ? clamp((u - .3) / .7) : u; setAng(lerp(from, A[k], eIO(v))); },
  };
}

/* A cube as children use it: a flat square with one shaded face along the bottom. */
function cubeMark(p, x, y, cu, a = {}) {
  const g = h('g', a, p);
  h('rect', { x, y, width: cu, height: cu, rx: 4, fill: 'var(--counter-edge)', cls: 'body' }, g);
  h('rect', { x, y, width: cu, height: Math.round(cu * .8), rx: 4, fill: 'var(--counter)' }, g);
  return g;
}

/* One centred balance with one number sentence above the stand: the Year 1 and 2 layout
   (missing number by matching, comparing two sides, or an unknown left for the class).
   Sized to fill the slide: pans span the live width, cubes as large as the pan allows, and
   everything is placed for the final build so nothing moves between clicks. */
function renderWide(root, P, ctx) {
  const { M, items } = balancePlan(P); const b = ctx.b, N = ctx.N; const g = M.g;
  const bi = k => b[k] ?? -1;
  const CX = 640, PY = 514, ARM = 310, PW = 500, PAN_Y = PY - 78, BASE_Y = 624;
  const TILT = Math.ceil(ARM * Math.sin(6 * Math.PI / 180));   // the most a pan rises when tilted
  const kL = bi('left'), kR = bi('right'), kM = bi('match'), kO = bi('leftover'), kX = M.match ? N : -1;

  const stand = h('g', {}, root);
  h('polygon', { points: `${CX},${PY} ${CX - 82},${BASE_Y} ${CX + 82},${BASE_Y}`, fill: 'var(--metal-shade)', stroke: 'var(--metal-shade)', 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round', cls: 'body' }, stand);
  h('rect', { x: CX - 200, y: BASE_Y, width: 400, height: 24, rx: 'var(--r-mark)', fill: 'var(--ink-2)', cls: 'body' }, stand);
  const beam = h('g', {}, root);
  h('rect', { x: CX - ARM - 18, y: PY - 11, width: 2 * ARM + 36, height: 22, rx: 11, fill: 'var(--ink-2)', cls: 'body' }, beam);
  h('circle', { cx: CX, cy: PY, r: 16, fill: 'var(--paper)', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-arrow)' }, beam);
  const pans = {};
  for (const side of ['L', 'R']) {
    const ex = CX + (side === 'L' ? -ARM : ARM);
    const pg = h('g', {}, root); pans[side] = { g: pg, ex };
    h('rect', { x: ex - 8, y: PAN_Y + 16, width: 16, height: PY - PAN_Y - 16, fill: 'var(--ink-2)' }, pg);
    h('path', { d: `M${ex - PW / 2} ${PAN_Y} L ${ex + PW / 2} ${PAN_Y} L ${ex + PW / 2 - 24} ${PAN_Y + 20} L ${ex - PW / 2 + 24} ${PAN_Y + 20} Z`, fill: 'var(--metal)', stroke: 'var(--metal-shade)', 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round', cls: 'body' }, pg);
  }
  const S_ = s => s === 'L' ? M.L : M.R;
  const k0 = s => s === 'L' ? kL : kR;
  const GAP = 10, FIVE = 24, PB = 9, ROOM = PW - 28;
  // x offsets of n cubes in a row of up to 10, with a wider gap after each 5 (dice-like 5 + n)
  const rowXs = (n, cu, five = true) => { const o = []; let x = 0; for (let i = 0; i < n; i++) { o.push(x); x += cu + (five && i % 5 === 4 ? FIVE : GAP); } return { xs: o, w: n ? x - (five && n % 5 === 0 ? FIVE : GAP) : 0 }; };
  const boxW = (n, cu) => n * cu + (n - 1) * GAP + 2 * PB;
  const cubeAt = { L: [], R: [] };
  let topY = PAN_Y;   // highest mark, for placing the sentence

  if (M.match) {
    const uS = M.uSide, oS = uS === 'L' ? 'R' : 'L';
    const x = M.x, bU = M.bU, bO = M.bO;
    // the plain side splits where the matched cubes start, with a clear gap so the two rings never touch
    const SPLIT = 30, cut = oS === 'L' ? bO - bU : bU;
    const plainXs = c => { const o = []; let xx = 0; for (let i = 0; i < bO; i++) { if (i === cut && i > 0) xx += SPLIT - GAP; o.push(xx); xx += c + GAP; } return { xs: o, w: xx - GAP }; };
    let cu = 64;
    const uW = c => bU * (c + GAP) + SPLIT + boxW(x, c);
    while (cu > 26 && (plainXs(cu).w > ROOM || uW(cu) > ROOM)) cu--;
    const yC = PAN_Y - 4 - cu - PB;           // cubes sit level with the cubes inside the box
    topY = yC - PB;
    // the plain side: matched cubes nearest the middle, left-over cubes at the outer end
    { const { g: pg, ex } = pans[oS]; const { xs, w } = plainXs(cu); const x0 = ex - w / 2;
      xs.forEach((dx, i) => {
        const inner = oS === 'L' ? i >= bO - bU : i < bU;
        const it = { x: x0 + dx, y: yC };
        cubeMark(pg, it.x, it.y, cu, { s: k0(oS), cls: 'pop', delay: 60 + i * 50, c: inner && kO >= 0 ? `${kO}:soft` : null });
        cubeAt[oS].push({ ...it, inner });
      });
      const out = cubeAt[oS].filter(c => !c.inner);
      if (out.length && kO >= 0) { const x1 = Math.min(...out.map(c => c.x)), x2 = Math.max(...out.map(c => c.x)) + cu; groupRing(pg, { x: x1, y: yC, w: x2 - x1, h: cu }, { pad: 7, s: kO, col: 'var(--focus)' }); }
    }
    // the box side: cubes nearest the middle, the box at the outer end
    { const { g: pg, ex } = pans[uS]; const W = uW(cu); const x0 = ex - W / 2;
      const bw = boxW(x, cu), bh = cu + 2 * PB, by = yC - PB;
      const cubesX = uS === 'R' ? x0 : x0 + bw + SPLIT;
      const boxX = uS === 'R' ? x0 + bU * (cu + GAP) + SPLIT - GAP : x0;
      for (let i = 0; i < bU; i++) { const it = { x: cubesX + i * (cu + GAP), y: yC }; cubeMark(pg, it.x, it.y, cu, { s: k0(uS), cls: 'pop', delay: 60 + i * 50, c: kO >= 0 ? `${kO}:soft` : null }); cubeAt[uS].push({ ...it, inner: true }); }
      // the closed box: tinted, with ? on it, until the last click
      const bg = h('g', { s: k0(uS), cls: 'pop', delay: 60 + bU * 50, hide: kX >= 0 ? kX : null }, pg);
      h('rect', { x: boxX, y: by, width: bw, height: bh, rx: 'var(--r-card)', fill: 'var(--focus-pale)', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)', cls: 'body' }, bg);
      const q = T(bg, boxX + bw / 2, yC + cu / 2 + 2, g, 'ts-big', { 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: 'var(--focus-text)' });
      computed(q, 'unknown');
      // the opened box: an open tray with its lid lifted on the inner hinge, the cubes inside in plain view
      if (kX >= 0) {
        const og = h('g', { s: kX }, pg);
        h('path', { d: `M${boxX} ${by} L ${boxX} ${by + bh} L ${boxX + bw} ${by + bh} L ${boxX + bw} ${by}`, fill: 'none', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, og);
        const hx = uS === 'R' ? boxX : boxX + bw, ang = uS === 'R' ? -16 : 16;
        h('rect', { x: uS === 'R' ? hx : hx - bw, y: by - 14, width: bw, height: 14, rx: 4, fill: 'var(--focus-pale)', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)', transform: `rotate(${ang} ${hx} ${by})` }, og);
        for (let i = 0; i < x; i++) cubeMark(og, boxX + PB + i * (cu + GAP), yC, cu, { s: kX, cls: 'pop', delay: 200 + i * 90 });
        topY = Math.min(topY, by - 10 - Math.sin(16 * Math.PI / 180) * bw);
      }
    }
    // matching: the paired cubes ringed on both sides, joined by one link
    if (kM >= 0) {
      const lg = h('g', { c: kO >= 0 ? `${kO}:soft` : null }, root);
      const boxOf = side => { const cs = cubeAt[side].filter(c => c.inner); const x1 = Math.min(...cs.map(c => c.x)), x2 = Math.max(...cs.map(c => c.x)) + cu; return { x: x1, y: yC, w: x2 - x1, h: cu }; };
      const bo = boxOf(oS), bu = boxOf(uS);
      groupRing(pans[oS].g, bo, { pad: 7, s: kM, col: 'var(--compare)', a: { c: kO >= 0 ? `${kO}:soft` : null } });
      groupRing(pans[uS].g, bu, { pad: 7, s: kM, col: 'var(--compare)', a: { c: kO >= 0 ? `${kO}:soft` : null } });
      const ax = bo.x + bo.w / 2, cx2 = bu.x + bu.w / 2, y = yC - 7 - 4, cy = y - 70;
      h('path', { d: `M${ax} ${y} C ${ax} ${cy} ${cx2} ${cy} ${cx2} ${y}`, fill: 'none', stroke: 'var(--compare)', 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round', s: kM, cls: 'draw', pathLength: 1, delay: 300 }, lg);
      topY = Math.min(topY, y - 56);
    }
  } else {
    // comparing, or an unknown the class is asked to find: boxes above, cubes in rows of 5 (up to 10) or 10 (5 + 5)
    const maxB = Math.max(M.L.b, M.R.b, 1), per = maxB <= 10 ? 5 : 10, perRow = Math.min(per, maxB);
    const nRows = Math.ceil(maxB / per), maxA = Math.max(M.L.a, M.R.a);
    let cu = 60; while (cu > 22 && (rowXs(perRow, cu).w > ROOM || nRows * (cu + GAP) + (maxA ? cu * 1.25 + 12 : 0) > 210)) cu--;
    const BOX = Math.round(Math.max(64, cu * 1.25));
    for (const side of ['L', 'R']) {
      const S = S_(side), { g: pg, ex } = pans[side]; let y = PAN_Y - 4; let j = 0;
      if (M.cubes) {
        const fw = rowXs(perRow, cu).w;
        for (let r = 0; r * per < S.b; r++) {
          const n = Math.min(per, S.b - r * per); const { xs } = rowXs(n, cu); y -= cu + (r ? GAP : 0);
          xs.forEach(dx => cubeMark(pg, ex - fw / 2 + dx, y, cu, { s: k0(side), cls: 'pop', delay: 60 + (j++) * 35 }));
        }
      } else {
        const nums = S.terms.filter(t => t.k === 'num'); const ws = nums.map(t => Math.max(96, measure(root, fmtNum(t.v), 'ts-big') + 40));
        const tw = ws.reduce((s2, w2) => s2 + w2, 0) + (ws.length - 1) * 10; let xx = ex - tw / 2; const WH = 84; y -= WH;
        nums.forEach((t, i) => { const wg = h('g', { s: k0(side), cls: 'pop', delay: 60 + i * 80 }, pg); const it = { x: xx, y, w: ws[i], h: WH };
          h('path', { d: `M${it.x + 8} ${it.y + it.h} L ${it.x} ${it.y + 12} Q ${it.x} ${it.y} ${it.x + 12} ${it.y} L ${it.x + it.w - 12} ${it.y} Q ${it.x + it.w} ${it.y} ${it.x + it.w} ${it.y + 12} L ${it.x + it.w - 8} ${it.y + it.h} Z`, fill: 'var(--panel)', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)', 'stroke-linejoin': 'round', cls: 'body' }, wg);
          computed(T(wg, it.x + it.w / 2, it.y + it.h / 2 + 3, fmtNum(t.v), 'ts-big', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }), side === 'L' ? 'balance.left' : 'balance.right');
          xx += ws[i] + 10; });
      }
      if (S.a > 0) {
        const tw = S.a * BOX + (S.a - 1) * 10; y -= BOX + 12;
        for (let i = 0; i < S.a; i++) { const bg = h('g', { s: k0(side), cls: 'pop', delay: 60 + i * 60 }, pg); const bx = ex - tw / 2 + i * (BOX + 10);
          h('rect', { x: bx, y, width: BOX, height: BOX, rx: 'var(--r-card)', fill: 'var(--focus-pale)', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)', cls: 'body' }, bg);
          computed(T(bg, bx + BOX / 2, y + BOX / 2 + 2, g, 'ts-big', { 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: 'var(--focus-text)' }), P.unknown === 'letter' ? 'letter' : 'unknown'); }
      }
      topY = Math.min(topY, y);
    }
  }

  /* the number sentence above the stand, one token at a time so the unknown can turn into its value */
  const cls = 'ts-eq', FA = { 'font-size': 'calc(var(--fs-eq) * 1.3)' };
  const EQ_Y = clamp(topY - TILT - 44, GRID.top + 58, 214);
  const toks = [];
  const side = (S, path) => S.terms.forEach((t, i) => {
    if (i) toks.push({ t: '+', path, kind: 'op' });
    if (t.k === 'num') toks.push({ t: fmtNum(t.v), path, kind: 'edit' });
    else if (M.match) toks.push({ t: g, path, kind: 'unk' });
    else toks.push({ t: unkStr(t.c, g, P), path: P.unknown === 'letter' ? 'letter' : 'unknown', kind: 'calc' });
  });
  side(M.L, 'balance.left');
  const wL = wOf(M.L, M.x || 0), wR = wOf(M.R, M.x || 0);
  toks.push({ t: M.hasU ? '=' : rel(wL, wR), path: 'balance.right', kind: M.hasU ? 'op' : 'sign' });
  side(M.R, 'balance.right');
  const mz = s => measure(root, s, cls, FA);
  const SP = mz('0') * .42;
  const wTok = tk => tk.kind === 'unk' ? Math.max(mz(tk.t), mz(fmtNum(M.x))) : tk.kind === 'sign' ? Math.max(mz(tk.t), mz('?')) : mz(tk.t);
  const ws = toks.map(wTok); const tot = ws.reduce((s2, w2) => s2 + w2, 0) + (toks.length - 1) * SP;
  const eq = h('g', { s: kR, cls: 'rise', delay: 500 }, root);
  let ex = CX - tot / 2;
  toks.forEach((tk, i) => {
    const cx = ex + ws[i] / 2; ex += ws[i] + SP;
    const a = { 'text-anchor': 'middle', ...FA };
    if (tk.kind === 'edit') editable(T(eq, cx, EQ_Y, tk.t, cls, a), tk.path);
    else if (tk.kind === 'op') computed(T(eq, cx, EQ_Y, tk.t, cls, a), tk.path);
    else if (tk.kind === 'calc') computed(T(eq, cx, EQ_Y, tk.t, cls, { ...a, fill: 'var(--focus-text)' }), tk.path);
    else if (tk.kind === 'unk') {
      computed(T(eq, cx, EQ_Y, tk.t, cls, { ...a, fill: 'var(--focus-text)', hide: kX >= 0 ? kX : null }), 'unknown');
      if (kX >= 0) computed(T(eq, cx, EQ_Y, fmtNum(M.x), cls, { ...a, fill: 'var(--focus-text)', s: kX, cls: 'pop', delay: 500 }), tk.path);
    } else {
      const kS = bi('sign');
      computed(T(eq, cx, EQ_Y, '?', cls, { ...a, fill: 'var(--ink-2)', hide: kS >= 0 ? kS : null }), 'balance.right');
      computed(T(eq, cx, EQ_Y, tk.t, cls, { ...a, fill: 'var(--focus-text)', s: kS, cls: 'pop' }), 'balance.right');
    }
  });

  /* tilt: worked out from what is on each pan after every build (heavier side down) */
  const angOf = st => { const wl = st.L[0] * (M.x || 0) + st.L[1], wr = st.R[0] * (M.x || 0) + st.R[1]; if (wl === wr) return 0; const d = wr - wl; return Math.sign(d) * clamp(2 + 4 * Math.abs(d) / Math.max(wl, wr, 1), 2, 6); };
  const A = items.map(it => angOf(it.st));
  const setAng = deg => {
    beam.setAttribute('transform', `rotate(${deg} ${CX} ${PY})`);
    const r = deg * Math.PI / 180;
    for (const sd of ['L', 'R']) { const s = sd === 'L' ? -1 : 1; pans[sd].g.setAttribute('transform', `translate(${s * ARM * (Math.cos(r) - 1)} ${s * ARM * Math.sin(r)})`); }
  };
  setAng(A[A.length - 1]);
  const dur = Object.fromEntries(items.map((it, i) => [it.key, i < 2 ? 1700 : 1300]));
  return {
    dur,
    still() { setAng(A[A.length - 1]); },
    reset() { setAng(0); },
    tick(k, u) { if (k >= A.length) return setAng(A[A.length - 1]); const from = k === 0 ? 0 : A[k - 1]; const v = k < 2 ? clamp((u - .3) / .7) : u; setAng(lerp(from, A[k], eIO(v))); },
  };
}

function renderMachine(root, P, ctx) {
  const { MM } = machinePlan(P); const { steps, vals } = MM; const n = steps.length; const b = ctx.b, N = ctx.N;
  const bi = k => b[k] ?? -1; const f = fmtNum;
  // the biggest machine that fits the live area: boxes and numbers grow together
  const NC = 'ts-big';
  const fa = sc => ({ 'font-size': `calc(var(--fs-big) * ${(sc / 1.5).toFixed(3)})` });
  const sizeOf = sc => [Math.max(116 * sc, ...vals.map(v => measure(root, f(v), NC, fa(sc)) + 44 * sc)), Math.max(150 * sc, ...steps.map(s => measure(root, `${s.op} ${f(s.n)}`, NC, fa(sc)) + 56 * sc))];
  const LABEL_H = 50, MID = 100;                              // room for In/Out over the top row, and between the rows
  const fits = sc => { const [a, o] = sizeOf(sc); const tall = LABEL_H + 100 * sc + (MM.back ? MID + 100 * sc : 0); return (n + 1) * a + n * o + 2 * n * 50 <= GRID.right - GRID.left && tall <= GRID.bottom - GRID.top - 10; };
  const SC = [2.1, 1.9, 1.75, 1.5, 1.25, 1, 0.85].find(fits) || 0.85;
  const FA = fa(SC);
  const [vw, ow] = sizeOf(SC);
  const gap = clamp((GRID.right - GRID.left - (n + 1) * vw - n * ow) / (2 * n), 44, 140);
  const total = (n + 1) * vw + n * ow + 2 * n * gap; const x0 = 640 - total / 2;
  const vx = i => x0 + i * (vw + ow + 2 * gap);           // left of value box i
  const ox = i => vx(i) + vw + gap;                        // left of op box i
  const VH = 76 * SC, OH = 100 * SC;
  const tallAll = LABEL_H + OH + (MM.back ? MID + OH : 0);
  const top0 = (GRID.top + GRID.bottom) / 2 - tallAll / 2 + 10;  // centred in the content area, laid out for the last build
  const FY = top0 + LABEL_H + OH / 2, BY = FY + OH + MID;
  const k0 = MM.findInput ? bi('out') : bi('in');
  const arrowR = (p, xa, xb, y, col, a) => { const g = h('g', a, p); h('line', { x1: xa, x2: xb - 12, y1: y, y2: y, stroke: col, 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round', cls: 'draw', pathLength: 1 }, g); h('path', { d: headD(xb, y, 0, 16), fill: col }, g); return g; };
  const arrowL = (p, xa, xb, y, col, a) => { const g = h('g', a, p); h('line', { x1: xa, x2: xb + 12, y1: y, y2: y, stroke: col, 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round' }, g); h('path', { d: headD(xb, y, Math.PI, 16), fill: col }, g); return g; };
  const valBox = (p, i, y, text, { a = {}, col = 'var(--rule)', tcol = 'var(--ink)', path = 'machine.input' } = {}) => {
    const g = h('g', a, p);
    h('rect', { x: vx(i), y: y - VH / 2, width: vw, height: VH, rx: 'var(--r-card)', fill: 'var(--paper)', stroke: col, 'stroke-width': 'var(--sw-struct)', cls: 'body' }, g);
    computed(T(g, vx(i) + vw / 2, y + 2, text, NC, { 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: tcol, ...FA }), path);
    return g;
  };
  const opBox = (p, i, y, text, { a = {}, back = false } = {}) => {
    const g = h('g', a, p);
    h('rect', { x: ox(i), y: y - OH / 2, width: ow, height: OH, rx: 'var(--r-card)', fill: back ? 'var(--compare-pale)' : 'var(--panel)', stroke: back ? 'var(--compare)' : 'var(--ink-3)', 'stroke-width': 'var(--sw-struct)', cls: 'body' }, g);
    computed(T(g, ox(i) + ow / 2, y + 2, text, NC, { 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: back ? 'var(--compare-text)' : 'var(--ink)', ...FA }), `machine.steps.${i}.op`);
    return g;
  };

  /* labels over the ends: wrap (up to three lines), then shrink, never overflow; the last line sits on the box */
  const lw = Math.max(160, vw + gap - 18);   // never reaches over the taller op box beside the end box
  const endLabel = (x, key, def, anchor, s) => {
    const tb = textBlock(root, x, FY - VH / 2 - 18, txt(P, key, def), { cls: 'ts-label', maxW: lw, maxLines: 3, lh: 32, anchor, edit: `text.${key}`, a: { s } });
    if (tb.lines.length > 1) tb.el.setAttribute('transform', `translate(0 ${-(tb.lines.length - 1) * tb.lh})`);
  };
  endLabel(vx(0), 'label:input', 'In', 'start', k0);
  endLabel(vx(n) + vw, 'label:output', 'Out', 'end', MM.findInput ? k0 : bi(`op:${n - 1}`));

  /* forward run */
  const fw = h('g', {}, root);   // the forward run stays at full strength: the class reads both rows
  steps.forEach((s, i) => opBox(fw, i, FY, `${s.op} ${f(s.n)}`, { a: { s: k0, cls: 'rise' } }));
  if (MM.findInput) {
    const q = valBox(root, 0, FY, '?', { a: { s: k0, hide: bi('back:0') }, col: 'var(--focus)', tcol: 'var(--focus-text)' });
    valBox(root, 0, FY, f(vals[0]), { a: { s: bi('back:0'), cls: 'pop', delay: 700 }, col: 'var(--focus)', tcol: 'var(--focus-text)' });
    steps.forEach((s, i) => { arrowR(fw, i === 0 ? vx(0) + vw + 6 : ox(i - 1) + ow + 6, ox(i) - 6, FY, 'var(--ink-3)', { s: k0 }); });
    arrowR(fw, ox(n - 1) + ow + 6, vx(n) - 6, FY, 'var(--ink-3)', { s: k0 });
    valBox(root, n, FY, f(vals[n]), { a: { s: k0, cls: 'pop', delay: 400 }, path: `machine.steps.${n - 1}.n` });
    void q;
  } else {
    valBox(fw, 0, FY, f(vals[0]), { a: { s: k0, cls: 'pop' } });
    steps.forEach((s, i) => {
      const k = bi(`op:${i}`);
      arrowR(fw, vx(i) + vw + 6, ox(i) - 6, FY, 'var(--ink-3)', { s: k });
      arrowR(fw, ox(i) + ow + 6, vx(i + 1) - 6, FY, 'var(--ink-3)', { s: k, delay: 450 });
      const last = i === n - 1;
      valBox(last ? root : fw, i + 1, FY, f(vals[i + 1]), { a: { s: k, cls: 'pop', delay: 800 }, col: last ? 'var(--focus)' : 'var(--rule)', tcol: last ? 'var(--focus-text)' : 'var(--ink)', path: `machine.steps.${i}.n` });
    });
  }

  /* backwards run: inverse operations in reverse order, right to left */
  if (MM.back) {
    const kb0 = bi(`back:${n - 1}`);
    const bg = h('g', {}, root);
    const tbB = textBlock(bg, vx(0), BY - OH / 2 - 22, txt(P, 'label:back', 'Run it backwards'), { cls: 'ts-label', maxW: total, maxLines: 2, lh: 30, edit: 'text.label:back', a: { s: kb0, fill: 'var(--compare-text)' } });
    if (tbB.lines.length > 1) tbB.el.setAttribute('transform', `translate(0 ${-(tbB.lines.length - 1) * tbB.lh})`);
    valBox(bg, n, BY, f(vals[n]), { a: { s: kb0, cls: 'rise' }, path: `machine.steps.${n - 1}.n` });
    for (let i = n - 1; i >= 0; i--) {
      const k = bi(`back:${i}`); const s = steps[i];
      opBox(bg, i, BY, `${INV[s.op]} ${f(s.n)}`, { a: { s: k, cls: 'rise' }, back: true });
      arrowL(bg, vx(i + 1) - 6, ox(i) + ow + 6, BY, 'var(--compare)', { s: k, delay: 250 });
      arrowL(bg, ox(i) - 6, vx(i) + vw + 6, BY, 'var(--compare)', { s: k, delay: 600 });
      valBox(bg, i, BY, f(vals[i]), { a: { s: k, cls: 'pop', delay: 900 }, col: i === 0 ? 'var(--focus)' : 'var(--rule)', tcol: i === 0 ? 'var(--focus-text)' : 'var(--ink)', path: i === 0 ? 'machine.input' : `machine.steps.${i - 1}.n` });
    }
  }
  return { dur: Object.fromEntries(machinePlan(P).items.map(it => [it.key, 1400])) };
}
