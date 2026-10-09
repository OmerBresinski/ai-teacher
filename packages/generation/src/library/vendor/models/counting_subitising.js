// Counting and subitising: one structured set, centre stage. Ten frames by default (a full row is
// five), or dice patterns, fingers, a line or a scatter. Count one at a time with small running
// numerals, five at a time, or flash the set to subitise; the total numeral rises under the set;
// optionally one more (a --focus counter) and one less. Every number on the slide is computed.
import {
  h, T, GRID, textBlock, rng,
  computed, txt, TEXT_PARAM_FOR, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { countable, groupRing, isWholeNumber } from '../kit/batch-A.js';

export const meta = {
  id: 'counting_subitising', name: 'Counting and subitising', kind: 'info', version: 2,
  subjects: ['Maths'],
  years: ['Reception', 'Y1'],
  teaches: 'Counting a set one by one, knowing the last number said is how many, seeing small amounts at a glance in a ten frame, and one more and one less.',
};

const REPS = ['tenframe', 'dice', 'fingers', 'line', 'scatter'];
const OBJECTS = ['counter', 'apple', 'star', 'car'];
const PLURAL = { counter: 'counters', apple: 'apples', star: 'stars', car: 'cars', dice: 'dots', fingers: 'fingers' };
const SINGULAR = { counter: 'counter', apple: 'apple', star: 'star', car: 'car', dice: 'dot', fingers: 'finger' };
const CAP = { tenframe: 20, dice: 12, fingers: 10, line: 20, scatter: 20 };
const CAP_WHY = {
  tenframe: 'Two ten frames hold 20',
  dice: 'Two dice show up to 12 dots',
  fingers: 'Two hands show up to 10 fingers',
  line: 'One slide shows a line of up to 20 so each one is big enough to count',
  scatter: 'One slide shows up to 20 scattered so each one is big enough to count',
};
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'twenty-one'];
const word = n => WORDS[n] ?? String(n);
const up1 = s => s.charAt(0).toUpperCase() + s.slice(1);

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Counting and subitising',
  properties: {
    title: TITLE_PARAM('How many?'),
    n: { type: 'integer', title: 'How many', description: 'The number of things shown, 0 to 20.', minimum: 0, maximum: 20, default: 5 },
    representation: {
      type: 'string', title: 'Show them as', enum: REPS,
      'x-labels': ['Ten frames', 'Dice patterns', 'Fingers', 'A line of objects', 'A scatter'], default: 'tenframe',
    },
    object: {
      type: 'string', title: 'Things to count', description: 'Counters suit ten frames. Not used for dice or fingers.', enum: OBJECTS,
      'x-labels': ['Counters', 'Apples', 'Stars', 'Cars'], default: 'counter', 'x-panel': 'advanced',
    },
    reveal: {
      type: 'string', title: 'How they appear', enum: ['one', 'five', 'all'],
      'x-labels': ['One at a time, counting', 'Five at a time (a row, a hand or a dice)', 'All at once, to see without counting'], default: 'one',
    },
    oneMoreOneLess: {
      type: 'string', title: 'One more and one less', enum: ['off', 'more', 'less', 'both'],
      'x-labels': ['Not shown', 'One more', 'One less', 'One more, then one less'], default: 'off',
    },
    countAloud: { type: 'boolean', title: 'Show the number word', description: 'Writes the word (“five”) under the number.', default: true },
    // the noun sits inside the captions; "one more" / "one less" label the neighbours in the summary
    text: TEXT_PARAM_FOR({ thing: 'label', things: 'label', more: 'label', less: 'label' }),
  },
};

