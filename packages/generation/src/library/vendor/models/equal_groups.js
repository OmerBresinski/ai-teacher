// Equal groups, arrays and the grid method. One model for multiplication and division from
// Year 1 to Year 6: loose objects move into equal groups (rings) or rows (an array), the class
// counts in steps, then the sentence is written. Division is drawn two ways that never mix:
// sharing (the groups exist first and get one each in turn) and grouping (a ring forms round
// each group of the divisor's size). A remainder stays in the pile, smaller than the divisor.
// Arrays can turn (commutativity). The grid method partitions both numbers, works out each
// part's product in code and adds them. Every number on the slide is computed.
import {
  h, T, measure, clamp, eIO, rng, GRID, textBlock,
  editable, computed, txt, TEXT_PARAM, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { countable, groupRing, fmtNum, COUNTABLES, pvColour } from '../kit/batch-A.js';

export const meta = {
  id: 'equal_groups', name: 'Equal groups and arrays', kind: 'info', version: 1,
  subjects: ['Maths'],
  years: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6'],
  teaches: 'Multiplication as equal groups, rows and columns, and division as sharing or grouping, up to the grid method for bigger numbers.',
};

const NOUN = { counter: ['counter', 'counters'], apple: ['apple', 'apples'], duck: ['duck', 'ducks'], star: ['star', 'stars'], car: ['car', 'cars'] };
const pl = (n, one, many) => `${fmtNum(n)} ${n === 1 ? one : many}`;

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Equal groups and arrays',
  properties: {
    title: TITLE_PARAM('Equal groups'),
    layout: { type: 'string', title: 'Show it as', enum: ['groups', 'array', 'grid'], 'x-labels': ['Equal groups (in rings)', 'An array (rows and columns)', 'The grid method (bigger numbers)'], default: 'groups' },
    groups: { type: 'integer', title: 'Number of groups (or rows)', description: 'When sharing, this is how many it is shared between.', minimum: 1, maximum: 12, default: 5 },
    size: { type: 'integer', title: 'How many in each group (or row)', description: 'When grouping, this is the size of each group.', minimum: 1, maximum: 12, default: 2 },
    object: { type: 'string', title: 'Objects', enum: COUNTABLES, 'x-labels': ['Counters', 'Apples', 'Ducks', 'Stars', 'Cars'], default: 'counter' },
    division: { type: 'string', title: 'Division', enum: ['none', 'sharing', 'grouping'], 'x-labels': ['No, multiplication', 'Sharing (one each in turn)', 'Grouping (make groups of a size)'], default: 'none' },
    remainder: { type: 'integer', title: 'Left over', description: 'Division only. It must be smaller than the number you divide by.', minimum: 0, maximum: 11, default: 0 },
    countSteps: { type: 'boolean', title: 'Count in steps', default: true },
    addition: { type: 'boolean', title: 'Write it as repeated addition first', description: 'Multiplication only: shows 2 + 2 + 2 + 2 + 2 = 10 before 5 × 2 = 10. Left out when there are more than 8 groups.', default: true },
    turn: { type: 'boolean', title: 'Turn the array', description: 'Arrays in multiplication: shows the same total the other way round.', default: false },
    showFacts: { type: 'boolean', title: 'Show the fact family', description: 'Two multiplications and two divisions from one picture. With something left over it shows the check instead: multiply back and add what is left.', default: false },
    grid: {
      type: 'object', title: 'Grid method numbers', description: 'Used when “Show it as” is the grid method. Each number is split by place value (23 = 20 + 3).',
      default: { a: 23, b: 14 },
      properties: {
        a: { type: 'integer', title: 'First number', minimum: 2, maximum: 999, default: 23 },
        b: { type: 'integer', title: 'Second number', minimum: 2, maximum: 999, default: 14 },
      },
    },
    text: TEXT_PARAM,
  },
};

export const presets = [
  { id: 'y2-groups-of-2', name: 'Year 2: 5 groups of 2', params: { title: '5 groups of 2', layout: 'groups', groups: 5, size: 2, object: 'counter', division: 'none', countSteps: true, addition: true } },
  { id: 'y3-13-div-4', name: 'Year 3: 13 ÷ 4 = 3 r 1', params: { title: 'How many groups of 4 in 13?', layout: 'groups', groups: 3, size: 4, remainder: 1, object: 'counter', division: 'grouping', countSteps: true } },
  { id: 'y4-array-turn', name: 'Year 4: 3 × 6 and 6 × 3', params: { title: 'Arrays: 3 × 6 and 6 × 3', layout: 'array', groups: 3, size: 6, object: 'counter', division: 'none', countSteps: true, addition: false, turn: true, showFacts: true } },
  { id: 'y5-grid-23x14', name: 'Year 5: 23 × 14 by the grid method', params: { title: '23 × 14 by the grid method', layout: 'grid', grid: { a: 23, b: 14 } } },
];

/* ------------------------------------------------------------------ the numbers */
function nums(P) {
  const G = P.groups, S = P.size, div = P.division !== 'none' && P.layout !== 'grid';
  const R = div ? P.remainder : 0, N = G * S + R;
  const sharing = div && P.division === 'sharing', grouping = div && P.division === 'grouping';
  const array = P.layout === 'array', turn = array && !div && P.turn && G !== S; // a square array turns into itself
  const facts = P.showFacts && R === 0, check = P.showFacts && R > 0; // a remainder has no fact family, but it can be checked
  const noun = NOUN[P.object] || NOUN.counter;
  const add = !div && P.addition && G > 1 && G <= 8; // repeated addition: 2 + 2 + 2 + 2 + 2, kept to one readable line
  return { G, S, R, N, div, sharing, grouping, array, turn, facts, check, add, noun, divisor: sharing ? G : S, quot: sharing ? S : G };
}
const pvSplit = n => String(n).split('').map((c, i, a) => +c * 10 ** (a.length - 1 - i)).filter(v => v > 0);
function gridNums(P) {
  // the grid method splits by place value, so the parts are worked out from each number, never typed
  const g = P.grid; const A = pvSplit(g.a), B = pvSplit(g.b);
  const cells = []; B.forEach((q, j) => A.forEach((p, i) => cells.push({ i, j, p, q, v: p * q })));
  return { a: g.a, b: g.b, A, B, cells, prod: g.a * g.b };
}

