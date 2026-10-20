/*
 * Glyph centring (Greg, 20 Oct 2026: "icons and letters inside circles … are often not properly
 * centred"). A badge's numeral or letter was centred on its line box, which centres the font's
 * ascent-to-descent band, not the ink: a font whose ascent and descent are asymmetric (Baloo 2,
 * Andika, Literata) sat the glyph high or low. A line box taller than the badge (line height 1.5
 * plus 12pt of padding in a 32pt disc) was worse: `safe center` falls back to the top when the
 * content overflows, so the numeral dropped by several pixels.
 *
 * The rule, for every render path: a badge glyph is centred on its line box with no padding and
 * line height 1, then moved by `glyphShiftY`, which puts the middle of the cap height (digits,
 * capitals, `?`) or of the x-height (lower case only, "vs") on the shape's centre. Icons and the
 * drawn tick and cross are centred on their own geometry (`tickPolygon`, `crossPolygon`).
 */
import { FONT_STACKS, type FontKey } from "./fonts";

/**
 * Vertical metrics per family in thousandths of an em, at weight 700 (badges are bold): the line
 * box's ascent and descent (what CSS and canvas use, Chromium `fontBoundingBox*`), and the ink
 * height of "H" (cap) and "x". Measured in Chromium from the self-hosted @fontsource files
 * (`measureText` on a 1000px font, 20 Oct 2026); re-measure when a family is added or changed.
 */
export const FONT_V_METRICS: Record<FontKey, readonly [number, number, number, number]> = {
  lexend: [1000, 250, 700, 531],
  gabarito: [940, 260, 681, 489],
  figtree: [950, 250, 701, 500],
  sourceSerif: [1036, 335, 657, 499],
  schibsted: [977, 258, 703, 527],
  literata: [1177, 308, 701, 512],
  publicSans: [950, 225, 723, 517],
  bricolage: [930, 270, 660, 525],
  instrumentSans: [970, 250, 720, 510],
  atkinson: [984, 316, 668, 496],
  fredoka: [974, 236, 691, 511],
  playpen: [1170, 340, 782, 557],
  baloo: [1078, 524, 616, 487],
  nunito: [1011, 353, 713, 497],
  outfit: [1000, 260, 706, 486],
  geist: [1005, 295, 710, 536],
  andika: [1221, 391, 713, 498],
};

const KEY_BY_STACK = new Map<string, FontKey>(
  (Object.entries(FONT_STACKS) as [FontKey, string][]).map(([k, s]) => [s, k]),
);

/** The family a theme stack names, or null for a stack outside the catalogue. */
export function fontKeyOf(stack: string): FontKey | null {
  return KEY_BY_STACK.get(stack) ?? null;
}

/** The largest side of a badge, in slide units (hinge keys are 43, "vs" discs 56, numerals 28-40). */
export const BADGE_MAX = 72;

/**
 * True for a shape that is a badge: small and near square. A teacher's own "OK" or "42" box is
 * larger and keeps the line-box layout every text box uses; only a badge's glyph is re-centred.
 */
export function isBadgeBox(w: number, h: number): boolean {
  const big = Math.max(w, h);
  return big > 0 && big <= BADGE_MAX && Math.min(w, h) / big >= 0.6;
}

/**
 * True for a badge glyph: one to three characters on one line (a numeral, a letter, "?", "vs",
 * "10"). Longer labels are words and keep the line-box centring every text box uses.
 */
export function isBadgeGlyph(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && [...t].length <= 3 && !/\s/.test(t);
}

/**
 * How far to move a badge glyph's line box, in the units of `fontSize` (positive is down), so
 * the glyph's cap height (or x-height, for lower case only) is centred where the line box's
 * middle was. 0 for a family outside the catalogue.
 */
