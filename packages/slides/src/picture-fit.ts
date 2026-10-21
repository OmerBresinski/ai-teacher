/**
 * Pictures fit their layout box (TEACH-25 part b; rulings 217, 216, 210, 213). A port of the layout
 * pilot's `northstars/picture.js` r4, which Greg approved on 12 Oct 2026 ("looking amazing!!"):
 *
 * 1. A layout asks for a standard shape (16:9, 4:3, 1:1, 3:4) that fits its zone.
 * 2. A shape is safe for a picture when its largest crop keeps the whole subject plus a 2.5% margin
 *    ("crop"), or, on a plain backdrop only, when the canvas can grow by stretching the backdrop's
 *    edge ("extend"). Without a subject box a busy picture may lose 30% per axis, a plain one 12%.
 *    Scenes never extend; neither does a picture whose backdrop is unknown.
 * 3. No safe standard shape: the box takes the picture's own shape. Never a mat, blur or grey band.
 * 4. The crop zooms to the subject: it fills about 72% of the crop's limiting side (extension buys
 *    room only up to 80%), and the crop is never under 0.6x the displayed box in source pixels. A
 *    subject wider than 90% on a busy picture keeps the plain centred crop.
 * 5. A compare pair shares one shape and one scale (the widest crop any zooming side needs), so a
 *    seedling is not blown up beside a mature plant.
 *
 * Pure: it reads the picture's facts (`PictureFacts`), never its pixels. The facts are found server
 * side by `@tj/images` `pictureFacts` (plain-backdrop difference box only: the pilot's saliency
 * fallback was wrong 70% of the time, so a picture without a box takes the centred no-box crop), and
 * an extended crop is baked into a new image there by `extendRaster` before it is placed: the
 * editor's crop is clamped to the picture, and PowerPoint has no edge-stretch, so an extension is
 * never drawn live. A crop is returned as fractions of the picture, which is `ImageElement.crop`
 * and PowerPoint's source rectangle.
 */

export type FracRect = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };
export type ShapeName = "16:9" | "4:3" | "1:1" | "3:4";

/** What placement knows about a picture (`ImageElement.subject`, `.backdrop`, `.kind` + its size). */
export type PictureFacts = {
  /** Source pixels. */
  width: number;
  height: number;
  /** The box round what the picture shows, as fractions of it. */
  subject?: FracRect;
  /** Which edges are a plain backdrop; absent means unknown (never extended). */
  backdrop?: {
    plain: { top: boolean; right: boolean; bottom: boolean; left: boolean };
    colour: string;
  };
  /** A scene is never extended. */
  kind?: "object" | "scene";
};

export type FitOptions = {
  /** false: shapes and crops stay inside the picture. */
  extend?: boolean;
  /** false: the largest in-image crop, no zoom to the subject. */
  zoom?: boolean;
  /** A pair's shared crop width, as a fraction of this picture's width (`pairFit`). */
  cropW?: number;
  /** The point to centre on, as fractions; default the subject's centre, else the middle. */
  focus?: { x: number; y: number };
};

export type PictureCrop = FracRect & {
  /** The largest in-image crop's width over this crop's: above 1 is zoomed in. */
  zoom: number;
  zoomed: boolean;
  /** The crop runs past the picture: it must be baked (`extendPlan`) before it is placed. */
  extended: boolean;
};

export const SHAPES: readonly (readonly [ShapeName, number])[] = [
  ["16:9", 16 / 9],
  ["4:3", 4 / 3],
  ["1:1", 1],
  ["3:4", 3 / 4],
];
/** The subject's share of the crop's limiting side (Greg: 65-80%). */
export const ZOOM_FILL = 0.72;
/** Extension buys breathing room only up to this fill, so a backdrop is stretched as little as possible. */
export const EXTEND_FILL = 0.8;
/** A crop is never under this share of the displayed box, in source pixels. */
export const RES_FLOOR = 0.6;
/** The margin a safe crop keeps round the subject, as a fraction of the picture. */
export const SUBJECT_MARGIN = 0.025;
/** Loss allowed per axis without a subject box: a busy picture, and a plain-backdrop one. */
export const BUSY_LOSS = 0.3;
export const PLAIN_LOSS = 0.12;
/** A stretched backdrop counts this much less when shapes are ranked, so a crop wins a tie. */
const EXTEND_PENALTY = 0.92;
/** A subject wider than this on a busy picture is a scene: plain centred crop, no zoom. */
const SCENE_WIDE = 0.9;

