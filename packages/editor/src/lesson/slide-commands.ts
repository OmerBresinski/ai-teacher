import type { Id, Lesson, SlideKind } from "@tj/domain/documents";
import * as reducers from "../model/reducers";
import type { HistoryApi } from "./document-context";
import type { SessionActions } from "./use-editor-session";

/**
 * The slide-level commands behind the action pill, the navigator and the canvas keys (TeachDeck
 * `components/editor/canvas/slide-commands.ts`), kept out of the components so each action has
 * exactly one implementation and can be tested for what it leaves in the undo stack. TeachDeck's
 * read a global store; these take the history API, the lesson and the session actions.
 *
 * Each is a single reducer, so already one history entry. Inserting a slide also makes it the
 * active one, as TeachDeck's `insertSlide` did.
 */

export type SlideCommandDeps = {
  history: HistoryApi;
  lesson: Lesson;
  session: Pick<SessionActions, "setActiveSlide">;
};

export const slideIndex = (lesson: Lesson, id: Id): number =>
  lesson.slides.findIndex((s) => s.id === id);

export function duplicateSlide({ history, session }: SlideCommandDeps, id: Id): Id | null {
  const made = history.dispatch(reducers.duplicateSlide, id);
  const copy = made?.id ?? null;
  if (copy) session.setActiveSlide(copy);
  return copy;
}

export function addSlideAfter(
  { history, session }: SlideCommandDeps,
  afterId: Id | null,
  kind: SlideKind,
): Id | null {
  const made = history.dispatch(reducers.addSlide, kind, afterId);
  const id = made?.id ?? null;
  if (id) session.setActiveSlide(id);
  return id;
}

/** Deleting the active slide moves to its neighbour; the last slide never goes. */
export function deleteSlide(
  { history, lesson, session }: SlideCommandDeps,
  id: Id,
  activeSlideId: Id | null,
): void {
  if (lesson.slides.length <= 1) return;
  const idx = slideIndex(lesson, id);
  if (idx === -1) return;
  const next = history.dispatch(reducers.deleteSlide, id);
  if (!next || next === lesson) return;
  const wasActive = activeSlideId === id || (activeSlideId === null && idx === 0);
  if (wasActive) {
    const neighbour = next.slides[Math.min(idx, next.slides.length - 1)];
    if (neighbour) session.setActiveSlide(neighbour.id);
  }
}

export const canMoveSlide = (lesson: Lesson, id: Id, dir: -1 | 1): boolean => {
  const i = slideIndex(lesson, id);
  return i !== -1 && i + dir >= 0 && i + dir < lesson.slides.length;
};

export function moveSlideBy({ history, lesson }: SlideCommandDeps, id: Id, dir: -1 | 1): void {
  if (!canMoveSlide(lesson, id, dir)) return;
  history.dispatch(reducers.moveSlide, id, slideIndex(lesson, id) + dir);
}
