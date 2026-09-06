import type { Id, SlideElement } from "@tj/domain/documents";
import {
  centre as centreOf,
  normaliseAngle,
  type Point,
  type Rect,
  rotatedBounds,
  rotatePoint,
  snapAngle,
  unionRect,
} from "../../model/geometry";
import {
  computeMoveSnap,
  computeSnap,
  type Guide,
  SNAP_THRESHOLD_PX,
  type SnapOptions,
  type SnapTarget,
  SPACING_THRESHOLD_PX,
} from "../../model/snapping";
import type { ElementTransform } from "../../slide/elements/ElementFrame";
import {
  ASPECT_LOCKED_TYPES,
  type HandleId,
  MIN_SIZE,
  ROTATE_FINE_DEG,
  ROTATE_SNAP_DEG,
  ROTATE_SNAP_THRESHOLD_DEG,
} from "./constants";
import { clampToStage, type ElementBox } from "./hit-test";
import {
  anchorOf,
  applyEdgeSnap,
  clampGroupScale,
  movingLinesFor,
  resizeRect,
  scaleAbout,
  scaleGroupChildren,
} from "./resize";

/*
 * The maths of a pointer gesture, kept out of `SelectionLayer` so it can be read and tested on its
 * own: given the boxes as they were when the pointer went down and the sample it is at now, what
 * does the selection look like? Each function returns the **preview** the canvas paints — the
 * document is written once, on release, from the same numbers (ADR 0022 §4).
 */

/** A pointer sample plus the modifier state we care about. */
export type Sample = { x: number; y: number; shift: boolean; alt: boolean; meta: boolean };

/** An element as it was at gesture start. */
export type StartBox = {
  id: Id;
  rect: Rect;
  rotation: number;
  type: SlideElement["type"];
  lockHeight: boolean;
  /** Group children, in the group's local space, as they were at gesture start. */
  children?: SlideElement[];
};

/** Element id → in-flight geometry, painted by `SlideView` instead of the cache. */
export type PreviewMap = ReadonlyMap<Id, ElementTransform>;

export type Gesture =
  | { kind: "none" }
  | {
      kind: "drag";
      ids: Id[];
      boxes: StartBox[];
      bounds: Rect;
      origin: Sample;
      duplicate: boolean;
      started: boolean;
      /** The total delta the preview currently shows — what pointer-up commits. */
      applied: Point;
    }
  | { kind: "marquee"; origin: Point; additive: boolean; base: Id[] }
  | {
      kind: "resize";
      handle: HandleId;
      ids: Id[];
      boxes: StartBox[];
      bounds: Rect;
      multi: boolean;
      started: boolean;
    }
  | {
      kind: "rotate";
      ids: Id[];
      boxes: StartBox[];
      pivot: Point;
      startAngle: number;
      started: boolean;
    };

/** What the layer needs to know about the session while previewing. */
export type SnapSettings = { snap: boolean; showGuides: boolean };

export const angleOf = (p: Point, about: Point): number =>
  (Math.atan2(p.y - about.y, p.x - about.x) * 180) / Math.PI;

export const sampleOf = (e: {
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}): Sample => ({
  x: e.clientX,
  y: e.clientY,
  shift: e.shiftKey,
  alt: e.altKey,
  meta: e.metaKey || e.ctrlKey,
});

export const startBoxOf = (b: ElementBox): StartBox => ({
  id: b.id,
  rect: b.rect,
  rotation: b.rotation,
  type: b.el.type,
  lockHeight: (b.el.type === "text" || b.el.type === "gap-text") && b.el.style.autoHeight !== false,
  children: b.el.type === "group" ? b.el.children : undefined,
});

export const boundsOfBoxes = (boxes: StartBox[]): Rect =>
  unionRect(boxes.map((b) => rotatedBounds(b.rect, b.rotation)));

/** A group's children scaled with its frame, so the contents follow (`undefined` for others). */
export function childrenFor(b: StartBox, rect: Rect): SlideElement[] | undefined {
  if (!b.children) return undefined;
  const sx = b.rect.w === 0 ? 1 : rect.w / b.rect.w;
  const sy = b.rect.h === 0 ? 1 : rect.h / b.rect.h;
  return scaleGroupChildren(b.children, sx, sy);
}

