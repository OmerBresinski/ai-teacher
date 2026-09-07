import type { ImageElement, ImageTransform } from "@tj/domain/documents";

/*
 * The crop maths for in-canvas image adjustment (TEACH-153), pure and unit-tested. The model:
 *
 * - The **picture box** is the bitmap at its displayed aspect, sized so that at zoom 1 it just
 *   covers the element box. `crop` (fractions of the picture box) is the window the element shows;
 *   zoom, pan and the handle trims all reduce to a new `crop`.
 * - `focal` is a point of the *displayed* picture (after rotate and flip). Re-covers after the box
 *   changes shape keep it in view: `cropFor` re-derives the window round it, and `sourceFocal`
 *   maps it back to bitmap space for CSS `object-position`.
 * - `imageTransform` is composed in display space: rotate by quarter turns, then flip, then the
 *   straighten tilt on the outside, with a cover factor so a tilted picture never shows a corner.
 */

export type Crop = { x: number; y: number; w: number; h: number };
export type Focal = { x: number; y: number };
export type Size = { w: number; h: number };
export type Rect = { x: number; y: number; w: number; h: number };

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
export const STRAIGHTEN_MAX = 45;
/** Keyboard nudge of the crop window, as a fraction of the picture. */
export const NUDGE_FRACTION = 0.01;
export const NUDGE_FRACTION_BIG = 0.1;
export const ZOOM_STEP = 0.25;