export function shapeRatio(name: ShapeName): number {
  return SHAPES.find(([n]) => n === name)?.[1] ?? 1;
}

/** May the canvas grow on each axis? Both edges of the axis plain, and not a scene. */
function extendable(f: PictureFacts): { h: boolean; v: boolean } {
  const p = f.backdrop?.plain;
  if (!p || f.kind === "scene") return { h: false, v: false };
  return { h: p.left && p.right, v: p.top && p.bottom };
}
/** An isolated object: all four edges a plain backdrop. */
function isPlain(f: PictureFacts): boolean {
  const e = extendable(f);
  return e.h && e.v;
}
/** The largest crop of aspect r inside the picture, in source px (width). */
const maxCropW = (f: PictureFacts, r: number) => Math.min(f.width, f.height * r);

/** What the crop must keep (px): the subject plus its margin, else all but the allowed loss. */
function needPx(f: PictureFacts): Size {
  const s = f.subject;
  if (!s) {
    const keep = 1 - (isPlain(f) ? PLAIN_LOSS : BUSY_LOSS);
    return { w: keep * f.width, h: keep * f.height };
  }
  const x0 = Math.max(0, s.x - SUBJECT_MARGIN);
  const x1 = Math.min(1, s.x + s.w + SUBJECT_MARGIN);
  const y0 = Math.max(0, s.y - SUBJECT_MARGIN);
  const y1 = Math.min(1, s.y + s.h + SUBJECT_MARGIN);
  return { w: (x1 - x0) * f.width, h: (y1 - y0) * f.height };
}

/** The widest crop of aspect r the picture allows (px): inside it, or past it on a plain axis. */
function allowedW(f: PictureFacts, r: number, extend: boolean): number {
  const e = extend ? extendable(f) : { h: false, v: false };
  return Math.min(
    e.h ? Number.POSITIVE_INFINITY : f.width,
    (e.v ? Number.POSITIVE_INFINITY : f.height) * r,
  );
}

/** How a standard shape of ratio r can show the picture: "crop", "extend", or null (not safe). */
export function shapeMode(
  f: PictureFacts,
  r: number,
  opts: Pick<FitOptions, "extend"> = {},
): "crop" | "extend" | null {
  const n = needPx(f);
  const cw = Math.max(n.w, n.h * r);
  if (cw <= maxCropW(f, r) + 0.5) return "crop";
  if (opts.extend !== false && cw <= allowedW(f, r, true) + 0.5) return "extend";
  return null;
}

export const shapeSafe = (f: PictureFacts, r: number, opts?: Pick<FitOptions, "extend">) =>
  shapeMode(f, r, opts) !== null;

export function safeShapes(f: PictureFacts, opts?: Pick<FitOptions, "extend">): ShapeName[] {
  return SHAPES.filter(([, r]) => shapeSafe(f, r, opts)).map(([n]) => n);
}

/**
 * The crop for a box (fractions of the picture; past 0..1 only where the plain backdrop extends),
 * zoomed to the subject. `box` is the box's size in the pixels it is shown at: only its aspect and
 * the resolution floor read it, and the floor compares it with the picture's source pixels. From
 * slide units (960 wide) multiply by the render width over 960; the pilot's numbers were measured
 * on a 1440-wide slide (1.5x).
 */
