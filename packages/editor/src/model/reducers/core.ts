/**
 * Shared plumbing for the pure lesson reducers (ADR 0022 §4). A reducer is
 * `(lesson, ...args) => Lesson` (or `{ lesson, id }` when it mints ids). Bodies are TeachDeck's
 * `lesson-store.ts` `mutate(...)` callbacks run through immer, so unchanged slides keep their
 * identity and the canvas can memoise rows on it.
 */

import type { Id, Lesson, Slide, SlideElement } from "@tj/domain/documents";
import { produce } from "immer";
import { now } from "../factories";

/** A reducer result that also reports the id(s) it minted. */
export type WithId<K extends string, V> = { lesson: Lesson } & { [P in K]: V };

/**
 * Marks a reducer whose write is bookkeeping, not an edit: `useDocumentHistory` applies it
 * without recording an undo step (TeachDeck paused zundo for `setFitVersion` and
 * `updateElementLayout`).
 */
export const SILENT = Symbol("silent-reducer");

export type SilentReducer<F> = F & { readonly [SILENT]: true };

export function silent<F extends (...args: never[]) => unknown>(reducer: F): SilentReducer<F> {
  return Object.assign(reducer, { [SILENT]: true as const });
}

export function isSilentReducer(reducer: unknown): boolean {
  return typeof reducer === "function" && (reducer as { [SILENT]?: true })[SILENT] === true;
}

/**
 * Apply `fn` to a draft of the lesson. Returns the same object when the draft was left untouched,
 * so callers (and the history hook) can tell a no-op from an edit by identity; otherwise stamps
 * `updatedAt`.
 */
export function edit(lesson: Lesson, fn: (draft: Lesson) => void): Lesson {
  const next = produce(lesson, (draft) => {
    fn(draft);
  });
  if (next === lesson) return lesson;
  return { ...next, updatedAt: now() };
}

/** Like `edit`, without the `updatedAt` stamp — for silent bookkeeping writes. */
export function editQuietly(lesson: Lesson, fn: (draft: Lesson) => void): Lesson {
  return produce(lesson, (draft) => {
    fn(draft);
  });
}

/** Edit one slide; a missing slide is a no-op that returns the same lesson. */
export function editSlide(
  lesson: Lesson,
  slideId: Id,
  fn: (slide: Slide, lesson: Lesson) => void,
): Lesson {
  return edit(lesson, (draft) => {
    const slide = draft.slides.find((s) => s.id === slideId);
    if (slide) fn(slide, draft);
  });
}

/** Top-level element or a group's direct child. */
export function findElement(slide: Slide, id: Id): SlideElement | undefined {
  for (const el of slide.elements) {
    if (el.id === id) return el;
    if (el.type === "group") {
      const inner = el.children.find((c) => c.id === id);
      if (inner) return inner;
    }
  }
  return undefined;
}
