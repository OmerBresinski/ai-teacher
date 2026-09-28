import type { Id, Lesson } from "@tj/domain/documents";
import { useEffect, useState } from "react";
import { FIT_VERSION } from "../model/themes";

/*
 * Only `../model/themes` is imported statically: the viewer and print route chunks carry this hook,
 * and the ruler, the linter and Tidy load on demand (`./refit-run.ts`), for a stale lesson only.
 */
const isStale = (lesson: Lesson): boolean => (lesson.fitVersion ?? 0) < FIT_VERSION;
const whenFontsReady = (): Promise<void> => import("./measure").then((m) => m.whenFontsReady());

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
 * `refitStaleLesson` (`./refit-run.ts`) for a component: null while the theme fonts load (the ruler would measure the
 * fallback face), then the fitted lesson. A current lesson comes straight back, with no wait.
 */
export function useFittedLesson(
  lesson: Lesson | null,
  fontsReady: () => Promise<void> = whenFontsReady,
): Lesson | null {
  const stale = !!lesson && isStale(lesson);
  const [fitted, setFitted] = useState<{ from: Lesson; to: Lesson } | null>(null);

  useEffect(() => {
    if (!lesson || !stale) return;
    let cancelled = false;
    // The linter and Tidy load on demand: most lessons are current and never need them.
    void Promise.all([fontsReady(), import("./refit-run")]).then(([, run]) => {
      if (!cancelled) setFitted({ from: lesson, to: run.refitStaleLesson(lesson) });
    });
    return () => {
      cancelled = true;
    };
  }, [lesson, stale, fontsReady]);

  if (!lesson) return null;
  if (!stale) return lesson;
  return fitted?.from === lesson ? fitted.to : null;
}
