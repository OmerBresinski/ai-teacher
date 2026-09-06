/** Element reducers on one slide: add, patch, transform, delete, duplicate, paste. */

import type { Id, Lesson, SlideElement } from "@tj/domain/documents";
import { cloneElement } from "../factories";
import { rectOf, unionRect } from "../geometry";
import { editQuietly, editSlide, findElement, silent, type WithId } from "./core";

export const addElement = (lesson: Lesson, el: SlideElement, slideId: Id): Lesson =>
  editSlide(lesson, slideId, (s) => {
    s.elements.push(el);
  });

export const addElements = (lesson: Lesson, els: SlideElement[], slideId: Id): Lesson =>
  editSlide(lesson, slideId, (s) => {
    s.elements.push(...els);
  });

export type ElementPatch<T extends SlideElement = SlideElement> = Partial<T> | ((el: T) => void);

/** Patch by object or by a mutator run on the immer draft. Reaches into a group's children. */
export const updateElement = <T extends SlideElement>(
  lesson: Lesson,
  slideId: Id,
  id: Id,
  patch: ElementPatch<T>,
): Lesson =>
  editSlide(lesson, slideId, (s) => {
    const el = findElement(s, id);
    if (!el) return;
    if (typeof patch === "function") patch(el as T);
    else Object.assign(el, patch);
  });

export const updateElements = (
  lesson: Lesson,
  slideId: Id,
  ids: Id[],
  patch: Partial<SlideElement>,
): Lesson =>
  editSlide(lesson, slideId, (s) => {
    for (const id of ids) {
      const el = findElement(s, id);
      if (el) Object.assign(el, patch);
    }
  });

/**
 * Layout-driven write (auto-height measurement) on a specific slide. Silent: no undo step of its
 * own and no `updatedAt`; it merges into the next real edit's history entry. A change under half a
 * point is ignored so measurement jitter never dirties the document.
 */
export const updateElementLayout = silent(
  (lesson: Lesson, slideId: Id, id: Id, patch: Partial<Pick<SlideElement, "w" | "h">>): Lesson => {
    const slide = lesson.slides.find((sl) => sl.id === slideId);
    const cur = slide ? findElement(slide, id) : undefined;
    if (!cur) return lesson;
    const same =
      (patch.w === undefined || Math.abs(patch.w - cur.w) < 0.5) &&
      (patch.h === undefined || Math.abs(patch.h - cur.h) < 0.5);
    if (same) return lesson;
    return editQuietly(lesson, (draft) => {
      const sl = draft.slides.find((x) => x.id === slideId);
      const el = sl ? findElement(sl, id) : undefined;
      if (el) Object.assign(el, patch);
    });
  },
);

export type Transform = {
  dx?: number;
  dy?: number;
  scale?: number;
  rotation?: number;
  origin?: { x: number; y: number };
};

/**
 * Move / scale / rotate a set of elements as one unit. `scale` multiplies sizes and re-anchors
 * positions about `origin` (defaults to the selection's centre). Locked elements are skipped.
 */
export const transformElements = (lesson: Lesson, slideId: Id, ids: Id[], t: Transform): Lesson =>
  editSlide(lesson, slideId, (s) => {
    const els = s.elements.filter((e) => ids.includes(e.id) && !e.locked);
    if (els.length === 0) return;
    const bounds = unionRect(els.map(rectOf));
    const origin = t.origin ?? { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
    const k = t.scale ?? 1;
    for (const el of els) {
      if (k !== 1) {
        el.x = origin.x + (el.x - origin.x) * k;
        el.y = origin.y + (el.y - origin.y) * k;
        el.w = Math.max(1, el.w * k);
        el.h = Math.max(1, el.h * k);
      }
      el.x += t.dx ?? 0;
      el.y += t.dy ?? 0;
      if (t.rotation) el.rotation = ((el.rotation ?? 0) + t.rotation) % 360;
    }
  });

/**
 * Remove elements. Inside groups: an emptied group is dropped, a single survivor is unwrapped into
 * slide space, otherwise the group rect is re-fitted around the survivors.
 */
export const deleteElements = (lesson: Lesson, slideId: Id, ids: Id[]): Lesson => {
  const gone = new Set(ids);
  return editSlide(lesson, slideId, (s) => {
    const next: SlideElement[] = [];
    for (const el of s.elements) {
      if (gone.has(el.id)) continue;
      if (el.type !== "group") {
        next.push(el);
        continue;
      }
      const children = el.children.filter((c) => !gone.has(c.id));
      if (children.length === 0) continue;
      const [only] = children;
      if (children.length === 1 && only) {
        next.push({ ...only, x: only.x + el.x, y: only.y + el.y });
        continue;
      }
      if (children.length === el.children.length) {
        next.push(el);
        continue;
      }
      const local = unionRect(children.map(rectOf));
      el.children = children.map((c) => ({ ...c, x: c.x - local.x, y: c.y - local.y }));
      el.x += local.x;
      el.y += local.y;
      el.w = local.w;
      el.h = local.h;
      next.push(el);
    }
    if (next.length !== s.elements.length || next.some((el, i) => el !== s.elements[i])) {
      s.elements = next;
    }
  });
};

/** Copies with fresh ids, offset diagonally (TeachDeck default 16 points), appended on top. */
export function duplicateElements(
  lesson: Lesson,
  slideId: Id,
  ids: Id[],
  offset = 16,
): WithId<"ids", Id[]> {
  const slide = lesson.slides.find((s) => s.id === slideId);
  if (!slide) return { lesson, ids: [] };
  const copies = slide.elements
    .filter((e) => ids.includes(e.id))
    .map((e) => {
      const c = cloneElement(e);
      c.x += offset;
      c.y += offset;
      return c;
    });
  if (copies.length === 0) return { lesson, ids: [] };
  return { lesson: addElements(lesson, copies, slideId), ids: copies.map((c) => c.id) };
}

/**
 * The document half of paste: clones of the clipboard elements, offset by 16, appended on top.
 * Returns the copies too so the caller can keep them as the next clipboard (each paste lands
 * further along, as TeachDeck's did).
 */
export function pasteElements(
  lesson: Lesson,
  els: SlideElement[],
  slideId: Id,
): WithId<"ids", Id[]> & { copies: SlideElement[] } {
  if (els.length === 0) return { lesson, ids: [], copies: [] };
  const copies = els.map((e) => {
    const c = cloneElement(e);
    c.x += 16;
    c.y += 16;
    return c;
  });
  return { lesson: addElements(lesson, copies, slideId), ids: copies.map((c) => c.id), copies };
}
