// Coins and money: count a set of coins, make an amount (fewest coins or the teacher's own
// coins), or give change by counting up from the price. Real denominations for the locale only,
// drawn as generic coins (shape, size and tone, never a real design) to scale with each other.
// Every total, running total and change amount is computed in code.
import {
  h, T, measure, clamp, GRID, textBlock, arrow, lanePlace,
  editable, computed, txt, TEXT_PARAM, TITLE_PARAM, schemaCheck, withDefaults, result,
} from '../kit/index.js';
import { coin, locale } from '../kit/batch-B.js';

export const meta = {
  id: 'coins_money', name: 'Coins and money', kind: 'info', version: 1,
  subjects: ['Maths'],
  years: ['Reception', 'Y1', 'Y2', 'Y3'],
  teaches: 'Recognising coins, counting money, making an amount in different ways and giving change by counting up.',
};

const LOCALE_CODES = ['GB', 'IN', 'US', 'EU'];
const MONEY_NAME = { GB: 'pounds and pence', IN: 'rupees', US: 'dollars and cents', EU: 'euros and cents' };
const EXAMPLE = { GB: '“65p” or “£1.35”', IN: '“₹15”', US: '“65¢” or “$1.35”', EU: '“65c” or “€1.35”' };
const MAX_COINS = 10, MAX_HOPS = 6;

export const params = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: 'Coins and money',
  properties: {
    title: TITLE_PARAM('Make 10p'),
    locale: { type: 'string', title: 'Money', description: 'Set from your account. Only this country’s real coins are used.', enum: LOCALE_CODES, 'x-labels': ['Pounds and pence (UK)', 'Rupees (India)', 'Dollars and cents (US)', 'Euros and cents'], default: 'GB' },
    task: { type: 'string', title: 'What the class does', enum: ['count', 'make', 'change'], 'x-labels': ['Count the coins', 'Make an amount', 'Give change'], default: 'make' },
    amount: { type: 'string', title: 'Amount (or price)', description: 'Like “65p” or “£1.35”. For change, this is the price.', minLength: 1, maxLength: 12, default: '10p' },
    coins: { type: 'string', title: 'Which coins', description: 'For counting or making an amount. Change always counts up with the fewest coins.', enum: ['fewest', 'chosen'], 'x-labels': ['Fewest coins (worked out for you)', 'Coins I choose'], default: 'fewest' },
    coinList: {
      type: 'array', title: 'My coins', description: 'Used when “Which coins” is “Coins I choose”. They are shown biggest value first.', 'x-item': 'a coin', maxItems: MAX_COINS, default: [],
      items: { type: 'object', required: ['coin'], default: { coin: '10p' }, properties: { coin: { type: 'string', title: 'Coin', description: 'Like “20p” or “£1”.', minLength: 1, maxLength: 8 } } },
    },
    paid: { type: 'string', title: 'Paid with', description: 'For change: the money handed over, like “£2” or “£5”.', minLength: 1, maxLength: 12, default: '£1' },
    item: { type: 'string', title: 'What is bought', description: 'For change.', minLength: 1, maxLength: 60, default: 'A pencil' },
    text: TEXT_PARAM,
  },
};

export const presets = [
  { id: 'y1-make-10p', name: 'Year 1: make 10p', params: {
    title: 'Make 10p', locale: 'GB', task: 'make', amount: '10p', coins: 'chosen',
    coinList: [{ coin: '2p' }, { coin: '5p' }, { coin: '1p' }, { coin: '2p' }],
  } },
  { id: 'y2-count', name: 'Year 2: how much money?', params: {
    title: 'How much money?', locale: 'GB', task: 'count', coins: 'chosen',
    coinList: [{ coin: '20p' }, { coin: '50p' }, { coin: '10p' }, { coin: '2p' }, { coin: '20p' }, { coin: '1p' }],
  } },
  { id: 'y2-135', name: 'Year 2: £1.35 in coins', params: {
    title: '£1.35 in coins', locale: 'GB', task: 'make', amount: '£1.35', coins: 'fewest',
  } },
  { id: 'y3-change', name: 'Year 3: change from £2 for 65p', params: {
    title: 'Change from £2', locale: 'GB', task: 'change', amount: '65p', paid: '£2', item: 'A pencil',
  } },
];