export const presets = [
  { id: 'rec-five', name: 'Reception: how many? (5 in a ten frame)', params: {
    title: 'How many?', n: 5, representation: 'tenframe', object: 'counter', reveal: 'one', oneMoreOneLess: 'off', countAloud: true,
  } },
  { id: 'rec-dice', name: 'Reception: subitising with dice', params: {
    title: 'Spot it on the dice', n: 5, representation: 'dice', reveal: 'all', oneMoreOneLess: 'more', countAloud: true,
  } },
  { id: 'rec-fingers', name: 'Reception: seven on our fingers', params: {
    title: 'Show seven', n: 7, representation: 'fingers', reveal: 'one', oneMoreOneLess: 'less', countAloud: true,
  } },
  { id: 'y1-14', name: 'Year 1: one more than 14', params: {
    title: 'One more than 14', n: 14, representation: 'tenframe', object: 'counter', reveal: 'five', oneMoreOneLess: 'both', countAloud: false,
  } },
];

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P), W = [];
  if (R.length) return result(R);
  const n = P.n, rep = P.representation, more = P.oneMoreOneLess === 'more' || P.oneMoreOneLess === 'both', less = P.oneMoreOneLess === 'less' || P.oneMoreOneLess === 'both';
  if (!isWholeNumber(n)) R.push({ path: 'n', reason: 'Counting uses whole numbers. Choose a whole number from 0 to 20.' });
  else {
    if (n > CAP[rep]) R.push({ path: 'n', reason: `${CAP_WHY[rep]}, so ${n} will not fit. Use ${CAP[rep]} or fewer, or show them another way.` });
    else if (more && n + 1 > CAP[rep]) R.push({ path: 'oneMoreOneLess', reason: `${CAP_WHY[rep]}, so there is no room to show one more than ${n}. Use ${CAP[rep] - 1} or fewer, or show only one less.` });
    if (rep === 'dice' && n === 0) R.push({ path: 'n', reason: 'A dice has no face for zero. Choose 1 to 12, or show zero in a ten frame.' });
    if (less && n === 0) R.push({ path: 'oneMoreOneLess', reason: 'There is nothing to take away from zero, so one less than 0 cannot be shown here. Choose a bigger number, or show only one more.' });
    if (P.reveal === 'one' && n > 12) W.push(`Counting ${n} one at a time takes ${n} steps. “Five at a time” is quicker.`);
  }
  return result(R, W);
}

/* ------------------------------------------------------------------ where things go */
// The set and its numeral (with the word) form one centred block on the stage. The set is sized to
// fill the stage: a single ten frame is about three quarters of the live width, two dice or two hands
// fill the height left above the numeral. Everything is laid out for the final build from build 1,
// so nothing moves while the builds play.
const STAGE = { y0: 124, y1: 640 };
const CX = 640;
const NUM_SC = 2.6;           // the numeral: ts-num (40) scaled so it reads from the back of the room
const NUM_GAP = 104;          // set bottom to numeral baseline (gap plus cap height)
const WORD_GAP = 50;          // numeral baseline to word baseline
// the summary labels ("One less", "One more") sit on the word line; a teacher's longer label may take a second line
const longLabels = P => ['less', 'more'].some(k => { const d = k === 'less' ? 'One less' : 'One more'; return txt(P, `label:${k}`, d) !== d; });
const numBlock = P => P.oneMoreOneLess === 'both' ? NUM_GAP + WORD_GAP + 8 + (longLabels(P) ? 34 : 0)
  : P.countAloud ? NUM_GAP + WORD_GAP + 8 : NUM_GAP + 6;
const PIPS = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
/** Two dice share a number as evenly as they can (7 = 4 + 3); one dice up to 6. */
const diceSplit = n => n <= 6 ? [n] : [Math.ceil(n / 2), Math.floor(n / 2)];
/** One more on dice changes one face and leaves the other alone: 5 -> 6, 6 -> 6 and 1, 7 = 4 + 3 -> 4 + 4. */
function diceMore(n) {
  const s = diceSplit(n);
  if (s.length === 1) return n < 6 ? { split: [n + 1], c: 0 } : { split: [6, 1], c: 1 };
  const c = s[1] < s[0] ? 1 : 0, out = s.slice(); out[c]++;
  return { split: out, c };
}

/** Slots: centres for every object the slide can show (n, plus one more), in counting order, inside area A.
 *  `small(i)` gives where object i's small running numeral goes, or null when the layout has no room for one.
 *  `bb` is the set's vertical extent (rings and numerals included). */
