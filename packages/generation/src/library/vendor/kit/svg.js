// Tiny SVG builder and maths helpers. Ported from the north star engine.
// Build attributes understood by h():
//   s: build index the mark appears at      hide: build index it disappears at
//   c: "k:cls" or "k-j:cls" class ranges   delay: ms inside the build (scaled by --pace)
//   cls: class list    vars: CSS custom properties    text: text content
// Any value starting var( / color-mix( / calc( is set as a style so tokens resolve live.
export const W = 1280, H = 720, SVGNS = 'http://www.w3.org/2000/svg';
const isCss = v => typeof v === 'string' && /^(var|color-mix|calc)\(/.test(v);

export function h(tag, a, p) {
  const el = document.createElementNS(SVGNS, tag);
  if (a) for (const k in a) {
    const v = a[k]; if (v == null) continue;
    if (k === 's') el.dataset.s = v;
    else if (k === 'hide') el.dataset.h = v;
    else if (k === 'c') el.dataset.c = v;
    else if (k === 'cls') el.setAttribute('class', v);
    else if (k === 'delay') el.style.setProperty('--d', `calc(${v}ms * var(--pace))`);
    else if (k === 'vars') { for (const kk in v) el.style.setProperty(kk, v[kk]); }
    else if (k === 'text') el.textContent = v;
    else if (isCss(v)) el.style.setProperty(k, v);
    else el.setAttribute(k, v);
  }
  if (p) p.appendChild(el);
  return el;
}
export const mc = (cls, a) => [cls, a && a.cls].filter(Boolean).join(' ') || null;
/** Text at x,y with a type-scale class (ts-title, ts-label, ts-small, ts-tiny, ts-num ...). */
export const T = (p, x, y, s, cls, a) => h('text', Object.assign({}, a || {}, { x, y, cls: mc(cls, a), text: s }), p);
/** Multi-line text, one tspan per line. */
export function lines(p, x, y, arr, cls, lh, a) {
  const t = h('text', Object.assign({}, a || {}, { x, y, cls: mc(cls, a) }), p);
  arr.forEach((s, i) => h('tspan', { x, dy: i ? lh : 0, text: s }, t));
  return t;
}
/** Measured width of a string in a type class, inside parent p (must be in the live DOM). */
export function measure(p, s, cls, a) {
  const t = T(p, -9999, -9999, s, cls, a); const w = t.getComputedTextLength(); t.remove(); return w;
}
/** Greedy word wrap to a measured width; returns lines. A single word wider than maxW is broken
 *  across lines at the last letter that fits, so no word ever runs past its lane. */
export function wrap(p, s, cls, maxW, a) {
  const words = String(s).split(/\s+/).filter(Boolean); const out = []; let cur = '';
  for (const w of words) {
    const tryS = cur ? cur + ' ' + w : w;
    if (measure(p, tryS, cls, a) <= maxW) { cur = tryS; continue; }
    if (cur) { out.push(cur); cur = ''; }
    if (measure(p, w, cls, a) <= maxW) { cur = w; continue; }
    const parts = breakWord(p, w, cls, maxW, a); out.push(...parts.slice(0, -1)); cur = parts[parts.length - 1];
  }
  if (cur) out.push(cur); return out;
}
/** Split one overlong word into pieces that each fit maxW (at least one letter per piece). */
export function breakWord(p, w, cls, maxW, a) {
  const out = []; let cur = '';
  for (const ch of w) { if (cur && measure(p, cur + ch, cls, a) > maxW) { out.push(cur); cur = ch; } else cur += ch; }
  if (cur) out.push(cur); return out;
}
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, u) => a + (b - a) * u;
export const eIO = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const eOut = t => 1 - Math.pow(1 - t, 3);
export function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function bez(p0, p1, p2, p3, t) { const m = 1 - t; return [m * m * m * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * p3[0], m * m * m * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * p3[1]]; }
/** Point at fraction v along a polyline. */
export function alongPts(pts, v) {
  let L = 0; const seg = [];
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); L += d; }
  let t = clamp(v) * L;
  for (let i = 0; i < seg.length; i++) { if (t <= seg[i] || i === seg.length - 1) { const u = seg[i] ? clamp(t / seg[i]) : 1; return [lerp(pts[i][0], pts[i + 1][0], u), lerp(pts[i][1], pts[i + 1][1], u)]; } t -= seg[i]; }
  return pts[pts.length - 1];
}
/** Axis-aligned box overlap with padding. Boxes are {x,y,w,h}. */
export const overlaps = (a, b, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
/** Format an integer with thousands separators (England: 10,000; years of 4 digits stay 2019). */
export const fmtInt = (n, isYear) => (isYear && Math.abs(n) < 10000) ? String(n) : Math.round(n).toLocaleString('en-GB');
