import type { Lesson, Theme } from "@tj/domain/documents";
import { getTheme } from "../model/themes";
import { isFitStale, measureInputsOf, planFitMigration, renderedHeights } from "./fit-plan";
import { lintSlide } from "./lint";
import { createMeasurer, warmMeasurer } from "./measure";
import type { MeasureInput, Measurer } from "./reflow";
import { tidySlide } from "./tidy";

/**
 * The work behind `useFittedLesson` (`./refit.ts`): the linter, the ruler and Tidy. Kept in its own
 * module so the read-only routes load it on demand, only for a lesson stored under older floors,
 * and their route chunks stay inside their budgets (ADR 0022 §8).
 */

export type RefitDeps = {
  /** Injected in tests; the defaults are the DOM ruler. */
  measurer?: (theme: Theme) => Measurer;
  warm?: (inputs: MeasureInput[], theme: Theme) => void;
};

/**
 * The lesson as the editor's migration would leave it, or the same object when it is current or
 * nothing on it is flagged. The copy is stamped with the version it was fitted to, so a surface
 * that hands it on (an export) says truthfully what it holds.
 */
export function refitStaleLesson(lesson: Lesson, deps: RefitDeps = {}): Lesson {
  if (!isFitStale(lesson)) return lesson;
  const { measurer = createMeasurer, warm = warmMeasurer } = deps;
  const theme = getTheme(lesson.themeId);
  const measure = measurer(theme);
  warm(
    lesson.slides.flatMap((slide) => measureInputsOf(slide)),
    theme,
  );
  const plan = planFitMigration(
    lesson,
    (slide) => !lintSlide(renderedHeights(slide, measure), measure, theme).ok,
  );
  let out = lesson;
  // A generated slide is never continued (`tidySlide`'s default for it is `split: false`).
  for (const id of plan.slideIds) out = tidySlide(out, id, measure).lesson;
  return out === lesson ? lesson : { ...out, fitVersion: plan.version };
}
