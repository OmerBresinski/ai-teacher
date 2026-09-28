import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Lesson } from "@tj/domain/documents";
import { DEMO_LESSON_SPECS, demoLessonSlides, measureHeadless, type SlideSpec } from "@tj/slides";
import * as reducers from "../model/reducers";
import { getTheme, THEMES } from "../model/themes";
import { renderedHeights } from "./fit-plan";
import { lintSlide } from "./lint";
import { rethemeLesson, slidesNeedingFit } from "./retheme";

/*
 * TEACH-258 FR5: a generated lesson re-themed with `setTheme` alone keeps the old theme's boxes
 * under the new theme's type; `rethemeLesson` tidies what that breaks. The fixture is the fake
 * AI's own slide specs (`@tj/generation` fixtures, the deck the e2e generation writes) run
 * through `materialiseSlide` + `fitSlide` in the default theme, as the pipeline does, and measured
 * with `fitSlide`'s own headless ruler.
 */

const fixture = JSON.parse(
  readFileSync(new URL("../../../generation/src/fixtures/slides.json", import.meta.url), "utf8"),
) as Record<string, SlideSpec>;
const specs: SlideSpec[] = [
  ...DEMO_LESSON_SPECS.filter((s) => s.kind === "title" || s.kind === "objectives"),
  ...Object.values(fixture),
];

function generated(themeId: string): Lesson {
  const { slides } = demoLessonSlides(themeId, { specs });
  return {
    id: "lesson-retheme",
    type: "lesson",
    title: "States of matter",
    themeId,
    slides,
    createdAt: "2026-09-28T00:00:00.000Z",
    updatedAt: "2026-09-28T00:00:00.000Z",
  } as unknown as Lesson;
}

/** Every word the lesson shows, in any element, as a sorted bag. */
function words(lesson: Lesson): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (key === "text" && typeof value === "string") out.push(...value.split(/\s+/));
        else walk(value);
      }
    }
  };
  walk(lesson.slides.map((s) => s.elements));
  return out.filter(Boolean).sort();
}

/** Lint totals for the lesson as the renderer draws it, under its own theme. */
function lintTotals(lesson: Lesson) {
  const theme = getTheme(lesson.themeId);
  const measure = measureHeadless(theme);
  const totals = { overlaps: 0, overflow: 0, lane: 0 };
  for (const slide of lesson.slides) {
    const lint = lintSlide(renderedHeights(slide, measure), measure, theme);
    totals.overlaps += lint.overlaps.length;
    totals.overflow += lint.overflow.length;
    totals.lane += lint.laneOverflow.length;
  }
  return totals;
}
const show = (t: ReturnType<typeof lintTotals>) =>
  `overlaps ${t.overlaps}, overflow ${t.overflow}, lane ${t.lane}`;

describe("re-theming a generated lesson (TEACH-258 FR5)", () => {
  const base = generated("chalk");
  const report: string[] = [];

  test("the fixture has no overlap or overflow in the theme it was generated in", () => {
    // The multiple-choice slide's options already cover its explanation lane when generated, in
    // every theme: a generation finding, not a theme one, so the lane is counted but not held here.
    expect(lintTotals(base)).toMatchObject({ overlaps: 0, overflow: 0 });
  });

  for (const theme of THEMES.filter((t) => t.id !== "chalk")) {
    test(`chalk → ${theme.id}: re-fitted with no overlap or overflow, every word kept, one theme`, () => {
      const naive = reducers.setTheme(base, theme.id);
      const measure = measureHeadless(theme);
      const { lesson: after, outcome } = rethemeLesson(base, theme.id, measure);
      const before = lintTotals(naive);
      const fitted = lintTotals(after);
      report.push(
        `${theme.id}: setTheme only → ${show(before)}; rethemeLesson → ${show(fitted)}; tidied ${outcome.tidied.length}, slides ${base.slides.length} → ${after.slides.length}`,
      );
      expect(fitted).toMatchObject({ overlaps: 0, overflow: 0 });
      expect(after.themeId).toBe(theme.id);
      expect(outcome.overflow).toEqual([]);
      expect(words(after)).toEqual(words(base));
      expect(slidesNeedingFit(after, theme, measure).length).toBeLessThanOrEqual(
        slidesNeedingFit(naive, theme, measure).length,
      );
    });
  }

  test("before/after counts (printed for the PR)", () => {
    console.log(`re-theme from chalk\n  ${report.join("\n  ")}`);
    expect(report.length).toBe(THEMES.length - 1);
  });

  test("choosing the theme the lesson already has changes nothing", () => {
    const { lesson, outcome } = rethemeLesson(base, "chalk", measureHeadless(getTheme("chalk")));
    expect(lesson).toBe(base);
    expect(outcome.tidied).toEqual([]);
  });
});
