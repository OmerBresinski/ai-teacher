/**
 * Text fitting engine — the migration decision, pure (TeachDeck `lib/layout/fit-plan.ts`).
 *
 * The floors in `MIN_FONT_SIZE` are applied at render time, so raising one grows the text inside
 * boxes positioned under the old number. A lesson records the floor table it was last fitted to
 * (`fitVersion`), and this file decides what to do about a lesson that is behind: a lesson at the
 * current version is left alone (one integer comparison); a lesson behind is re-fitted **only on
 * the slides the linter flags**; either way it is stamped, so the decision is made once per lesson.
 */

import type { Id, Lesson, Slide } from "@tj/domain/documents";
import { FIT_VERSION } from "../model/themes";

/**
 * `renderedHeights` and `measureInputsOf` moved to `@tj/slides` (`lint.ts`) with the linter, so
 * the headless fit check (`fitsPlanned`) and the editor draw the same slide; re-exported here.
 */
export { measureInputsOf, renderedHeights } from "@tj/slides";

export type FitPlan = {
  /** True when there is anything at all to do, a version stamp included. */
  needed: boolean;
  /** The slides to re-fit, in document order. Empty when nothing is flagged. */
  slideIds: Id[];
  /** The version to stamp on the lesson afterwards. */
  version: number;
};

const NOTHING = (version: number): FitPlan => ({ needed: false, slideIds: [], version });

/** What the lesson was last fitted to. A document written before the field is at 0. */
export const fitVersionOf = (lesson: Pick<Lesson, "fitVersion">): number => lesson.fitVersion ?? 0;

/** True when the stored layout predates the current floor table. */
export const isFitStale = (lesson: Pick<Lesson, "fitVersion">, version = FIT_VERSION): boolean =>
  fitVersionOf(lesson) < version;

/** Which slides of `lesson` need re-fitting, given a linter. */
export function planFitMigration(
  lesson: Pick<Lesson, "fitVersion" | "slides">,
  flagged: (slide: Slide) => boolean,
  version = FIT_VERSION,
): FitPlan {
  if (!isFitStale(lesson, version)) return NOTHING(version);
  return {
    needed: true,
    slideIds: lesson.slides.filter((slide) => flagged(slide)).map((slide) => slide.id),
    version,
  };
}

/** The toast, shown only when a slide actually moved. */
export function fitMigrationMessage(slides: number): string {
  if (slides <= 0) return "";
  return `${slides === 1 ? "1 slide" : `${slides} slides`} tidied to fit the new text sizes.`;
}
