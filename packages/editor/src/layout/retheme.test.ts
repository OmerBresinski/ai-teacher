import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  type GroupElement,
  type LayoutRef,
  type Lesson,
  richDocToPlainText,
  type Slide,
  type TextElement,
} from "@tj/domain/documents";
import {
  countLines,
  DEMO_LESSON_SPECS,
  demoLessonSlides,
  measureHeadless,
  resolveTextStyle,
  type SlideSpec,
} from "@tj/slides";
import * as kit from "@tj/slides/relayout";
import * as reducers from "../model/reducers";
import { getTheme, THEMES } from "../model/themes";
import { renderedHeights } from "./fit-plan";
import { lintSlide } from "./lint";
import { recolourSlide, rethemeFromReducer, rethemeLesson, slidesNeedingFit } from "./retheme";

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
  const base = generated("splash");
  const report: string[] = [];

  test("the fixture has no overlap or overflow in the theme it was generated in", () => {
    // The multiple-choice slide's options already cover its explanation lane when generated, in
    // every theme: a generation finding, not a theme one, so the lane is counted but not held here.
    expect(lintTotals(base)).toMatchObject({ overlaps: 0, overflow: 0 });
  });

  for (const theme of THEMES.filter((t) => t.id !== "splash")) {
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
    const { lesson, outcome } = rethemeLesson(base, "splash", measureHeadless(getTheme("splash")));
    expect(lesson).toBe(base);
    expect(outcome.tidied).toEqual([]);
  });

  test("the picker's preview always starts from the opening lesson, so browsing never stacks", () => {
    const measure = measureHeadless(getTheme("playground"));
    const once = rethemeLesson(base, "playground", measure).lesson;
    const browsed = rethemeLesson(once, "beacon", measureHeadless(getTheme("beacon"))).lesson;
    // Same result as re-theming the opening lesson directly (`updatedAt` is the clock's).
    const previewed = rethemeFromReducer(browsed, base, "playground", measure).lesson;
    expect(previewed.themeId).toBe(once.themeId);
    expect(previewed.slides).toEqual(once.slides);
    expect(rethemeFromReducer(browsed, base, "splash", measure).lesson).toBe(base);
  });

  test("the palette follows the theme: no old-theme colour is left, text is untouched", () => {
    const chalk = getTheme("splash");
    const night = getTheme("night-lab");
    const { lesson: after } = rethemeLesson(base, "night-lab", measureHeadless(night));
    const json = JSON.stringify(after.slides.map((s) => s.elements)).toLowerCase();
    for (const [key, value] of Object.entries(chalk.colors)) {
      const same =
        (night.colors as Record<string, string>)[key]?.toLowerCase() === value.toLowerCase();
      if (!same) expect(json).not.toContain(`"${value.toLowerCase()}"`);
    }
    expect(words(after)).toEqual(words(base));
    const custom = { ...base.slides[0], elements: [] } as unknown as Parameters<
      typeof recolourSlide
    >[0];
    expect(recolourSlide(custom, chalk, chalk)).toBe(custom);
  });
});

/*
 * TEACH-75 part aq: an adaptive layout laid in one theme's faces broke a word in another's
 * (Studio's 44 title in Treehouse: "Brother / s and sisters"; in Crayon: "Find the resultan / t").
 * A re-theme now re-lays every layout group by its template in the new faces.
 */
describe("re-theme re-lays adaptive layouts in the new theme's faces", () => {
  const rows = [
    { name: "Same direction", text: "Add: 6 N right + 4 N right = 10 N right.", icon: null },
    { name: "Opposite directions", text: "Subtract: 9 N right − 4 N left.", icon: null },
    { name: "Equal and opposite", text: "6 N right and 6 N left give 0 N.", icon: null },
  ];
  const laid = (heading: string): Lesson => {
    const ref = {
      template: "panel-list",
      input: { heading, lead: "Read aloud.", rows, panel: null },
    } as unknown as LayoutRef;
    const studio = getTheme("studio");
    const r = kit.relayout(ref, studio, kit.stageOf(studio, undefined), "g");
    const group = {
      id: "g",
      type: "group",
      name: "Layout",
      ...r.frame,
      children: r.elements.map((e) => ({ ...e, x: e.x - r.frame.x, y: e.y - r.frame.y })),
      layout: { ...ref, frame: r.frame },
    };
    const base = generated("studio");
    const slide = { ...base.slides[1], id: "s-pl", elements: [group] } as unknown as Slide;
    return { ...base, slides: [slide] } as Lesson;
  };
  const brokenWords = (lesson: Lesson) => {
    const theme = getTheme(lesson.themeId);
    const g = lesson.slides[0]?.elements[0] as GroupElement;
    const h = g.children.find((c) => c.name === "Heading") as TextElement;
    const text = richDocToPlainText(h.doc);
    const preset = h.style.preset ?? "title";
    const pad = resolveTextStyle({ preset }, theme).padding;
    return text
      .split(" ")
      .filter(
        (w) =>
          countLines(w, preset, theme, h.w + 2 * pad, h.style.fontWeight, h.style.fontSize) > 1,
      );
  };

  for (const [heading, to] of [
    ["Brothers and sisters", "treehouse"],
    ["Find the resultant", "crayon"],
  ] as const) {
    test(`"${heading}" in ${to}: no word breaks`, () => {
      const base = laid(heading);
      expect(brokenWords(base)).toEqual([]);
      const measure = measureHeadless(getTheme(to));
      // The bug: the theme alone, the layout left at Studio's sizes.
      const stale = rethemeLesson(base, to, measure, null).lesson;
      expect(brokenWords(stale).length).toBeGreaterThan(0);
      const after = rethemeLesson(base, to, measure, kit).lesson;
      expect(brokenWords(after)).toEqual([]);
      const g = after.slides[0]?.elements[0] as GroupElement;
      // The teacher's words are the ref's: the re-lay keeps them.
      const before = base.slides[0]?.elements[0] as GroupElement | undefined;
      expect(g.layout?.input).toEqual(before?.layout?.input);
    });
  }
});
