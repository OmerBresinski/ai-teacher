/**
 * Words inside an adaptive layout group are typed on the slide (TEACH-205 part b): the group is one
 * box to the selection, but a double-click reaches the bound text under the pointer. Pure.
 */
import { type GroupElement, isLayoutGroup, type SlideElement } from "@tj/domain/documents";
import { boundPath } from "@tj/slides/layout-paths";
import type { Point, Rect } from "../../model/geometry";
import { isTextEditable } from "./constants";
import type { ElementBox } from "./hit-test";

/** Points: the least height a layout's text box counts as to a double-click. */
const MIN_HIT_H = 16;

/** A layout child's box on the slide (a layout group is never rotated by its template). */
export const childRect = (g: GroupElement, c: SlideElement): Rect => ({
  x: g.x + c.x,
  y: g.y + c.y,
  w: c.w,
  h: c.h,
});

/** The typed-into text of a layout group under `p`: the topmost child bound to one of its words. */
export function layoutTextAt(el: SlideElement, p: Point): SlideElement | undefined {
  if (!isLayoutGroup(el) || el.rotation) return undefined;
  for (let i = el.children.length - 1; i >= 0; i--) {
    const c = el.children[i] as SlideElement;
    if (!boundPath(el.id, c.id) || !isTextEditable(c)) continue;
    const r = childRect(el, c);
    // A box is never thinner than a line to the pointer (an empty field measures next to nothing).
    const h = Math.max(r.h, MIN_HIT_H);
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + h) return c;
  }
  return undefined;
}

/** The box of a layout child being typed into, as the stage's hole (`id` is not a top-level box). */
export function layoutChildBox(boxes: readonly ElementBox[], id: string): ElementBox | undefined {
  for (const b of boxes) {
    if (b.el.type !== "group" || !isLayoutGroup(b.el)) continue;
    const c = b.el.children.find((x) => x.id === id);
    if (c) return { id, rect: childRect(b.el, c), rotation: 0, locked: false, el: c };
  }
  return undefined;
}

/** The layout group a child id belongs to, if any. */
export function layoutGroupOfChild(
  boxes: readonly ElementBox[],
  id: string | null | undefined,
): ElementBox | undefined {
  if (!id) return undefined;
  return boxes.find(
    (b) => b.el.type === "group" && isLayoutGroup(b.el) && b.el.children.some((c) => c.id === id),
  );
}
