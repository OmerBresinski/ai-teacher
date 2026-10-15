/**
 * split-compare's adapter (TEACH-75 part w) onto theme v2 (TEACH-152 part b) and picture fit
 * (TEACH-25 part b). Both are the real modules now (integration of the pilot branches); this file
 * maps them onto the names the template uses. A product picture knows its `aspect`, its `subjects`
 * and, once placed, T5's backdrop facts (`ext`): a plain axis may extend, at most twice the
 * picture's size (split-compare's cap on top of picture fit).
 */
import type { Theme } from "@tj/domain/documents";
import {
  cropFor,
  type PictureFacts as FitFacts,
  shapeMode as factsShapeMode,
  subjectArea as factsSubjectArea,
  type PictureCrop,
} from "../picture-fit";
import { v2Colors, v2Profile } from "../theme-v2";
import type { Stage, SubjectBox } from "./index";

export { SHAPES, type ShapeName, ZOOM_FILL } from "../picture-fit";

/* ------------------------------------------------------------------ */
/* Theme v2                                                            */
/* ------------------------------------------------------------------ */

export type SplitTones = {
  /** One flat field per side: the accent's tint, then two neutrals (never a second hue). */
  fields: readonly [string, string, string];
  /** The seam marker's disc (v2 `deep`). */
  deep: string;
  /** The words on the deep disc. */
  onDeep: string;
  /** The paper between the fields and round the marker. */
  paper: string;
  /** The medal's face. */
  face: string;
  /**
   * The theme's soft neutral surface (v2 `sand`): every side-by-side card (Greg, 14 Oct: "prefer
   * sand - the lighter colour. but assume it'll vary by theme"). Read from the theme, never a literal.
   */
  sand: string;
};

/** The split fields and marker colours of a theme (`v2Colors`). */
export function splitTones(t: Theme): SplitTones {
  const col = v2Colors(t);
  return {
    fields: col.fields,
    deep: col.deep,
    onDeep: col.onDeep,
    paper: col.background,
    face: col.surface,
    sand: col.sand,
  };
}

/** The quote's voice at the theme's age (`v2Profile`): a v1 theme quotes in its body face. */
export function quoteVoice(t: Theme, _stage: Stage): { family: string; italic: boolean } {
  const p = v2Profile(t);
  return { family: p.fonts.quote, italic: p.quoteStyle === "italic" };
}

/**
 * The age profile's sizes against the stage's body size (ruling 212): full, comfortable (the
 * fit's comfort line, ruling 215) and the floor it never goes under. The pilot's ratios (comfort
 * 0.9 body and 0.82 name, floors 0.8 and 0.7), on the product's type scale.
 */