function layoutIn(P, slots, A) {
  const rep = P.representation, AH = A.y1 - A.y0, CY = (A.y0 + A.y1) / 2, CX = A.cx ?? 640;
  if (rep === 'tenframe') {
    // one frame: as big as the height allows (up to 3/4 of the width); two frames side by side across the live area
    const frames = slots > 10 ? 2 : 1, pad = 12, gap = 60;
    const cell = frames === 1 ? Math.min(184, (AH - 2 * pad) / 2) : Math.min(94, (1000 - gap) / 10, (AH - 2 * pad) / 2);
    const fw = cell * 5, fh = cell * 2;
    const tw = frames * fw + (frames - 1) * gap, x0 = CX - tw / 2, y = CY - fh / 2;
    const fx = f => x0 + f * (fw + gap);
    const pts = Array.from({ length: frames * 10 }, (_, i) => { const f = Math.floor(i / 10), j = i % 10; return [fx(f) + cell * (j % 5 + .5), y + cell * (Math.floor(j / 5) + .5)]; });
    // running numerals sit on the counters themselves, so none sits in an empty cell
    const small = i => pts[i];
    return { pts, size: cell * .74, ring: cell * .44, cell, frames: Array.from({ length: frames }, (_, f) => ({ x: fx(f), y, cell })),
      group: i => Math.floor(i / 5), small, onObj: true, bb: { top: y - pad, bottom: y + fh + pad } };
  }
  if (rep === 'dice') {
    const more = slots > P.n, M2 = more ? diceMore(P.n) : null, orig = diceSplit(P.n);
    const split = more ? M2.split : orig, pad = 16, gap = 80;
    const die = Math.min(440, AH - 2 * pad, ((A.w ?? 1000) - (split.length - 1) * gap) / split.length), u = die / 196, pip = 18 * u;
    const w = split.length * die + (split.length - 1) * gap, x0 = CX - w / 2;
    const dice = split.map((k, d) => ({ x: x0 + d * (die + gap), y: CY - die / 2, k, k0: orig[d] || 0 }));
    const pipAt = (D, [a, b]) => [D.x + die / 2 + a * 56 * u, D.y + die / 2 + b * 56 * u];
    const pts = [], grp = [];
    dice.forEach((D, d) => { if (D.k0) PIPS[D.k0].forEach(ab => { pts.push(pipAt(D, ab)); grp.push(d); }); });
    // one more: the changed face, drawn whole in place of the old one
    const newFace = more ? PIPS[split[M2.c]].map(ab => pipAt(dice[M2.c], ab)) : null;
    return { pts, size: pip * 2, pip, die, ring: pip + 14, dice, changed: more ? M2.c : null, newFace,
      group: i => grp[i], small: () => null, bb: { top: CY - die / 2 - pad, bottom: CY + die / 2 + pad, left: x0 - pad, right: x0 + w + pad } };
  }
  if (rep === 'fingers') {
    // two flat hands, palms to the class, in hand units scaled by s to fill the area's height.
    // Units: fingertips up to 230 above the palm top, palm 170 below it, wrist 40 more.
    const s = Math.min(1.25, AH / 470), u = v => v * s;
    const sp = u(62), fw = u(52), pw = sp * 4 + u(14), gap = u(190), pt = A.y0 + u(12 + 230);
    const hands = [CX - gap / 2 - pw / 2, CX + gap / 2 + pw / 2];
    const pts = [], fing = [], TH = u(140);
    hands.forEach((hx, side) => {
      // screen-left hand: thumb on its right; screen-right hand: thumb on its left. Count left to right.
      const xs = [-1.5, -.5, .5, 1.5].map(d => hx + d * sp), fl = (side === 0 ? [160, 212, 230, 205] : [205, 230, 212, 160]).map(u);
      const order = side === 0 ? [0, 1, 2, 3, 'thumb'] : ['thumb', 0, 1, 2, 3], dir = side === 0 ? 1 : -1;
      order.forEach(o => {
        if (o === 'thumb') { const bx = hx + dir * (pw / 2 - fw / 2), by = pt + u(112), ang = 38 * Math.PI / 180;
          fing.push({ thumb: true, side, dir, hx, bx, by, len: TH, deg: dir * 38, tip: [bx + dir * Math.sin(ang) * (TH - fw / 2), by - Math.cos(ang) * (TH - fw / 2)] }); }
        else fing.push({ x: xs[o], len: fl[o], side, hx, tip: [xs[o], pt - fl[o] + fw / 2] });
      });
    });
    fing.forEach(f => pts.push(f.tip));
    return { pts, size: fw, fw, s, ring: u(30), hands: hands.map(hx => ({ hx, top: pt, pw })), fing, tipTop: A.y0 + u(12),
      group: i => Math.floor(i / 5), small: () => null, bb: { top: A.y0, bottom: pt + u(226), left: hands[0] - pw / 2 - u(10), right: hands[1] + pw / 2 + u(10) } };
  }
  if (rep === 'line') {
    const per = 10, rows = Math.max(1, Math.ceil(slots / per)), used = Math.min(per, Math.max(1, slots));
    const step = Math.min(150, 1000 / used), size = Math.min(120, step * .8), rowH = size + 72;
    const w = (used - 1) * step + (used > 5 ? 28 : 0);
    const numH = P.reveal === 'one' ? 46 : 0;
    const y0 = CY - numH / 2 - (rows - 1) * rowH / 2;
    const pts = Array.from({ length: rows * per }, (_, i) => { const r = Math.floor(i / per), j = i % per; return [CX - w / 2 + j * step + (j >= 5 ? 28 : 0), y0 + r * rowH]; });
    const ringR = size / 2 + 14;
    return { pts, size, ring: ringR, group: i => Math.floor(i / 5), small: i => [pts[i][0], pts[i][1] + size / 2 + 40],
      bb: { top: y0 - ringR - 8, bottom: y0 + (rows - 1) * rowH + Math.max(ringR + 8, size / 2 + numH) } };
  }
  // scatter: a jittered grid in a calm central block, counted in reading order; seeded so the same params
  // draw the same slide. Five at a time uses rows of five, so each group of five is one row.
  const x0 = 172, W = 936;
  const k = Math.max(1, slots), cols = P.reveal === 'five' && k > 5 ? 5 : Math.min(6, Math.max(2, Math.ceil(Math.sqrt(k * 1.5)))), rows = Math.ceil(k / cols);
  const roomy = rows <= 2;   // with two rows or fewer each object has room for its running numeral
  const cw = W / cols, ch = Math.min(240, AH / rows), size = Math.min(150, .76 * Math.min(cw, roomy ? ch - 44 : ch));
  const y0 = CY - rows * ch / 2, R = rng(1000 + P.n * 7 + slots);
  const pts = Array.from({ length: k }, (_, i) => { const r = Math.floor(i / cols), c = i % cols, jx = (cw - size) * .3, jy = Math.max(0, ch - size - (roomy ? 48 : 0)) * .3;
    return [x0 + cw * (c + .5) + (R() * 2 - 1) * jx, y0 + ch * (r + .5) - (roomy ? 18 : 0) + (R() * 2 - 1) * jy]; });
  const ys = pts.map(p => p[1]), ringR = size / 2 + 10;
  return { pts, size, ring: ringR, group: i => Math.floor(i / 5), small: roomy ? i => [pts[i][0], pts[i][1] + size / 2 + 36] : () => null,
    bb: { top: Math.min(...ys) - ringR - 8, bottom: Math.max(...ys) + (roomy ? size / 2 + 46 : ringR + 8) } };
}