export const FULL_CROP: Crop = { x: 0, y: 0, w: 1, h: 1 };
export const CENTRE: Focal = { x: 0.5, y: 0.5 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const EPS = 1e-9;

/* ---------------- transform ---------------- */

export function normaliseTransform(t: ImageTransform | undefined): ImageTransform | undefined {
  if (!t) return undefined;
  const out: ImageTransform = {};
  if (t.straighten) out.straighten = clamp(t.straighten, -STRAIGHTEN_MAX, STRAIGHTEN_MAX);
  if (t.rotate) out.rotate = t.rotate;
  if (t.flipH) out.flipH = true;
  if (t.flipV) out.flipV = true;
  return Object.keys(out).length ? out : undefined;
}

export function rotateQuarter(t: ImageTransform | undefined, by: 90 | -90 = 90): ImageTransform {
  const next = ((((t?.rotate ?? 0) + by) % 360) + 360) % 360;
  return { ...t, rotate: next as 0 | 90 | 180 | 270 };
}

export function flip(t: ImageTransform | undefined, axis: "h" | "v"): ImageTransform {
  return axis === "h" ? { ...t, flipH: !t?.flipH } : { ...t, flipV: !t?.flipV };
}

/** Width over height of the picture as displayed: a quarter turn swaps the bitmap's aspect. */
export function displayedAspect(natural: Size, t: ImageTransform | undefined): number {
  const a = natural.h > 0 ? natural.w / natural.h : 1;
  return (t?.rotate ?? 0) % 180 === 90 ? 1 / a : a;
}

/** Scale that keeps a box of this aspect covered by its own copy rotated `deg` degrees. */
export function straightenCover(deg: number, aspect: number): number {
  const rad = (Math.abs(deg) * Math.PI) / 180;
  const longOverShort = aspect >= 1 ? aspect : 1 / aspect;
  return Math.cos(rad) + longOverShort * Math.sin(rad);
}

/** A displayed focal point mapped back to the bitmap (undo the flip, then the quarter turns). */
export function sourceFocal(focal: Focal, t: ImageTransform | undefined): Focal {
  const x = t?.flipH ? 1 - focal.x : focal.x;
  const y = t?.flipV ? 1 - focal.y : focal.y;
  switch (t?.rotate ?? 0) {
    case 90:
      return { x: y, y: 1 - x };
    case 180:
      return { x: 1 - x, y: 1 - y };
    case 270:
      return { x: 1 - y, y: x };
    default:
      return { x, y };
  }
}

/* ---------------- crop ---------------- */

/** The picture box at zoom 1: the smallest box of this aspect that covers the element box. */
export function coverSize(box: Size, aspect: number): Size {
  const w = Math.max(box.w, box.h * aspect);
  return { w, h: w / aspect };
}

export function clampCrop(crop: Crop): Crop {
  const w = clamp(crop.w, EPS, 1);
  const h = clamp(crop.h, EPS, 1);
  return { x: clamp(crop.x, 0, 1 - w), y: clamp(crop.y, 0, 1 - h), w, h };
}

/** Zoom the crop encodes, relative to cover; 1 when the window is the whole picture box. */
export function zoomOf(crop: Crop, box: Size, aspect: number): number {
  const cover = coverSize(box, aspect);
  const byW = box.w / (crop.w * cover.w);
  const byH = box.h / (crop.h * cover.h);
  return clamp(Math.max(byW, byH), ZOOM_MIN, ZOOM_MAX);
}

/** The window at this zoom with the focal point as near its centre as the picture allows. */
export function cropFor(box: Size, aspect: number, zoom: number, focal: Focal = CENTRE): Crop {
  const z = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
  const cover = coverSize(box, aspect);
  const w = box.w / (cover.w * z);
  const h = box.h / (cover.h * z);
  return clampCrop({ x: focal.x - w / 2, y: focal.y - h / 2, w, h });
}

/** Zoom to `zoom`, keeping the picture point under `at` (window fractions) where it is. */
export function zoomAbout(crop: Crop, zoom: number, at: Focal, box: Size, aspect: number): Crop {
  const z = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
  const cover = coverSize(box, aspect);
  const w = box.w / (cover.w * z);
  const h = box.h / (cover.h * z);
  const qx = crop.x + at.x * crop.w;
  const qy = crop.y + at.y * crop.h;
  return clampCrop({ x: qx - at.x * w, y: qy - at.y * h, w, h });
}

/** Drag the picture by (dx, dy) element units: the window moves the other way. */
export function pan(crop: Crop, dx: number, dy: number, box: Size): Crop {
  return clampCrop({
    ...crop,
    x: crop.x - (dx * crop.w) / box.w,
    y: crop.y - (dy * crop.h) / box.h,
  });
}

/** Move the window by fractions of the picture (the arrow keys). */
export function nudgeCrop(crop: Crop, dx: number, dy: number): Crop {
  return clampCrop({ ...crop, x: crop.x + dx, y: crop.y + dy });
}

/**
 * The box changed shape (Fill, a resize, a layout recipe): the same zoom round the same focal
 * point, re-derived for the new box so the subject stays in view.
 */
export function rederiveCrop(
  crop: Crop,
  focal: Focal | undefined,
  oldBox: Size,
  newBox: Size,
  aspect: number,
): Crop {
  return cropFor(newBox, aspect, zoomOf(crop, oldBox, aspect), focal ?? CENTRE);
}

/** The crop an untouched picture enters crop mode with: cover at zoom 1 round the focal point. */
export function seedCrop(
  element: Pick<ImageElement, "w" | "h" | "crop" | "focal" | "imageTransform">,
  natural: Size,
): Crop {
  const aspect = displayedAspect(natural, element.imageTransform);
  if (element.crop) return clampCrop(element.crop);
  return cropFor({ w: element.w, h: element.h }, aspect, ZOOM_MIN, element.focal ?? CENTRE);
}

/* ---------------- slide-space rects (the crop layer) ---------------- */

/** Where the whole picture sits on the slide, given the element box and its window. */
export function pictureRect(box: Rect, crop: Crop): Rect {
  const w = box.w / crop.w;
  const h = box.h / crop.h;
  return { x: box.x - crop.x * w, y: box.y - crop.y * h, w, h };
}

/** The window a box cuts out of a picture, as fractions of the picture. */
export function cropFromRects(picture: Rect, box: Rect): Crop {
  return clampCrop({
    x: (box.x - picture.x) / picture.w,
    y: (box.y - picture.y) / picture.h,
    w: box.w / picture.w,
    h: box.h / picture.h,
  });
}

/** Keep a trimmed box inside the picture and no smaller than `min` a side. */
export function clampBoxToPicture(box: Rect, picture: Rect, min: number): Rect {
  const w = clamp(box.w, Math.min(min, picture.w), picture.w);
  const h = clamp(box.h, Math.min(min, picture.h), picture.h);
  return {
    x: clamp(box.x, picture.x, picture.x + picture.w - w),
    y: clamp(box.y, picture.y, picture.y + picture.h - h),
    w,
    h,
  };
}

/** The point of the picture under a slide point, as displayed-picture fractions. */
export function focalAt(picture: Rect, p: { x: number; y: number }): Focal {
  return {
    x: clamp((p.x - picture.x) / picture.w, 0, 1),
    y: clamp((p.y - picture.y) / picture.h, 0, 1),
  };
}

/* ---------------- rendering ---------------- */

export type PictureStyle = {
  /** The picture box, as percentages of the element box. */
  wrapper: { left: string; top: string; width: string; height: string };
  /** The bitmap inside it: swapped for a quarter turn, centred, then rotated, flipped, tilted. */
  img: { width: string; height: string; transform: string; objectPosition: string };
};

/**
 * One inner transform for `ImageView` and the crop layer. `box` is the element's size in slide
 * units, needed only because a quarter-turned bitmap takes the wrapper's height as its width.
 */
export function pictureStyle(
  box: Size,
  crop: Crop | undefined,
  t: ImageTransform | undefined,
  focal: Focal | undefined,
): PictureStyle {
  const c = crop ? clampCrop(crop) : FULL_CROP;
  const quarter = (t?.rotate ?? 0) % 180 === 90;
  const wrapperW = box.w / c.w;
  const wrapperH = box.h / c.h;
  const aspect = wrapperW / wrapperH;
  const cover = t?.straighten ? straightenCover(t.straighten, aspect) : 1;
  const sx = (t?.flipH ? -1 : 1) * cover;
  const sy = (t?.flipV ? -1 : 1) * cover;
  const parts = ["translate(-50%, -50%)"];
  if (t?.straighten) parts.push(`rotate(${t.straighten}deg)`);
  if (sx !== 1 || sy !== 1) parts.push(`scale(${round(sx)}, ${round(sy)})`);
  if (t?.rotate) parts.push(`rotate(${t.rotate}deg)`);
  const src = sourceFocal(focal ?? CENTRE, t);
  return {
    wrapper: {
      left: pct(-c.x / c.w),
      top: pct(-c.y / c.h),
      width: pct(1 / c.w),
      height: pct(1 / c.h),
    },
    img: {
      width: quarter ? pct(wrapperH / wrapperW) : "100%",
      height: quarter ? pct(wrapperW / wrapperH) : "100%",
      transform: parts.join(" "),
      objectPosition: `${pct(src.x)} ${pct(src.y)}`,
    },
  };
}

const round = (n: number) => Math.round(n * 10000) / 10000;
const pct = (f: number) => `${round(f * 100)}%`;

/* ---------------- the crop-mode draft ---------------- */

/**
 * What crop mode edits before it commits: the element's three adjustment fields, the trimmed box
 * (the handles), the bitmap's natural size once measured, and whether Reset was the last word.
 */
export type CropDraft = {
  crop?: Crop;
  focal?: Focal;
  imageTransform?: ImageTransform;
  box?: Rect;
  natural?: Size;
  reset?: boolean;
};

export const RESET_DRAFT: CropDraft = {
  crop: undefined,
  focal: undefined,
  imageTransform: undefined,
  box: undefined,
  reset: true,
};

/** The aspect the draft's picture shows at, from the natural size if measured, else the box. */
export function draftAspect(d: CropDraft, box: Size): number {
  return displayedAspect(d.natural ?? box, d.imageTransform);
}

/** The window the draft shows: its crop, else cover round its focal point. */
export function draftCrop(d: CropDraft, box: Size): Crop {
  return d.crop ?? cropFor(box, draftAspect(d, box), ZOOM_MIN, d.focal ?? CENTRE);
}

/** A quarter turn: the displayed aspect swaps, so the window is re-derived at the same zoom. */
export function draftRotate(d: CropDraft, box: Size): Partial<CropDraft> {
  const before = draftAspect(d, box);
  const imageTransform = rotateQuarter(d.imageTransform);
  const after = displayedAspect(d.natural ?? box, imageTransform);
  const zoom = zoomOf(draftCrop(d, box), box, before);
  const focal = turnedFocal(d.focal);
  return { imageTransform, crop: cropFor(box, after, zoom, focal ?? CENTRE), focal };
}

/** A displayed point after the picture turns a quarter clockwise. */
function turnedFocal(f: Focal | undefined): Focal | undefined {
  return f ? { x: 1 - f.y, y: f.x } : f;
}

/** A flip mirrors the picture in place: the window and the focal point mirror with it. */
export function draftFlip(d: CropDraft, box: Size, axis: "h" | "v"): Partial<CropDraft> {
  const c = draftCrop(d, box);
  const f = d.focal;
  return axis === "h"
    ? {
        imageTransform: flip(d.imageTransform, "h"),
        crop: { ...c, x: 1 - c.x - c.w },
        focal: f ? { x: 1 - f.x, y: f.y } : f,
      }
    : {
        imageTransform: flip(d.imageTransform, "v"),
        crop: { ...c, y: 1 - c.y - c.h },
        focal: f ? { x: f.x, y: 1 - f.y } : f,
      };
}

export function draftStraighten(d: CropDraft, deg: number): Partial<CropDraft> {
  const straighten = Math.round(clamp(deg, -STRAIGHTEN_MAX, STRAIGHTEN_MAX));
  return { imageTransform: { ...d.imageTransform, straighten } };
}

/** Zoom about a window point (the pointer), or the window's centre for the slider and keys. */
export function draftZoom(
  d: CropDraft,
  box: Size,
  zoom: number,
  at: Focal = CENTRE,
): Partial<CropDraft> {
  return { crop: zoomAbout(draftCrop(d, box), zoom, at, box, draftAspect(d, box)) };
}