export type SplitSizes = {
  name: number;
  body: number;
  quote: number;
  comfort: { name: number; body: number };
  floor: { name: number; body: number };
};
export function splitSizes(body: number, floorBody: number, heading?: number): SplitSizes {
  // The side title sits one step under the scale's heading: between heading and body on the
  // scale's own ratio (their geometric mean; KS2 42 and 29 give 35). Greg, 12 Oct: titles were big.
  const name = heading ? Math.round(Math.sqrt(heading * body)) : Math.round(body * 1.2);
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
/* Picture fit                                                         */
/* ------------------------------------------------------------------ */

/** A picture as the fit sees it: its own shape and its must-see subjects (fractions 0..1). */
export type FitPicture = {
  aspect: number;
  subjects?: SubjectBox[];
  diagram?: boolean;
  /** Axes whose two edges are a plain backdrop, so the canvas may grow by edge-stretch (T5). */
  ext?: { h: boolean; v: boolean };
};
/** T5's placement facts, as the picture director writes them (`ImageElement.backdrop`, `.kind`). */
export type PictureFacts = {
  backdrop?: { plain: { top: boolean; right: boolean; bottom: boolean; left: boolean } };
  kind?: "object" | "scene";
};
/** Which axes may extend: both edges plain, never a scene, nothing without facts. */
export function extOf(f: PictureFacts): FitPicture["ext"] {
  const p = f.backdrop?.plain;
  if (!p || f.kind === "scene") return undefined;
  const ext = { h: p.left && p.right, v: p.top && p.bottom };
  return ext.h || ext.v ? ext : undefined;
}
export type Crop = { x: number; y: number; w: number; h: number };

/** A product picture's facts: its aspect at a nominal 1000 px tall, its subjects' union, its backdrop. */
function factsOf(p: FitPicture): FitFacts {
  const facts: FitFacts = { width: Math.round(p.aspect * 1000), height: 1000 };
  if (p.ext)
    Object.assign(facts, {
      backdrop: {
        plain: { top: p.ext.v, bottom: p.ext.v, left: p.ext.h, right: p.ext.h },
        colour: "#ffffff",
      },
      kind: "object",
    });
  const s = p.subjects;
  if (!s?.length) return facts;
  const x0 = Math.min(...s.map((b) => b.x));
  const y0 = Math.min(...s.map((b) => b.y));
  const x1 = Math.max(...s.map((b) => b.x + b.w));
  const y1 = Math.max(...s.map((b) => b.y + b.h));
  return { ...facts, subject: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}

/** The nominal box a crop of shape `r` is shown in (px at 1440 wide), for the resolution floor. */
const boxOf = (r: number) => ({ w: Math.round(600 * r), h: 600 });
/** Past this many times the picture's own size the stretched backdrop is the picture (a sliver). */
const MAX_EXTEND = 2;

/** How shape `r` shows the whole subject (plus margin): cropped, extended (at most 2x), or not. */
export function shapeMode(p: FitPicture, r: number): "crop" | "extend" | null {
  if (p.diagram) return "crop";
  const f = factsOf(p);
  const mode = factsShapeMode(f, r);
  if (mode !== "extend") return mode;
  const c = cropFor(f, boxOf(r));
  return c.w <= MAX_EXTEND + 1e-6 && c.h <= MAX_EXTEND + 1e-6 ? "extend" : null;
}
/** Whether shape `r` can show the picture (cropped, or extended past a plain backdrop). */
export const shapeSafe = (p: FitPicture, r: number): boolean => shapeMode(p, r) !== null;

/** How big a picture's subjects show in a box of `w` x `h` (a diagram counts half its box). */
export function subjectArea(p: FitPicture, w: number, h: number): number {
  if (p.diagram) return w * h * 0.5;
  return factsSubjectArea(factsOf(p), { w, h });
}

/**
 * Pair fit (ruling 216): crops for every side at one shape and one scale. When any side zooms,
 * every photo takes the widest crop any of them needs, so a seedling is not blown up beside a grown
 * plant. INTEGRATION NOTE: picture fit's own `pairFit` shares the scale among the zooming sides
 * only, so a pair where one side cannot zoom (a plant filling a 16:9 box) keeps two scales; this
 * adapter keeps split-compare's stricter rule until the two are reconciled in TEACH-25 part b.
 * A diagram is contained, never cropped.
 */
export function pairCrops(pics: FitPicture[], r: number): (Crop | null)[] {
  const box = boxOf(r);
  const own: (PictureCrop | null)[] = pics.map((p) =>
    p.diagram ? null : cropFor(factsOf(p), box),
  );
  const photos = own.filter((c): c is PictureCrop => !!c);
  const shared =
    photos.length > 1 && photos.some((c) => c.zoomed)
      ? Math.max(...photos.map((c) => c.w))
      : undefined;
  return own.map((c, i) => {
    if (!c) return null;
    const k =
      shared !== undefined ? cropFor(factsOf(pics[i] as FitPicture), box, { cropW: shared }) : c;
    return { x: k.x, y: k.y, w: k.w, h: k.h };
  });
}