/* ------------------------------------------------------------------ money parsing */
const SYM = { '£': 'GB', '₹': 'IN', 'rs': 'IN', 'rs.': 'IN', 'inr': 'IN', '$': 'US', '€': 'EU' };
const SUF = { GB: ['p'], IN: ['paise'], US: ['¢', 'c'], EU: ['c', '¢'] };
/** Parse a typed amount in the locale's money into minor units: {minor, carried} or {error}.
 *  An amount written in another country's money (after “Money” is switched) keeps its number and is
 *  read in this money ({carried: true}); validate() warns so the teacher can rewrite it. */
export function parseMoney(raw, code = 'GB') {
  const L = locale(code), s = String(raw ?? '').trim().replace(/[\s,]/g, '');
  const bad = { error: `“${raw}” is not an amount of money. Write it like ${EXAMPLE[L.code]}.` };
  if (!s) return { error: 'The amount is empty.' };
  const m = s.match(/^(£|₹|\$|€|rs\.?|inr)?(\d+(?:\.\d+)?)(p|¢|c|paise)?$/i);
  if (!m) return bad;
  const [, sym, num, suf] = m;
  const carried = !!((sym && SYM[sym.toLowerCase()] !== L.code) || (suf && !SUF[L.code].includes(suf.toLowerCase())));
  if (sym && suf) return { error: `“${raw}” has both ${sym} and ${suf}. Write it like ${EXAMPLE[L.code]}.` };
  let minor;
  if (suf) { if (num.includes('.')) return { error: `“${raw}” is part of a ${suf}. Use whole ${suf === 'p' ? 'pence' : 'cents'}.` }; minor = +num; }
  else if (sym || num.includes('.') || L.code === 'IN') {
    const dec = (num.split('.')[1] || '');
    if (dec.length > 2) return { error: `“${raw}” has more than two numbers after the point. Money has two, like ${EXAMPLE[L.code]}.` };
    minor = Math.round(+num * L.minorPerMajor);
  } else return { error: `Is “${raw}” ${L.money(+num)} or ${L.money(+num * L.minorPerMajor)}? Write it with its sign, like ${EXAMPLE[L.code]}.` };
  if (!(minor > 0)) return { error: 'The amount has to be more than nothing.' };
  return { minor, carried };
}
const coinNames = L => L.coinList.map(L.money).join(', ');

/* ------------------------------------------------------------------ model of the data */
function model(P) {
  const L = locale(P.locale), $ = L.money, task = P.task;
  const amt = parseMoney(P.amount, P.locale).minor;
  if (task === 'change') {
    const paid = parseMoney(P.paid, P.locale).minor, change = paid - amt;
    const hops = (L.coinsFor(change) || []).slice().sort((a, b) => a - b);   // count up: small coins first, to round amounts
    const stops = [amt]; hops.forEach(c => stops.push(stops[stops.length - 1] + c));
    return { L, $, task, amt, paid, change, hops, stops };
  }
  let list;
  if (ownCoins(P)) list = (P.coinList || []).map((c, i) => ({ v: parseMoney(c.coin, P.locale).minor, path: `coinList.${i}.coin` }));
  else list = (L.coinsFor(amt) || []).map(v => ({ v, path: 'amount' }));
  list.sort((a, b) => b.v - a.v);   // largest first (stable, so equal coins keep their order)
  const run = []; list.reduce((s, c) => { run.push(s + c.v); return s + c.v; }, 0);
  const total = run[run.length - 1] || 0;
  return { L, $, task, amt, coins: list, run, total, fewest: !ownCoins(P) };
}
/** “Coins I choose” with no coins yet shows the fewest coins until the teacher adds some. */
const ownCoins = P => P.coins === 'chosen' && (P.coinList || []).length > 0;

