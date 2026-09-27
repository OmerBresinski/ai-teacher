import type { Id, Lesson, Theme } from "@tj/domain/documents";
import { useEffect, useState } from "react";
import { getTheme } from "../model/themes";
import { isFitStale, measureInputsOf, planFitMigration, renderedHeights } from "./fit-plan";
import { lintSlide } from "./lint";
import { createMeasurer, warmMeasurer, whenFontsReady } from "./measure";
import type { MeasureInput, Measurer } from "./reflow";
import { tidySlide } from "./tidy";

/**
 * Text fitting engine — the fit migration for the surfaces that only read a lesson: Present, the
 * viewer, the print route (the PDF) and the PowerPoint and PNG exports behind the viewer.
 *
 * The editor re-fits a lesson stored under older floors once, on open, and saves it
 * (`./use-fit-migration.ts`). A lesson opened anywhere else was drawn as stored, with its text
 * running out of the boxes the old floors sized. This makes the same decision with the same linter
 * and the same Tidy, but on a copy in memory: nothing is written back. A read-only surface has no
 * undo to put the change in, may be one of several tabs on the lesson, and saving from it would
 * race the editor's own save; the editor still stamps and stores the fit the next time the lesson
 * is opened there.
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
  for (const id of plan.slideIds) out = tidySlide(out, id, measure).lesson;
  return out === lesson ? lesson : { ...out, fitVersion: plan.version };
}

/**
 * `id` from the re-fitted copy as a slide of the stored lesson: itself, or — for a continuation
 * slide the Tidy added — the stored slide it continues. Progress is written against the stored
 * lesson, which has no continuation slides until the editor saves them.
 */
export function storedSlideId(fitted: Lesson, stored: Lesson, id: Id): Id | undefined {
  const known = new Set(stored.slides.map((s) => s.id));
  if (known.has(id)) return id;
  const at = fitted.slides.findIndex((s) => s.id === id);
  for (let i = at - 1; i >= 0; i -= 1) {
    const prior = fitted.slides[i]?.id;
    if (prior && known.has(prior)) return prior;
  }
  return stored.slides[0]?.id;
}

/**
 * `refitStaleLesson` for a component: null while the theme fonts load (the ruler would measure the
 * fallback face), then the fitted lesson. A current lesson comes straight back, with no wait.
 */
export function useFittedLesson(
  lesson: Lesson | null,
  fontsReady: () => Promise<void> = whenFontsReady,
): Lesson | null {
  const stale = !!lesson && isFitStale(lesson);
  const [fitted, setFitted] = useState<{ from: Lesson; to: Lesson } | null>(null);

  useEffect(() => {
    if (!lesson || !stale) return;
    let cancelled = false;
    void fontsReady().then(() => {
      if (!cancelled) setFitted({ from: lesson, to: refitStaleLesson(lesson) });
    });
    return () => {
      cancelled = true;
    };
  }, [lesson, stale, fontsReady]);

  if (!lesson) return null;
  if (!stale) return lesson;
  return fitted?.from === lesson ? fitted.to : null;
}
