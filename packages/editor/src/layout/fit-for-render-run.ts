import type { Lesson } from "@tj/domain/documents";
import { getTheme } from "../model/themes";
import { measureInputsOf, renderedHeights } from "./fit-plan";
import { lintSlide } from "./lint";
import { createMeasurer, warmMeasurer, whenFontsReady } from "./measure";
import { tidySlide } from "./tidy";

/**
 * The work behind `useFittedLesson` (`./fit-for-render.ts`): the linter, the ruler and Tidy. Kept in
 * its own module so the read-only routes load it on demand and their route chunks stay inside their
 * budgets (ADR 0022 §8).
 */

/** The lesson as the print, view and present surfaces should draw it. */
export async function fitLessonForRender(lesson: Lesson): Promise<Lesson> {
  if (typeof document === "undefined" || !document.body) return lesson;
  await whenFontsReady();
  const theme = getTheme(lesson.themeId);
  const measure = createMeasurer(theme);
  warmMeasurer(
    lesson.slides.flatMap((slide) => measureInputsOf(slide)),
    theme,
  );
  let out = lesson;
  for (const slide of lesson.slides) {
    if (lintSlide(renderedHeights(slide, measure), measure, theme).ok) continue;
    out = tidySlide(out, slide.id, measure).lesson;
  }
  return out;
}
