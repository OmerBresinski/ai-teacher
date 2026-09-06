import type { SlideElement } from "@tj/domain/documents";
import { normaliseAngle } from "../../model/geometry";
import type { ElementBox } from "./hit-test";

/** The live-region sentences the transform layer speaks (TeachDeck `SelectionLayer` :138-159). */

/** A screen-reader name for an element: its own name, else its kind. */
export function nameOf(el: SlideElement): string {
  const named = (el as { name?: string }).name;
  if (named) return named;
  if (el.type === "image") return el.alt ? `Image, ${el.alt}` : "Image";
  return el.type.replace("-", " ").replace(/^./, (c) => c.toUpperCase());
}

export function describeBoxes(boxes: ElementBox[]): string {
  const [b] = boxes;
  if (!b) return "Nothing selected";
  if (boxes.length > 1) return `${boxes.length} elements selected`;
  const r = b.rect;
  const parts = [
    `${nameOf(b.el)} selected`,
    `x ${Math.round(r.x)}, y ${Math.round(r.y)}`,
    `${Math.round(r.w)} by ${Math.round(r.h)} points`,
  ];
  if (b.rotation) parts.push(`rotated ${Math.round(normaliseAngle(b.rotation))} degrees`);
  if (b.locked) parts.push("locked");
  return parts.join(", ");
}
