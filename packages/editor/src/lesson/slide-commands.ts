import {
  checkLesson,
  type Id,
  type Lesson,
  type Slide,
  type SlideKind,
} from "@tj/domain/documents";
import { toast } from "@tj/ui";
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
  session: Pick<SessionActions, "setActiveSlide" | "openRegenerate">;
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

/** Insert a slide the activity picker built (TEACH-185) after `afterId` and make it active. */
export function insertSlideAfter(
  { history, session }: SlideCommandDeps,
  afterId: Id | null,
  slide: Slide,
): Id {
  history.dispatch(reducers.insertSlide, slide, afterId);
  session.setActiveSlide(slide.id);
  return slide.id;
}

/** The objectives `objective-taught` names (ruling 81), after the teacher's ignores. */
const untaught = (lesson: Lesson): Set<string> =>
  new Set(
    checkLesson(lesson)
      .filter((f) => f.check === "objective-taught" && f.target.factId !== undefined)
      .map((f) => f.target.factId as string),
  );

/** "2" / "1 and 3" / "1, 2 and 4". */
function numberList(numbers: readonly number[]): string {
  if (numbers.length === 1) return String(numbers[0]);
  return `${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
}

/**
 * The toast when a delete leaves an objective with no slide that teaches it (ruling 96): "Slide 5
 * deleted. Objective 2 is no longer taught on any slide." `null` when no objective lost its last
 * teaching slide. `slideNumbers` are the deleted slides' 1-based positions before the delete.
 */
export function untaughtAfterDelete(
  before: Lesson,
  after: Lesson,
  slideNumbers: readonly number[],
): string | null {
  const was = untaught(before);
  const lost = [...untaught(after)].filter((id) => !was.has(id));
  if (lost.length === 0 || slideNumbers.length === 0) return null;
  const numbers = (after.facts?.objectives ?? [])
    .map((o, i) => (lost.includes(o.id) ? i + 1 : 0))
    .filter((n) => n > 0);
  const slides = `${slideNumbers.length === 1 ? "Slide" : "Slides"} ${numberList(slideNumbers)}`;
  const objectives = `${numbers.length === 1 ? "Objective" : "Objectives"} ${numberList(numbers)}`;
  const verb = numbers.length === 1 ? "is" : "are";
  return `${slides} deleted. ${objectives} ${verb} no longer taught on any slide.`;
}

/** Toast what `untaughtAfterDelete` found, with Undo (one step: the delete). */
export function toastUntaught(
  history: Pick<HistoryApi, "undo">,
  before: Lesson,
  after: Lesson,
  slideNumbers: readonly number[],
): void {
  const message = untaughtAfterDelete(before, after, slideNumbers);
  if (message) toast(message, { action: { label: "Undo", onClick: () => history.undo() } });
}

/**
 * Deleting the active slide moves to its neighbour; the last slide never goes. When the slide was
 * the last one teaching an objective, a toast names the objective and offers Undo (ruling 96).
 */
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
  toastUntaught(history, lesson, next, [idx + 1]);
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

/**
 * "Regenerate slide…" (TEACH-134, ADR 0025 §18): makes the slide active and opens the Regenerate
 * dialog for it. No document write here — the proposal the job returns is the undo step.
 */
export function regenerateSlide({ lesson, session }: SlideCommandDeps, id: Id): void {
  if (slideIndex(lesson, id) === -1) return;
  session.setActiveSlide(id);
  session.openRegenerate({ slideId: id });
}