/** The frame a box would have at `rect`, with a group's children scaled to match. */
const transformAt = (b: StartBox, rect: Rect, rotation = b.rotation): ElementTransform => {
  const children = childrenFor(b, rect);
  return { ...rect, rotation, ...(children ? { children } : null) };
};

/* ------------------------------------------------------------------ */
/* Move                                                                */
/* ------------------------------------------------------------------ */

export type DragPreview = { delta: Point; preview: Map<Id, ElementTransform>; guides: Guide[] };

/**
 * Where a drag puts the selection: the raw delta, Shift-constrained to one axis, snapped to
 * siblings and the stage (unless ⌘ is held), then clamped so no more than `OVERHANG` hangs off.
 */
export function previewDrag(
  g: Extract<Gesture, { kind: "drag" }>,
  s: Sample,
  scale: number,
  targets: SnapTarget[],
  settings: SnapSettings,
): DragPreview {
  const k = scale || 1;
  let dx = (s.x - g.origin.x) / k;
  let dy = (s.y - g.origin.y) / k;

  // Shift constrains to one axis. The frozen axis is passed to the snapper as "no lines may snap
  // here", so neither alignment nor equal spacing can put the movement back.
  const lines: NonNullable<SnapOptions["lines"]> = {};
  if (s.shift) {
    if (Math.abs(dx) >= Math.abs(dy)) {
      dy = 0;
      lines.y = [];
    } else {
      dx = 0;
      lines.x = [];
    }
  }

  let guides: Guide[] = [];
  if (settings.snap && !s.meta) {
    const moved: Rect = { ...g.bounds, x: g.bounds.x + dx, y: g.bounds.y + dy };
    const r = computeMoveSnap(moved, targets, SNAP_THRESHOLD_PX / k, SPACING_THRESHOLD_PX / k, {
      lines,
    });
    dx += r.dx;
    dy += r.dy;
    guides = r.guides;
  }

  const moved: Rect = { ...g.bounds, x: g.bounds.x + dx, y: g.bounds.y + dy };
  const clamped = clampToStage(moved);
  const cdx = clamped.x - moved.x;
  const cdy = clamped.y - moved.y;
  if (cdx || cdy) {
    dx += cdx;
    dy += cdy;
    // The clamp has just pushed the element off whatever it snapped to: drop that guide.
    guides = guides.filter((g2) => !(cdx && g2.axis === "x") && !(cdy && g2.axis === "y"));
  }

  const preview = new Map<Id, ElementTransform>();
  for (const b of g.boxes) {
    preview.set(b.id, {
      x: b.rect.x + dx,
      y: b.rect.y + dy,
      w: b.rect.w,
      h: b.rect.h,
      rotation: b.rotation,
    });
  }
  return { delta: { x: dx, y: dy }, preview, guides: settings.showGuides ? guides : [] };
}

/* ------------------------------------------------------------------ */
/* Resize                                                              */
/* ------------------------------------------------------------------ */

export type ResizePreview = { preview: Map<Id, ElementTransform>; guides: Guide[] };

/**
 * A single element grows along its own axes about the opposite corner (or its centre under Alt);
 * corners keep the aspect for image-like types unless Shift says otherwise, and the dragged edges
 * snap to siblings when the element is unrotated. A multi-selection scales as one box about the
 * handle's anchor, members by their centre so a rotated member keeps its place, with the scale
 * floored once for the whole group so small members cannot shear the arrangement.
 */