export function cropFor(f: PictureFacts, box: Size, opts: FitOptions = {}): PictureCrop {
  const r = box.w / box.h;
  const s = f.subject;
  const extend = opts.extend !== false;
  const mc = maxCropW(f, r);
  const n = needPx(f);
  const cap = allowedW(f, r, extend);
  let cw = Math.max(mc, n.w, n.h * r);
  let zoomed = false;
  if (s && (s.w <= SCENE_WIDE || isPlain(f)) && opts.zoom !== false) {
    const wantAt = (fill: number) =>
      Math.max((s.w * f.width) / fill, (s.h * f.height * r) / fill, n.w, n.h * r);
    const want = wantAt(ZOOM_FILL) <= mc ? wantAt(ZOOM_FILL) : Math.max(mc, wantAt(EXTEND_FILL));
    // The floor stops zooming in past the picture's resolution; it never zooms OUT past the largest
    // in-image crop, which would extend a low-resolution picture that needed no extension.
    cw = Math.max(want, Math.min(RES_FLOOR * box.w, mc));
    zoomed = cw < mc - 1;
  }
  if (opts.cropW) {
    cw = Math.max(opts.cropW * f.width, n.w, n.h * r);
    zoomed = cw < mc - 1;
  }
  cw = Math.min(cw, cap);
  const ch = cw / r;
  const focus = opts.focus ?? (s ? { x: s.x + s.w / 2, y: s.y + s.h / 2 } : { x: 0.5, y: 0.5 });
  const place = (c: number, size: number, full: number) =>
    size <= full
      ? Math.min(Math.max(c - size / 2, 0), full - size)
      : Math.min(0, Math.max(full - size, c - size / 2));
  const x0 = place(focus.x * f.width, cw, f.width);
  const y0 = place(focus.y * f.height, ch, f.height);
  return {
    x: x0 / f.width,
    y: y0 / f.height,
    w: cw / f.width,
    h: ch / f.height,
    zoom: Math.round((mc / cw) * 100) / 100,
    zoomed,
    extended: cw > f.width + 0.5 || ch > f.height + 0.5,
  };
}

/** How big the subject shows in a box (px²); shapes are ranked by it. */
export function subjectArea(f: PictureFacts, box: Size, opts: FitOptions = {}): number {
  const s = f.subject;
  const c = cropFor(f, box, opts);
  const k = box.w / (c.w * f.width);
  const area = s ? s.w * f.width * k * s.h * f.height * k : box.w * box.h * 0.5;
  return area * (c.extended ? EXTEND_PENALTY : 1);
}

/** The largest box of aspect r inside the zone, in whole px. */
function boxIn(zone: Size, r: number): Size {
  return {
    w: Math.round(Math.min(zone.w, zone.h * r)),
    h: Math.round(Math.min(zone.h, zone.w / r)),
  };
}

export type ShapeChoice = {
  shape: ShapeName | "own";
  ratio: number;
  box: Size;
  mode: "crop" | "extend" | "own";
};

export type ChooseOptions = Pick<FitOptions, "extend" | "zoom"> & {
  /**
   * "subject" (default): the safe shape that shows the subject largest in the zone (split-compare).
   * "tallest": the tallest safe shape at the zone's full width that fits its height (panel-list).
   */
  order?: "subject" | "tallest";
  /** Only these shapes are considered (default all four). */
  shapes?: readonly ShapeName[];
};

/** The box a picture takes in a zone: a safe standard shape, else its own shape. */
export function chooseShape(zone: Size, f: PictureFacts, opts: ChooseOptions = {}): ShapeChoice {
  const safe = SHAPES.filter(
    ([n, r]) => (!opts.shapes || opts.shapes.includes(n)) && shapeSafe(f, r, opts),
  );
  let pick: { shape: ShapeName; ratio: number; box: Size } | undefined;
  if (opts.order === "tallest") {
    const fits = [...safe]
      .sort((a, b) => a[1] - b[1])
      .find(([, r]) => Math.round(zone.w / r) <= zone.h);
    if (fits)
      pick = {
        shape: fits[0],
        ratio: fits[1],
        box: { w: zone.w, h: Math.round(zone.w / fits[1]) },
      };
  } else {
    let best = -1;
    for (const [n, r] of safe) {
      const box = boxIn(zone, r);
      const a = subjectArea(f, box, opts) + box.w * box.h * 1e-3;
      if (a > best) {
        best = a;
        pick = { shape: n, ratio: r, box };
      }
    }
  }
  if (pick) {
    const mode = shapeMode(f, pick.ratio, opts) ?? "crop";
    return { ...pick, mode };
  }
  const own = f.width / f.height;
  return { shape: "own", ratio: own, box: boxIn(zone, own), mode: "own" };
}

