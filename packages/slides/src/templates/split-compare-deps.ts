/**
 * split-compare's adapter (TEACH-75 part w) onto two parts built in parallel with it:
 *
 * - **Theme v2** (TEACH-152 part b, T1): the split fields' tones, the deep seam marker and the
 *   quote voice. Until its accessor lands every value here is derived from `theme.colors` and
 *   `theme.fonts` (ruling 211: the layout never hard-codes a colour, font or radius), so the 9
 *   current themes draw with these fallbacks.
 * - **Picture fit** (TEACH-25 part b, T5): standard shapes, subject-safe crops and one shared crop
 *   scale for a matched pair (ruling 216). The stand-in below is the pilot's `picture.js` without
 *   its pixel work: no edge-stretch extension and no automatic subject box (the product knows a
 *   photo's `aspect` and its `subjects`, not its pixels).
 *
 * When T1 and T5 land on master, point these exports at the real modules; the template imports
 * nothing else from them.
 */
import type { Theme } from "@tj/domain/documents";
import { FONT_STACKS } from "../fonts";
import { contrastRatio } from "../look";
import { BLIND_CROP_KEEP, mix, type Stage, type SubjectBox } from "./index";

/* ------------------------------------------------------------------ */
/* Theme v2 stand-ins (T1)                                             */
/* ------------------------------------------------------------------ */

export type SplitTones = {
  /** One flat field per side: the accent's tint, then two neutrals (never a second hue). */
  fields: [string, string, string];
  /** The seam marker's disc (v2 `deep`). */
  deep: string;
  /** The words on the deep disc. */
  onDeep: string;
  /** The paper between the fields and round the marker. */
  paper: string;
  /** The medal's face. */
  face: string;
};

/** The split fields and marker colours of a theme (v2 tokens, else derived from `colors`). */
export function splitTones(t: Theme): SplitTones {
  const c = t.colors;
  const deep = c.ink;
  const onDeep = [c.background, c.surface, c.onAccent].reduce((a, b) =>
    contrastRatio(b, deep) > contrastRatio(a, deep) ? b : a,
  );
  return {
    fields: [
      mix(c.accent, c.background, 0.16),
      mix(c.ink, c.background, 0.05),
      mix(c.ink, c.background, 0.1),
    ],
    deep,
    onDeep,
    paper: c.background,
    face: c.surface,
  };
}

/** The quote's voice: a serif italic (v2 quote font), an upright infant face at KS1 (Andika in v2). */
export function quoteVoice(t: Theme, stage: Stage): { family: string; italic: boolean } {
  if (stage === "ks1") return { family: t.fonts.body, italic: false };
  return { family: FONT_STACKS.sourceSerif, italic: true };
}

/**
 * The age profile's sizes against the stage's body size (ruling 212): full, comfortable (the
 * fit's comfort line, ruling 215) and the floor it never goes under. The pilot's ratios (name
 * 1.3x body, comfort 0.9 body and 0.82 name, floors 0.8 and 0.7), on the product's type scale.
 */
export type SplitSizes = {
  name: number;
  body: number;
  quote: number;
  comfort: { name: number; body: number };
  floor: { name: number; body: number };
};
export function splitSizes(body: number, floorBody: number): SplitSizes {
  const name = Math.round(body * 1.3);
  const fb = Math.max(floorBody, Math.round(body * 0.8));
  return {
    name,
    body,
    quote: Math.round(body * 1.05),
    comfort: { name: Math.round(name * 0.82), body: Math.round(body * 0.9) },
    floor: { name: Math.max(fb, Math.round(name * 0.7)), body: fb },
  };
}

/* ------------------------------------------------------------------ */
/* Picture fit stand-ins (T5)                                          */
/* ------------------------------------------------------------------ */

/** The standard shapes, widest first (pilot `SHAPES`). */
export const SHAPES = [
  ["16:9", 16 / 9],
  ["4:3", 4 / 3],
  ["1:1", 1],
  ["3:4", 3 / 4],
] as const;
export type ShapeName = (typeof SHAPES)[number][0];
/** The subject fills this share of the crop's limiting side when the crop zooms to it. */
export const ZOOM_FILL = 0.72;
/** A crop never zooms past this (no pixel size is known, so no resolution floor can be read). */
const MAX_ZOOM = 2;
/** The margin a safe crop keeps round the subjects, as a share of the picture. */
const MARGIN = 0.025;