export function previewResize(
  g: Extract<Gesture, { kind: "resize" }>,
  s: Sample,
  pointer: Point,
  scale: number,
  targets: SnapTarget[],
  settings: SnapSettings,
): ResizePreview | null {
  const k = scale || 1;
  const corner = g.handle.length === 2;
  const preview = new Map<Id, ElementTransform>();

  if (!g.multi) {
    const b = g.boxes[0];
    if (!b) return null;
    const aspectDefault = ASPECT_LOCKED_TYPES.has(b.type);
    const aspect = corner && (s.shift ? !aspectDefault : aspectDefault);
    let rect = resizeRect({
      handle: g.handle,
      start: b.rect,
      rotation: b.rotation,
      pointer,
      fromCentre: s.alt,
      aspect,
      lockHeight: b.lockHeight,
    });
    let guides: Guide[] = [];
    // `applyEdgeSnap` works in slide axes, so it is only meaningful on an unrotated element.
    if (settings.snap && !s.meta && !s.alt && !aspect && !b.rotation) {
      const r = computeSnap(rect, targets, SNAP_THRESHOLD_PX / k, {
        lines: movingLinesFor(g.handle),
      });
      rect = applyEdgeSnap(rect, g.handle, r.dx, r.dy, MIN_SIZE);
      guides = r.guides;
    }
    preview.set(b.id, transformAt(b, rect));
    return { preview, guides: settings.showGuides ? guides : [] };
  }

  const target = resizeRect({
    handle: g.handle,
    start: g.bounds,
    pointer,
    fromCentre: s.alt,
    aspect: corner ? !s.shift : false,
  });
  const anchor = anchorOf(g.bounds, g.handle, s.alt);
  const sx = clampGroupScale(
    g.bounds.w === 0 ? 1 : target.w / g.bounds.w,
    g.boxes.map((b) => b.rect.w),
  );
  const sy = clampGroupScale(
    g.bounds.h === 0 ? 1 : target.h / g.bounds.h,
    g.boxes.map((b) => b.rect.h),
  );
  for (const b of g.boxes) {
    const r = scaleAbout(b.rect, anchor, sx, sy);
    const h = b.lockHeight ? b.rect.h : r.h;
    const y = b.lockHeight ? r.y + (r.h - h) / 2 : r.y;
    preview.set(b.id, transformAt(b, { x: r.x, y, w: r.w, h }));
  }
  return { preview, guides: [] };
}

/* ------------------------------------------------------------------ */
/* Rotate                                                              */
/* ------------------------------------------------------------------ */

export type RotatePreview = { preview: Map<Id, ElementTransform>; label: number };

/**
 * Snap the *resulting* angle, not the change in angle: an element already at 7° must land on 15°,
 * not on 7 + 15. The delta is derived from the snapped result so a multi-selection stays rigid.
 */
export function previewRotate(
  g: Extract<Gesture, { kind: "rotate" }>,
  s: Sample,
  pointer: Point,
): RotatePreview {
  const raw = angleOf(pointer, g.pivot) - g.startAngle;
  const base = g.boxes[0]?.rotation ?? 0;
  const target = s.meta
    ? base + raw
    : s.alt
      ? Math.round((base + raw) / ROTATE_FINE_DEG) * ROTATE_FINE_DEG
      : snapAngle(base + raw, ROTATE_SNAP_DEG, ROTATE_SNAP_THRESHOLD_DEG);
  const delta = target - base;

  const preview = new Map<Id, ElementTransform>();
  for (const b of g.boxes) {
    const rotation = normaliseAngle(b.rotation + delta);
    if (g.boxes.length === 1) {
      preview.set(b.id, { ...b.rect, rotation });
    } else {
      const c = rotatePoint(centreOf(b.rect), g.pivot, delta);
      preview.set(b.id, {
        x: c.x - b.rect.w / 2,
        y: c.y - b.rect.h / 2,
        w: b.rect.w,
        h: b.rect.h,
        rotation,
      });
    }
  }
  const shown = g.boxes.length === 1 ? normaliseAngle(target) : normaliseAngle(delta);
  return { preview, label: Math.round(shown) };
}

/* ------------------------------------------------------------------ */
/* Commit                                                              */
/* ------------------------------------------------------------------ */

/** The `updateElement` patch that makes a box match what its preview showed. */
export function patchFor(
  kind: "resize" | "rotate",
  b: StartBox,
  shown: ElementTransform,
): Partial<SlideElement> {
  const rect = { x: shown.x, y: shown.y, w: shown.w, h: shown.h };
  const children = kind === "resize" ? childrenFor(b, rect) : undefined;
  return {
    ...rect,
    ...(kind === "rotate" ? { rotation: shown.rotation ?? 0 } : null),
    ...(children ? { children } : null),
  } as Partial<SlideElement>;
}