/** Lay the set out, then shift it so set plus numeral sit as one block centred on the stage.
 *  Dice and hands are about as tall as they are wide, so their numeral sits beside them (except for the
 *  one-less / one-more summary row), which lets them use the stage's full height. Ten frames, lines and
 *  scatters are wide, so their numeral sits underneath. */
const NUM_COL = 230, NUM_COL_GAP = 40;
function layout(P, slots) {
  const side = (P.representation === 'dice' || P.representation === 'fingers') && P.oneMoreOneLess !== 'both';
  if (side) {
    const A = { y0: STAGE.y0, y1: STAGE.y1, w: 1100 - NUM_COL - NUM_COL_GAP };
    const L0 = layoutIn(P, slots, A), w0 = L0.bb.right - L0.bb.left, tot = w0 + NUM_COL_GAP + NUM_COL;
    const left = 640 - tot / 2, dx = left - L0.bb.left;
    const L = layoutIn(P, slots, Object.assign({}, A, { cx: 640 + dx }));
    const mid = (L.bb.top + L.bb.bottom) / 2;
    L.numX = L.bb.right + NUM_COL_GAP + NUM_COL / 2;
    L.numSc = 3.4; L.numY = mid + (P.countAloud ? 22 : 48); L.wordY = L.numY + WORD_GAP + 6;
    return L;
  }
  const nb = numBlock(P), avail = { y0: STAGE.y0, y1: STAGE.y1 - nb };
  const L0 = layoutIn(P, slots, avail), h0 = L0.bb.bottom - L0.bb.top;
  // a wide, short set (two ten frames) leaves height spare: half of it goes to a bigger numeral
  const CAP_H = 40 * .72, ext = Math.min(.8, Math.max(0, (STAGE.y1 - STAGE.y0 - h0 - nb) * .5 / CAP_H)), grow = ext * CAP_H;
  const top = STAGE.y0 + (STAGE.y1 - STAGE.y0 - h0 - nb - grow) / 2, dy = top - L0.bb.top;
  const L = layoutIn(P, slots, { y0: avail.y0 + dy, y1: avail.y1 + dy });
  L.numX = 640; L.numSc = NUM_SC + ext; L.numY = L.bb.bottom + NUM_GAP + grow; L.wordY = L.numY + WORD_GAP;
  return L;
}

/* ------------------------------------------------------------------ plan: builds, captions, numbers */
function totalCaption(M) {
  const { n, thing, things } = M;
  if (n === 0) return `There are no ${things}. That is zero.`;
  if (M.rep === 'tenframe') {
    if (n === 5) return 'A full row is 5.';
    if (n === 10) return 'Two full rows make 10.';
    if (n === 20) return 'Two full ten frames make 20.';
    if (n > 5 && n < 10) return `A full row is 5, and ${n - 5} more make ${n}.`;
    if (n > 10) return `A full ten frame is 10, and ${n - 10} more make ${n}.`;
  }
  return n === 1 ? `There is 1 ${thing}.` : `There are ${n} ${things}.`;
}

