import { isContinuation, type Lesson, type Slide } from "@tj/domain/documents";
import { CALLOUT_NAMES } from "./callout";
import { slideFits } from "./fit-check";
import { fitSlide } from "./fit-slide";
import { BODY_Y } from "./layouts";
import { lintAsDrawn } from "./lint";
import { SAFE_BOTTOM } from "./metrics";
import { measureHeadless } from "./text-measure";
import { FIT_VERSION, getTheme, THEMES } from "./themes";

/*
 * The `fit` block of the worker's `generation summary` line, and the numbers the offline fit
 * scorer (`docs/eval/lab/fit-lab/harness/fit-score.ts`) prints next to its own: one function, so
 * an offline score and production never disagree about a deck. Counts only, never content.
 * Headless: the same ruler generation fits with (`measureHeadless`) and the same linter the editor
 * flags slides with.
 */

export type FitReport = {
  slides: {
    /** What the brief asked for; null when the lesson has no brief count. */
    requested: number | null;
    /** Slides that are not a continuation of the one before. */
    delivered: number;
    /** Every stored slide, continuations included. */
    stored: number;
  };
  /**
   * Per theme id: slides with a box still past the safe area once fitted in that theme. The
   * lesson's own theme is the one it opens in.
   */
  overflowing: Record<string, number>;
  /**
   * Per theme id: slides the linter still flags once fitted for an overlap or the "Why?" lane, or
   * whose answers reveal covers its questions (`answersOverQuestions`).
   */
  clashing: Record<string, number>;
  /** Callouts the outline planned on a teaching slide, and teaching slides that carry one. */
  callouts: { planned: number; placed: number };
  /** Continuation pages the editor's first open would add (0 when the lesson is fitted). */
  pagesOnOpen: number;
};

export type FitReportOptions = {
  /**
   * Counts the pages the first open adds with the editor's own Tidy, for a caller that can import
   * `@tj/editor` (the offline fit scorer). Without one, `pagesOnOpen` is the headless estimate
   * below.
   */
  pagesOnOpen?: (lesson: Lesson) => number;
};

const TEACHING = new Set<Slide["kind"]>(["content", "image-text"]);

const hasCallout = (slide: Slide) =>
  slide.elements.some((e) => e.name === CALLOUT_NAMES.card || e.name === CALLOUT_NAMES.text);

/** Question slides are never split (ruling 91); the editor's Tidy leaves them to overflow. */
const QUESTION_KINDS = new Set<Slide["kind"]>([
  "multiple-choice",
  "true-false",
  "matching",
  "fill-gap",
  "sort",
  "image-match",
  "open-response",
  "exit-ticket",
]);
const splittable = (slide: Slide) => !slide.question && !QUESTION_KINDS.has(slide.kind);

/**
 * Pages the first open adds, headless: none for a lesson stamped with the current `fitVersion`
 * (the migration reads one number and stops). Otherwise, for each slide the migration flags on the
 * lesson's own theme, that Tidy is allowed to split, and that still overflows once fitted: the
 * overrun past the safe area in continuation bodies (heading band to foot), at least one.
 */
export function estimatePagesOnOpen(lesson: Lesson): number {
  if ((lesson.fitVersion ?? 0) >= FIT_VERSION) return 0;
  const theme = getTheme(lesson.themeId);
  const measure = measureHeadless(theme);
  const page = SAFE_BOTTOM - BODY_Y;
  let pages = 0;
  for (const slide of lesson.slides) {
    if (!splittable(slide) || lintAsDrawn(slide, measure, theme).ok) continue;
    const fitted = fitSlide(slide, theme);
    if (fitted.overflow.length === 0) continue;
    const over = new Set(fitted.overflow);
    const foot = Math.max(
      ...fitted.slide.elements.filter((e) => over.has(e.id)).map((e) => e.y + e.h),
    );
    pages += Math.max(1, Math.ceil((foot - SAFE_BOTTOM) / page));
  }
  return pages;
}

export function fitReport(lesson: Lesson, opts: FitReportOptions = {}): FitReport {
  const slides = lesson.slides;
  const delivered = slides.filter((s, i) => i === 0 || !isContinuation(s, slides[i - 1])).length;
  const fits = THEMES.map((theme) => ({
    theme: theme.id,
    slides: slides.map((slide) => slideFits(slide, theme, 1)),
  }));
  const perTheme = (count: (fit: (typeof fits)[number]["slides"][number]) => boolean) =>
    Object.fromEntries(fits.map((t) => [t.theme, t.slides.filter(count).length]));
  const overflowing = perTheme((fit) => fit.overflow.length > 0);
  const clashing = perTheme(
    (fit) => fit.overlaps > 0 || fit.lane.length > 0 || fit.answers.length > 0,
  );
  const outline = lesson.facts?.outline ?? [];
  const planned = outline.filter((e) => TEACHING.has(e.kind) && e.callout).length;
  const placed = slides.filter((s) => TEACHING.has(s.kind) && hasCallout(s)).length;
  return {
    slides: {
      requested: lesson.brief?.slideCount ?? null,
      delivered,
      stored: slides.length,
    },
    overflowing,
    clashing,
    callouts: { planned, placed },
    pagesOnOpen: (opts.pagesOnOpen ?? estimatePagesOnOpen)(lesson),
  };
}
