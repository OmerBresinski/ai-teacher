import { type Id, SLIDE_H, SLIDE_W, type SlideElement } from "@tj/domain/documents";
import {
  centre,
  clamp,
  contains,
  type Point,
  type Rect,
  rectOf,
  rotatedBounds,
  rotatePoint,
  unionRect,
} from "../../model/geometry";
import { OVERHANG } from "./constants";

/** Pure hit-testing for the transform layer (TeachDeck `transform/hit-test.ts`). */

export type ElementBox = {
  id: Id;
  rect: Rect;
  rotation: number;
  locked: boolean;
  el: SlideElement;
};

/** Flat, draw-ordered boxes for a slide. Groups are a single box (flat multi-select). */
export function boxesOf(elements: readonly SlideElement[]): ElementBox[] {
  return elements.map((el) => ({
    id: el.id,
    rect: rectOf(el),
    rotation: el.rotation ?? 0,
    locked: !!el.locked,
    el,
  }));
}

/** True if `p` (slide space) is inside the element, honouring its rotation. */
export function hitsBox(box: ElementBox, p: Point, slop = 0): boolean {
  const local = box.rotation ? rotatePoint(p, centre(box.rect), -box.rotation) : p;
  const r = box.rect;
  return (
    local.x >= r.x - slop &&
    local.x <= r.x + r.w + slop &&
    local.y >= r.y - slop &&
    local.y <= r.y + r.h + slop
  );
}

/** Topmost element under the point, or null. Locked elements are selectable. */
export function hitTest(boxes: ElementBox[], p: Point, slop = 0): ElementBox | null {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const box = boxes[i];
    if (box && hitsBox(box, p, slop)) return box;
  }
  return null;
}

/** Fully-enclosed marquee selection (Canva / Slides / Keynote behaviour). */
export function marqueeHits(boxes: ElementBox[], marquee: Rect): Id[] {
  return boxes.filter((b) => contains(marquee, rotatedBounds(b.rect, b.rotation))).map((b) => b.id);
}

/** Axis-aligned bounds of a set of boxes, each already rotated. */
export function boundsOf(boxes: ElementBox[]): Rect {
  return unionRect(boxes.map((b) => rotatedBounds(b.rect, b.rotation)));
}

/** The four corners of a (possibly rotated) rect, in slide space, from nw clockwise. */
export function cornersOf(r: Rect, rotation = 0): Point[] {
  const c = centre(r);
  const pts: Point[] = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
  return rotation ? pts.map((p) => rotatePoint(p, c, rotation)) : pts;
}

/**
 * Clamp a rect to the stage, allowing OVERHANG points of it to hang off any edge — "actively
 * prevent dragging an element off the slide" (TeachDeck research/01 §7).
 */
export function clampToStage(r: Rect): Point {
  const clampAxis = (v: number, size: number, stage: number) => {
    const min = -OVERHANG;
    const max = stage - size + OVERHANG;
    return min <= max ? clamp(v, min, max) : clamp(v, max, min);
  };
  return { x: clampAxis(r.x, r.w, SLIDE_W), y: clampAxis(r.y, r.h, SLIDE_H) };
}