function plan(P) {
  const n = P.n, rep = P.representation, mode = P.oneMoreOneLess;
  const kind = rep === 'dice' ? 'dice' : rep === 'fingers' ? 'fingers' : P.object;
  const things = txt(P, 'label:things', PLURAL[kind]), thing = txt(P, 'label:thing', SINGULAR[kind]);
  const noun = k => k === 1 ? thing : things;
  const more = mode === 'more' || mode === 'both', less = mode === 'less' || mode === 'both';
  const slots = n + (more ? 1 : 0);
  const L = layout(P, slots);
  const items = [], reveal = n === 0 ? 'all' : P.reveal;
  const runs = [];   // per build: the running count shown in the numeral slot (null: none, '?': not yet)
  const smallOK = reveal === 'one' && n > 0 && L.small(0) != null;
  if (rep === 'tenframe') { items.push({ key: 'frame', caption: L.frames.length > 1 ? 'Here are two ten frames.' : 'Here is a ten frame.' }); runs.push(null); }
  if (reveal === 'one') for (let i = 0; i < n; i++) {
    const seq = Array.from({ length: i + 1 }, (_, j) => j + 1).join(', ');
    items.push({ key: `obj:${i}`, caption: `Count the ${things}: ${seq}.`, idx: [i] });
    runs.push(smallOK ? null : i + 1);
  } else if (reveal === 'five') {
    const groups = [];
    for (let i = 0; i < n; i++) { const g = L.group(i); (groups[g] = groups[g] || []).push(i); }
    groups.filter(Boolean).forEach((idx, j) => {
      const cnt = idx[idx.length - 1] + 1, add = idx.length;
      const where = rep === 'dice' ? 'on this dice' : rep === 'fingers' ? 'on this hand' : rep === 'tenframe' ? 'in this row' : '';
      items.push({ key: `five:${j}`, caption: j ? `${up1(word(add))} more ${where}: that makes ${cnt}.`.replace(' :', ':') : `${up1(word(add))} ${noun(add)}${where ? ' ' + where : ''}.`, idx });
      runs.push(cnt);
    });
  } else {
    items.push({ key: 'show', caption: n ? `How many ${things}? Look, don’t count.` : `How many ${things}? Look carefully.`, idx: Array.from({ length: n }, (_, i) => i) });
    runs.push('?');
  }
  const M = { n, rep, kind, things, thing, noun, more, less, slots, L, items, runs, reveal, smallOK };
  items.push({ key: 'total', caption: totalCaption(M) });
  if (more) items.push({ key: 'more', caption: `One more than ${n} is ${n + 1}.` });
  if (less) items.push({ key: 'less', caption: `One less than ${n} is ${n - 1}.` });
  M.summary = more && less ? `One less than ${n} is ${n - 1}. One more than ${n} is ${n + 1}.`
    : more ? `One more than ${n} is ${n + 1}.` : less ? `One less than ${n} is ${n - 1}.` : totalCaption(M);
  return M;
}

export function builds(P) {
  const { items, summary } = plan(P);
  return { steps: items.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } };
}

export function notes(P) {
  const M = plan(P), n = M.n;
  const steps = M.items.map(it => {
    const k = it.key;
    if (k === 'frame') return M.L.frames.length > 1 ? 'Point to the two frames. Ask: how many spaces in one frame? We fill the first frame, top row first, then the second.' : 'Point to the two rows of five. Ask: how many spaces are there? We fill the top row first, left to right.';
    if (k.startsWith('obj:')) { const i = +k.slice(4);
      if (!i) return M.rep === 'fingers' ? 'Fingers go up from left to right across both hands, so five is one whole hand. Use your school’s finger pattern if it differs.' : 'Touch each one once and say one number for each, so nothing is counted twice.';
      if (i === n - 1) return 'Ask: what was the last number we said? That number tells us how many.';
      return i === 4 && n > 5 ? 'Pause at five. Ask: can you see five without counting again?' : 'Keep one number for each one: no skipping, no counting twice.'; }
    if (k.startsWith('five:')) return M.rep === 'tenframe' ? 'A full row of a ten frame is five; two full rows are ten. Ask: how many empty spaces?' : M.rep === 'dice' ? 'Each dice pattern is seen at a glance. Two dice share the number as evenly as they can, so 7 is 4 and 3.' : 'See five as one group, then count on from five.';
    if (k === 'show') return n ? `Show it for a moment, then ask how many. Small amounts (up to about 5) can be seen without counting: that is subitising. ${n > 5 ? 'Bigger amounts are seen as smaller groups put together.' : ''}`.trim() : 'Zero means none at all. Ask: how many are there? How do you know?';
    if (k === 'total') return n ? (M.rep === 'tenframe' && n >= 5 ? 'The frame shows how many without counting: a full row is 5, a full frame is 10. Ask: how many empty spaces? How many more to make 10?' : 'The last number said is how many there are, whatever order we count in. Ask: if we counted from the other end, would we get the same?') : 'Zero is a number: it tells us there are none.';
    if (k === 'more') return `One more is the next number when we count: ${n}, ${n + 1}. ${M.rep === 'dice' ? `The dice now shows the real pattern for ${n + 1}, so the class can see it at a glance.` : 'The new one is in a different colour so the class can see which one was added.'}`.trim();
    if (k === 'less') return `One less is the number before when we count: ${n - 1}, ${n}. Ask: which one went? How many are left?`;
    return '';
  });
  const summary = M.more || M.less ? `Ask: what is one more than ${n + 1}? What is one less than ${Math.max(1, n - 1)}?` : 'Ask: show me the same number a different way, on fingers or with a dice pattern.';
  return { steps, summary };
}

