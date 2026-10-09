// Batch A shared parts (Number and place value). Plain ES module on the kit core; tokens only.
// Every visible word is real SVG text, marked editable(el, path) or computed(el, path).
//
// Exports and params
//   Truth helpers
//     isWholeNumber(v)                      -> true for a finite integer >= 0
//     inRange(v, lo, hi)                    -> lo <= v <= hi (numbers only)
//     checkSum(parts, whole, eps=1e-9)      -> true when parts add to whole (float safe)
//     fmtNum(v, dp?)                        -> en-GB number with thousands commas and a true minus "−"
//   Place value
//     PV_NAMES                              -> {6:'millions' … 0:'ones', -1:'tenths' … -3:'thousandths'}
//     pvColour(e)                           -> {fill, text, pale} tokens for place exponent e (ones = 0).
//                                              Decimals mirror round the ones (tenths = tens colour …).
//     digitCard(p, x, y, d, col, {w=72, h=96, edit, computedPath, placeholder, s, cls, a})
//                                           -> place-value digit tile centred on (x, y); col = place
//                                              name or exponent. placeholder draws a dashed 0 tile.
//                                              Returns g with g.box and g.text.
//     dienes(p, n, {x, y, colW=200, u=12, gap=8, maxH, places, sCol, counts, warn})
//                                           -> base-ten blocks for whole n (≤ 9,999) in columns,
//                                              highest place left; counts {tens:3, ones:12} shows an
//                                              unregrouped layout. Returns {g, cols:{place:{x, items, …}},
//                                              exchange(from, to, {s, ghost=true}), bottom}.
//                                              exchange('ones','tens') = ten ones become one ten;
//                                              exchange('tens','ones') = one ten becomes ten ones.
//   Number line
//     numberLine(p, {from, to, step, x0, x1, y, labels:'all'|'ends'|'none', fmt, computedPath, s, a})
//                                           -> {g, S (scale), ticks, jump(a, b, label, opts), mark(v, opts),
//                                              halfway(v, opts)}. Tick labels thin themselves (keeping the
//                                              ends) so neighbours stay 28 units apart.
//       jump(a, b, label, {s, col, edit, computedPath, below, lift}) -> arc with head landing on b
//       mark(v, {s, col, label, edit, computedPath, r})              -> dot on the line, label under the tick values (clear of jump arcs)
//       halfway(v, {s, label, edit})                                 -> dashed halfway line
//     partWhole(p, whole, parts, {x, y, r, pr, dy, spread, s, sParts, wholeCol, partCol,
//               wholePath, partsPath, edit})
//                                           -> cherry diagram: whole circle above, part circles below,
//                                              links ending at circle edges. Returns {g, whole, parts}.
//   Arrays and groups
//     counterGrid(p, rows, cols, {x, y, r=18, gap=14, col, kind='counter', s, stagger:'row'|'each'|null, a})
//                                           -> {g, cells:[[x,y]] row-major, items, box}
//     groupRing(p, box, {pad=10, col='var(--focus)', s, draw=true, a})
//                                           -> rounded ring round box {x,y,w,h}
//   Countable objects (topic-tagged, like OBJECT_CULTURES)
//     COUNTABLES, COUNTABLE_TOPICS          -> counter, apple, duck, star, car with topic tags
//     countablesFor(topic)                  -> kinds that fit a topic ('any' fits everywhere)
//     countable(p, kind, x, y, size=36, a)  -> one countable object centred on (x, y)
import { h, T, measure, clamp } from './svg.js';
import { scale } from './layout.js';
import { editable, computed, counter, baseTen, headD } from './components.js';