export type PairFit = {
  shape: ShapeName | "own";
  /** One box per side; all equal unless the shape is "own" (then one shared height). */
  boxes: Size[];
  /** One crop per side; null for a diagram side (contain, any shape). */
  crops: (PictureCrop | null)[];
};

/**
 * A compare pair (ruling 216): one shared standard shape, the safe one that shows the subjects
 * largest (a diagram side counts half its box), and one scale: every side that zooms or extends
 * takes the widest crop any of them needs. No shared safe shape: each picture takes its own shape
 * at one shared height. A `null` side is a diagram.
 */
export function pairFit(
  sides: readonly (PictureFacts | null)[],
  zone: Size,
  opts: Pick<ChooseOptions, "extend" | "zoom" | "shapes"> = {},
): PairFit {
  const photos = sides.filter((s): s is PictureFacts => s !== null);
  const shared = SHAPES.filter(
    ([n, r]) =>
      (!opts.shapes || opts.shapes.includes(n)) && photos.every((f) => shapeSafe(f, r, opts)),
  );
  if (!shared.length && photos.length) {
    // one shared height: the tallest at which every side's own shape fits the zone's width
    const ratios = sides.map((f) => (f ? f.width / f.height : 1));
    const h = Math.min(zone.h, ...ratios.map((r) => zone.w / r));
    const boxes = ratios.map((r) => ({ w: Math.round(h * r), h: Math.round(h) }));
    return {
      shape: "own",
      boxes,
      crops: sides.map((f, i) => (f ? cropFor(f, boxes[i] as Size, opts) : null)),
    };
  }
  let pick = shared[0] ?? SHAPES[0];
  let best = -1;
  for (const sh of shared) {
    const b = boxIn(zone, sh[1]);
    const a =
      sides.reduce((t, f) => t + (f ? subjectArea(f, b, opts) : b.w * b.h * 0.5), 0) +
      b.w * b.h * 1e-3;
    if (a > best) {
      best = a;
      pick = sh;
    }
  }
  const [shape, ratio] = pick as readonly [ShapeName, number];
  const box = boxIn(zone, ratio);
  const own = sides.map((f) => (f ? cropFor(f, box, opts) : null));
  const movers = own.filter((c): c is PictureCrop => !!c && (c.zoomed || c.extended));
  const sharedW =
    movers.length > 1 && opts.zoom !== false ? Math.max(...movers.map((c) => c.w)) : null;
  const crops = sides.map((f, i) => {
    const c = own[i] ?? null;
    if (!f || !c) return null;
    return sharedW && (c.zoomed || c.extended) ? cropFor(f, box, { ...opts, cropW: sharedW }) : c;
  });
  return { shape, boxes: sides.map(() => box), crops };
}

/** The crop runs past the picture, so it must be baked into a new image before it is placed. */
export function needsExtension(crop: FracRect): boolean {
  const e = 1e-4;
  return crop.x < -e || crop.y < -e || crop.x + crop.w > 1 + e || crop.y + crop.h > 1 + e;
}

/**
 * The bake for an extended crop, in source px: a canvas `width` x `height` with the picture drawn
 * at (`offsetX`, `offsetY`) (negative where the crop trims that axis) and `pad` px of stretched
 * backdrop on each side. `@tj/images` `extendRaster` paints it; the baked file is then placed with
 * no crop, since it is exactly the crop's window.
 */
export type ExtendPlan = {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  pad: { left: number; top: number; right: number; bottom: number };
};

export function extendPlan(f: Pick<PictureFacts, "width" | "height">, crop: FracRect): ExtendPlan {
  const width = Math.round(crop.w * f.width);
  const height = Math.round(crop.h * f.height);
  const offsetX = Math.round(-crop.x * f.width);
  const offsetY = Math.round(-crop.y * f.height);
  return {
    width,
    height,
    offsetX,
    offsetY,
    pad: {
      left: Math.max(0, offsetX),
      top: Math.max(0, offsetY),
      right: Math.max(0, width - (offsetX + f.width)),
      bottom: Math.max(0, height - (offsetY + f.height)),
    },
  };
}