/* ------------------------------------------------------------------ render */
export function render(root, P, ctx) {
  const M = plan(P), b = ctx.b, N = ctx.N, L = M.L, n = M.n;
  const bi = key => b[key] ?? 0;
  const kT = bi('total'), kMore = M.more ? bi('more') : null, kLess = M.less ? bi('less') : null;
  const both = M.more && M.less;
  const kAfter = kMore ?? kLess;   // once one more / one less starts, the total ring steps away: one highlight per build
  const at = i => M.items.findIndex(it => it.idx && it.idx.includes(i));
  const kOf = i => i < n ? at(i) : kMore;
  const under = h('g', {}, root), marks = h('g', {}, root), rings = h('g', {}, root), smalls = h('g', {}, root), slot = h('g', {}, root);

  /* frames, dice faces and hands sit under the objects. Every frame is there from the first build,
     so the set never moves or grows as the builds play. */
  if (L.frames) L.frames.forEach(F => {
    const g = h('g', { s: bi('frame'), cls: 'rise' }, under);
    h('rect', { x: F.x, y: F.y, width: F.cell * 5, height: F.cell * 2, fill: 'var(--paper)', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', rx: 'var(--r-mark)' }, g);
    for (let i = 1; i < 5; i++) h('line', { x1: F.x + i * F.cell, x2: F.x + i * F.cell, y1: F.y, y2: F.y + F.cell * 2, stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)' }, g);
    h('line', { x1: F.x, x2: F.x + F.cell * 5, y1: F.y + F.cell, y2: F.y + F.cell, stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)' }, g);
  });
  if (L.dice) L.dice.forEach(D => h('rect', Object.assign({ x: D.x, y: D.y, width: L.die, height: L.die, rx: 'var(--r-card)', fill: 'var(--paper)', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)' },
    D.k0 ? {} : { s: kMore, cls: 'rise', hide: both ? kLess : null }), under));

  /* hands: flat silhouettes. Each shape is drawn twice, an outline pass under a fill pass, so the hand reads as one shape. */
  const skin = 'color-mix(in oklab, var(--hue-orange) 26%, var(--paper))';
  const handO = h('g', {}, under), handF = h('g', {}, under);
  const part = (attrs, a = {}, tag = 'rect') => {
    const o = h('g', a, handO), f = h('g', a, handF);
    h(tag, Object.assign({}, attrs, { fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'calc(var(--sw-struct) * 2)' }), o);
    h(tag, Object.assign({}, attrs, { fill: skin }), f);
    return f;
  };
  if (L.hands) L.hands.forEach(({ hx, top, pw }) => {
    // palm with rounded shoulders, narrowing into a wrist
    const u = v => v * L.s, x0 = hx - pw / 2, x1 = hx + pw / 2, y0 = top - u(20), yb = top + u(150), yw = top + u(210), wx0 = hx - pw * .34, wx1 = hx + pw * .34, r = u(40);
    part({ d: `M${x0 + r} ${y0} H${x1 - r} Q${x1} ${y0} ${x1} ${y0 + r} V${yb} C${x1} ${yb + u(36)} ${wx1} ${yb + u(30)} ${wx1} ${yw} H${wx0} C${wx0} ${yb + u(30)} ${x0} ${yb + u(36)} ${x0} ${yb} V${y0 + r} Q${x0} ${y0} ${x0 + r} ${y0} Z` }, {}, 'path');
  });
  if (L.fing) L.fing.forEach((f, i) => {
    const u = v => v * L.s;
    if (!f.thumb) part({ x: f.x - L.fw / 2, y: L.hands[0].top - u(36), width: L.fw, height: u(64), rx: L.fw / 2 });   // folded finger: a knuckle bump
  });

  /* the objects */
  const fingerMark = (f, a) => f.thumb
    ? part({ x: -L.fw / 2, y: -f.len, width: L.fw, height: f.len + L.fw / 2, rx: L.fw / 2, transform: `translate(${f.bx} ${f.by}) rotate(${f.deg})` }, a)
    : part({ x: f.x - L.fw / 2, y: L.hands[0].top - f.len, width: L.fw, height: f.len + 30 * L.s, rx: L.fw / 2 }, a);
  const draw = (i, a, isMore) => {
    const [x, y] = L.pts[i];
    if (L.fing) return fingerMark(L.fing[i], a);
    if (L.dice) return h('circle', Object.assign({ cx: x, cy: y, r: L.pip, fill: 'var(--ink)', cls: 'body' }, a), marks);
    // one more is a --focus counter: the same flat disc, the answer's colour
    if (isMore && M.kind === 'counter') { const g = h('g', a, marks); h('circle', { cx: x, cy: y, r: L.size * 26 / 60, fill: 'var(--focus)', stroke: 'var(--focus-text)', 'stroke-width': 'var(--sw-hair)', cls: 'body' }, g); return g; }
    return countable(marks, M.kind, x, y, L.size, a);
  };
  const lastOrig = n - 1;
  const quietLast = both ? `${kLess}-${N}:quiet` : `${kLess}:quiet`;
  for (let i = 0; i < M.slots; i++) {
    if (L.dice && i >= n) continue;   // dice show one more as a whole new face (below)
    const k = kOf(i), isMore = i >= n;
    const a = { s: k, cls: L.fing ? 'rise' : 'pop', delay: M.reveal === 'all' || M.reveal === 'five' ? (i - (M.items[k]?.idx?.[0] ?? i)) * 90 : 0 };
    if (M.less && i === lastOrig) a.c = quietLast;
    if (isMore && both) a.hide = kLess;
    // dice: the old face of the changed dice goes when one more arrives (and comes back for one less, below)
    const onChanged = L.dice && M.more && L.dice[L.group(i)] === L.dice[L.changed];
    if (onChanged) { a.hide = kMore; delete a.c; }
    draw(i, a, isMore);
    if (onChanged && both) draw(i, Object.assign({ s: kLess, cls: 'pop' }, i === lastOrig ? { c: quietLast } : {}), false);
    // a non-counter "one more" (an apple, a finger) keeps its look and gets a --focus ring instead
    if (isMore && (M.kind !== 'counter' || L.fing)) { const [x, y] = L.pts[i]; h('circle', { cx: x, cy: y, r: L.ring, fill: 'none', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)', s: k, hide: both ? kLess : null }, rings); }
  }
  if (L.dice && M.more) {
    // one more on dice: the changed dice shows its real new face, ringed in the answer's colour
    L.newFace.forEach(([x, y], j) => h('circle', { cx: x, cy: y, r: L.pip, fill: 'var(--ink)', cls: 'pop body', s: kMore, hide: both ? kLess : null, delay: j * 60 }, marks));
    const D = L.dice[L.changed];
    groupRing(rings, { x: D.x, y: D.y, w: L.die, h: L.die }, { pad: 10, s: kMore, a: { hide: both ? kLess : null } });
  }

  /* small running numerals: on each counter in a ten frame, under each object in a line or scatter; they go when the total arrives */
  if (M.smallOK) for (let i = 0; i < n; i++) {
    const [x, y] = L.small(i);
    if (L.onObj) {
      const sc = L.cell / 120, g = h('g', { s: kOf(i), hide: kT, cls: 'pop' }, smalls);
      // dark on the counter's colour in every theme (the counters are the same hue in all of them)
      computed(T(h('g', { transform: `translate(${x} ${y + 14 * sc}) scale(${sc})` }, g), 0, 0, String(i + 1), 'ts-num',
        { 'text-anchor': 'middle', fill: 'color-mix(in oklab, var(--hue-orange) 18%, #000)' }), 'n');
    } else computed(T(smalls, x, y, String(i + 1), 'ts-label', { 'text-anchor': 'middle', fill: 'var(--ink-2)', s: kOf(i), hide: kT, cls: 'pop' }), 'n');
  }

  /* focus: the one being counted (when it has no numeral), the group of five, the total ring */
  const box = idx => { const xs = idx.map(i => L.pts[i][0]), ys = idx.map(i => L.pts[i][1]), r = L.ring;
    return { x: Math.min(...xs) - r, y: Math.min(...ys) - r, w: Math.max(...xs) - Math.min(...xs) + 2 * r, h: Math.max(...ys) - Math.min(...ys) + 2 * r }; };
  M.items.forEach((it, k) => {
    if (!it.idx || !it.idx.length || it.key === 'show') return;
    if (it.idx.length === 1) { if (M.smallOK) return; const [x, y] = L.pts[it.idx[0]]; h('circle', { cx: x, cy: y, r: L.ring, fill: 'none', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)', s: k, hide: k + 1 }, rings); }
    else if (L.dice && L.group(it.idx[0]) != null) { const D = L.dice[L.group(it.idx[0])]; groupRing(rings, { x: D.x, y: D.y, w: L.die, h: L.die }, { pad: 10, s: k, a: { hide: k + 1 } }); }
    else groupRing(rings, box(it.idx), { pad: 6, s: k, a: { hide: k + 1 } });
  });
  if (n > 0) {
    let tb;
    if (L.frames) {
      // the structure that makes the number: a full row of 5, or a full frame of 10, or both frames for 20
      const F0 = L.frames[0], c = F0.cell;
      tb = n < 5 ? { x: F0.x, y: F0.y, w: n * c, h: c }
        : n < 10 ? { x: F0.x, y: F0.y, w: 5 * c, h: c }
        : n < 20 ? { x: F0.x, y: F0.y, w: 5 * c, h: 2 * c }
        : { x: F0.x, y: F0.y, w: L.frames[1].x + 5 * c - F0.x, h: 2 * c };
    } else if (L.dice) { const ds = L.dice.filter(D => D.k0); tb = { x: ds[0].x, y: ds[0].y, w: ds[ds.length - 1].x + L.die - ds[0].x, h: L.die }; }
    else if (L.hands) { const H0 = L.hands[0], s = L.s, top = L.tipTop;
      tb = { x: H0.hx - H0.pw / 2, y: top, w: n > 5 ? L.hands[1].hx - H0.hx + H0.pw : H0.pw + 70 * s, h: H0.top + 210 * s - top }; }
    else tb = box(Array.from({ length: n }, (_, i) => i));
    groupRing(rings, tb, { pad: L.frames ? 8 : 12, s: kT, a: { hide: kAfter ?? null } });
  }

  /* the numeral slot under the set: running count, the total, then one more / one less */
  const big = (p, x, y, sc, a = {}) => h('g', Object.assign({ transform: `translate(${x} ${y}) scale(${sc})` }, a), p);
  const numY = L.numY, wordY = L.wordY;
  const numeral = (val, k, hide, fill, withWord = true) => {
    const g = h('g', { s: k, hide, cls: 'rise' }, slot);
    computed(T(big(g, L.numX, numY, L.numSc), 0, 0, String(val), 'ts-num', { 'text-anchor': 'middle', fill }), 'n');
    if (P.countAloud && withWord && typeof val === 'number') computed(T(g, L.numX, wordY, word(val), 'ts-label', { 'text-anchor': 'middle', fill: 'var(--ink-2)' }), 'n');
    return g;
  };
  M.runs.forEach((v, k) => { if (v != null) numeral(v, k, k + 1, 'var(--ink-2)', v !== '?'); });
  numeral(n, kT, kAfter ?? null, 'var(--ink)');
  if (M.more) numeral(n + 1, kMore, both ? kLess : null, 'var(--focus-text)');
  if (M.less) numeral(n - 1, kLess, both ? N : null, 'var(--focus-text)');
  if (both) {
    // the summary: the number with its neighbours, one less on the left and one more on the right, labelled underneath
    const g = h('g', { s: N, cls: 'rise' }, slot);
    computed(T(big(g, CX, numY, L.numSc), 0, 0, String(n), 'ts-num', { 'text-anchor': 'middle', fill: 'var(--ink)' }), 'n');
    if (P.countAloud) computed(T(g, CX, wordY, word(n), 'ts-label', { 'text-anchor': 'middle', fill: 'var(--ink-2)' }), 'n');
    [[-1, n - 1, 'less', 'One less'], [1, n + 1, 'more', 'One more']].forEach(([dir, val, key, def]) => {
      const x = CX + dir * 330;
      computed(T(big(g, x, numY, L.numSc * .77), 0, 0, String(val), 'ts-num', { 'text-anchor': 'middle', fill: 'var(--focus-text)' }), 'n');
      textBlock(h('g', {}, g), x, wordY, txt(P, `label:${key}`, def), { cls: 'ts-label', maxW: 340, maxLines: 2, lh: 34, anchor: 'middle', edit: `text.label:${key}`, a: { fill: 'var(--ink-2)' } });
    });
  }
  return {};
}
