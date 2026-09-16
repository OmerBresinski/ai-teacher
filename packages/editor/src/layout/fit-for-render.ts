import type { Lesson } from "@tj/domain/documents";
import { useEffect, useState } from "react";
import { getTheme } from "../model/themes";
import { measureInputsOf, renderedHeights } from "./fit-plan";
import { lintSlide } from "./lint";
import { createMeasurer, warmMeasurer, whenFontsReady } from "./measure";
import { tidySlide } from "./tidy";

/*
 * Text fitting engine — the render-time pass (quality lab, Sept 2026).
 *
 * The fit migration (`use-fit-migration.ts`) runs in the editor only, when the teacher is idle. A
 * generated lesson that is printed, viewed or presented before anyone opens it in the editor is
 * drawn as the recipes laid it: every two-line heading through its divider, a four-step working
 * card past its bottom, an exit-ticket item off the slide. This pass fits such a lesson in memory
 * for the render at hand — the slides the linter flags are tidied exactly as the Tidy button would,
 * continuation slides included — and writes nothing: the stored document is the teacher's, and the
 * editor's migration stamps it when they next open it.
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

/**
 * The fitted lesson for a render, and whether the pass has run for this document yet. Until it has,
 * the caller decides: the viewer draws the stored layout (a picture beats a blank while the fonts
 * settle); the print route waits, so what the browser captures is the fitted deck.
 */
export function useFittedLesson(
  lesson: Lesson,
  options: { enabled?: boolean } = {},
): { lesson: Lesson; fitted: boolean } {
  const enabled = options.enabled !== false;
  const [state, setState] = useState<{ source: Lesson; fitted: Lesson } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void fitLessonForRender(lesson).then((fitted) => {
      if (!cancelled) setState({ source: lesson, fitted });
    });
    return () => {
      cancelled = true;
    };
  }, [lesson, enabled]);
  const current = enabled && state !== null && state.source === lesson;
  return { lesson: current ? state.fitted : lesson, fitted: current };
}
