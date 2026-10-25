/**
 * Where the tick on a revealed right card goes (choose, odd one out), so it never covers words
 * (TEACH-101 part h). Pure geometry in slide space, so the renderer and the tests agree without
 * measuring the DOM. The hinge draws its own tick (`HingeMarks`).
 */
import type { Slide, SlideElement } from "@tj/domain/documents";
import { SLIDE_H, SLIDE_W } from "@tj/domain/documents";
import { isBackdrop } from "@tj/slides";

export type Box = { x: number; y: number; w: number; h: number };

/** Strict overlap: two boxes that only touch along an edge do not intersect. */
export const intersects = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** An element that draws words: a text box, a gap text, an option, or a shape with a label. */
export function hasText(el: SlideElement): boolean {
  if (el.type === "text" || el.type === "gap-text" || el.type === "option") return true;
  if (el.type === "shape" && "doc" in el && el.doc) {
    const walk = (n: { text?: string; content?: unknown[] }): boolean =>
      !!n.text?.trim() || (n.content ?? []).some((c) => walk(c as typeof n));
    return walk(el.doc as { content?: unknown[] });
  }
  return false;
}

/** Every box on the slide that draws words, in slide space (groups walked), but `except`. */
export function wordBoxes(slide: Slide, except?: string): Box[] {
  const out: Box[] = [];
  const walk = (els: readonly SlideElement[], dx: number, dy: number) => {
    for (const el of els) {
      if (el.id === except) continue;
      if (el.type === "group") walk(el.children, el.x + dx, el.y + dy);
      else if (!isBackdrop(el) && hasText(el))
        out.push({ x: el.x + dx, y: el.y + dy, w: el.w, h: el.h });
    }
  };
  walk(slide.elements, 0, 0);
  return out;
}

/** The tick's diameter, and its inset inside a card's corner. */
export const TICK_D = 36;
const INSET = 10;
/** How far a perched tick may hang past the card's side (cards sit 16 apart). */
const SIDE_OUT = 18;

/**
 * The tick's spot, relative to the card, first clear of every word on the slide and on the slide:
 * inside the top-right corner (over a picture, or above a short word), then inside the bottom-right
 * corner (a word card's word stops above its letter badge, which sits bottom centre), then perched
 * half out of the top-right corner, then the top-left equivalents. When nothing is clear (only an
 * over-full card the template already flags) it keeps the top-right corner.
 */
export function tickSpot(slide: Slide, card: Box & { id?: string }): { left: number; top: number } {
  const { w, h } = card;
  const spots = [
    { left: w - INSET - TICK_D, top: INSET },
    { left: w - INSET - TICK_D, top: h - INSET - TICK_D },
    { left: w - TICK_D + SIDE_OUT, top: -SIDE_OUT },
    { left: INSET, top: INSET },
    { left: INSET, top: h - INSET - TICK_D },
    { left: -SIDE_OUT, top: -SIDE_OUT },
  ];
  const words = wordBoxes(slide, card.id);
  const at = (s: { left: number; top: number }): Box => ({
    x: card.x + s.left,
    y: card.y + s.top,
    w: TICK_D,
    h: TICK_D,
  });
  const onSlide = (b: Box) => b.x >= 0 && b.y >= 0 && b.x + b.w <= SLIDE_W && b.y + b.h <= SLIDE_H;
  const clear = spots.find((s) => onSlide(at(s)) && !words.some((b) => intersects(at(s), b)));
  return clear ?? (spots[0] as { left: number; top: number });
}
