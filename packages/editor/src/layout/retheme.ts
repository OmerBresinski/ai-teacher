import type { Id, Lesson, Theme } from "@tj/domain/documents";
import * as reducers from "../model/reducers";
import { getTheme } from "../model/themes";
import { measureInputsOf, renderedHeights } from "./fit-plan";
import { lintSlide } from "./lint";
import type { Measurer } from "./reflow";
import { tidySlide } from "./tidy";

/*
 * Re-theme a whole lesson (TEACH-258, ruling 113). A theme is not paint only: its type ladder sets
 * how tall every text box needs to be, so a lesson laid out in one theme and drawn in another can
 * overrun its boxes. `setTheme` alone would leave that to the teacher. This sets the theme and
 * then tidies every slide the linter flags under the new theme, as the renderer will draw it —
 * the same decision and the same tidy the fit migration makes on open. A slide whose text still
 * does not fit at the legibility floor continues onto a new slide rather than losing words.
 *
 * Positions across the slide (x, w) stay where the old theme put them; only heights, the vertical
 * stack and type steps move. The recipes differ between themes in those too, but re-laying a
 * teacher's slide from its recipe would throw away their edits.
 */

export type RethemeOutcome = {
  /** Slides the tidy changed. */
  tidied: Id[];
  /** Boxes still past the safe area at the legibility floor, after the tidy. */
  overflow: Id[];
};

/** Every slide that does not lint clean under `theme`, measured as the renderer draws it. */
export function slidesNeedingFit(lesson: Lesson, theme: Theme, measure: Measurer): Id[] {
  return lesson.slides
    .filter((slide) => !lintSlide(renderedHeights(slide, measure), measure, theme).ok)
    .map((slide) => slide.id);
}

/** Pure: every slide the linter flags under the lesson's own theme, tidied. */
export function fitLessonToTheme(
  lesson: Lesson,
  measure: Measurer,
): { lesson: Lesson; outcome: RethemeOutcome } {
  const theme = getTheme(lesson.themeId);
  let out = lesson;
  const tidied: Id[] = [];
  const overflow: Id[] = [];
  for (const id of slidesNeedingFit(lesson, theme, measure)) {
    const made = tidySlide(out, id, measure);
    out = made.lesson;
    if (made.outcome.changed) tidied.push(id);
    overflow.push(...made.outcome.overflow);
  }
  return { lesson: out, outcome: { tidied, overflow } };
}

/** Pure: the lesson in `themeId`, fitted to it. Choosing the theme it already has is a no-op. */
export function rethemeLesson(
  lesson: Lesson,
  themeId: string,
  measure: Measurer,
): { lesson: Lesson; outcome: RethemeOutcome } {
  if (lesson.themeId === themeId) return { lesson, outcome: { tidied: [], overflow: [] } };
  return fitLessonToTheme(reducers.setTheme(lesson, themeId), measure);
}

/** `fitLessonToTheme` in reducer shape, for `history.dispatch`. */
export const fitLessonToThemeReducer = (lesson: Lesson, measure: Measurer) =>
  fitLessonToTheme(lesson, measure);

/** Every measurement a re-theme will ask for, for one warm-up batch. */
export const rethemeMeasureInputs = (lesson: Lesson) =>
  lesson.slides.flatMap((slide) => measureInputsOf(slide));
