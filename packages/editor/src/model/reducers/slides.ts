/** Slide-list reducers: add, insert, duplicate, delete, move, patch. */

import type { Id, Lesson, Slide, SlideKind } from "@tj/domain/documents";
import { cloneSlide, newSlide } from "../factories";
import { edit, editSlide, type WithId } from "./core";

/** `afterId` null/undefined or unknown → append. */
export const insertSlide = (lesson: Lesson, slide: Slide, afterId?: Id | null): Lesson =>
  edit(lesson, (l) => {
    const idx = afterId ? l.slides.findIndex((s) => s.id === afterId) : -1;
    l.slides.splice(idx === -1 ? l.slides.length : idx + 1, 0, slide);
  });

/** A fresh slide of `kind` laid out for the lesson's theme, after `afterId`. */
export function addSlide(lesson: Lesson, kind: SlideKind, afterId?: Id | null): WithId<"id", Id> {
  const slide = newSlide(kind, lesson.themeId);
  return { lesson: insertSlide(lesson, slide, afterId), id: slide.id };
}

/** A deep copy with fresh ids, inserted right after the source. Unknown id → unchanged, `null`. */
export function duplicateSlide(lesson: Lesson, id: Id): WithId<"id", Id | null> {
  const src = lesson.slides.find((s) => s.id === id);
  if (!src) return { lesson, id: null };
  const copy = cloneSlide(src);
  return { lesson: insertSlide(lesson, copy, id), id: copy.id };
}

/** The clipboard half of paste-slide: a clone of `slide` after `afterId`. */
export function pasteSlide(lesson: Lesson, slide: Slide, afterId?: Id | null): WithId<"id", Id> {
  const copy = cloneSlide(slide);
  return { lesson: insertSlide(lesson, copy, afterId), id: copy.id };
}

/** A lesson keeps at least one slide; deleting the last (or an unknown id) is a no-op. */
export function deleteSlide(lesson: Lesson, id: Id): Lesson {
  if (lesson.slides.length <= 1) return lesson;
  const idx = lesson.slides.findIndex((s) => s.id === id);
  if (idx === -1) return lesson;
  return edit(lesson, (l) => {
    l.slides.splice(idx, 1);
  });
}

export const moveSlide = (lesson: Lesson, id: Id, toIndex: number): Lesson =>
  edit(lesson, (l) => {
    const from = l.slides.findIndex((s) => s.id === id);
    if (from === -1) return;
    const [s] = l.slides.splice(from, 1);
    if (s) l.slides.splice(Math.max(0, Math.min(toIndex, l.slides.length)), 0, s);
  });

/**
 * Reorder a set of slides to `toIndex` in one step (the navigator's drag and ⌘↑/↓). The picked
 * slides keep their relative order and land where the insertion line was; unknown ids are ignored.
 * One reducer rather than N `moveSlide`s so the order is computed from the lesson being edited,
 * never from a render that may be a tick behind the cache.
 */
export const moveSlides = (lesson: Lesson, ids: Id[], toIndex: number): Lesson => {
  const order = lesson.slides.map((s) => s.id);
  const set = new Set(ids);
  const picked = order.filter((id) => set.has(id));
  if (picked.length === 0) return lesson;
  const before = order.slice(0, toIndex).filter((id) => !set.has(id)).length;
  const rest = order.filter((id) => !set.has(id));
  const next = [...rest.slice(0, before), ...picked, ...rest.slice(before)];
  if (next.every((id, i) => id === order[i])) return lesson;
  const byId = new Map(lesson.slides.map((s) => [s.id, s]));
  return edit(lesson, (l) => {
    l.slides = next.flatMap((id) => {
      const s = byId.get(id);
      return s ? [s] : [];
    });
  });
};

/** Move a set of slides one place up or down together; already at the end → unchanged. */
export const nudgeSlides = (lesson: Lesson, ids: Id[], dir: -1 | 1): Lesson => {
  const set = new Set(ids);
  const positions = lesson.slides.flatMap((s, i) => (set.has(s.id) ? [i] : []));
  const first = positions[0];
  const last = positions[positions.length - 1];
  if (first === undefined || last === undefined) return lesson;
  const target = dir === -1 ? Math.max(0, first - 1) : Math.min(lesson.slides.length, last + 2);
  return moveSlides(lesson, ids, target);
};

export type SlidePatch = Partial<Omit<Slide, "id" | "elements">>;

export const updateSlide = (lesson: Lesson, id: Id, patch: SlidePatch): Lesson =>
  editSlide(lesson, id, (s) => {
    Object.assign(s, patch);
  });

export const setSlideBackground = (
  lesson: Lesson,
  slideId: Id,
  background: Slide["background"] | undefined,
): Lesson =>
  editSlide(lesson, slideId, (s) => {
    if (background) s.background = background;
    else delete s.background;
  });

export const setSlideNotes = (lesson: Lesson, slideId: Id, notes: string): Lesson =>
  editSlide(lesson, slideId, (s) => {
    if (notes.trim()) s.notes = notes;
    else delete s.notes;
  });