/* ------------------------------------------------------------------ layout (pure numbers, so validate can check it fits) */
const ZONE = { x: GRID.left, w: GRID.right - GRID.left };
const DMAX = 140; // one object's cell at most: big enough to read from the back of the room
const PILE = { y: 128, h: 112 };
const TOP = 120, BOT = 556; // the stage between the title and the sentence row
function lay(P) {
  const M = nums(P); const { G, S, R, N } = M;
  const top = M.sharing ? PILE.y + PILE.h + 20 : TOP, bot = BOT, H = bot - top;
  const out = { d: 0, groups: [], pile: [], left: null, top, bot, turn: null };
  if (M.array) {
    // one array, laid out once. Row totals sit at the row ends; a turn spins the same array a quarter turn
    // about its centre (shrinking only if the turned array would not fit), and the totals leave
    const labW = P.countSteps ? 112 : 0, rowsN = G + (R ? 1 : 0);
    const d = Math.min(DMAX, (ZONE.w * .86 - labW) / S, (R ? H - 16 : H) / rowsN); // a ringed short row needs a little more room
    const aw = S * d, ah = rowsN * d, x0 = 640 - (aw + labW) / 2, y0 = top + (H - ah) / 2;
    for (let i = 0; i < G; i++) out.groups.push({ items: Array.from({ length: S }, (_, j) => [x0 + (j + .5) * d, y0 + (i + .5) * d]), box: { x: x0, y: y0 + i * d, w: aw, h: d }, countAt: [x0 + aw + 30, y0 + (i + .5) * d + 4], anchor: 'start' });
    if (R) out.left = { items: Array.from({ length: R }, (_, j) => [x0 + (j + .5) * d, y0 + (G + .5) * d]), labAt: [x0 + R * d + 28, y0 + (G + .5) * d], side: true };
    if (M.turn) out.turn = { cx: x0 + aw / 2, cy: y0 + ah / 2, s: Math.min(1, H / (S * d), ZONE.w * .9 / (G * d)) };
    out.d = d; out.bbox = { x: x0, y: y0, w: aw, h: ah };
  } else {
    // pick the group shape (columns per group, rows of groups) that draws the objects largest
    const slot = M.grouping && R ? 1 : 0, slots = G + slot; // grouping: the left-over sits beside the groups
    // small tight clusters: grouping shows through spacing (the gap between rings is wider than the gap inside one),
    // never through big boxes
    const PAD = .24, GAP = .62, gy = 28, lab = P.countSteps || M.sharing || slot ? 64 : 0;
    let best = null;
    for (let gr = 1; gr <= 3; gr++) {
      const gc = Math.ceil(slots / gr); if (gr > 1 && (gr - 1) * gc >= slots) continue;
      for (let c = Math.min(S, 6); c >= 1; c--) {
        const rows = Math.ceil(S / c); if (rows > c + 1) continue;
        const d = Math.min(DMAX, ZONE.w / (gc * (c + 2 * PAD) + (gc - 1) * GAP), (H - (gr - 1) * gy - gr * lab) / gr / (rows + 2 * PAD));
        const waste = c * rows - S; // a tie in size goes to the tidier shape: 4 is 2 by 2, not 3 and 1
        if (!best || d > best.d + 1 || (d > best.d - 1 && gr === best.gr && waste < best.waste)) best = { c, rows, gr, gc, d, waste };
      }
    }
    if (!best) best = { c: Math.min(S, 6), rows: Math.ceil(S / Math.min(S, 6)), gr: 1, gc: slots, d: 1 };
    const { c, rows, gr, gc, d } = best, gx = GAP * d;
    const gw = (c + 2 * PAD) * d, gh = (rows + 2 * PAD) * d;
    const totH = gr * (gh + lab) + (gr - 1) * gy, y0 = top + (H - totH) / 2;
    const place = (box, n, c = best.c) => Array.from({ length: n }, (_, j) => { const r = Math.floor(j / c), cc = j % c, k = r === Math.ceil(n / c) - 1 ? n - r * c : c; return [box.x + PAD * d + (c - k) * d / 2 + (cc + .5) * d, box.y + PAD * d + (r + .5) * d]; });
    // the left-over slot is only as wide as what is in it, so the left over sits close to the groups
    const wOf = g => g >= G ? (Math.min(c, R) + 2 * PAD) * d : gw, boxes = [];
    for (let g = 0; g < slots; g++) {
      const row = Math.floor(g / gc), col = g % gc, r0 = row * gc, inRow = row === gr - 1 ? slots - r0 : gc;
      let rw = (inRow - 1) * gx; for (let q = 0; q < inRow; q++) rw += wOf(r0 + q);
      let x = ZONE.x + (ZONE.w - rw) / 2; for (let q = 0; q < col; q++) x += wOf(r0 + q) + gx;
      boxes.push({ box: { x, y: y0 + row * (gh + lab + gy), w: wOf(g), h: gh }, first: col === 0, last: col === inRow - 1 });
    }
    for (let g = 0; g < G; g++) { const { box } = boxes[g]; out.groups.push({ items: place(box, S), box, countAt: [box.x + gw / 2, box.y + gh + 38], anchor: 'middle' }); }
    if (slot) { const sb = boxes[G], sw = sb.box.w, mid = sb.box.x + sw / 2; out.left = { items: place(sb.box, R, Math.min(c, R)), labAt: [mid, sb.box.y + gh + 38], side: false, half: Math.min(sb.first ? mid - ZONE.x : sw / 2 + gx + gw / 2 - 32, sb.last ? ZONE.x + ZONE.w - mid : sw / 2 + gx + gw / 2 - 32) }; }
    out.d = d; const xs = boxes.map(g => g.box);
    out.bbox = { x: Math.min(...xs.map(b => b.x)), y: y0, w: Math.max(...xs.map(b => b.x + b.w)) - Math.min(...xs.map(b => b.x)), h: totH - lab };
  }
  if (M.sharing) {
    // sharing: every object in tidy rows across the top strip, above the empty groups
    let dp = Math.min(out.d, 72), per, nr;
    for (; dp > 10; dp -= 2) { per = Math.floor(ZONE.w / dp); nr = Math.ceil(N / per); if (nr * dp <= PILE.h) break; }
    per = Math.min(per, Math.ceil(N / nr));
    for (let i = 0; i < N; i++) { const r = Math.floor(i / per), c = i % per, n = r === nr - 1 ? N - r * per : per; out.pile.push([ZONE.x + (ZONE.w - n * dp) / 2 + (c + .5) * dp, PILE.y + (PILE.h - nr * dp) / 2 + (r + .5) * dp]); }
    out.dp = dp;
  } else {
    // loose objects, the same size they will be, where the groups will be: one even line if they fit,
    // otherwise a staggered (honeycomb) cluster whose rows alternate long and short, so it never reads as an array
    const b = out.bbox, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const lp = Math.min(out.d * 1.5, ZONE.w / N);
    if (!M.array && lp >= out.d * 1.12) {
      for (let i = 0; i < N; i++) out.pile.push([640 - N * lp / 2 + (i + .5) * lp, cy]);
      out.dp = out.d; return out;
    }
    const W = Math.min(ZONE.w, Math.max(b.w, out.d * 3)), Hh = Math.min(H, Math.max(b.h, out.d * 2));
    const r0 = Math.max(1, Math.round(Math.sqrt(N * Hh / W / .85)));
    const r = [r0, r0 + 1, r0 - 1].find(q => q >= 1 && q <= N && N % q) || r0;
    const base = Math.floor(N / r), extra = N % r, cnt = Array(r).fill(base);
    // the extra objects go on alternate lines: odd lines when that is enough (3, 4, 3), else even lines (5, 4, 5, 4)
    const odd = r % 2 === 1 && extra <= (r - 1) / 2;
    const order = [...Array(r).keys()].sort((p, q) => (odd ? (q % 2) - (p % 2) : (p % 2) - (q % 2)) || p - q);
    for (let i = 0; i < extra; i++) cnt[order[i]]++;
    if (!extra && r > 1) for (let i = 0; i + 1 < r; i += 2) { cnt[i]++; cnt[i + 1]--; }
    const mx = Math.max(...cnt), dp = Math.min(out.d, W / (mx + .3) / 1.12, Hh / r / .92), px = dp * 1.12, py = dp * .92;
    let i = 0;
    cnt.forEach((n, ri) => { for (let j = 0; j < n; j++, i++) out.pile.push([cx - n * px / 2 + (j + .5) * px, cy - (r - 1) * py / 2 + ri * py]); });
    out.dp = dp;
  }
  return out;
}

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P), W = [];
  if (R.length) return result(R);
  if (P.layout === 'grid') return result(R);
  const M = nums(P);
  if (P.division === 'sharing' && P.layout === 'array') R.push({ path: 'layout', reason: 'Sharing is shown with groups in rings. Choose Equal groups, or choose Grouping for an array.' });
  if (P.division === 'none' && P.remainder > 0) R.push({ path: 'remainder', reason: 'Only a division can have something left over. Choose sharing or grouping, or set “Left over” to 0.' });
  if (M.div && M.R >= M.divisor) R.push({ path: 'remainder', reason: `${fmtNum(M.R)} left over is too many when dividing by ${M.divisor}: you could ${M.sharing ? 'give every group one more' : `make another group of ${M.S}`}. The amount left over must be less than ${M.divisor}.` });
  if (R.length) return result(R);
  if (P.turn && P.layout === 'array' && !M.div && M.G === M.S) W.push({ path: 'turn', reason: 'A square array looks the same turned round, so there is no turn step.' });
  const L = lay(P);
  if (L.d < 30 || L.dp < 24) R.push({ path: M.array ? 'size' : 'groups', reason: `${fmtNum(M.N)} objects are too many to draw clearly on one slide. Use fewer groups or smaller groups, or the grid method.` });
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
const TIMES = ['', 'once', 'twice', 'three times', 'four times', 'five times', 'six times', 'seven times', 'eight times'];
const addParts = M => [`${Array.from({ length: M.G }, () => fmtNum(M.S)).join(' + ')} = `, fmtNum(M.N)];
const steps = (S, n) => Array.from({ length: n }, (_, i) => fmtNum(S * (i + 1)));
const stepList = (S, n) => { const s = steps(S, n); return s.length <= 8 ? s.join(', ') : `${s.slice(0, 4).join(', ')} … ${s[s.length - 1]}`; };
function eqs(P) {
  // the sentences in the bottom row: [{s: [text, answer], key}]
  const M = nums(P); const f = fmtNum; const out = [];
  const mul = (a, b, k) => out.push({ k, parts: [`${f(a)} × ${f(b)} = `, f(a * b)], path: 'groups' });
  const dv = (a, b, k, r = 0) => out.push({ k, parts: [`${f(a)} ÷ ${f(b)} = `, f(Math.floor(a / b)) + (r ? ` r ${f(r)}` : '')], path: M.sharing ? 'groups' : 'size' });
  if (!M.div) {
    mul(M.G, M.S, 'sentence');
    if (M.turn && M.S !== M.G) mul(M.S, M.G, 'turn');
    if (M.facts) { if (!M.turn && M.S !== M.G) mul(M.S, M.G, 'facts'); dv(M.N, M.S, 'facts'); if (M.S !== M.G) dv(M.N, M.G, 'facts'); }
  } else {
    dv(M.N, M.divisor, 'sentence', M.R);
    if (M.facts) { if (M.G !== M.S) dv(M.N, M.quot, 'facts'); mul(M.G, M.S, 'facts'); if (M.G !== M.S) mul(M.S, M.G, 'facts'); }
    if (M.check) out.push({ k: 'facts', parts: [`${f(M.G)} × ${f(M.S)} + ${f(M.R)} = `, f(M.N)], path: 'remainder' });
  }
  return out;
}
function plan(P) {
  if (P.layout === 'grid') {
    const g = gridNums(P); const f = fmtNum; const it = [];
    const sp = (n, parts) => parts.length > 1 ? `${f(n)} = ${parts.map(v => f(v)).join(' + ')}` : null;
    const ss = [sp(g.a, g.A), sp(g.b, g.B)].filter(Boolean);
    it.push({ key: 'split', caption: ss.length ? `${ss.length > 1 ? 'Split both numbers' : 'Split by place value'}: ${ss.join(' and ')}.` : `${f(g.a)} and ${f(g.b)} each have one part, so there is one box.` });
    g.cells.forEach(c => it.push({ key: `cell:${c.i}-${c.j}`, caption: `${f(c.p)} × ${f(c.q)} = ${f(c.v)}.` }));
    const add = `Add the parts: ${g.cells.map(c => f(c.v)).join(' + ')} = ${f(g.prod)}.`;
    it.push({ key: 'sum', caption: add.length <= 110 ? add : `Add the ${g.cells.length} parts together to get ${f(g.prod)}.` });
    return { it, summary: `${f(g.a)} × ${f(g.b)} = ${f(g.prod)}.` };
  }
  const M = nums(P); const { G, S, R, N, noun } = M; const f = fmtNum; const it = [];
  const things = pl(N, ...noun), grp = M.array ? ['row', 'rows'] : ['group', 'groups'];
  if (!M.div) {
    it.push({ key: 'objects', caption: `Here are ${things}.` });
    it.push({ key: 'groups', caption: M.array ? `Put them in ${pl(G, 'row', 'rows')} of ${f(S)}.` : `There ${G === 1 ? 'is' : 'are'} ${pl(G, 'group', 'groups')} of ${f(S)}.` });
    if (P.countSteps) it.push({ key: 'count', caption: `Count in ${f(S)}s: ${stepList(S, G)}.` });
    if (M.add) it.push({ key: 'add', caption: `Add ${f(S)} ${TIMES[G]}.` });
    it.push({ key: 'sentence', caption: `${pl(G, ...grp)} of ${f(S)} is ${f(N)}. ${f(G)} × ${f(S)} = ${f(N)}.` });
    if (M.turn) it.push({ key: 'turn', caption: `Turn the array: ${pl(S, 'row', 'rows')} of ${f(G)} is still ${f(N)}, so ${f(S)} × ${f(G)} = ${f(N)}.` });
  } else if (M.sharing) {
    it.push({ key: 'objects', caption: `${things} to share equally between ${f(G)}.` });
    it.push({ key: 'rings', caption: `${pl(G, 'group', 'groups')} to share them into.` });
    it.push({ key: 'share', caption: R ? 'Give one to each group in turn, until there are not enough to go round.' : 'Give one to each group in turn, until none are left.' });
    it.push({ key: 'count', caption: `Each group gets ${f(S)}.` });
    if (R) it.push({ key: 'left', caption: `${f(R)} left over: not enough to give every group one more.` });
    it.push({ key: 'sentence', caption: `${f(N)} shared between ${f(G)} is ${f(S)} each${R ? `, ${f(R)} left over` : ''}: ${f(N)} ÷ ${f(G)} = ${f(S)}${R ? ` r ${f(R)}` : ''}.` });
  } else {
    it.push({ key: 'objects', caption: `${things}. How many groups of ${f(S)} can we make?` });
    it.push({ key: 'groups', caption: M.array ? `Make rows of ${f(S)}, one row at a time.` : `Make groups of ${f(S)}, one group at a time.` });
    if (P.countSteps) it.push({ key: 'count', caption: `Count in ${f(S)}s: ${stepList(S, G)}. That is ${pl(G, ...grp)}.` });
    if (R) it.push({ key: 'left', caption: `${f(R)} left over: not enough to make another ${grp[0]} of ${f(S)}.` });
    it.push({ key: 'sentence', caption: `${f(N)} ÷ ${f(S)} = ${f(G)}${R ? ` r ${f(R)}` : ''}: ${pl(G, ...grp)} of ${f(S)}${R ? `, ${f(R)} left over` : ''}.` });
  }
  if (M.facts) it.push({ key: 'facts', caption: G === S ? 'One picture, two facts: one multiplication and one division.' : 'One picture, four facts: two multiplications and two divisions.' });
  if (M.check) it.push({ key: 'facts', caption: `Check by multiplying back: ${f(G)} × ${f(S)} = ${f(G * S)}, and ${f(R)} more makes ${f(N)}.` });
  const E = eqs(P)[0];
  const summary = M.div ? (M.sharing ? `${things} shared between ${f(G)}: ${f(S)} each${R ? `, ${f(R)} left over` : ''}.` : `${things} make ${pl(G, ...grp)} of ${f(S)}${R ? `, ${f(R)} left over` : ''}.`)
    : M.turn ? `${pl(G, 'row', 'rows')} of ${f(S)}, turned, make ${pl(S, 'row', 'rows')} of ${f(G)}: ${f(G)} × ${f(S)} = ${f(S)} × ${f(G)} = ${f(N)}.`
    : `${pl(G, ...grp)} of ${f(S)}: ${E.parts.join('')}.`;
  return { it, summary };
}
export function builds(P) { const { it, summary } = plan(P); return { steps: it.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }

const sf1 = n => { const p = 10 ** Math.floor(Math.log10(n)); return Math.round(n / p) * p; }; // one significant figure, never 0
export function notes(P) {
  const { it } = plan(P);
  if (P.layout === 'grid') {
    const g = gridNums(P);
    const tens = n => { let e = 0; while (n % 10 === 0 && n > 0) { n /= 10; e++; } return [n, e]; };
    return {
      steps: it.map(x => {
        if (x.key === 'split') return 'Split each number by place value: tens and ones (and hundreds). The parts must add back to the number. The grid is not to scale; an area model would draw the parts to size.';
        if (x.key === 'sum') return 'Add the parts. Column addition is safest when there are several. Check with an estimate: round both numbers first.';
        const c = g.cells.find(q => x.key === `cell:${q.i}-${q.j}`); const [pa, ea] = tens(c.p), [qa, eb] = tens(c.q); const z = ea + eb;
        return z ? `${pa} × ${qa} = ${pa * qa}, and ${fmtNum(c.p)} × ${fmtNum(c.q)} is ${fmtNum(10 ** z)} times bigger: ${fmtNum(c.v)}. Ask: why does each part get multiplied by each part?` : `A known times-table fact: ${c.p} × ${c.q} = ${c.v}.`;
      }),
      summary: `Every part of ${fmtNum(g.a)} is multiplied by every part of ${fmtNum(g.b)}. Estimate first: about ${fmtNum(sf1(g.a))} × ${fmtNum(sf1(g.b))}.`,
    };
  }
  const M = nums(P);
  const N = {
    objects: M.div ? 'Count the whole amount first, so the class knows what is being divided.' : 'Ask: how could we count these quickly? Loose objects are hard to count.',
    rings: 'Sharing: we know how many groups there are. We are finding how many go in each.',
    share: 'Deal them out one at a time, round the groups, like dealing cards. Every group must end up the same.',
    add: `Repeated addition: ${M.S} added ${M.G} times. Point to each ${M.array ? 'row' : 'group'} as you say each ${M.S}. Then ask: is there a shorter way to write this?`,
    groups: M.div ? `Grouping: we know the size of each group (${M.S}). We are finding how many groups.` : `Every ${M.array ? 'row' : 'group'} has the same number in it. That is what makes them equal groups. Stem sentence: “There are ${M.G} ${M.array ? 'rows' : 'groups'} of ${M.S}.” Say both numbers: how many ${M.array ? 'rows' : 'groups'}, and how many in each.`,
    count: M.sharing ? 'Check each group has the same amount.' : `Count in ${M.S}s, one step per ${M.array ? 'row' : 'group'}, rather than in ones.`,
    left: `The amount left over is always less than ${M.divisor}; otherwise there would be enough for ${M.sharing ? 'another round' : 'another group'}.`,
    sentence: M.div ? `Read it as “${M.N} divided by ${M.divisor}”. Sharing and grouping both give ${M.N} ÷ ${M.divisor}, but the pictures answer different questions.` : `Read ${M.G} × ${M.S} as “${M.G} ${M.array ? 'rows' : 'groups'} of ${M.S}”. Some schemes read it the other way; both are true because multiplication can be done in any order.`,
    turn: 'Same counters, turned a quarter turn: the total does not change. Multiplication is commutative.',
    facts: M.check ? `Multiplying back and adding the ${M.R} left over gets back to ${M.N}, so the division is right. There is no fact family here, because ${M.N} does not divide exactly.` : M.G === M.S ? 'A square has equal sides, so the picture gives one multiplication and one division.' : 'The same picture gives both divisions: the total divided by one side gives the other side.',
  };
  return { steps: it.map(x => N[x.key] || ''), summary: M.div ? 'Ask: would sharing or grouping be quicker to act out here? Both give the same division.' : 'Ask: what other multiplication can you see in this picture?' };
}

/* ------------------------------------------------------------------ render */
const EQ_Y = 616, EQ_CLS = ['ts-big', 'ts-num', 'ts-label', 'ts-small'];
function eqRow(root, list, b, focusFirst, cOf = () => null, start = 0) {
  // the sentences sit in one row, centred on the final width; each appears with its own build
  // (start: never larger than a line already shown in the same place, so the row keeps one size)
  const gap = 64; let cls = EQ_CLS[start], ws;
  for (const c of EQ_CLS.slice(start)) { cls = c; ws = list.map(e => measure(root, e.parts.join(''), c)); if (ws.reduce((a, z) => a + z, 0) + gap * (list.length - 1) <= ZONE.w) break; }
  let x = 640 - (ws.reduce((a, z) => a + z, 0) + gap * (list.length - 1)) / 2;
  return list.map((e, i) => {
    const t = computed(T(root, x, EQ_Y, '', cls, { fill: 'var(--ink)', s: b[e.k], cls: 'rise', delay: e.k === 'facts' ? 250 * i : 0, c: cOf(e, i) }), e.path);
    h('tspan', { text: e.parts[0] }, t); h('tspan', { text: e.parts[1], fill: i === 0 && focusFirst ? 'var(--focus-text)' : 'var(--ink)' }, t);
    x += ws[i] + gap; return t;
  });
}

// a flat apple: one fill, a stem and a small leaf (the kit's apple has a shaded half)
function obj(p, kind, x, y, size, a = {}) {
  if (kind !== 'apple') return countable(p, kind, x, y, size, a);
  const outer = h('g', a, p), g = h('g', { transform: `translate(${x} ${y}) scale(${size / 60})` }, outer);
  h('path', { d: 'M0 -16 C -10 -24 -28 -20 -28 0 C -28 18 -14 28 0 24 C 14 28 28 18 28 0 C 28 -20 10 -24 0 -16 Z', fill: 'var(--hue-red)', cls: 'body' }, g);
  h('rect', { x: -2, y: -27, width: 4, height: 12, rx: 2, fill: 'var(--trunk)' }, g);
  h('path', { d: 'M2 -21 Q 9 -28 15 -23 Q 9 -18 2 -21 Z', fill: 'var(--leaf)' }, g);
  return outer;
}

export function render(root, P, ctx) {
  return P.layout === 'grid' ? renderGrid(root, P, ctx) : renderGroups(root, P, ctx);
}

function renderGroups(root, P, ctx) {
  const M = nums(P), L = lay(P), b = ctx.b, NB = ctx.N; const { G, S, R, N } = M;
  // objects stand on the slide itself: no band, no tray. A counter fills most of its cell, a picture a little less
  const size = L.d * (M.array ? .8 : P.object === 'counter' ? .9 : .84), psize = Math.min(size, L.dp * .82);
  // one picture throughout: nothing is faded at the end, the summary is the finished picture
  const mainG = h('g', {}, root);
  const ringsG = h('g', {}, mainG), itemsG = h('g', {}, mainG), labG = h('g', {}, root); // labels never turn with the array
  const spinners = []; // with a turn, each placed object turns back about its own centre so pictures stay upright
  // which pile object goes to which place: sharing deals round the groups; grouping fills one group at a time
  const dest = []; // dest[pileIndex] = {g, j}
  if (M.sharing) { for (let i = 0; i < G * S; i++) dest.push({ g: i % G, j: Math.floor(i / G) }); }
  else for (let g = 0; g < G; g++) for (let j = 0; j < S; j++) dest.push({ g, j });
  const kObj = b.objects, kMove = M.sharing ? b.share : b.groups;
  const stag = Math.min(40, 1200 / N);
  const moveDelay = i => M.sharing ? i * Math.min(160, 3600 / (G * S)) : M.grouping ? dest[i].g * Math.min(500, 2400 / G) + dest[i].j * 40 : dest[i].g * Math.min(220, 1200 / G);
  // groups layout: one light ring round each group. Sharing draws them first and empty; otherwise they close round the objects
  if (!M.array) L.groups.forEach((g, gi) => {
    const kR = M.sharing ? b.rings : b.groups; const del = M.sharing ? gi * 120 : M.grouping ? moveDelay(gi * S) + 500 : 700;
    groupRing(ringsG, g.box, { pad: 0, col: 'var(--ink-3)', s: kR, a: { delay: del, rx: Math.min(g.box.h / 2, L.d * .9), 'stroke-width': 'var(--sw-rule)' } });
  });
  // every object: a pile copy (shown from the first build, leaves when it moves) and a placed copy that flies in
  const kLeft = b.left;
  for (let i = 0; i < N; i++) {
    const [sx, sy] = L.pile[i];
    const outer = h('g', { s: kObj, cls: 'pop', delay: i * stag }, itemsG);
    const to = i < G * S ? (() => { const { g, j } = dest[i]; return { at: L.groups[g].items[j], k: kMove, del: moveDelay(i) }; })()
      // the left over moves with the groups, into its own place next to them, and is ringed when it is talked about
      : L.left ? { at: L.left.items[i - G * S], k: kMove, del: M.grouping && !M.array ? G * Math.min(500, 2400 / G) : 400 } : null;
    if (to) {
      const [fx, fy] = to.at;
      obj(h('g', { hide: to.k, cls: 'snap', delay: to.del }, outer), P.object, sx, sy, psize);
      const fly = h('g', { s: to.k, cls: 'fly', delay: to.del, vars: { '--fx': `${sx - fx}px`, '--fy': `${sy - fy}px` } }, itemsG);
      const inner = h('g', {}, fly); obj(inner, P.object, fx, fy, size); if (M.turn) spinners.push([inner, fx, fy]);
    } else obj(outer, P.object, sx, sy, psize); // sharing: the left over stays in the pile
  }
  // count in steps (running totals), or for sharing the amount each group got. In multiplication only the last total,
  // the product, is the focus colour; the totals stay through the summary because the count is how the product is found
  const cntCls = L.d >= 56 ? 'ts-num' : L.d >= 40 ? 'ts-label' : 'ts-tiny';
  if (b.count != null) L.groups.forEach((g, gi) => {
    const v = M.sharing ? S : S * (gi + 1), last = !M.div && gi === G - 1;
    computed(T(labG, g.countAt[0], g.countAt[1] + 10, fmtNum(v), cntCls, { 'text-anchor': g.anchor, fill: last ? 'var(--focus-text)' : 'var(--ink-2)', cls: 'strong', s: b.count, hide: M.turn ? b.turn : null, delay: M.sharing ? 0 : gi * 380 }), 'size');
  });
  // the remainder: ringed where it ends up, with its words beside or under it
  if (kLeft != null) {
    const pts = L.left ? L.left.items : L.pile.slice(G * S), sz = L.left ? size : psize, r = sz * .62;
    const box = { x: Math.min(...pts.map(p => p[0])) - r, y: Math.min(...pts.map(p => p[1])) - r, w: 0, h: 0 };
    box.w = Math.max(...pts.map(p => p[0])) + r - box.x; box.h = Math.max(...pts.map(p => p[1])) + r - box.y;
    const g = h('g', { s: kLeft }, labG);
    groupRing(g, box, { pad: 0, col: 'var(--compare)', s: kLeft, a: { 'stroke-width': 'var(--sw-struct)' } });
    const words = txt(P, 'label:left', 'left over');
    // the words fit the room they have: more lines first, then one size smaller, never cut
    const under = L.left && !L.left.side, ax = L.left ? L.left.labAt[0] : null;
    const room = L.left ? ZONE.x + ZONE.w - ax : ZONE.x + ZONE.w - (box.x + box.w + 20), right = L.left || room >= 220;
    // where the lines may run: under the slot, down to the sentence row; beside an array's short row, from that row down
    // (the rows above are full); beside the sharing pile, within the strip between the title and the rings
    const lastMax = under || L.left ? EQ_Y - 56 : L.top - 26;
    // under the slot: never above the running totals' line, so the words cannot reach up beside the last group's ring
    const firstMin = under ? Math.max(box.y + box.h + 34, L.left.labAt[1] + 10) : L.left ? L.left.labAt[1] + 14 : PILE.y + 30;
    let LC, lh, nw, maxW, tb, fMin = firstMin;
    // a long edit under the slot may use the full width below the totals (nothing else is on that band)
    for (const [c, l, wide] of [['ts-num', 44, 0], ['ts-label', 38, 0], ['ts-label', 38, 1], ['ts-small', 30, 1]]) {
      if (wide && !under && c !== 'ts-small') continue;
      LC = c; lh = l; nw = measure(g, fmtNum(R), c) + 12;
      maxW = Math.max(120, under ? (wide ? ZONE.w : 2 * L.left.half) - nw : right ? room - nw : box.x - 20 - ZONE.x - nw);
      fMin = wide && under ? firstMin + 48 : firstMin; // full width: start under the line of totals, never on it
      const maxLines = Math.max(1, Math.floor((lastMax - fMin) / lh) + 1);
      tb = textBlock(h('g', {}, g), 0, 0, words, { cls: c, maxW, maxLines, lh }); tb.el.parentNode.remove(); tb.maxLines = maxLines;
      if (!tb.lines[tb.lines.length - 1].endsWith('…') || words.trim().endsWith('…')) break;
    }
    let x0, ty;
    if (under) { x0 = clamp(L.left.labAt[0] - (nw + tb.w) / 2, ZONE.x, ZONE.x + ZONE.w - nw - tb.w); ty = Math.max(fMin, Math.min(L.left.labAt[1] + 14, lastMax) - (tb.lines.length - 1) * tb.lh); }
    else {
      ty = L.left ? firstMin : clamp(box.y + box.h / 2 + 14 - (tb.lines.length - 1) * tb.lh / 2, firstMin, lastMax - (tb.lines.length - 1) * tb.lh);
      x0 = L.left ? ax : right ? box.x + box.w + 20 : box.x - 20 - nw - tb.w;
    }
    computed(T(g, x0, ty, fmtNum(R), tb.cls === 'ts-tiny' ? 'ts-label' : LC, { fill: 'var(--compare-text)', cls: 'rise' }), 'remainder');
    textBlock(g, x0 + nw, ty, words, { cls: LC, maxW, maxLines: tb.maxLines, lh, a: { fill: 'var(--compare-text)', cls: 'rise' }, edit: 'text.label:left' });
  }
  const EQ = eqs(P);
  let eqCls = null;
  if (M.add) {
    // repeated addition first, on its own centred line; it leaves when the multiplication takes its place
    const ap = addParts(M); eqCls = EQ_CLS.find(c => measure(root, ap.join(''), c) <= ZONE.w) || EQ_CLS[EQ_CLS.length - 1];
    const t = computed(T(root, 640 - measure(root, ap.join(''), eqCls) / 2, EQ_Y, '', eqCls, { fill: 'var(--ink)', s: b.add, hide: b.sentence, cls: 'rise' }), 'groups');
    h('tspan', { text: ap[0] }, t); h('tspan', { text: ap[1], fill: 'var(--focus-text)' }, t);
  }
  const row = eqRow(root, EQ, b, true, e => M.turn && e.k === 'sentence' ? `${b.turn}-${b.turn + 1}:soft` : null, eqCls ? EQ_CLS.indexOf(eqCls) : 0);
  // the first sentence sits centred until the next sentence arrives, then slides into its place in the row
  const kNext = EQ.length > 1 ? b[EQ[1].k] : null, eqG = kNext != null ? h('g', {}, root) : null, eqDx = eqG ? 640 - (+row[0].getAttribute('x') + measure(root, EQ[0].parts.join(''), row[0].getAttribute('class').split(' ').find(c => c.startsWith('ts-'))) / 2) : 0;
  if (eqG) eqG.appendChild(row[0]);
  // the turn (commutativity): the same array spins a quarter turn about its centre and settles in the middle;
  // 3 rows of 6 become 6 rows of 3
  const spin = f => {
    if (!L.turn) return; const { cx, cy, s } = L.turn, k = 1 + (s - 1) * f;
    mainG.setAttribute('transform', `translate(${(cx + (640 - cx) * f).toFixed(1)} ${cy}) rotate(${(90 * f).toFixed(2)}) scale(${k.toFixed(4)}) translate(${-cx} ${-cy})`);
    spinners.forEach(([el, x, y]) => el.setAttribute('transform', `rotate(${(-90 * f).toFixed(2)} ${x} ${y})`));
  };
  const eqAt = f => eqG && eqG.setAttribute('transform', `translate(${(eqDx * f).toFixed(1)} 0)`);
  const at = e => { spin(e); eqAt(1 - e); };
  at(0);
  return {
    dur: { turn: 1400 },
    reset() { at(0); }, still() { at(1); },
    tick(k, u) { const kt = M.turn ? b.turn : kNext; if (kt == null) return; at(k < kt ? 0 : k > kt ? 1 : eIO(clamp(u * 1.25))); },
  };
}

function renderGrid(root, P, ctx) {
  const g = gridNums(P), b = ctx.b, NB = ctx.N; const f = fmtNum;
  const na = g.A.length, nb = g.B.length;
  const hw = 150, hh = 92; // header column, header row; the grid itself takes about 80% of the stage width
  const cw = Math.min(380, (ZONE.w * .8 - hw) / na), gw = hw + na * cw, gx = 640 - gw / 2;
  // the "not to scale" note sits under the grid: a long one wraps (then shrinks), and the grid gives up the height it needs
  const nW = Math.max(gw, 640), nLH = 30, note = txt(P, 'label:notScale', 'Not to scale');
  const nProbe = textBlock(h('g', {}, root), 0, 0, note, { cls: 'ts-small', maxW: nW, maxLines: 2, lh: nLH }); nProbe.el.parentNode.remove();
  const nMore = nProbe.lines.length - 1, room = 362 - nMore * (nProbe.lh + 8), nY = 36 - 6 * nMore;
  const ch = Math.min(130, (room - hh) / nb), gy = 168 + (room - hh - nb * ch) / 2;
  const kS = b.split;
  const grid = h('g', { s: kS, cls: 'rise' }, root);
  const cellX = i => gx + hw + i * cw, cellY = j => gy + hh + j * ch;
  // header cells: each part as plain text in its place-value colour (no tinted panels)
  const head = (x, y, w, hgt, v, path) => {
    const c = pvColour(Math.min(3, Math.floor(Math.log10(v))));
    computed(T(grid, x + w / 2, y + hgt / 2 + 14, f(v), 'ts-num', { 'text-anchor': 'middle', fill: c.text }), path);
  };
  computed(T(grid, gx + hw / 2, gy + hh / 2 + 14, '×', 'ts-num', { 'text-anchor': 'middle', fill: 'var(--ink-2)' }), 'layout');
  g.A.forEach((v, i) => head(cellX(i), gy, cw, hh, v, 'grid.a'));
  g.B.forEach((v, j) => head(gx, cellY(j), hw, ch, v, 'grid.b'));
  // the grid lines
  const x1 = cellX(na), y1 = cellY(nb);
  h('rect', { x: gx + hw, y: gy + hh, width: x1 - gx - hw, height: y1 - gy - hh, fill: 'var(--paper)', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)' }, grid);
  for (let i = 1; i < na; i++) h('line', { x1: cellX(i), x2: cellX(i), y1: gy + hh, y2: y1, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)' }, grid);
  for (let j = 1; j < nb; j++) h('line', { x1: gx + hw, x2: x1, y1: cellY(j), y2: cellY(j), stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)' }, grid);
  // the two whole numbers, bracketed over their parts
  const tq = 10, by = gy - 6;
  h('path', { d: `M${cellX(0) + 6} ${by} H ${x1 - 6} M${cellX(0) + 6} ${by - tq} V ${by + tq * .2} M${x1 - 6} ${by - tq} V ${by + tq * .2}`, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)', fill: 'none', 'stroke-linecap': 'round' }, grid);
  computed(T(grid, (cellX(0) + x1) / 2, by - 18, f(g.a), 'ts-num', { 'text-anchor': 'middle', fill: 'var(--ink)', cls: 'halo' }), 'grid.a');
  const bx = gx - 6;
  h('path', { d: `M${bx} ${cellY(0) + 6} V ${y1 - 6} M${bx + tq} ${cellY(0) + 6} H ${bx - tq * .2} M${bx + tq} ${y1 - 6} H ${bx - tq * .2}`, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)', fill: 'none', 'stroke-linecap': 'round' }, grid);
  computed(T(grid, bx - 18, (cellY(0) + y1) / 2 + 14, f(g.b), 'ts-num', { 'text-anchor': 'end', fill: 'var(--ink)' }), 'grid.b');
  textBlock(grid, x1, y1 + nY, note, { cls: 'ts-small', maxW: nW, maxLines: 2, lh: nLH, anchor: 'end', a: { fill: 'var(--ink-2)' }, edit: 'text.label:notScale' });
  // each part's product, one per build; the cell being worked is lit while it is the focus
  g.cells.forEach(c => {
    const k = b[`cell:${c.i}-${c.j}`], x = cellX(c.i), y = cellY(c.j);
    h('rect', { x: x + 3, y: y + 3, width: cw - 6, height: ch - 6, fill: 'var(--focus-pale)', s: k, hide: k + 1 }, root);
    const cls = measure(root, f(c.v), 'ts-num') <= cw - 20 ? 'ts-num' : 'ts-label';
    computed(T(root, x + cw / 2, y + ch / 2 + 14, f(c.v), cls, { 'text-anchor': 'middle', fill: 'var(--ink)', s: k, cls: 'pop', c: `${b.sum}-${b.sum + 1}:soft` }), 'grid.a');
  });
  // the sentence row: the question first; the sum and the answer replace the question mark
  // many parts: the sum shrinks to fit the row; if it still cannot fit, the row keeps the answer (the sum is in the caption)
  let full = [`${f(g.a)} × ${f(g.b)} = `, `${g.cells.map(c => f(c.v)).join(' + ')} = `, f(g.prod)];
  const fit = () => EQ_CLS.find(c => measure(root, full.join(''), c) <= ZONE.w);
  let cls = fit(); if (!cls) { full = [full[0], '', full[2]]; cls = fit() || EQ_CLS[EQ_CLS.length - 1]; }
  const x0 = 640 - measure(root, full.join(''), cls) / 2;
  const q = computed(T(root, x0, EQ_Y, '', cls, { fill: 'var(--ink)', s: kS, hide: b.sum }), 'grid.a');
  h('tspan', { text: full[0] }, q); h('tspan', { text: '?', fill: 'var(--focus-text)' }, q);
  const a = computed(T(root, x0, EQ_Y, '', cls, { fill: 'var(--ink)', s: b.sum, cls: 'rise' }), 'grid.a');
  h('tspan', { text: full[0] }, a); h('tspan', { text: full[1] }, a); h('tspan', { text: full[2], fill: 'var(--focus-text)' }, a);
  return {};
}
