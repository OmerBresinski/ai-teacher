/*
 * Drawing helpers, ported from the pilot's icons.js and kit.js (TEACH-310 part b). They emit the
 * pilot's markup unchanged: colours as `var(--slot)`, treatment as the classes `o lu hl sp sh rr
 * rr2 dt dl` and the per-element `--k`, `--w`, `--gw`. Nothing here reaches a caller as is:
 * `flatten` in treatment.ts turns all of it into literal attributes for one age, size and theme.
 */

let uid = 0;
/** A drawing-local id; `flatten` renames every id per SVG, so only uniqueness within one matters. */
export const id = (): string => `i${++uid}`;

/** Filled shape with the age outline (the outline sits outside the fill: paint-order stroke). */
export const F = (d: string, c: string, k = 1, extra = ""): string =>
  `<path d="${d}" class="o" style="fill:${c};--k:${k}" ${extra}/>`;
/** Filled shape, no outline (inner detail). */
export const P = (d: string, c: string, extra = ""): string =>
  `<path d="${d}" style="fill:${c}" ${extra}/>`;
/** A thick stroked part: an outline underlay, then the line. */
export const L = (d: string, c: string, w: number, k = 1, cap = "round"): string =>
  `<path d="${d}" class="lu" style="--w:${w}px;--k:${k};stroke-linecap:${cap}"/>` +
  `<path d="${d}" style="fill:none;stroke:${c};stroke-width:${w}px;stroke-linecap:${cap};stroke-linejoin:round"/>`;
/** Inner line (no outline). */
export const IL = (d: string, c: string, w: number, extra = ""): string =>
  `<path d="${d}" style="fill:none;stroke:${c};stroke-width:${w}px;stroke-linecap:round;stroke-linejoin:round" ${extra}/>`;
/** Gloss highlight, plus the early-age spark dot just before the stroke starts. */
export const H = (d: string, w: number): string => {
  const n = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  const x0 = n[0] ?? 0;
  const y0 = n[1] ?? 0;
  const x1 = n[2] ?? x0 + 1;
  const y1 = n[3] ?? y0;
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const sx = x0 - ((x1 - x0) / len) * w * 1.9;
  const sy = y0 - ((y1 - y0) / len) * w * 1.9;
  return `<path d="${d}" class="hl" style="--gw:${w}px"/><circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${(w * 0.62).toFixed(1)}" class="sp"/>`;
};
/** Shade: a darker shape clipped to the silhouette. */
export const SH = (sil: string, d: string, c: string): string => {
  const i = id();
  return `<clipPath id="${i}"><path d="${sil}"/></clipPath><path d="${d}" class="sh" clip-path="url(#${i})" style="fill:${c}"/>`;
};
export const C = (cx: number, cy: number, r: number, c: string, o = true, k = 1): string =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" ${o ? 'class="o"' : ""} style="fill:${c};--k:${k}"/>`;
export const E = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  c: string,
  o = true,
  extra = "",
): string =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${o ? 'class="o"' : ""} style="fill:${c}" ${extra}/>`;
export const R = (
  x: number,
  y: number,
  w: number,
  h: number,
  c: string,
  o = true,
  extra = "",
): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${o ? 'class="o"' : ""} style="fill:${c}" ${extra}/>`;
/** Rounded rect whose corner radius comes from the age (rr = full, rr2 = half). */
export const RR = (
  x: number,
  y: number,
  w: number,
  h: number,
  c: string,
  r = "rr",
  outline = true,
): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${outline ? "o " : ""}${r}" style="fill:${c}"/>`;
/** Line with an arrowhead at the end (the marker takes the same colour). */
export const AR = (d: string, c: string, w: number, outline = true): string => {
  const m = id();
  return (
    `<marker id="${m}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" style="fill:${c}"/></marker>` +
    (outline ? `<path d="${d}" class="lu" style="--w:${w}px;stroke-linecap:round"/>` : "") +
    `<path d="${d}" marker-end="url(#${m})" style="fill:none;stroke:${c};stroke-width:${w}px;stroke-linecap:round;stroke-linejoin:round"/>`
  );
};
/** Bold label text (chemical formulae and the like). */
export const TX = (x: number, y: number, s: string, size: number, c: string, sub = ""): string =>
  `<text x="${x}" y="${y}" text-anchor="middle" style="font:800 ${size}px Lexend,Arial,sans-serif;fill:${c}">${s}${sub ? `<tspan dy="${size * 0.22}" style="font-size:${size * 0.62}px">${sub}</tspan>` : ""}</text>`;
/** A pictogram figure of thick round strokes, head at (hx, hy). */
export const FIG = (hx: number, hy: number, limbs: string, c: string, w = 22): string =>
  `${L(limbs, c, w)}${C(hx, hy, w * 0.82, c)}`;
/** Clip a group to a silhouette. */
export const CLIP = (sil: string, inner: string): string => {
  const i = id();
  return `<clipPath id="${i}"><path d="${sil}"/></clipPath><g clip-path="url(#${i})">${inner}</g>`;
};
