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
