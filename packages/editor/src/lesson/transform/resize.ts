import { centre, type Point, type Rect, rotatePoint } from "../../model/geometry";
import { HANDLE_DIR, type HandleId, MIN_SIZE } from "./constants";

/** Pure resize maths for the transform layer (TeachDeck `transform/resize.ts`). */

export type ResizeInput = {
  handle: HandleId;
  /** The rect at gesture start. */
  start: Rect;
  /** Element rotation in degrees; the drag works in the element's own axes. */
  rotation?: number;
  /** Pointer position in slide points. */
  pointer: Point;
  /** Alt: resize about the centre instead of the opposite corner. */
  fromCentre?: boolean;
  /** Keep the start aspect ratio (corner handles only). */
  aspect?: boolean;
  /** Auto-height text: the width reflows, the height is the renderer's business. */
  lockHeight?: boolean;
  minSize?: number;
};

/**
 * Rotation-aware resize. The anchor (the opposite corner, or the centre under Alt) stays put in
 * *world* space while the box grows along its own axes.
 */
export function resizeRect(input: ResizeInput): Rect {
  const { handle, start, pointer } = input;
  const rotation = input.rotation ?? 0;
  const min = input.minSize ?? MIN_SIZE;
  const d = HANDLE_DIR[handle];
  const c0 = centre(start);
  const w0 = start.w;
  const h0 = start.h;

  // Pointer in the element's unrotated frame, relative to the start centre.
  const m = rotatePoint(pointer, c0, -rotation);
  const local: Point = { x: m.x - c0.x, y: m.y - c0.y };

  // The fixed point, in the same local frame.
  const anchor: Point = { x: (-d.x * w0) / 2, y: (-d.y * h0) / 2 };

  // Unclamped first: MIN_SIZE has to be applied *after* the aspect solve, or a corner drag that
  // bottoms out on one axis feeds a distorted ratio into it.
  let w = w0;
  let h = h0;
  if (input.fromCentre) {
    if (d.x) w = 2 * d.x * local.x;
    if (d.y) h = 2 * d.y * local.y;
  } else {
    if (d.x) w = d.x * (local.x - anchor.x);
    if (d.y) h = d.y * (local.y - anchor.y);
  }

  if (input.aspect && d.x !== 0 && d.y !== 0 && w0 > 0 && h0 > 0) {
    const sx = w / w0;
    const sy = h / h0;
    let s = Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy;
    s = Math.max(s, min / w0, min / h0);
    w = w0 * s;
    h = h0 * s;
  } else {
    if (d.x) w = Math.max(min, w);
    if (d.y) h = Math.max(min, h);
  }

  if (input.lockHeight) h = h0;

  if (input.fromCentre) return { x: c0.x - w / 2, y: c0.y - h / 2, w, h };

  // Move the centre so the world-space anchor is unchanged.
  const anchor2: Point = { x: (-d.x * w) / 2, y: (-d.y * h) / 2 };
  const shift = rotatePoint(
    { x: anchor.x - anchor2.x, y: anchor.y - anchor2.y },
    { x: 0, y: 0 },
    rotation,
  );
  const c = { x: c0.x + shift.x, y: c0.y + shift.y };
  return { x: c.x - w / 2, y: c.y - h / 2, w, h };
}

/** Which lines of the rect the drag is moving — used to restrict snapping. */
export function movingLinesFor(handle: HandleId): { x: ("min" | "max")[]; y: ("min" | "max")[] } {
  const d = HANDLE_DIR[handle];
  const pick = (v: number): ("min" | "max")[] => (v > 0 ? ["max"] : v < 0 ? ["min"] : []);
  return { x: pick(d.x), y: pick(d.y) };
}

/**
 * Apply a snap delta to the dragged edges only, leaving the anchor put.
 *
 * This works in *slide* axes, so it is only meaningful for an unrotated element: `dx`/`dy` come
 * from `computeSnap`, which compares axis-aligned lines. Callers must therefore fence it off with
 * `!rotation` — a rotated element deliberately does not snap while being resized.
 */
export function applyEdgeSnap(rect: Rect, handle: HandleId, dx: number, dy: number, min: number) {
  const d = HANDLE_DIR[handle];
  const out = { ...rect };
  if (d.x > 0) out.w = Math.max(min, rect.w + dx);
  else if (d.x < 0) {
    const w = Math.max(min, rect.w - dx);
    out.x = rect.x + rect.w - w;
    out.w = w;
  }
  if (d.y > 0) out.h = Math.max(min, rect.h + dy);
  else if (d.y < 0) {
    const h = Math.max(min, rect.h - dy);
    out.y = rect.y + rect.h - h;
    out.h = h;
  }
  return out;
}

/** Scale a child rect with its group's bounding box (both unrotated). */
export function scaleWithin(child: Rect, from: Rect, to: Rect): Rect {
  const sx = from.w === 0 ? 1 : to.w / from.w;
  const sy = from.h === 0 ? 1 : to.h / from.h;
  return {
    x: to.x + (child.x - from.x) * sx,
    y: to.y + (child.y - from.y) * sy,
    w: child.w * sx,
    h: child.h * sy,
  };
}

/**
 * The world-space point a resize keeps fixed: the opposite corner or edge, or the centre under
 * Alt. Axes the handle does not drive use the centre, which is harmless because they do not scale.
 */
export function anchorOf(from: Rect, handle: HandleId, fromCentre = false): Point {
  const c = centre(from);
  if (fromCentre) return c;
  const d = HANDLE_DIR[handle];
  return {
    x: d.x > 0 ? from.x : d.x < 0 ? from.x + from.w : c.x,
    y: d.y > 0 ? from.y : d.y < 0 ? from.y + from.h : c.y,
  };
}

/**
 * Scale a rect about a fixed point. The *centre* is scaled, not the top-left corner, so a rotated
 * member keeps its place relative to the frame — its rotated bounds are what the frame was built
 * from, and only its centre is invariant under rotation.
 */
export function scaleAbout(rect: Rect, anchor: Point, sx: number, sy: number): Rect {
  const c = centre(rect);
  const w = rect.w * sx;
  const h = rect.h * sy;
  return {
    x: anchor.x + (c.x - anchor.x) * sx - w / 2,
    y: anchor.y + (c.y - anchor.y) * sy - h / 2,
    w,
    h,
  };
}

/**
 * The group scale, floored so the *whole* arrangement stops shrinking together when its smallest
 * member reaches `minSize`. Clamping each member on its own shears the layout; clamping once here
 * does not. Never forces a scale above 1, so a member that is already under the floor cannot block
 * a shrink outright.
 */
export function clampGroupScale(s: number, sizes: number[], minSize = MIN_SIZE): number {
  let need = 0;
  for (const v of sizes) if (v > 0) need = Math.max(need, minSize / v);
  return Math.max(s, Math.min(need, 1));
}

/**
 * Scale a group's children, which are stored in the group's *local* space (origin at the group's
 * top-left), so the contents follow the frame. Recurses, in case a group ever contains a group.
 */
export function scaleGroupChildren<T extends { x: number; y: number; w: number; h: number }>(
  children: readonly T[],
  sx: number,
  sy: number,
): T[] {
  return children.map((child) => {
    const next: T = {
      ...child,
      x: child.x * sx,
      y: child.y * sy,
      w: child.w * sx,
      h: child.h * sy,
    };
    const kids = (child as { children?: readonly T[] }).children;
    if (Array.isArray(kids)) {
      (next as { children?: T[] }).children = scaleGroupChildren(kids, sx, sy);
    }
    return next;
  });
}