/** A picture as the fit sees it: its own shape and its must-see subjects (fractions 0..1). */
export type FitPicture = { aspect: number; subjects?: SubjectBox[]; diagram?: boolean };
export type Crop = { x: number; y: number; w: number; h: number };

const unionOf = (s: SubjectBox[]) => {
  const x0 = Math.min(...s.map((b) => b.x));
  const y0 = Math.min(...s.map((b) => b.y));
  const x1 = Math.max(...s.map((b) => b.x + b.w));
  const y1 = Math.max(...s.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/** What a crop must keep, in picture units (width `aspect`, height 1), and the subjects' centre. */
function need(p: FitPicture) {
  if (!p.subjects?.length)
    return { w: BLIND_CROP_KEEP * p.aspect, h: BLIND_CROP_KEEP, cx: 0.5, cy: 0.5, s: null };
  const s = unionOf(p.subjects);
  const x0 = Math.max(0, s.x - MARGIN);
  const x1 = Math.min(1, s.x + s.w + MARGIN);
  const y0 = Math.max(0, s.y - MARGIN);
  const y1 = Math.min(1, s.y + s.h + MARGIN);
  return { w: (x1 - x0) * p.aspect, h: y1 - y0, cx: s.x + s.w / 2, cy: s.y + s.h / 2, s };
}

/** The largest crop of shape `r` inside the picture, in picture units. */
const maxCropW = (p: FitPicture, r: number) => Math.min(p.aspect, r);

/** Whether shape `r` shows the whole subject (plus margin) by cropping inside the picture. */
export function shapeSafe(p: FitPicture, r: number): boolean {
  if (p.diagram) return true;
  const n = need(p);
  return Math.max(n.w, n.h * r) <= maxCropW(p, r) + 1e-6;
}

/**
 * The crop of shape `r` for a picture, zoomed so the subject fills about 72% of the crop's limiting
 * side, centred on it and clamped inside the picture. `cropW` (a share of the picture's width) is
 * the pair's shared scale. `zoom` is how far it is in from the largest crop.
 */
export function cropFor(
  p: FitPicture,
  r: number,
  cropW?: number,
): Crop & { zoom: number; zoomed: boolean } {
  const n = need(p);
  const most = maxCropW(p, r);
  const least = Math.max(n.w, n.h * r, most / MAX_ZOOM);
  let cw = most;
  if (n.s && n.s.w <= 0.9) {
    const want = Math.max((n.s.w * p.aspect) / ZOOM_FILL, (n.s.h * r) / ZOOM_FILL);
    cw = Math.min(most, Math.max(least, want));
  }
  if (cropW !== undefined) cw = Math.min(most, Math.max(least, cropW * p.aspect));
  const ch = cw / r;
  const place = (centre: number, size: number, full: number) =>
    Math.min(Math.max(centre - size / 2, 0), full - size);
  const x = place(n.cx * p.aspect, cw, p.aspect) / p.aspect;
  const y = place(n.cy, ch, 1);
  return {
    x,
    y,
    w: cw / p.aspect,
    h: ch,
    zoom: Math.round((most / cw) * 100) / 100,
    zoomed: cw < most - 1e-6,
  };
}

/** How big a picture's subjects show in a box of `w` x `h` (a diagram counts half its box). */
export function subjectArea(p: FitPicture, w: number, h: number): number {
  if (p.diagram || !p.subjects?.length) return w * h * 0.5;
  const c = cropFor(p, w / h);
  const k = w / (c.w * p.aspect);
  const s = unionOf(p.subjects);
  return s.w * p.aspect * k * s.h * k;
}

/**
 * Pair fit (ruling 216): crops for every side at one shape and one scale. When any side zooms,
 * every photo takes the widest crop any of them needs (as a share of the picture), so a seedling
 * is not blown up beside a grown plant (the pilot shared it among the zooming sides only; a pair
 * where one side cannot zoom then kept two scales). A diagram is contained, never cropped.
 */
export function pairCrops(pics: FitPicture[], r: number): (Crop | null)[] {
  const own = pics.map((p) => (p.diagram ? null : cropFor(p, r)));
  const photos = own.filter((c): c is NonNullable<typeof c> => !!c);
  const shared =
    photos.length > 1 && photos.some((c) => c.zoomed)
      ? Math.max(...photos.map((c) => c.w))
      : undefined;
  return own.map((c, i) => {
    if (!c) return null;
    const p = pics[i] as FitPicture;
    const k = shared !== undefined ? cropFor(p, r, shared) : c;
    return { x: k.x, y: k.y, w: k.w, h: k.h };
  });
}