/* ------------------------------------------------------------------ truth helpers */
export const isWholeNumber = v => typeof v === 'number' && Number.isInteger(v) && v >= 0;
export const inRange = (v, lo, hi) => typeof v === 'number' && !Number.isNaN(v) && v >= lo && v <= hi;
export const checkSum = (parts, whole, eps = 1e-9) => Array.isArray(parts) && parts.every(x => typeof x === 'number') && Math.abs(parts.reduce((a, b) => a + b, 0) - whole) <= eps * Math.max(1, Math.abs(whole));
export function fmtNum(v, dp) {
  const n = dp == null ? +(+v).toFixed(10) : +v;
  const s = Math.abs(n).toLocaleString('en-GB', dp == null ? { maximumFractionDigits: 6 } : { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return (n < 0 && s !== '0' ? '−' : '') + s;
}

/* ------------------------------------------------------------------ place value */
export const PV_NAMES = { 6: 'millions', 5: 'hundred thousands', 4: 'ten thousands', 3: 'thousands', 2: 'hundreds', 1: 'tens', 0: 'ones', '-1': 'tenths', '-2': 'hundredths', '-3': 'thousandths' };
const PV_EXP = Object.fromEntries(Object.entries(PV_NAMES).map(([e, n]) => [n, +e]));
const PV_TOK = { 0: 'ones', 1: 'tens', 2: 'hundreds', 3: 'thousands', 4: 'tens', 5: 'hundreds', 6: 'thousands' };
/** Column colours from the --pv-* tokens. Decimals mirror round the ones column. */
export function pvColour(e) {
  if (typeof e === 'string') e = e in PV_EXP ? PV_EXP[e] : ({ one: 0, ten: 1, hundred: 2, thousand: 3 }[e] ?? 0);
  const k = PV_TOK[Math.min(6, Math.abs(e))];
  return { fill: `var(--pv-${k})`, text: `var(--pv-${k}-text)`, pale: `color-mix(in oklab, var(--pv-${k}) 20%, var(--paper))` };
}

/** A place-value digit tile centred on (x, y), in its column colour. */
export function digitCard(p, x, y, d, col, { w = 72, h: hh = 96, edit, computedPath, placeholder = false, s, cls, a = {} } = {}) {
  const c = pvColour(col);
  const g = h('g', Object.assign({ s, cls }, a), p);
  h('rect', { x: x - w / 2, y: y - hh / 2, width: w, height: hh, rx: 'var(--r-mark)', fill: placeholder ? 'var(--paper)' : c.pale, stroke: c.fill, 'stroke-width': 'var(--sw-struct)', 'stroke-dasharray': placeholder ? '8 6' : null, cls: 'body' }, g);
  const t = T(g, x, y, String(d), 'ts-big', { 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: c.text });
  if (edit) editable(t, edit); else computed(t, computedPath);
  g.box = { x: x - w / 2, y: y - hh / 2, w, h: hh }; g.text = t;
  return g;
}

// one thousand: a cube drawn as a front face plus a top and side plane (flat, mixed towards shade)
function thousandBlock(p, x, y, u, a = {}) {
  const g = h('g', a, p); const s = 10 * u, o = 3 * u;
  h('polygon', { points: `${x},${y + o} ${x + o},${y} ${x + o + s},${y} ${x + s},${y + o}`, fill: 'color-mix(in oklab, var(--pv-thousands) 78%, var(--paper))' }, g);
  h('polygon', { points: `${x + s},${y + o} ${x + o + s},${y} ${x + o + s},${y + s} ${x + s},${y + o + s}`, fill: 'color-mix(in oklab, var(--pv-thousands) 70%, var(--shade))' }, g);
  h('rect', { x, y: y + o, width: s, height: s, fill: 'var(--pv-thousands)', stroke: 'var(--shade)', 'stroke-opacity': .35, 'stroke-width': 'var(--sw-hair)', cls: 'body' }, g);
  for (let i = 1; i < 10; i++) { h('line', { x1: x + i * u, x2: x + i * u, y1: y + o, y2: y + o + s, stroke: 'var(--shade)', 'stroke-opacity': .2, 'stroke-width': 1 }, g); h('line', { x1: x, x2: x + s, y1: y + o + i * u, y2: y + o + i * u, stroke: 'var(--shade)', 'stroke-opacity': .2, 'stroke-width': 1 }, g); }
  return g;
}
const DIENES = {
  thousands: { kind: 'thousand', w: u => 13 * u, h: u => 13 * u },
  hundreds: { kind: 'hundred', w: u => 10 * u, h: u => 10 * u },
  tens: { kind: 'ten', w: u => u, h: u => 10 * u },
  ones: { kind: 'one', w: u => u, h: u => u },
};
/** Base-ten blocks for a whole number in place columns, highest place on the left. */
export function dienes(p, n, { x = 64, y = 140, colW = 200, u = 12, gap = 8, maxH = 480, places, sCol = {}, counts, warn } = {}) {
  const g = h('g', {}, p);
  n = Math.max(0, Math.floor(n));
  if (n > 9999) { warn && warn(`dienes: ${n} is more than 9,999 blocks can show`); n = 9999; }
  const digits = { thousands: Math.floor(n / 1000), hundreds: Math.floor(n / 100) % 10, tens: Math.floor(n / 10) % 10, ones: n % 10 };
  // counts: an unregrouped layout (e.g. {tens: 3, ones: 12} after adding ones columns); its total wins over n
  if (counts) { Object.assign(digits, { thousands: 0, hundreds: 0, tens: 0, ones: 0 }, counts); n = digits.thousands * 1000 + digits.hundreds * 100 + digits.tens * 10 + digits.ones; }
  const top = ['thousands', 'hundreds', 'tens', 'ones'].findIndex(k => digits[k] > 0);
  const use = places || ['thousands', 'hundreds', 'tens', 'ones'].filter((k, i) => k === 'ones' || (top >= 0 && i >= top));
  const cols = {}; let bottom = y;
  // slot i of a column: rods sit side by side; ones sit in rows of five, a wider gap after each ten
  const slot = (k, i) => {
    const D = DIENES[k], w = D.w(u), hh = D.h(u), cx = cols[k].x;
    if (k === 'ones') { const r = Math.floor(i / 5), c = i % 5, gx = u * .6, gy = u * .6; const rowW = 5 * w + 4 * gx; return { x: cx + (colW - rowW) / 2 + c * (w + gx), y: y + r * (hh + gy) + Math.floor(r / 2) * u, w, h: hh }; }
    const per = Math.max(1, Math.floor((colW + gap) / (w + gap))); const rowW = Math.min(per, 10) * (w + gap) - gap;
    const r = Math.floor(i / per), c = i % per;
    return { x: cx + (colW - rowW) / 2 + c * (w + gap), y: y + r * (hh + gap), w, h: hh };
  };
  const draw = (k, b, a) => k === 'thousands' ? thousandBlock(g, b.x, b.y, u, a) : baseTen(g, DIENES[k].kind, b.x, b.y, { u, a });
  use.forEach((k, ci) => {
    cols[k] = { x: x + ci * (colW + gap * 2), w: colW, count: digits[k], items: [], next: digits[k] };
    for (let i = 0; i < digits[k]; i++) {
      const b = slot(k, i); cols[k].items.push(draw(k, b, sCol[k] != null ? { s: sCol[k], cls: 'pop', delay: i * 60 } : {}));
      bottom = Math.max(bottom, b.y + b.h);
    }
  });
  if (bottom - y > maxH && warn) warn(`dienes: blocks for ${n} need ${Math.round(bottom - y)} units, more than ${maxH}`);
  function exchange(from, to, { s, ghost = true } = {}) {
    if (!cols[from] || !cols[to]) { warn && warn(`dienes: no ${!cols[from] ? from : to} column to exchange with`); return null; }
    const up = PV_EXP[to] === PV_EXP[from] + 1, down = PV_EXP[to] === PV_EXP[from] - 1;
    if (!up && !down) { warn && warn(`dienes: ${from} and ${to} are not next to each other`); return null; }
    const added = [];
    if (up) { // ten of `from` become one of `to`
      const src = cols[from].items.slice(-10); if (src.length < 10) { warn && warn(`dienes: fewer than ten ${from} to exchange`); return null; }
      const srcB = Array.from({ length: 10 }, (_, j) => slot(from, cols[from].count - 10 + j));
      const sx = Math.min(...srcB.map(b => b.x)), sy = Math.min(...srcB.map(b => b.y));
      src.forEach(el => { el.dataset.h = s; });
      if (ghost) for (const b of srcB) h('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: 'none', stroke: pvColour(from).fill, 'stroke-width': 'var(--sw-hair)', 'stroke-dasharray': '3 3', s, cls: 'quiet' }, g);
      const b = slot(to, cols[to].next++);
      const wrap = h('g', { s, cls: 'fly', vars: { '--fx': `${sx - b.x}px`, '--fy': `${sy - b.y}px` } }, g);
      added.push(draw(to, b, {})); wrap.appendChild(added[0]);
    } else { // one of `from` becomes ten of `to`
      const src = cols[from].items[cols[from].items.length - 1]; if (!src) { warn && warn(`dienes: no ${from} to exchange`); return null; }
      const sb = slot(from, cols[from].count - 1); src.dataset.h = s;
      if (ghost) h('rect', { x: sb.x, y: sb.y, width: sb.w, height: sb.h, fill: 'none', stroke: pvColour(from).fill, 'stroke-width': 'var(--sw-hair)', 'stroke-dasharray': '3 3', s, cls: 'quiet' }, g);
      for (let j = 0; j < 10; j++) {
        const b = slot(to, cols[to].next++);
        const wrap = h('g', { s, cls: 'fly', delay: j * 40, vars: { '--fx': `${sb.x - b.x}px`, '--fy': `${sb.y + j * u - b.y}px` } }, g);
        const el = draw(to, b, {}); wrap.appendChild(el); added.push(el); bottom = Math.max(bottom, b.y + b.h);
      }
    }
    return added;
  }
  return { g, cols, exchange, get bottom() { return bottom; } };
}

/* ------------------------------------------------------------------ number line */
/** Number line with equal tick spacing. Returns helpers for jumps, marks and the halfway line. */
export function numberLine(p, { from = 0, to = 10, step = 1, x0 = 112, x1 = 1168, y = 420, labels = 'all', fmt, computedPath, s, a = {}, minGap = 28 } = {}) {
  const g = h('g', Object.assign({ s }, a), p);
  const S = scale(from, to, x0, x1); const f = fmt || (v => fmtNum(v));
  const nT = Math.round((to - from) / step); const ticks = Array.from({ length: nT + 1 }, (_, i) => +(from + i * step).toFixed(10));
  h('line', { x1: x0 - 24, x2: x1 + 24, y1: y, y2: y, stroke: 'var(--axis)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g);
  for (const [xx, ang] of [[x1 + 24, 0], [x0 - 24, Math.PI]]) h('path', { d: headD(xx + Math.cos(ang) * 10, y, ang, 14), fill: 'var(--axis)' }, g);
  ticks.forEach(v => h('line', { x1: S(v), x2: S(v), y1: y - 14, y2: y + 14, stroke: 'var(--axis)', 'stroke-width': 'var(--sw-rule)' }, g));
  if (labels !== 'none') {
    // thin the labels (every 1, 2, 5, 10 … ticks, ends always kept) until neighbours keep minGap
    const ws = ticks.map(v => measure(g, f(v), 'ts-axis'));
    const fits = every => { let last = null; for (let i = 0; i <= nT; i++) { if (!(i % every === 0 || i === nT)) continue; if (last != null && S(ticks[i]) - ws[i] / 2 - (S(ticks[last]) + ws[last] / 2) < minGap) return false; last = i; } return true; };
    let every = labels === 'ends' ? nT : [1, 2, 5, 10, 20, 50, 100].find(e => fits(e)) || nT;
    for (let i = 0; i <= nT; i++) {
      if (!(i % every === 0 || i === nT)) continue;
      if (i === nT && i % every !== 0 && S(ticks[i]) - S(ticks[i - (i % every)]) < (ws[i] + ws[i - (i % every)]) / 2 + minGap) continue;
      computed(T(g, S(ticks[i]), y + 50, f(ticks[i]), 'ts-axis', { 'text-anchor': 'middle' }), computedPath);
    }
  }
  const lane = []; // jump label boxes, so stacked labels never touch
  function jump(av, bv, label, { s: js, col = 'var(--focus)', edit, computedPath: cp, below = false, lift } = {}) {
    const xa = S(av), xb = S(bv), span = Math.abs(xb - xa), dir = below ? 1 : -1;
    const hh = lift || clamp(span * .38, 34, 110); const yb = y + dir * 18, peak = yb + dir * hh;
    const jg = h('g', { s: js }, g);
    const d = `M${xa} ${yb} C ${xa} ${peak}, ${xb} ${peak}, ${xb} ${yb}`;
    h('path', { d, fill: 'none', stroke: col, 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round', cls: 'draw', pathLength: 1 }, jg);
    h('path', { d: headD(xb, yb, dir < 0 ? Math.PI / 2 : -Math.PI / 2, 14), fill: col, delay: 600, s: js }, jg);
    let lt = null;
    if (label != null && label !== '') {
      const ly = yb + dir * (hh * .75) + (below ? 34 : -12);
      lt = T(jg, (xa + xb) / 2, ly, String(label), 'ts-label halo', { 'text-anchor': 'middle', fill: col.replace(/\)$/, '-text)'), delay: 500 });
      if (edit) editable(lt, edit); else computed(lt, cp);
      const w = lt.getComputedTextLength(), box = { x: (xa + xb) / 2 - w / 2, y: ly - 26, w, h: 32 };
      if (lane.some(q => q.x < box.x + box.w + 12 && box.x < q.x + q.w + 12 && Math.abs(q.y - box.y) < 32)) { lt.setAttribute('y', ly + dir * 34); box.y += dir * 34; }
      lane.push(box);
    }
    return { g: jg, label: lt, peak };
  }
  function mark(v, { s: ms, col = 'var(--focus)', label, edit, computedPath: cp, r = 11 } = {}) {
    const mg = h('g', { s: ms, cls: 'pop' }, g);
    h('circle', { cx: S(v), cy: y, r, fill: col, stroke: 'var(--paper)', 'stroke-width': 'var(--sw-rule)' }, mg);
    if (label != null) { const t = T(mg, S(v), y + (labels === 'none' ? 50 : 92), String(label), 'ts-label halo', { 'text-anchor': 'middle', fill: col.replace(/\)$/, '-text)') }); if (edit) editable(t, edit); else computed(t, cp); }
    return mg;
  }
  function halfway(v, { s: hs, label, edit } = {}) {
    const hg = h('g', { s: hs }, g);
    h('line', { x1: S(v), x2: S(v), y1: y - 70, y2: y + 18, stroke: 'var(--compare)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '6 6' }, hg);
    if (label != null) editable(T(hg, S(v), y - 82, String(label), 'ts-small halo', { 'text-anchor': 'middle', fill: 'var(--compare-text)' }), edit);
    return hg;
  }
  return { g, S, ticks, jump, mark, halfway };
}

/* ------------------------------------------------------------------ part-whole */
/** Cherry diagram: whole above, parts below; links stop at the circle edges. */
export function partWhole(p, whole, parts, { x = 640, y = 220, r = 70, pr = 58, dy = 210, spread, s, sParts, wholeCol = 'var(--focus)', partCol = 'var(--part)', wholePath, partsPath, edit = false } = {}) {
  const g = h('g', {}, p); const n = parts.length; const sp = spread || (n === 2 ? 340 : 280);
  const W0 = { x, y, r };
  const P = parts.map((v, i) => ({ x: x + (i - (n - 1) / 2) * sp, y: y + dy, r: pr, v }));
  const tag = (t, path) => edit ? editable(t, path) : computed(t, path);
  P.forEach((q, i) => {
    const ang = Math.atan2(q.y - y, q.x - x);
    const lg = h('g', { s: sParts != null ? sParts : s }, g);
    h('line', { x1: x + Math.cos(ang) * r, y1: y + Math.sin(ang) * r, x2: q.x - Math.cos(ang) * pr, y2: q.y - Math.sin(ang) * pr, stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round', cls: 'draw', pathLength: 1 }, lg);
    const cg = h('g', { cls: 'pop', delay: 300 + i * 150 }, lg);
    h('circle', { cx: q.x, cy: q.y, r: pr, fill: `color-mix(in oklab, ${partCol} 16%, var(--paper))`, stroke: partCol, 'stroke-width': 'var(--sw-struct)', cls: 'body' }, cg);
    q.text = tag(T(cg, q.x, q.y, fmtNum(q.v), 'ts-big', { 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: partCol.replace(/\)$/, '-text)') }), partsPath ? `${partsPath}.${i}` : null);
    q.g = cg;
  });
  const wg = h('g', { s, cls: 'pop' }, g);
  h('circle', { cx: x, cy: y, r, fill: `color-mix(in oklab, ${wholeCol} 16%, var(--paper))`, stroke: wholeCol, 'stroke-width': 'var(--sw-struct)', cls: 'body' }, wg);
  W0.text = tag(T(wg, x, y, fmtNum(whole), 'ts-big', { 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: wholeCol.replace(/\)$/, '-text)') }), wholePath);
  W0.g = wg;
  return { g, whole: W0, parts: P };
}

/* ------------------------------------------------------------------ arrays and groups */
/** rows x cols of counters (or countable objects). stagger 'row' = each row its own build from s. */
export function counterGrid(p, rows, cols, { x = 400, y = 200, r = 18, gap = 14, col = 'var(--counter)', kind = 'counter', s, stagger = null, a = {} } = {}) {
  const g = h('g', a, p); const step = 2 * r + gap; const cells = [], items = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const cx = x + r + j * step, cy = y + r + i * step; cells.push([cx, cy]);
    const at = s == null ? {} : stagger === 'row' ? { s: s + i, cls: 'pop', delay: j * 50 } : stagger === 'each' ? { s: s + i * cols + j, cls: 'pop' } : { s, cls: 'pop', delay: (i * cols + j) * 30 };
    items.push(kind === 'counter' ? counter(g, cx, cy, r, col, at) : countable(g, kind, cx, cy, 2 * r, at));
  }
  return { g, cells, items, box: { x, y, w: cols * step - gap, h: rows * step - gap } };
}
/** A ring round an equal group (or a row of an array). */
export function groupRing(p, box, { pad = 10, col = 'var(--focus)', s, draw = true, a = {} } = {}) {
  return h('rect', Object.assign({ x: box.x - pad, y: box.y - pad, width: box.w + 2 * pad, height: box.h + 2 * pad, rx: Math.min(28, (box.h + 2 * pad) / 2), fill: 'none', stroke: col, 'stroke-width': 'var(--sw-struct)', s, cls: draw && s != null ? 'draw' : null, pathLength: draw && s != null ? 1 : null }, a), p);
}

/* ------------------------------------------------------------------ countable objects */
// Flat, one shaded face, drawn centred on (0,0) in a 60-unit box, scaled to `size`.
const CNT = {
  counter(g) { h('circle', { r: 26, fill: 'var(--counter)', stroke: 'var(--counter-edge)', 'stroke-width': 'var(--sw-hair)', cls: 'body' }, g); },
  apple(g) {
    h('path', { d: 'M0 -16 C -10 -24 -28 -20 -28 0 C -28 18 -14 28 0 24 C 14 28 28 18 28 0 C 28 -20 10 -24 0 -16 Z', fill: 'var(--hue-red)', cls: 'body' }, g);
    h('path', { d: 'M0 -16 C 10 -24 28 -20 28 0 C 28 18 14 28 0 24 Z', fill: 'color-mix(in oklab, var(--hue-red) 80%, var(--shade))' }, g);
    h('rect', { x: -2, y: -28, width: 4, height: 13, rx: 2, fill: 'var(--trunk)' }, g);
    h('path', { d: 'M2 -22 Q 12 -32 20 -24 Q 12 -18 2 -22 Z', fill: 'var(--leaf)' }, g);
  },
  duck(g) {
    h('ellipse', { cx: -4, cy: 10, rx: 26, ry: 16, fill: 'var(--hue-gold)', cls: 'body' }, g);
    h('ellipse', { cx: -8, cy: 8, rx: 13, ry: 7, fill: 'color-mix(in oklab, var(--hue-gold) 78%, var(--shade))' }, g);
    h('circle', { cx: 12, cy: -12, r: 13, fill: 'var(--hue-gold)', cls: 'body' }, g);
    h('path', { d: 'M23 -14 L 34 -10 L 23 -6 Z', fill: 'var(--hue-orange)' }, g);
    h('circle', { cx: 15, cy: -15, r: 2.4, fill: 'var(--ink)' }, g);
  },
  star(g) {
    const pts = Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 12 : 28; return `${(Math.cos(a) * rr).toFixed(1)},${(Math.sin(a) * rr + 2).toFixed(1)}`; });
    h('polygon', { points: pts.join(' '), fill: 'var(--hue-gold)', stroke: 'color-mix(in oklab, var(--hue-gold) 70%, var(--shade))', 'stroke-width': 'var(--sw-hair)', 'stroke-linejoin': 'round', cls: 'body' }, g);
  },
  car(g) {
    h('path', { d: 'M-28 10 L -28 -2 L -16 -6 L -8 -18 L 12 -18 L 20 -6 L 28 -2 L 28 10 Z', fill: 'var(--hue-blue)', cls: 'body' }, g);
    h('path', { d: 'M-5 -14 L 10 -14 L 15 -6 L -9 -6 Z', fill: 'var(--sky-top)' }, g);
    h('rect', { x: -28, y: 4, width: 56, height: 6, fill: 'color-mix(in oklab, var(--hue-blue) 75%, var(--shade))' }, g);
    for (const cx of [-15, 15]) h('circle', { cx, cy: 12, r: 7, fill: 'var(--ink-2)' }, g);
  },
};
export const COUNTABLES = Object.keys(CNT);
/** Which countable objects fit which topic. 'any' fits everywhere; a model picks only from these. */
export const COUNTABLE_TOPICS = { counter: ['any'], star: ['any', 'space'], apple: ['food', 'nature', 'harvest'], duck: ['animals', 'nature', 'pond'], car: ['transport', 'modern', 'town'] };
export const countablesFor = topic => COUNTABLES.filter(k => COUNTABLE_TOPICS[k].includes('any') || COUNTABLE_TOPICS[k].includes(topic));
/** One countable object centred on (x, y), about `size` units across. Build classes go on the outer group. */
export function countable(p, kind, x, y, size = 36, a = {}) {
  const outer = h('g', a, p); const g = h('g', { transform: `translate(${x} ${y}) scale(${size / 60})` }, outer); (CNT[kind] || CNT.counter)(g); return outer;
}