/* ------------------------------------------------------------------ validate */
export function validate(raw) {
  const P = withDefaults(params, raw);
  const R = schemaCheck(params, P); const W = [];
  if (R.length) return result(R);
  const L = locale(P.locale), $ = L.money;
  const needAmount = P.task !== 'count' || !ownCoins(P);
  const carry = (path, v, raw) => { if (v.carried) W.push({ path, reason: `“${raw}” is not written in ${MONEY_NAME[L.code]}, so it is shown as ${$(v.minor)}. Write it like ${EXAMPLE[L.code]}.` }); };
  const a = needAmount ? parseMoney(P.amount, P.locale) : null;
  if (a && a.error) R.push({ path: 'amount', reason: a.error });
  else if (a) carry('amount', a, P.amount);
  if (P.task === 'change') {
    const p = parseMoney(P.paid, P.locale);
    if (p.error) R.push({ path: 'paid', reason: p.error }); else carry('paid', p, P.paid);
    if (R.length) return result(R);
    if (p.minor <= a.minor) R.push({ path: 'paid', reason: p.minor === a.minor ? `Paying ${$(p.minor)} for ${$(a.minor)} gives no change. Pay with more than the price.` : `${$(p.minor)} is not enough to pay ${$(a.minor)}. Pay with more than the price.` });
    else {
      const ch = L.coinsFor(p.minor - a.minor);
      if (!ch) R.push({ path: 'amount', reason: `The change, ${$(p.minor - a.minor)}, cannot be made with ${MONEY_NAME[L.code]} coins (${coinNames(L)}).` });
      else if (ch.length > MAX_HOPS) R.push({ path: 'paid', reason: `Counting up ${$(p.minor - a.minor)} of change takes ${ch.length} coins; one slide shows up to ${MAX_HOPS}. Pay with an amount closer to the price.` });
    }
    return result(R, W);
  }
  if (P.coins === 'chosen' && !ownCoins(P)) W.push({ path: 'coinList', reason: 'No coins are added yet, so the fewest coins are shown. Add your own coins under “My coins”.' });
  if (ownCoins(P)) {
    (P.coinList || []).forEach((c, i) => {
      const v = parseMoney(c.coin, P.locale);
      if (v.error) { R.push({ path: `coinList.${i}.coin`, reason: v.error }); return; }
      carry(`coinList.${i}.coin`, v, c.coin);
      if (!L.coins[v.minor]) R.push({ path: `coinList.${i}.coin`, reason: `There is no ${$(v.minor)} coin. The coins are ${coinNames(L)}.` });
    });
    if (R.length) return result(R);
    if (P.task === 'make') {
      const sum = P.coinList.reduce((s, c) => s + parseMoney(c.coin, P.locale).minor, 0);
      if (sum !== a.minor) R.push({ path: 'coinList', reason: `These coins make ${$(sum)}, not ${$(a.minor)}. ${sum < a.minor ? 'Add' : 'Take away'} coins, or change the amount.` });
    }
  } else if (!R.length) {
    const g = L.coinsFor(a.minor);
    if (!g) R.push({ path: 'amount', reason: `${$(a.minor)} cannot be made with ${MONEY_NAME[L.code]} coins (${coinNames(L)}).` });
    else if (g.length > MAX_COINS) R.push({ path: 'amount', reason: `${$(a.minor)} needs ${g.length} coins, even with the fewest; one slide shows up to ${MAX_COINS}. Use a smaller amount.` });
  }
  return result(R, W);
}

/* ------------------------------------------------------------------ builds */
const plus = (arr, $) => arr.map($).join(' + ');
const andList = arr => arr.length < 2 ? arr.join('') : `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`;
function plan(P) {
  const M = model(P), $ = M.$, items = [];
  if (M.task === 'change') {
    items.push({ key: 'problem', caption: `${P.item} costs ${$(M.amt)}. We pay with ${$(M.paid)}.` });
    items.push({ key: 'line', caption: `Count up from the price, ${$(M.amt)}, to the ${$(M.paid)} we paid.` });
    M.hops.forEach((c, i) => items.push({ key: `hop:${i}`, caption: `Add ${$(c)} to make ${$(M.stops[i + 1])}.` }));
    items.push({ key: 'change', caption: M.hops.length > 1 ? `The change is ${plus(M.hops, $)} = ${$(M.change)}.` : `The change is ${$(M.change)}.` });
    return { M, items, summary: `${$(M.paid)} − ${$(M.amt)} = ${$(M.change)} change.` };
  }
  const vals = M.coins.map(c => c.v);
  if (M.task === 'make') items.push({ key: 'target', caption: `Make ${$(M.amt)}.` });
  items.push({ key: 'coins', caption: M.task === 'count' ? 'The coins in order, biggest value first.' : M.fewest ? 'Fewest coins: take the biggest coin that fits, again and again.' : `Use ${andList(vals.map($))}, biggest value first.` });
  vals.forEach((v, i) => items.push({ key: `add:${i}`, caption: i ? `Add ${$(v)}: that makes ${$(M.run[i])}.` : `Start with the biggest coin: ${$(v)}.` }));
  items.push({ key: 'total', caption: vals.length > 1 ? `${plus(vals, $)} = ${$(M.total)}.` : `One coin: ${$(M.total)}.` });
  const n = vals.length, summary = M.task === 'count' ? `There is ${$(M.total)} altogether.`
    : M.fewest ? `${$(M.amt)} with the fewest coins: ${n} coin${n === 1 ? '' : 's'}.` : `These ${n} coins make ${$(M.amt)}.`;
  return { M, items, summary };
}
export function builds(P) { const { items, summary } = plan(P); return { steps: items.map(({ key, caption }) => ({ key, caption })), summary: { caption: summary } }; }