export function glyphShiftY(text: string, fontStack: string, fontSize: number): number {
  const key = fontKeyOf(fontStack);
  if (!key) return 0;
  const [ascent, descent, cap, x] = FONT_V_METRICS[key];
  const band = CAP_BAND.test(text) ? cap : x;
  // From the line box's middle, the band's middle sits (ascent - descent - band) / 2 em lower.
  return -((ascent - descent - band) / 2000) * fontSize;
}

/** Text centred on the cap height: any capital, digit or tall mark; lower case only takes the x-height. */
export const CAP_BAND = /[\p{Lu}\p{N}?!#%&@]/u;

type Pt = readonly [number, number];

/** Moves `pts` so their bounding box is centred on (c, c). */
function centreOn(pts: Pt[], c: number): Pt[] {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const dx = c - (Math.min(...xs) + Math.max(...xs)) / 2;
  const dy = c - (Math.min(...ys) + Math.max(...ys)) / 2;
  return pts.map(([x, y]) => [x + dx, y + dy] as const);
}

/**
 * The cross (✕) as one filled outline in a 24-unit box, its ink centred on (12, 12): two bars
 * `weight` wide from corner to corner, arms `reach` long from the centre. A stroked polyline
 * could not be centred: its butt ends and round joins reach out by different amounts.
 */
export function crossPolygon(weight = 3.2, reach = 5 * Math.SQRT2): Pt[] {
  const a = weight / 2;
  const u = (deg: number): Pt => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  const pts: Pt[] = [];
  for (let k = 0; k < 4; k++) {
    const t = 45 + 90 * k;
    const [dx, dy] = u(t);
    const [lx, ly] = u(t - 90);
    pts.push([12 + reach * dx + a * lx, 12 + reach * dy + a * ly]);
    pts.push([12 + reach * dx - a * lx, 12 + reach * dy - a * ly]);
    const [nx, ny] = u(t + 45);
    pts.push([12 + a * Math.SQRT2 * nx, 12 + a * Math.SQRT2 * ny]);
  }
  return centreOn(pts, 12);
}

/**
 * The tick (✓) as one filled outline in a 24-unit box, its ink centred on (12, 12): a short and a
 * long bar `weight` wide meeting in a mitred corner (the stroke `(5.5,12.5) (10,17) (18.5,7.5)`).
 */
export function tickPolygon(weight = 3.2): Pt[] {
  const A: Pt = [5.5, 12.5];
  const B: Pt = [10, 17];
  const C: Pt = [18.5, 7.5];
  const a = weight / 2;
  const normal = (p: Pt, q: Pt): Pt => {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    return [-(q[1] - p[1]) / len, (q[0] - p[0]) / len];
  };
  const n1 = normal(A, B);
  const n2 = normal(B, C);
  const mx = n1[0] + n2[0];
  const my = n1[1] + n2[1];
  const k = a / (mx * n1[0] + my * n1[1]);
  const off = (p: Pt, n: Pt, s: number): Pt => [p[0] + n[0] * s, p[1] + n[1] * s];
  const pts: Pt[] = [
    off(A, n1, a),
    [B[0] + mx * k, B[1] + my * k],
    off(C, n2, a),
    off(C, n2, -a),
    [B[0] - mx * k, B[1] - my * k],
    off(A, n1, -a),
  ];
  return centreOn(pts, 12);
}

/** The glyphs `GLYPH_DX` covers, in its column order. */
export const GLYPH_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ?";

/**
 * How far right of its advance's centre each glyph's ink sits, in thousandths of an em, weight
 * 700 (a "1" leans right on its flag, a "B" on its bowls). Measured in Chromium from the ink of
 * each glyph set as a badge (24pt at 1440 wide, 20 Oct 2026), alongside `FONT_V_METRICS`.
 */
export const GLYPH_DX: Record<FontKey, readonly number[]> = {
  lexend: [
    0, 7, 7, -7, -7, -10, 3, 7, 0, 3, 0, 21, 10, 24, 14, 21, 3, 0, 0, -14, 42, 28, 0, 0, -3, 24, -3,
    28, -10, 0, 0, 0, 0, 0, 0, 0, -7,
  ],
  gabarito: [
    0, -24, -7, -7, 7, 7, 3, 3, 0, 3, 0, 10, 3, 21, 10, 17, 0, 3, 0, -14, 28, 21, 0, 0, 0, 21, 0,
    14, 0, 0, 0, 0, 0, 0, -3, 7, -3,
  ],
  figtree: [
    0, -24, -10, 0, 0, 7, 3, 0, 0, -3, 0, 21, 7, 17, 3, 24, 3, 0, 0, -28, 35, 31, 0, 0, 0, 28, 0,
    21, 0, 0, -3, 0, 0, -3, 0, 0, -7,
  ],
  sourceSerif: [
    0, 0, 0, 3, 0, 3, 0, 3, 0, 0, 0, 0, 3, -3, -3, 3, 7, 0, 0, -42, 10, 0, 0, 0, 0, 3, 0, 10, 3, 0,
    0, 3, 3, 0, 0, 0, 3,
  ],
  schibsted: [
    0, -24, -10, -3, 0, 0, 3, 0, 0, -3, 0, 17, 3, 17, 17, 24, -3, -3, 0, -21, 28, 24, 0, 0, 0, 21,
    0, 21, -7, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
  literata: [
    0, 3, -3, -10, -3, -7, 0, 7, -3, -3, 3, 7, 0, 3, 7, 10, 10, 0, 0, 0, 21, 3, 3, 3, 0, 14, 80, 17,
    0, 0, 3, 0, 0, 0, -3, 0, -7,
  ],
  publicSans: [
    0, -31, -3, 0, 7, 3, 3, 0, 0, 0, 3, 17, 0, 17, 14, 21, -14, 0, 0, -17, 28, 24, 0, 0, 0, 24, -7,
    14, 0, 0, 7, 0, 0, 0, 0, 7, -10,
  ],
  bricolage: [
    0, -21, -3, -7, 0, 0, 3, 0, 0, 0, 0, 14, 10, 10, 17, 24, -3, 0, 0, -28, 24, 31, 0, 3, 0, 21, 0,
    21, 0, 0, 0, 0, 0, 0, 0, 3, 3,
  ],
  instrumentSans: [
    0, -21, 3, 0, 0, -3, 3, 3, 0, -3, 0, 10, 3, 7, 7, 7, -3, 0, 0, -21, 14, 3, 3, 0, 0, 10, 7, 17,
    0, 0, 0, 0, -3, 0, 0, 3, 3,
  ],
  atkinson: [
    0, -31, -7, -7, -7, -3, 0, -7, 0, 0, 0, 17, 7, 14, 10, 14, -7, 0, 0, -28, 24, 21, 0, 0, 0, 17,
    21, 24, -3, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
  fredoka: [
    0, -14, 3, 0, -10, -3, 0, 0, 0, 0, 0, 3, 0, 7, 14, 7, -3, 0, 0, -10, 7, 17, 0, 0, 0, 10, 3, 10,
    0, 0, 0, 0, 0, 0, -3, 0, -3,
  ],
  playpen: [
    3, 3, 10, 7, 0, 0, -3, 17, 0, 0, -10, 10, 3, 7, 10, 24, -7, 0, 7, -21, 24, 14, -3, 0, 3, 21, 3,
    14, 0, 14, 7, 14, 14, 0, 14, -3, 14,
  ],
  baloo: [
    0, -31, 0, -3, 7, 10, 0, 7, 3, 0, 3, 17, 3, 14, 14, 21, -7, 0, 0, -21, 21, 21, 3, 0, 0, 21, 17,
    17, 3, 0, 0, -3, 0, 0, -3, 3, -7,
  ],
  nunito: [
    0, 28, 7, -10, 7, 14, 3, -3, 0, -7, 0, 10, 7, 14, 17, 28, -7, 0, 3, -45, 21, 31, 3, 0, 0, 24, 0,
    10, 7, 0, 0, 3, 0, 0, 0, 14, -7,
  ],
  outfit: [
    0, -24, -3, -7, 0, -10, 0, 0, 0, 0, 0, 17, 7, 17, 14, 17, 3, 0, 0, -21, 28, 21, 0, 0, 0, 21, 10,
    24, -7, 0, 0, 0, 0, 0, 0, -3, -7,
  ],
  geist: [
    0, -35, 0, 0, -10, 3, 7, 7, 0, -7, 0, 14, 3, 17, 14, 17, 0, -3, 0, -3, 31, 17, 3, 0, 0, 17, 3,
    10, 0, 0, -3, 0, 0, 0, 3, 0, 3,
  ],
  andika: [
    0, 10, 0, 0, 3, 0, 7, -3, 3, -3, -7, 3, -10, 7, 10, 10, -10, -7, -7, -35, 17, 28, -7, -7, -7,
    21, 21, 24, -3, -3, -7, -7, -7, -7, -3, -7, -14,
  ],
};

/**
 * How far below the middle of its trimmed line box (CSS `text-box: trim-both cap alphabetic`)
 * each glyph's ink sits, in thousandths of an em, weight 700: the gap between a family's
 * declared cap height and the glyph's own ink (round overshoot, a "?" taller than "H").
 */
export const GLYPH_DY: Record<FontKey, readonly number[]> = {
  lexend: [
    -7, -10, -14, -3, -7, -3, -10, -7, -10, -14, -3, -3, -7, -3, -3, -3, -7, -3, -3, 0, -3, -3, -3,
    -3, -10, -3, 42, -3, -10, -3, 0, -3, -3, -3, -3, -3, -7,
  ],
  gabarito: [
    0, -3, -7, 0, -3, 3, 0, -3, 0, 0, -3, -3, 0, -3, -3, -3, 0, -3, -3, 3, -3, -3, -3, -3, 0, -3,
    17, -3, -3, -3, 3, -3, -3, -3, -3, -3, -17,
  ],
  figtree: [
    -3, -3, -10, -3, -3, 3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, 3, -3, -3, -3, -3,
    -3, -3, 10, -3, -3, -3, 3, -3, -3, -3, -3, -3, -3,
  ],
  sourceSerif: [
    21, 21, 14, 21, 28, 28, 21, 21, 21, 21, 7, 10, 7, 10, 10, 10, 7, 10, 10, 83, 10, 10, 10, 10, 7,
    10, 104, 17, 7, 10, 17, 10, 10, 10, 10, 10, 7,
  ],
  schibsted: [
    0, 0, -7, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 80, 0, 0, 0, 7,
    0, 0, 0, 0, 0, 0,
  ],
  literata: [
    0, -3, -7, 0, -3, 7, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 7, 0, 0, 0, 0, 0, 90, 7, 0, 0, 7,
    0, 0, 0, 0, 0, 0,
  ],
  publicSans: [
    -3, -3, -7, 0, -3, 3, 0, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, 0, -3, -3, -3, -3, -3,
    -3, 56, -3, -3, -3, 0, -3, -3, -3, -3, -3, -7,
  ],
  bricolage: [
    3, 0, -7, 7, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 80, 0, 0, 0, 7,
    0, 0, 0, 0, 0, 0,
  ],
  instrumentSans: [
    -3, 0, -7, -3, 0, 3, -3, 0, -3, -3, 0, 0, -3, 0, 0, 0, -3, 0, 0, 3, 0, 0, 0, 0, -3, 0, -3, 0,
    -3, 0, 3, 0, 0, 0, 0, 0, -17,
  ],
  atkinson: [
    -3, -3, -7, 0, -3, 3, 0, -3, 0, -7, -3, -3, 0, -3, -3, -3, 0, -3, -3, 3, -3, -3, -3, -3, 0, -3,
    17, -3, 0, -3, 3, -3, -3, -3, -3, -3, 0,
  ],
  fredoka: [
    7, 3, 0, 7, 0, 10, 10, 3, 3, -3, 10, 3, 7, 3, 3, 3, 3, 3, 3, 10, 3, 3, 3, 3, 7, 3, 7, 7, 3, 3,
    10, 0, 0, 3, 0, 7, -3,
  ],
  playpen: [
    0, 0, 3, 0, 0, 3, -14, 7, -3, 0, -3, -3, 0, 10, 0, 3, 0, 0, 3, -3, 3, -3, 0, -10, 0, -3, 49, -3,
    3, 7, -3, -3, -3, -3, -3, -3, -3,
  ],
  baloo: [
    0, 0, -7, 0, 0, 7, 0, 3, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 3, 0, -3, 3, 0, 0, -3, 73, -3, 0, 3,
    3, 3, 0, 0, 3, 0, -7,
  ],
  nunito: [
    -10, -10, -14, -10, -7, -3, -10, -3, -10, -10, -7, -7, -10, -7, -7, -3, -10, -7, -7, -7, -7, -7,
    -7, -7, -10, -3, 87, -3, -10, -3, -7, -7, -7, -7, -7, -7, -10,
  ],
  outfit: [
    -14, -14, -21, -7, -14, -7, -10, -14, -17, -21, -14, -14, -14, -14, -14, -14, -14, -14, -14, -7,
    -14, -14, -14, -14, -14, -14, 7, -14, -14, -14, -7, -14, -14, -14, -14, -14, -28,
  ],
  geist: [
    -3, -3, -10, -3, -3, 3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, 3, -3, -3, -3, -3,
    -3, -3, 21, -3, -3, -3, 3, -3, -3, -3, -3, -3, -10,
  ],
  andika: [
    3, 3, -3, 3, 3, 10, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 10, 3, 3, 3, 3, 3, 0, 52, 0, 3, 3,
    10, 3, 3, 3, 3, 3, -10,
  ],
};

/** A badge glyph's centring: the shifts in `fontSize` units (positive is right and down). */
export type BadgeGlyph = {
  /** The ink's horizontal correction (single glyphs in `GLYPH_CHARS` only). */
  shiftX: number;
  /** The metric correction from the line box to the cap (or x) band, for renderers that centre on the line box. */
  shiftY: number;
  /** The ink's vertical correction once the line box is trimmed to `edge`. */
  trimY: number;
  /** The band to trim the line box to where the renderer can (CSS `text-box-edge`). */
  edge: "cap alphabetic" | "ex alphabetic";
};

/**
 * The one centring rule every badge renderer applies (SlideView's shape label and option chip,
 * the PPTX export): null when `text` is not a badge glyph. A glyph is set with no padding at line
 * height 1, centred on its line box trimmed to `edge` (or moved by `shiftY` where trimming is not
 * available), and moved by `shiftX`.
 */
export function badgeGlyph(text: string, fontStack: string, fontSize: number): BadgeGlyph | null {
  if (!isBadgeGlyph(text)) return null;
  const t = text.trim();
  const key = fontKeyOf(fontStack);
  const col = t.length === 1 && t.toUpperCase() === t ? GLYPH_CHARS.indexOf(t) : -1;
  const dx = key && col >= 0 ? (GLYPH_DX[key][col] ?? 0) : 0;
  const dy = key && col >= 0 ? (GLYPH_DY[key][col] ?? 0) : 0;
  return {
    shiftX: -(dx / 1000) * fontSize,
    trimY: -(dy / 1000) * fontSize,
    shiftY: glyphShiftY(t, fontStack, fontSize),
    edge: CAP_BAND.test(t) ? "cap alphabetic" : "ex alphabetic",
  };
}
