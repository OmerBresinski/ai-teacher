/** Arrangement reducers: draw order, alignment, distribution, grouping. */

import { type Id, type Lesson, SLIDE_H, SLIDE_W, type SlideElement } from "@tj/domain/documents";
import { uid } from "../factories";
import { rectOf, unionRect } from "../geometry";
import { editSlide, type WithId } from "./core";

export type Align = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
export type Reorder = "front" | "back" | "forward" | "backward";

/** Move the picked elements in draw order; `forward`/`backward` step each one place. */
export const reorder = (lesson: Lesson, slideId: Id, ids: Id[], how: Reorder): Lesson =>
  editSlide(lesson, slideId, (s) => {
    const picked = s.elements.filter((e) => ids.includes(e.id));
    if (picked.length === 0) return;
    const rest = s.elements.filter((e) => !ids.includes(e.id));
    if (how === "front") s.elements = [...rest, ...picked];
    else if (how === "back") s.elements = [...picked, ...rest];
    else {
      const order = [...s.elements];
      const indices = picked.map((p) => order.indexOf(p));
      const dir = how === "forward" ? 1 : -1;
      const sorted = dir === 1 ? indices.sort((a, b) => b - a) : indices.sort((a, b) => a - b);
      for (const i of sorted) {
        const j = i + dir;
        const a = order[i];
        const b = order[j];
        if (!a || !b || ids.includes(b.id)) continue;
        order[i] = b;
        order[j] = a;
      }
      s.elements = order;
    }
  });

/** A single element aligns to the slide; several align to their union rect. */
export const align = (lesson: Lesson, slideId: Id, ids: Id[], how: Align): Lesson =>
  editSlide(lesson, slideId, (s) => {
    const els = s.elements.filter((e) => ids.includes(e.id));
    if (els.length === 0) return;
    const target =
      els.length === 1 ? { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H } : unionRect(els.map(rectOf));
    for (const el of els) {
      switch (how) {
        case "left":
          el.x = target.x;
          break;
        case "hcenter":
          el.x = target.x + (target.w - el.w) / 2;
          break;
        case "right":
          el.x = target.x + target.w - el.w;
          break;
        case "top":
          el.y = target.y;
          break;
        case "vcenter":
          el.y = target.y + (target.h - el.h) / 2;
          break;
        case "bottom":
          el.y = target.y + target.h - el.h;
          break;
      }
    }
  });

/** Equal gaps between three or more elements; the outer two stay put. */
export const distribute = (lesson: Lesson, slideId: Id, ids: Id[], axis: "h" | "v"): Lesson =>
  editSlide(lesson, slideId, (s) => {
    const els = s.elements.filter((e) => ids.includes(e.id));
    if (els.length < 3) return;
    const key = axis === "h" ? "x" : "y";
    const size = axis === "h" ? "w" : "h";
    els.sort((a, b) => a[key] - b[key]);
    const first = els[0];
    const last = els[els.length - 1];
    if (!first || !last) return;
    const total = last[key] + last[size] - first[key];
    const occupied = els.reduce((acc, e) => acc + e[size], 0);
    const gap = (total - occupied) / (els.length - 1);
    let cursor = first[key];
    for (const el of els) {
      el[key] = cursor;
      cursor += el[size] + gap;
    }
  });

/**
 * Wrap two or more non-group elements in a group at their union rect; children move to
 * group-local coordinates. The group takes the draw position of the topmost picked element.
 */
export function group(lesson: Lesson, slideId: Id, ids: Id[]): WithId<"id", Id | null> {
  if (ids.length < 2) return { lesson, id: null };
  const groupId = uid();
  let made = false;
  const next = editSlide(lesson, slideId, (s) => {
    const picked = s.elements.filter((e) => ids.includes(e.id) && e.type !== "group");
    if (picked.length < 2) return;
    const bounds = unionRect(picked.map(rectOf));
    const children = picked.map((e) => ({ ...e, x: e.x - bounds.x, y: e.y - bounds.y }));
    const top = picked[picked.length - 1];
    const insertAt = top ? s.elements.indexOf(top) : s.elements.length;
    s.elements = s.elements.filter((e) => !picked.includes(e));
    s.elements.splice(Math.min(insertAt, s.elements.length), 0, {
      id: groupId,
      type: "group",
      ...bounds,
      children,
    });
    made = true;
  });
  return { lesson: next, id: made ? groupId : null };
}

/** Replace a group with its children in slide space, in the group's draw position. */
export function ungroup(lesson: Lesson, slideId: Id, id: Id): WithId<"ids", Id[]> {
  let childIds: Id[] = [];
  const next = editSlide(lesson, slideId, (s) => {
    const idx = s.elements.findIndex((e) => e.id === id);
    const g = s.elements[idx];
    if (g?.type !== "group") return;
    const children: SlideElement[] = g.children.map((c) => ({
      ...c,
      x: c.x + g.x,
      y: c.y + g.y,
    }));
    childIds = children.map((c) => c.id);
    s.elements.splice(idx, 1, ...children);
  });
  return { lesson: next, ids: childIds };
}