export function notes(P) {
  const { M, items } = plan(P), $ = M.$, L = M.L;
  const mpm = L.minorPerMajor;
  // a coin that is bigger but worth less: the classic misconception, named when the slide shows one
  const sizeTrap = vals => { const u = [...new Set(vals)]; for (const a of u) for (const b of u) if (a < b && L.coins[a][0] > L.coins[b][0]) return [a, b]; return null; };
  const steps = items.map(it => {
    const k = it.key;
    if (k === 'target') return `Ask: which coin would you pick first? ${M.fewest ? 'The biggest coin that fits means fewer coins to count.' : 'There is more than one way to make it.'}`;
    if (k === 'coins') { const t = sizeTrap(M.coins.map(c => c.v)); return `The coins are drawn to scale with each other.${t ? ` Size does not tell you the value: the ${$(t[0])} is bigger than the ${$(t[1])} but worth less.` : ''} The bar under each coin shows what it is worth. Counting is easier from the biggest value.`; }
    if (k.startsWith('add:')) { const i = +k.slice(4); if (!i) return 'Say the value of the first coin, then count on.';
      const a = M.run[i - 1], b = M.run[i]; return `Count on from ${$(a)}: ${$(a)} add ${$(M.coins[i].v)} is ${$(b)}.${a < mpm && b >= mpm && L.minor ? ` ${mpm}${L.minor} is the same as ${$(mpm)}.` : ''}`; }
    if (k === 'total') return 'Check by counting again in a different order. The total does not change.';
    if (k === 'problem') return 'Ask: will we get change? Roughly how much?';
    if (k === 'line') return 'This is the shopkeeper’s way: count up from the price to the money paid. The jumps are not to scale; small coins get room to be seen. Say so to the class.';
    if (k.startsWith('hop:')) { const i = +k.slice(4); return `Jump to an easy amount: ${$(M.stops[i])} add ${$(M.hops[i])} is ${$(M.stops[i + 1])}.`; }
    if (k === 'change') return `Check with take away: ${$(M.paid)} − ${$(M.amt)} = ${$(M.change)}.`;
    return '';
  });
  const summary = M.task === 'change' ? 'Ask: could the shopkeeper give the change with different coins?' : M.task === 'make' ? `Ask: can you make ${$(M.amt)} another way?` : 'Ask: which coins could you swap for one coin of the same value?';
  return { steps, summary };
}

/* ------------------------------------------------------------------ render */
// slide units per mm of real diameter: one scale for every coin on a slide
const MM_MAX = 9, MM_MIN = 2.3, MM_CH = 4.9;

/** A kit coin; plain silver coins get a darker ink-2 edge and a flat face (no inner ring). */
function drawCoin(p, v, L, o) {
  const g = coin(p, v, L, o), spec = L.coins[v];
  if (spec && !spec[3] && spec[2] === 'silver') {
    const body = g.firstChild, ring = body && body.nextSibling;
    if (body) { body.setAttribute('stroke', 'var(--ink-2)'); body.setAttribute('stroke-width', 'var(--sw-struct)'); }
    if (ring && ring.tagName === 'circle' && ring.getAttribute('fill') === 'none') ring.remove();
  }
  return g;
}

