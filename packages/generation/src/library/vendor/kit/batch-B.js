// Batch B kit parts: measures and fractions. Shared by fractions, bar_model, measuring_scales,
// clock_time, coins_money and area_perimeter. Tokens only (colours are meaning tokens or
// color-mix of the theme hues), all words are real SVG text marked editable or computed.
// No scenery objects here, so no culture tags are needed.
//
// Exports and params
//   fracText(p, x, y, n, d, {col, a, computed, edit})            stacked numerals; y = the fraction line
//   fracShape(p, shape, n, d, {x, y, w, h, size, gap, grid, fill, a, base, shade, split, maxWholes})
//       shape 'circle' | 'rectangle' | 'bar'; d equal parts; n > d draws ceil(n/d) wholes side by side.
//       base/split/shade are build attrs for: the empty wholes, the dividing lines, the shaded parts
//       (shade may be a function i => attrs to stagger parts). Returns {g, wholes[], box, centre(i)}.
//   fracWall(p, denominators, {x, y, w, rowH, gap, shade: {d: n}, a, rowA: i => attrs, computedPath, warn})
//       one row per denominator, every row the same whole; returns {g, rows[{d, y, cellW}], box}.
//   gauge(p, kind, {x, y, len, min, max, step, value, labelEvery, unit, width, r, fmt, a, readA,
//                   computedPath, unitEdit, warn})
//       kind 'ruler' | 'jug' | 'dial' | 'thermometer'. Ticks at every step, labels at labelEvery
//       (auto-chosen so labels never touch). Ruler zero sits inset from the end, at the mark.
//       Returns {g, S(v), at(v) -> [x, y], needle(v), labelEvery, tickPx, box}. needle(v) moves the
//       reading (liquid, pointer or bar) at once, so a model's tick(k, u) animates it in real time.
//   clockFace(p, h, m, {cx, cy, r, ring, a, handA, hourA, minA, computedPath})
//       analogue face; the hour hand drifts with the minutes. ring = five-minute ring outside.
//       Returns {g, set(h, m), angles(h, m) -> {hour, minute}}.
//   digitalTime(p, x, y, h, m, {h24, anchor, a, computedPath})    digital readout card, centred on x
//   timeWords(h, m)                                               'quarter to 4', 'half past 3' (en-GB)
//   coin(p, kind, locale, {x, y, mm, a, computedPath})
//       generic coin: the locale's real shape outline (circle, 7- or 12-sided) and tone, value as
//       text. Never a real coin's design. kind = value in minor units (GB 1..200). Returns g (g.r).
//   locale(code)  'GB' (default) | 'IN' | 'US' | 'EU' -> {code, symbol, minor, coins, notes,
//       units{length, mass, capacity, temperature, force}, money(minor), coinsFor(minor)}
//   LOCALES, INSTRUMENT_UNITS {ruler, tape, jug, dial, thermometer, force}, greedyCoins(amount, denoms)
import { h, T, measure, clamp } from './svg.js';
import { editable, computed } from './components.js';

const NEG = '−';
/** Number format: up to 2 decimals, true minus sign, en-GB grouping. */
export const fmtNum = v => { const s = (+v.toFixed(2)).toLocaleString('en-GB', { maximumFractionDigits: 2 }); return s.replace('-', NEG); };
const near = (a, b) => Math.abs(a - b) < 1e-6;
const isMult = (v, m) => near(v / m, Math.round(v / m));

/* ------------------------------------------------------------------ fractions */
export function fracText(p, x, y, n, d, { col = 'var(--ink)', a = {}, computed: cp, edit } = {}) {
  const g = h('g', a, p);
  const tn = T(g, x, y - 9, String(n), 'ts-frac', { 'text-anchor': 'middle', fill: col });
  const td = T(g, x, y + 31, String(d), 'ts-frac', { 'text-anchor': 'middle', fill: col });
  const w = Math.max(30, measure(g, String(n), 'ts-frac'), measure(g, String(d), 'ts-frac')) + 6;
  h('line', { x1: x - w / 2, x2: x + w / 2, y1: y, y2: y, stroke: col, 'stroke-width': 'var(--sw-struct)', 'stroke-linecap': 'round' }, g);
  for (const t of [tn, td]) { if (cp) computed(t, cp); else editable(t, edit); }
  g.box = { x: x - w / 2, y: y - 36, w, h: 74 };
  return g;
}

