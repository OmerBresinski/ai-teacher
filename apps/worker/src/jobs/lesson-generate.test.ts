/**
 * `withPlanSlides` without a database: the title and objectives slides Plan drew are rebuilt at
 * generate, in place, in the lesson's current theme (ruling 113).
 */
import { describe, expect, test } from "bun:test";
import type { Lesson } from "@tj/domain/documents";
import { generatedLesson } from "@tj/domain/documents/fixtures";
import { materialiseTitle, type PipelineDeps } from "@tj/generation";
import { withPlanSlides } from "./lesson-generate";

const deps = (): PipelineDeps => {
  let n = 0;
  return {
    now: () => new Date("2026-09-28T12:00:00.000Z"),
    ids: () => `e${++n}`,
  } as unknown as PipelineDeps;
};

/** A lesson whose title slide Plan drew in chalk, then confirmed in `themeId`. */
const confirmedIn = (themeId: string): Lesson => {
  const lesson = generatedLesson();
  const chalkTitle = materialiseTitle({ ...lesson, themeId: "chalk" }, deps());
  const [, ...rest] = lesson.slides;
  return { ...lesson, themeId, slides: [{ ...chalkTitle, id: "title-slide" }, ...rest] };
};

describe("withPlanSlides", () => {
  test("the title slide is redrawn in the lesson's theme under its own id", () => {
    const lesson = confirmedIn("night-lab");
    const out = withPlanSlides(lesson, deps());
    const expected = materialiseTitle(lesson, deps());
    expect(out.slides[0]?.id).toBe("title-slide");
    expect(out.slides[0]?.kind).toBe("title");
    expect(out.slides[0]).toEqual({ ...expected, id: "title-slide" });
    // The chalk drawing Plan left is gone.
    expect(out.slides[0]).not.toEqual(lesson.slides[0]);
  });

  test("the objectives slide keeps its id; the other slides are untouched", () => {
    const lesson = confirmedIn("night-lab");
    const out = withPlanSlides(lesson, deps());
    expect(out.slides[1]?.id).toBe(lesson.slides[1]?.id);
    expect(out.slides[1]?.kind).toBe(lesson.slides[1]?.kind);
    expect(out.slides.slice(2)).toEqual(lesson.slides.slice(2));
    expect(out.slides).toHaveLength(lesson.slides.length);
  });

  test("a deck that does not open with a title slide keeps its first slide", () => {
    const lesson = generatedLesson();
    const [first, ...rest] = lesson.slides;
    if (!first) throw new Error("fixture without slides");
    const noTitle: Lesson = { ...lesson, slides: [{ ...first, kind: "content" }, ...rest] };
    expect(withPlanSlides(noTitle, deps()).slides[0]).toEqual(noTitle.slides[0]);
  });
});