function note(p, value, L, { x, y, w = 168, hh = 86, a = {}, computedPath } = {}) {
  const g = h('g', a, p);
  h('rect', { x: x - w / 2, y: y - hh / 2, width: w, height: hh, rx: 'var(--r-mark)', fill: 'var(--plate)', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)', cls: 'body' }, g);
  h('rect', { x: x - w / 2 + 10, y: y - hh / 2 + 10, width: w - 20, height: hh - 20, rx: 'var(--r-mark)', fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }, g);
  computed(T(g, x, y + 12, L.money(value), 'ts-num', { 'text-anchor': 'middle' }), computedPath);
  g.box = { x: x - w / 2, y: y - hh / 2, w, h: hh }; g.r = hh / 2;
  return g;
}

export function render(root, P, ctx) {
  const { M } = plan(P); const b = ctx.b, L = M.L;
  const bi = key => b[key] ?? 0;
  const dia = v => L.coins[v][0];
  return M.task === 'change' ? renderChange(root, P, ctx, M, bi, dia) : renderCoins(root, P, ctx, M, bi, dia);
}

function renderCoins(root, P, ctx, M, bi, dia) {
  const N = ctx.N, L = M.L, $ = M.$, n = M.coins.length;
  const make = M.task === 'make';
  const kC = bi('coins'), kT = bi('total');
  /* the target card is measured first so the whole group can be centred on the stage */
  const word0 = make ? txt(P, 'label:make', 'Make') : '', aW = make ? measure(root, $(M.amt), 'ts-num') : 0;
  let tb = { w: 0, h: 0, lh: 34 };
  if (make) { const tmp = h('g', {}, root); tb = textBlock(tmp, 0, 0, word0, { cls: 'ts-label', maxW: 760, maxLines: 2, lh: 34 }); tmp.remove(); }
  const ch = make ? Math.max(72, tb.h + 34) : 0, cardGap = make ? 44 : 0;
  /* coin row: true relative sizes, as big as fits about 85% of the width */
  const lw = M.run.map(v => measure(root, $(v), 'ts-label'));
  const place = mm => { const r = M.coins.map(c => dia(c.v) * mm / 2), xs = [0];
    for (let i = 1; i < n; i++) xs.push(xs[i - 1] + Math.max(r[i - 1] + r[i] + 30, (lw[i - 1] + lw[i]) / 2 + 30));
    return { r, xs, w: (xs[n - 1] || 0) + r[0] + r[n - 1] }; };
  /* the total's word wraps (then shrinks) beside its number; its card grows to hold it */
  const word = txt(P, 'label:total', make ? 'makes' : 'Altogether'), nW = measure(root, $(M.total), 'ts-num');
  const wordMax = Math.min(760, GRID.right - GRID.left - nW - 14 - 28);
  const tbT = (() => { const tmp = h('g', {}, root); const r = textBlock(tmp, 0, 0, word, { cls: 'ts-label', maxW: wordMax, maxLines: 2, lh: 32 }); tmp.remove(); return r; })();
  const totH = Math.max(62, tbT.h + 28);
  const BELOW = 82 + 34 + 10 + totH;                     // running totals, bracket, total
  const maxD = (GRID.bottom - GRID.top) - ch - cardGap - BELOW - 24;
  const fitW = (GRID.right - GRID.left) * .85;
  let mm = MM_MAX, lay = place(mm);
  const tall = l => 2 * Math.max(...l.r) > maxD;
  while ((lay.w > fitW || tall(lay)) && mm > MM_MIN) { mm -= .1; lay = place(mm); }
  if (lay.w > GRID.right - GRID.left) ctx.warn(`${n} coins do not fit across the slide.`);
  const rMax = Math.max(...lay.r);
  const groupH = ch + cardGap + 2 * rMax + BELOW;
  const top = clamp(372 - groupH / 2, GRID.top + 8, GRID.bottom - groupH);
  const x0 = 640 - lay.w / 2 + lay.r[0];
  const CY = top + ch + cardGap + rMax;
  const X = i => x0 + lay.xs[i];
  /* the target: "Make 10p"; it steps back once the coins arrive */
  if (make) {
    const g = h('g', { s: bi('target'), cls: 'rise', c: `${kC}-${N}:soft,${N}:soft` }, root);
    const w = tb.w + 16 + aW + 56, cx0 = 640 - w / 2, cy = top + ch / 2;
    h('rect', { x: cx0, y: top, width: w, height: ch, rx: 'var(--r-card)', fill: 'var(--paper)', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)', cls: 'lift' }, g);
    textBlock(g, cx0 + 28, cy - tb.h / 2 + tb.lh - 8, word0, { cls: 'ts-label', maxW: 760, maxLines: 2, lh: 34, a: { fill: 'var(--ink)' }, edit: 'text.label:make' });
    editable(T(g, cx0 + 28 + tb.w + 16, cy + 14, $(M.amt), 'ts-num'), 'amount');
  }
  /* a bar under each coin, its length in proportion to the coin's value: size is not value */
  const vMax = Math.max(...M.coins.map(c => c.v));
  // one scale for all bars: the biggest value gets its coin's width, and no bar reaches its neighbour
  const slot = i => Math.min(i ? lay.xs[i] - lay.xs[i - 1] : Infinity, i < n - 1 ? lay.xs[i + 1] - lay.xs[i] : Infinity, 2 * rMax) - 28;
  const iMax = M.coins.findIndex(c => c.v === vMax);
  const barMax = Math.max(40, Math.min(2 * lay.r[iMax], ...M.coins.map((c, i) => slot(i) * vMax / c.v)));
  const BarY = CY + rMax + 22;
  M.coins.forEach((c, i) => {
    drawCoin(root, c.v, L, { x: X(i), y: CY, mm, a: { s: kC, cls: 'pop', delay: i * 140 }, computedPath: c.path });
    const bw = Math.max(6, barMax * c.v / vMax);
    h('rect', { x: X(i) - bw / 2, y: BarY, width: bw, height: 12, rx: 6, fill: 'var(--ink-2)', s: kC, cls: 'rise', delay: 300 + i * 140 }, root);
    // the coin being counted gets a ring for its build only
    h('circle', { cx: X(i), cy: CY, r: lay.r[i] + 9, fill: 'none', stroke: 'var(--focus)', 'stroke-width': 'var(--sw-struct)', s: bi(`add:${i}`), hide: bi(`add:${i}`) + 1 }, root);
  });
  /* running totals under the coins: earlier ones step back to soft (still readable) */
  const TY = CY + rMax + 82;
  M.run.forEach((v, i) => {
    const k = bi(`add:${i}`), last = i === n - 1;
    computed(T(root, X(i), TY, $(v), 'ts-label', { 'text-anchor': 'middle', s: k, cls: 'pop', c: [ctx.rc(`add:${i}`, last ? kT : null, 'soft'), `${N}:soft`].filter(Boolean).join(',') }), M.coins[i].path === 'amount' ? 'amount' : 'coinList');
    if (i) h('path', { d: `M${X(i - 1) + lw[i - 1] / 2 + 8} ${TY - 9} H ${X(i) - lw[i] / 2 - 8}`, stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)', 'stroke-dasharray': '3 5', s: k, c: `${k + 1}:soft` }, root);
  });
  /* the total: a bracket under the whole row */
  const BY = TY + 34, bx1 = X(0) - lay.r[0], bx2 = X(n - 1) + lay.r[n - 1];
  const g = h('g', { s: kT, cls: 'rise' }, root);
  h('path', { d: `M${bx1} ${BY - 12} V ${BY} H ${bx2} V ${BY - 12}`, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
  const tW = tbT.w, tot = tW + 14 + nW, tx = clamp(640 - tot / 2, GRID.left + 14, GRID.right - 14 - tot), tcy = BY + 10 + totH / 2;
  h('rect', { x: tx - 14, y: BY + 10, width: tot + 28, height: totH, rx: 'var(--r-mark)', fill: 'var(--bg)' }, g);
  textBlock(g, tx, tcy - tbT.h / 2 + tbT.lh - 7, word, { cls: 'ts-label', maxW: wordMax, maxLines: 2, lh: 32, a: { fill: 'var(--ink-2)' }, edit: 'text.label:total' });
  computed(T(g, tx + tW + 14, tcy + 13, $(M.total), 'ts-num', { fill: 'var(--focus-text)' }), make || M.fewest ? 'amount' : 'coinList');
  if (BY + 10 + totH > GRID.bottom + 8) ctx.warn('The total sits below the stage.');
}

function renderChange(root, P, ctx, M, bi, dia) {
  const N = ctx.N, L = M.L, $ = M.$, n = M.hops.length;
  const kH0 = n ? bi('hop:0') : bi('change');
  /* the problem: what it costs, what we pay with; it steps back once the first jump appears */
  const paidCoins = L.coins[M.paid] ? [M.paid] : L.notes.includes(M.paid) ? null : L.coinsFor(M.paid);
  const asCoins = paidCoins && paidCoins.length <= 4;
  const tb0 = (() => { const tmp = h('g', {}, root); const r = textBlock(tmp, 0, 0, P.item, { cls: 'ts-label', maxW: 340, maxLines: 2, lh: 34 }); tmp.remove(); return r; })();
  const pW = measure(root, $(M.amt), 'ts-num'), cardH = Math.max(84, tb0.h + 40), cardW = tb0.w + 28 + pW + 56;
  /* below the line, measured first: the end words (up to 2 lines) and the change word (wraps beside its number) */
  const xa = 120, xb = 1160, span = xb - xa, half = span / 2 - 20;
  const probe = (s, o) => { const tmp = h('g', {}, root); const r = textBlock(tmp, 0, 0, s, o); tmp.remove(); return r; };
  const priceWord = txt(P, 'label:price', 'price'), paidWord = txt(P, 'label:paidShort', 'paid');
  const END = { cls: 'ts-label', maxW: half, maxLines: 3, lh: 30 };
  const endLines = Math.max(probe(priceWord, END).lines.length, probe(paidWord, END).lines.length);
  const word = txt(P, 'label:change', 'change'), nW = measure(root, $(M.change), 'ts-num');
  const CHW = { cls: 'ts-label', maxW: Math.min(760, span - nW - 14 - 28), maxLines: 2, lh: 32 };
  const tbC = probe(word, CHW), chH = Math.max(50, tbC.h + 18);
  const drop = (endLines - 1) * 30;                       // extra room the end words take above the bracket
  const Ymax = GRID.bottom + 14 - chH - 2 - 102 - drop;
  /* one coin scale for the slide; it steps down only if the jumps and the problem can't both fit above the line */
  const paidH = mm => asCoins ? Math.max(...paidCoins.map(v => dia(v) * mm)) : 86;
  const rOf = mm => Math.max(...M.hops.map(c => dia(c) * mm / 2));
  const Ymin = mm => 132 + Math.max(cardH, paidH(mm)) + 16 + 96 + 2 * rOf(mm);
  let mm = MM_CH; while (Ymin(mm) > Ymax && mm > 3.2) mm -= .1;
  if (Ymin(mm) > Ymax) ctx.warn('The jumps and the change do not fit on the slide.');
  const topH = Math.max(cardH, paidH(mm)), cy = 132 + topH / 2;
  const gP = h('g', { s: bi('problem'), cls: 'rise', c: `${kH0}-${N}:soft,${N}:soft` }, root);
  h('rect', { x: GRID.left, y: cy - cardH / 2, width: cardW, height: cardH, rx: 'var(--r-card)', fill: 'var(--paper)', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)', cls: 'lift' }, gP);
  textBlock(gP, GRID.left + 28, cy - tb0.h / 2 + 24, P.item, { cls: 'ts-label', maxW: 340, maxLines: 2, lh: 34, a: { fill: 'var(--ink)' }, edit: 'item' });
  editable(T(gP, GRID.left + 28 + tb0.w + 28, cy + 14, $(M.amt), 'ts-num'), 'amount');
  // what was paid: one coin, one note, or the fewest coins for it (same scale as the jumps)
  let px = GRID.right;
  if (asCoins) {
    for (let i = paidCoins.length - 1; i >= 0; i--) { const r = dia(paidCoins[i]) * mm / 2; drawCoin(gP, paidCoins[i], L, { x: px - r, y: cy, mm, computedPath: 'paid' }); px -= 2 * r + 14; }
  } else if (!paidCoins) { note(gP, M.paid, L, { x: px - 84, y: cy, computedPath: 'paid' }); px -= 168 + 14; }
  else { const t = T(gP, px, cy + 14, $(M.paid), 'ts-num', { 'text-anchor': 'end' }); computed(t, 'paid'); px -= t.getComputedTextLength() + 14; }
  // "We pay" wraps, then shrinks, into the room between the price card and what was paid
  const payWord = txt(P, 'label:paid', 'We pay'), payMax = Math.max(80, px - 6 - (GRID.left + cardW + 28));
  const tbP = (() => { const tmp = h('g', {}, root); const r = textBlock(tmp, 0, 0, payWord, { cls: 'ts-label', maxW: payMax, maxLines: 2, lh: 32 }); tmp.remove(); return r; })();
  textBlock(gP, px - 6, cy - tbP.h / 2 + tbP.lh - 10, payWord, { cls: 'ts-label', maxW: payMax, maxLines: 2, lh: 32, anchor: 'end', edit: 'text.label:paid' });
  if (px - 6 - tbP.w < GRID.left + cardW + 20) ctx.warn('The price card and what was paid meet.');

  /* the counting-up line: jumps sized to their value, but never narrower than the coin they carry */
  const rMax = rOf(mm);
  const Y = Math.min(Math.max(480, Ymin(mm)), Math.max(Ymin(mm), Ymax));
  const lw = M.stops.map(v => measure(root, $(v), 'ts-label'));
  const minW = M.hops.map((c, i) => Math.max(dia(c) * mm + 34, (lw[i] + lw[i + 1]) / 2 + 30));
  let ws = M.hops.map(c => span * c / M.change);
  const scaled = ws.every((w, i) => w >= minW[i]);
  if (!scaled) { const free = span - minW.reduce((s, w) => s + w, 0); ws = minW.map((w, i) => w + Math.max(0, free) * M.hops[i] / M.change); }
  if (ws.reduce((s, w) => s + w, 0) > span + 1) ctx.warn('The jumps do not fit along the line.');
  const xs = [xa]; ws.forEach(w => xs.push(xs[xs.length - 1] + w));
  const kL = bi('line'), kCh = bi('change');
  const gl = h('g', { s: kL, cls: 'rise', c: `${N}:soft` }, root);
  h('line', { x1: xa - 30, x2: xb + 30, y1: Y, y2: Y, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, gl);
  const lane = [];
  const stopMark = (p, i, a) => { const x = xs[i], g = h('g', a, p);
    h('line', { x1: x, x2: x, y1: Y - 12, y2: Y + 12, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)' }, g);
    const bx = lanePlace(lane, lw[i], x, { y: Y + 18, gap: 28, shift: 0 }); if (!bx) ctx.warn(`The amount ${$(M.stops[i])} has no room under the line.`);
    computed(T(g, x, Y + 48, $(M.stops[i]), 'ts-label', { 'text-anchor': 'middle', cls: i === 0 || i === n ? 'strong' : null }), i === n ? 'paid' : 'amount'); return g; };
  stopMark(gl, 0, {}); stopMark(gl, n, {});
  // end words: the price end grows rightwards, the paid end leftwards, both kept on the stage
  const pX = Math.max(GRID.left, xa - lw[0] / 2), qX = Math.min(GRID.right, xs[n] + lw[n] / 2);
  textBlock(gl, pX, Y + 80, priceWord, Object.assign({}, END, { a: { fill: 'var(--ink-2)' }, edit: 'text.label:price' }));
  textBlock(gl, qX, Y + 80, paidWord, Object.assign({}, END, { anchor: 'end', a: { fill: 'var(--ink-2)' }, edit: 'text.label:paidShort' }));
  /* each jump: an arc with its coin riding above it */
  M.hops.forEach((c, i) => {
    const k = bi(`hop:${i}`), x0 = xs[i] + 6, x1 = xs[i + 1] - 6, mid = (x0 + x1) / 2, top = Y - 170;
    const ang = Math.atan2((Y - 8) - top, x1 - mid), s = ctx.tk.head;
    const ex = x1 - Math.cos(ang) * s * .72, ey = Y - 8 - Math.sin(ang) * s * .72;
    arrow(ctx, root, `M${x0} ${Y - 8} Q ${mid} ${top} ${ex} ${ey}`, ex, ey, ang, 'var(--focus)', 'var(--sw-arrow)', { draw: k });
    drawCoin(root, c, L, { x: mid, y: Y - 96 - rMax, mm, a: { s: k, cls: 'pop', delay: 500 }, computedPath: 'paid' });
    if (i < n - 1) stopMark(root, i + 1, { s: k, cls: 'rise', delay: 700, c: `${N}:soft` });
  });
  /* the change: a bracket under every jump */
  const BY = Y + 102 + drop, g = h('g', { s: kCh, cls: 'rise' }, root);
  h('path', { d: `M${xa} ${BY - 10} V ${BY} H ${xs[n]} V ${BY - 10}`, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
  const wW = tbC.w, tot = nW + 14 + wW, tx = clamp((xa + xs[n]) / 2 - tot / 2, GRID.left + 14, GRID.right - 14 - tot), ccy = BY + 2 + chH / 2;
  h('rect', { x: tx - 14, y: BY + 2, width: tot + 28, height: chH, rx: 'var(--r-mark)', fill: 'var(--bg)' }, g);
  computed(T(g, tx, ccy + 13, $(M.change), 'ts-num', { fill: 'var(--focus-text)' }), 'paid');
  textBlock(g, tx + nW + 14, ccy - tbC.h / 2 + tbC.lh - 7, word, Object.assign({}, CHW, { a: { fill: 'var(--ink-2)' }, edit: 'text.label:change' }));
}