const sectorD = (cx, cy, r, a0, a1) => {
  const P = a => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  return `M${cx} ${cy} L${P(a0)} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${P(a1)} Z`;
};

export function fracShape(p, shape, n, d, o = {}) {
  d = Math.max(1, Math.round(d)); n = Math.max(0, Math.round(n));
  const isC = shape === 'circle', isBar = shape === 'bar';
  const w = o.w || (isC ? (o.size || 240) : isBar ? 640 : 320), hh = o.h || (isC ? w : isBar ? 80 : 220);
  const gap = o.gap ?? 40, fill = o.fill || 'var(--part)';
  const nW = clamp(Math.max(1, Math.ceil(n / d)), 1, o.maxWholes || 4);
  const x0 = o.x ?? 0, y0 = o.y ?? 0;
  const g = h('g', o.a || {}, p);
  const gBase = h('g', o.base || {}, g), gShade = h('g', typeof o.shade === 'function' ? {} : (o.shade || {}), g);
  const gSplit = h('g', o.split || {}, g), gRim = h('g', o.base || {}, g);
  const [gr, gc] = !isC && !isBar && o.grid && o.grid[0] * o.grid[1] === d ? o.grid : [1, d];
  const wholes = [], cells = [];
  for (let k = 0; k < nW; k++) {
    const x = x0 + k * (w + gap), box = { x, y: y0, w, h: hh, cx: x + w / 2, cy: y0 + hh / 2 }; wholes.push(box);
    const r = w / 2, rim = { fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)' };
    if (isC) { h('circle', { cx: box.cx, cy: box.cy, r, fill: 'var(--paper)', cls: 'body' }, gBase); h('circle', Object.assign({ cx: box.cx, cy: box.cy, r }, rim), gRim); }
    else { h('rect', { x, y: y0, width: w, height: hh, rx: 'var(--r-mark)', fill: 'var(--paper)', cls: 'body' }, gBase); h('rect', Object.assign({ x, y: y0, width: w, height: hh, rx: 'var(--r-mark)' }, rim), gRim); }
    for (let i = 0; i < d; i++) {
      const idx = k * d + i; let el, cen;
      if (isC) {
        const a0 = -Math.PI / 2 + i * 2 * Math.PI / d, a1 = a0 + 2 * Math.PI / d, am = (a0 + a1) / 2;
        cen = d === 1 ? [box.cx, box.cy] : [box.cx + r * .6 * Math.cos(am), box.cy + r * .6 * Math.sin(am)];
        if (idx < n) el = d === 1 ? h('circle', { cx: box.cx, cy: box.cy, r }) : h('path', { d: sectorD(box.cx, box.cy, r, a0, a1) });
        if (d > 1) h('line', { x1: box.cx, y1: box.cy, x2: box.cx + r * Math.cos(a0), y2: box.cy + r * Math.sin(a0), stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)' }, gSplit);
      } else {
        const ri = Math.floor(i / gc), ci = i % gc, cw = w / gc, ch = hh / gr;
        cen = [x + (ci + .5) * cw, y0 + (ri + .5) * ch];
        if (idx < n) el = h('rect', { x: x + ci * cw, y: y0 + ri * ch, width: cw, height: ch });
      }
      if (el) { const host = typeof o.shade === 'function' ? h('g', o.shade(idx) || {}, gShade) : gShade; el.style.setProperty('fill', fill); host.appendChild(el); }
      cells.push(cen);
    }
    if (!isC) {
      for (let c = 1; c < gc; c++) h('line', { x1: x + c * w / gc, x2: x + c * w / gc, y1: y0, y2: y0 + hh, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)' }, gSplit);
      for (let rr = 1; rr < gr; rr++) h('line', { x1: x, x2: x + w, y1: y0 + rr * hh / gr, y2: y0 + rr * hh / gr, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-rule)' }, gSplit);
    }
  }
  const box = { x: x0, y: y0, w: nW * w + (nW - 1) * gap, h: hh };
  return { g, wholes, box, centre: i => cells[i], shaded: Math.min(n, nW * d), clipped: Math.ceil(n / d) > nW };
}

export function fracWall(p, denominators, o = {}) {
  const x = o.x ?? 160, y = o.y ?? 140, w = o.w || 960, rowH = o.rowH || 76, gap = o.gap ?? 8;
  const g = h('g', o.a || {}, p), rows = [];
  denominators.forEach((d, i) => {
    const ry = y + i * (rowH + gap), cw = w / d, shadeN = (o.shade && o.shade[d]) || 0;
    const rg = h('g', o.rowA ? o.rowA(i, d) || {} : {}, g);
    for (let j = 0; j < d; j++) {
      const on = j < shadeN;
      h('rect', { x: x + j * cw, y: ry, width: cw, height: rowH, fill: on ? 'var(--part-pale)' : 'var(--paper)', stroke: on ? 'var(--part)' : 'var(--ink-3)', 'stroke-width': on ? 'var(--sw-struct)' : 'var(--sw-rule)', cls: 'body' }, rg);
    }
    const fits = cw >= 52 && rowH >= 72;
    if (fits) for (let j = 0; j < d; j++) fracText(rg, x + (j + .5) * cw, ry + rowH / 2 - 2, 1, d, { col: j < shadeN ? 'var(--part-text)' : 'var(--ink)', computed: o.computedPath });
    else if (rowH >= 72 && x >= 60) fracText(rg, x - 36, ry + rowH / 2 - 2, 1, d, { computed: o.computedPath });
    else if (o.warn) o.warn(`fracWall: no room for the 1/${d} label; use rowH of at least 72`);
    rows.push({ d, y: ry, cellW: cw, inside: fits });
  });
  return { g, rows, box: { x, y, w, h: denominators.length * (rowH + gap) - gap } };
}

/* ------------------------------------------------------------------ gauges */
const LABEL_MULTS = [1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
function chooseLabelEvery(p, o, pxPerUnit, minGapPx) {
  const { min, max, step } = o, fmt = o.fmt || fmtNum;
  for (const m of LABEL_MULTS) {
    const L = step * m; if (!isMult(max - min, L) || !isMult(min, L)) continue;
    const wMax = Math.max(measure(p, fmt(min), 'ts-axis'), measure(p, fmt(max), 'ts-axis'));
    if (L * pxPerUnit >= (minGapPx ?? wMax + 28)) return L;
  }
  return null;
}

export function gauge(p, kind, o = {}) {
  const min = o.min ?? 0, max = o.max ?? 10, step = o.step || 1, fmt = o.fmt || fmtNum;
  const g = h('g', o.a || {}, p), warn = o.warn || (() => {});
  const nT = Math.round((max - min) / step);
  if (!(max > min) || !near(nT * step, max - min)) warn(`gauge: step ${step} does not divide ${min}–${max}`);
  const vals = Array.from({ length: nT + 1 }, (_, i) => +(min + i * step).toFixed(10));
  const tickLabel = (el, v) => computed(el, o.computedPath);
  let S, at, needle, box, LE, tickPx;
  const tierOf = v => isMult(v - min, LE) ? 2 : (isMult(LE / 2, step) && isMult(v - min, LE / 2)) ? 1 : 0;

  if (kind === 'ruler') {
    const x = o.x ?? 120, y = o.y ?? 360, len = o.len || 1000, pad = 28, bh = 100;
    S = v => x + pad + (v - min) / (max - min) * len; tickPx = len / nT;
    LE = o.labelEvery || chooseLabelEvery(g, { min, max, step, fmt }, len / (max - min)) || (max - min);
    h('rect', { x, y, width: len + 2 * pad, height: bh, rx: 'var(--r-mark)', fill: 'var(--paper)', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)', cls: 'lift body' }, g);
    const lt = [14, 24, 36];
    for (const v of vals) { const t = tierOf(v), xx = S(v); h('line', { x1: xx, x2: xx, y1: y, y2: y + lt[t], stroke: 'var(--axis)', 'stroke-width': t ? 'var(--sw-rule)' : 'var(--sw-hair)' }, g); if (t === 2) tickLabel(T(g, xx, y + 66, fmt(v), 'ts-axis', { 'text-anchor': 'middle' }), v); }
    if (o.unit) editable(T(g, x + pad + len + pad - 10, y + bh - 10, o.unit, 'ts-tiny', { 'text-anchor': 'end', cls: 'muted' }), o.unitEdit);
    const rd = h('g', o.readA || {}, g);
    const bar = h('rect', { x: S(min), y: y - 52, width: 0, height: 36, rx: 'var(--r-mark)', fill: 'var(--compare)', cls: 'body' }, rd);
    const ln = h('line', { y1: y - 16, y2: y + lt[2], stroke: 'var(--focus)', 'stroke-width': 'var(--sw-lead)', 'stroke-dasharray': '6 5' }, rd);
    needle = v => { const xx = S(clamp(v, min, max)); bar.setAttribute('width', Math.max(0, xx - S(min))); ln.setAttribute('x1', xx); ln.setAttribute('x2', xx); };
    at = v => [S(v), y]; box = { x, y: y - 52, w: len + 2 * pad, h: bh + 52 };
  } else if (kind === 'jug' || kind === 'thermometer') {
    const isJ = kind === 'jug', x = o.x ?? 480, y = o.y ?? 150, len = o.len || 400;
    const bw = isJ ? (o.width || 220) : 30, top = isJ ? 40 : 24, bot = isJ ? 20 : 0;
    const yb = y + top + len; S = v => yb - (v - min) / (max - min) * len; tickPx = len / nT;
    LE = o.labelEvery || chooseLabelEvery(g, { min, max, step, fmt }, len / (max - min), 34) || (max - min);
    const rx = x + bw; // scale on the right edge, labels outside
    const liquid = isJ ? 'var(--water-hi)' : 'var(--heat)';
    if (isJ) {
      h('path', { d: `M${x} ${y + 30} C${x - 70} ${y + 40} ${x - 70} ${y + 190} ${x} ${y + 200}`, fill: 'none', stroke: 'var(--glass-edge)', 'stroke-width': 'calc(var(--sw-struct) * 4)', 'stroke-linecap': 'round' }, g);
      h('path', { d: `M${x - 26} ${y} L${x} ${y + 24} V${yb + bot} H${x + bw} V${y} Z`, fill: 'var(--air)', cls: 'body' }, g);
    } else {
      h('circle', { cx: x + bw / 2, cy: yb + 36, r: 32, fill: 'var(--paper)', cls: 'body' }, g);
      h('rect', { x, y, width: bw, height: top + len + 20, rx: bw / 2, fill: 'var(--paper)', cls: 'body' }, g);
    }
    const lq = h('g', o.readA || {}, g);
    const pad = isJ ? 0 : 8;
    if (!isJ) h('circle', { cx: x + bw / 2, cy: yb + 36, r: 24, fill: liquid }, lq);
    const col = h('rect', { x: x + pad, width: bw - 2 * pad, fill: liquid }, lq);
    const surf = isJ ? h('line', { x1: x, x2: x + bw, stroke: 'var(--water)', 'stroke-width': 'var(--sw-struct)' }, lq) : null;
    const lt = [12, 20, 30];
    for (const v of vals) { const t = tierOf(v), yy = S(v); h('line', { x1: rx - lt[t], x2: rx, y1: yy, y2: yy, stroke: 'var(--axis)', 'stroke-width': t ? 'var(--sw-rule)' : 'var(--sw-hair)' }, g); if (t === 2) tickLabel(T(g, rx + 14, yy + 8, fmt(v), 'ts-axis', { 'text-anchor': 'start' }), v); }
    // outline last so liquid never covers the wall
    if (isJ) h('path', { d: `M${x - 26} ${y} L${x} ${y + 24} V${yb + bot} H${x + bw} V${y}`, fill: 'none', stroke: 'var(--glass-edge)', 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round' }, g);
    else { h('rect', { x, y, width: bw, height: top + len + 20, rx: bw / 2, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)' }, g); h('circle', { cx: x + bw / 2, cy: yb + 36, r: 32, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)' }, g); }
    if (o.unit) editable(T(g, rx + 14, y + (isJ ? 10 : -14), o.unit, 'ts-small', { 'text-anchor': 'start' }), o.unitEdit);
    const ybase = isJ ? yb + bot : yb + 36;
    needle = v => { const yy = S(clamp(v, min, max)); col.setAttribute('y', yy); col.setAttribute('height', Math.max(0, ybase - yy)); if (surf) { surf.setAttribute('y1', yy); surf.setAttribute('y2', yy); } };
    at = v => [rx, S(v)]; box = { x: x - (isJ ? 70 : 2), y: y - 14, w: bw + (isJ ? 70 : 2) + 90, h: top + len + (isJ ? bot : 72) + 14 };
  } else { // dial (kitchen scale): 0 at the top, clockwise through 300 degrees
    const cx = o.x ?? 640, cy = o.y ?? 400, r = o.r || 190, sweep = 300 * Math.PI / 180, a0 = -Math.PI / 2;
    const A = v => a0 + (v - min) / (max - min) * sweep; S = A; tickPx = r * sweep / nT;
    LE = o.labelEvery || chooseLabelEvery(g, { min, max, step, fmt }, (r - 60) * sweep / (max - min)) || (max - min);
    h('rect', { x: cx - r - 30, y: cy - r - 64, width: 2 * r + 60, height: 28, rx: 'var(--r-mark)', fill: 'var(--metal)', cls: 'body' }, g);
    h('rect', { x: cx - 24, y: cy - r - 36, width: 48, height: 30, fill: 'var(--metal-shade)' }, g);
    h('rect', { x: cx - r - 24, y: cy - r - 10, width: 2 * r + 48, height: 2 * r + 40, rx: 'var(--r-card)', fill: 'var(--metal)', cls: 'body' }, g);
    h('circle', { cx, cy, r, fill: 'var(--paper)', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)' }, g);
    const rd = h('g', o.readA || {}, g), arm = h('g', {}, rd);
    h('line', { x1: cx, y1: cy + 26, x2: cx, y2: cy - r + 14, stroke: 'var(--heat)', 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round' }, arm);
    h('circle', { cx, cy, r: 12, fill: 'var(--ink-2)' }, rd);
    const lt = [12, 20, 30];
    for (const v of vals) { const t = tierOf(v), a = A(v), c = Math.cos(a), s = Math.sin(a); h('line', { x1: cx + (r - 8) * c, y1: cy + (r - 8) * s, x2: cx + (r - 8 - lt[t]) * c, y2: cy + (r - 8 - lt[t]) * s, stroke: 'var(--axis)', 'stroke-width': t ? 'var(--sw-rule)' : 'var(--sw-hair)' }, g); if (t === 2) tickLabel(T(g, cx + (r - 66) * c, cy + (r - 66) * s + 8, fmt(v), 'ts-axis', { 'text-anchor': 'middle', cls: 'halo-paper' }), v); }
    if (o.unit) editable(T(g, cx, cy + (r - 66) * .5 + 8, o.unit, 'ts-small', { 'text-anchor': 'middle', cls: 'halo-paper' }), o.unitEdit);
    needle = v => arm.setAttribute('transform', `rotate(${((A(clamp(v, min, max)) - a0) * 180 / Math.PI).toFixed(2)} ${cx} ${cy})`);
    at = v => { const a = A(v); return [cx + (r - 8) * Math.cos(a), cy + (r - 8) * Math.sin(a)]; };
    box = { x: cx - r - 30, y: cy - r - 64, w: 2 * r + 60, h: 2 * r + 94 };
  }
  if (tickPx < 5) warn(`gauge: ticks only ${tickPx.toFixed(1)} units apart; use a bigger interval`);
  if (!o.labelEvery && !isMult(LE, step)) warn('gauge: no label spacing fits');
  needle(o.value ?? min);
  return { g, S, at, needle, labelEvery: LE, tickPx, box };
}

/* ------------------------------------------------------------------ clocks */
export function clockFace(p, hr, mn, o = {}) {
  const cx = o.cx ?? 640, cy = o.cy ?? 390, r = o.r || 200;
  const g = h('g', o.a || {}, p);
  h('circle', { cx, cy, r, fill: 'var(--paper)', cls: 'lift body' }, g);
  h('circle', { cx, cy, r, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 'calc(var(--sw-struct) * 2)' }, g);
  for (let i = 0; i < 60; i++) {
    const a = i * Math.PI / 30 - Math.PI / 2, big = i % 5 === 0, l = big ? 22 : 10;
    h('line', { x1: cx + (r - 10) * Math.cos(a), y1: cy + (r - 10) * Math.sin(a), x2: cx + (r - 10 - l) * Math.cos(a), y2: cy + (r - 10 - l) * Math.sin(a), stroke: big ? 'var(--ink-2)' : 'var(--ink-3)', 'stroke-width': big ? 'var(--sw-struct)' : 'var(--sw-hair)' }, g);
  }
  const hg = h('g', o.handA || {}, g);
  const hand = (len, w, col, attrs) => { const outer = h('g', attrs || {}, hg), inner = h('g', {}, outer); h('line', { x1: cx, y1: cy + len * .14, x2: cx, y2: cy - len, stroke: col, 'stroke-width': w, 'stroke-linecap': 'round' }, inner); return inner; };
  const hourH = hand(r * .5, 'calc(var(--sw-data) * 1.8)', 'var(--ink)', o.hourA);
  const minH = hand(r * .8, 'var(--sw-data)', 'var(--focus)', o.minA);
  h('circle', { cx, cy, r: 10, fill: 'var(--ink)' }, hg);
  const numR = r - 58, ncls = r >= 160 ? 'ts-label' : 'ts-small';
  for (let i = 1; i <= 12; i++) { const a = i * Math.PI / 6 - Math.PI / 2; computed(T(g, cx + numR * Math.cos(a), cy + numR * Math.sin(a) + 10, String(i), ncls, { 'text-anchor': 'middle', cls: 'halo-paper' }), o.computedPath); }
  if (o.ring) {
    const rg = h('g', o.ringA || {}, g);
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6 - Math.PI / 2; computed(T(rg, cx + (r + 34) * Math.cos(a), cy + (r + 34) * Math.sin(a) + 8, String(i * 5), 'ts-axis', { 'text-anchor': 'middle', cls: 'muted' }), o.computedPath); }
  }
  const angles = (H, M) => ({ hour: ((H % 12) + M / 60) * 30, minute: M * 6 });
  const set = (H, M) => { const A = angles(H, M); hourH.setAttribute('transform', `rotate(${A.hour} ${cx} ${cy})`); minH.setAttribute('transform', `rotate(${A.minute} ${cx} ${cy})`); };
  set(hr, mn);
  return { g, set, angles, hour: hourH, minute: minH, box: { x: cx - r - (o.ring ? 56 : 0), y: cy - r - (o.ring ? 56 : 0), w: 2 * r + (o.ring ? 112 : 0), h: 2 * r + (o.ring ? 112 : 0) } };
}

export function digitalTime(p, x, y, hr, mn, { h24 = true, a = {}, computedPath } = {}) {
  const g = h('g', a, p);
  const H = h24 ? String(hr % 24).padStart(2, '0') : String(((hr + 11) % 12) + 1);
  const s = `${H}:${String(mn).padStart(2, '0')}${h24 ? '' : (hr % 24 < 12 ? ' am' : ' pm')}`;
  const t = T(g, x, y, s, 'ts-big', { 'text-anchor': 'middle' }); computed(t, computedPath);
  const w = t.getComputedTextLength() + 56;
  g.insertBefore(h('rect', { x: x - w / 2, y: y - 56, width: w, height: 76, rx: 'var(--r-card)', fill: 'var(--paper)', stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)', cls: 'lift' }), t);
  g.box = { x: x - w / 2, y: y - 56, w, h: 76 }; g.text = s;
  return g;
}

export function timeWords(hr, mn) {
  const n = i => ((i + 11) % 12) + 1, H = n(hr % 12 || 12), N = n((hr + 1) % 12 || 12);
  if (mn === 0) return `${H} o'clock`;
  if (mn === 15) return `quarter past ${H}`;
  if (mn === 30) return `half past ${H}`;
  if (mn === 45) return `quarter to ${N}`;
  if (mn < 30) return `${mn} minute${mn === 1 ? '' : 's'} past ${H}`;
  const k = 60 - mn; return `${k} minute${k === 1 ? '' : 's'} to ${N}`;
}

/* ------------------------------------------------------------------ money and locale */
const TONE = {
  copper: 'color-mix(in oklab,var(--hue-brown) 60%,var(--hue-orange))',
  silver: 'color-mix(in oklab,var(--hue-grey) 45%,var(--cloud))',
  gold: 'color-mix(in oklab,var(--hue-gold) 75%,var(--cloud))',
};
// Real diameters (mm), outline shape and tone per denomination (minor units). Shape and tone
// only: never a coin's design. bi = [ring tone, centre tone] for bimetallic coins.
export const LOCALES = {
  GB: { code: 'GB', symbol: '£', minor: 'p', minorPerMajor: 100,
    coins: { 1: [20.3, 0, 'copper'], 2: [25.9, 0, 'copper'], 5: [18, 0, 'silver'], 10: [24.5, 0, 'silver'], 20: [21.4, 7, 'silver'], 50: [27.3, 7, 'silver'], 100: [23.4, 12, 'gold', ['gold', 'silver']], 200: [28.4, 0, 'gold', ['gold', 'silver']] },
    notes: [500, 1000, 2000, 5000],
    units: { length: ['mm', 'cm', 'm', 'km'], mass: ['g', 'kg'], capacity: ['ml', 'l'], temperature: ['°C'], force: ['N'] } },
  IN: { code: 'IN', symbol: '₹', minor: null, minorPerMajor: 100,
    coins: { 100: [21.9, 0, 'silver'], 200: [23, 0, 'silver'], 500: [25, 0, 'silver'], 1000: [27, 0, 'gold', ['gold', 'silver']], 2000: [27, 12, 'gold', ['gold', 'silver']] },
    notes: [1000, 2000, 5000, 10000, 20000, 50000],
    units: { length: ['mm', 'cm', 'm', 'km'], mass: ['g', 'kg'], capacity: ['ml', 'l'], temperature: ['°C'], force: ['N'] } },
  US: { code: 'US', symbol: '$', minor: '¢', minorPerMajor: 100,
    coins: { 1: [19.05, 0, 'copper'], 5: [21.21, 0, 'silver'], 10: [17.91, 0, 'silver'], 25: [24.26, 0, 'silver'] },
    notes: [100, 500, 1000, 2000],
    units: { length: ['in', 'ft', 'yd', 'cm', 'm'], mass: ['oz', 'lb', 'g', 'kg'], capacity: ['fl oz', 'cup', 'ml', 'l'], temperature: ['°F', '°C'], force: ['N'] } },
  EU: { code: 'EU', symbol: '€', minor: 'c', minorPerMajor: 100,
    coins: { 1: [16.25, 0, 'copper'], 2: [18.75, 0, 'copper'], 5: [21.25, 0, 'copper'], 10: [19.75, 0, 'gold'], 20: [22.25, 0, 'gold'], 50: [24.25, 0, 'gold'], 100: [23.25, 0, 'silver', ['gold', 'silver']], 200: [25.75, 0, 'silver', ['silver', 'gold']] },
    notes: [500, 1000, 2000, 5000],
    units: { length: ['mm', 'cm', 'm', 'km'], mass: ['g', 'kg'], capacity: ['ml', 'l'], temperature: ['°C'], force: ['N'] } },
};
/** Which unit family each instrument reads (truth rule: no grams on a jug). */
export const INSTRUMENT_UNITS = { ruler: 'length', tape: 'length', jug: 'capacity', dial: 'mass', scale: 'mass', thermometer: 'temperature', force: 'force' };
/** Greedy coin choice, largest first (the fewest coins for GB, IN, US and EU sets). */
export function greedyCoins(amount, denoms) {
  const out = []; let left = Math.round(amount);
  for (const d of [...denoms].sort((a, b) => b - a)) while (left >= d) { out.push(d); left -= d; }
  return left ? null : out;
}
export function locale(code = 'GB') {
  const L = LOCALES[code] || LOCALES.GB;
  const money = m => {
    m = Math.round(m); const neg = m < 0 ? NEG : ''; m = Math.abs(m);
    if (L.minor && m < L.minorPerMajor) return `${neg}${m}${L.minor}`;
    const maj = m / L.minorPerMajor; return `${neg}${L.symbol}${m % L.minorPerMajor ? maj.toFixed(2) : maj.toLocaleString('en-GB')}`;
  };
  const coins = Object.keys(L.coins).map(Number);
  return Object.assign({}, L, { coinList: coins, money, coinsFor: m => greedyCoins(m, coins), unitsFor: inst => L.units[INSTRUMENT_UNITS[inst]] || [] });
}

const polyD = (cx, cy, r, n) => 'M' + Array.from({ length: n }, (_, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`; }).join(' L') + ' Z';
export function coin(p, kind, loc = 'GB', { x = 0, y = 0, mm = 3.2, a = {}, computedPath } = {}) {
  const L = typeof loc === 'string' ? locale(loc) : loc; const spec = L.coins[kind];
  const g = h('g', a, p);
  if (!spec) { g.r = 0; g.invalid = true; return g; }
  const [dia, sides, tone, bi] = spec, r = dia * mm / 2;
  const shapeEl = (rr, fill, extra = {}) => h(sides ? 'path' : 'circle', Object.assign(sides ? { d: polyD(x, y, rr, sides) } : { cx: x, cy: y, r: rr }, { fill }, extra), g);
  const edge = c => `color-mix(in oklab,${c} 62%,var(--shade))`;
  shapeEl(r, TONE[bi ? bi[0] : tone], { stroke: edge(TONE[bi ? bi[0] : tone]), 'stroke-width': 'var(--sw-rule)', cls: 'body' });
  if (bi) h('circle', { cx: x, cy: y, r: r * .7, fill: TONE[bi[1]] }, g);
  h('circle', { cx: x, cy: y, r: r * (bi ? .7 : .84), fill: 'none', stroke: edge(TONE[bi ? bi[1] : tone]), 'stroke-width': 'var(--sw-hair)', 'stroke-opacity': .7 }, g);
  const label = L.money(kind), cls = r >= 44 ? 'ts-label' : r >= 34 ? 'ts-small' : 'ts-tiny';
  const t = T(g, x, y + (cls === 'ts-label' ? 10 : 8), label, cls, { 'text-anchor': 'middle', fill: 'var(--on-gold)', 'font-weight': 'var(--w-strong)' });
  t.style.setProperty('fill', 'var(--on-gold)'); computed(t, computedPath);
  g.r = r; g.label = label; g.box = { x: x - r, y: y - r, w: 2 * r, h: 2 * r };
  return g;
}
