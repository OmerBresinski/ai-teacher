/**
 * The theme picker while a job writes (P1 26 Oct, jank audit #6): every preview re-themes the
 * opening lesson plus what the job wrote since, so a slide written while the picker is open never
 * drops out of the strip (it went 5 -> 4 -> 5), whatever order the write and the pick land in.
 */
import { describe, expect, test } from "bun:test";
import type { Lesson, Slide } from "@tj/domain/documents";
import { inLessonTheme, recolourSlide } from "../layout/retheme";
import { renderTheme } from "../model/themes";
import { withJobWrites } from "./ThemeDialog";
import { seededLesson } from "./test-harness";

const inTheme = (lesson: Lesson, themeId: string): Lesson => ({
  ...lesson,
  themeId,
  slides: lesson.slides.map((s) =>
    recolourSlide(s, renderTheme(lesson), renderTheme(lesson, themeId)),
  ),
});
const byId = (l: Lesson) => new Map(l.slides.map((s) => [s.id, s]));

describe("withJobWrites", () => {
  const opening = seededLesson();
  const other = opening.themeId === "exam-hall" ? "playground" : "exam-hall";
  const previewed = inTheme(opening, other);

  test("before any preview, a job write is kept as written", () => {
    const added = { ...(opening.slides[0] as Slide), id: "job-new" } as Slide;
    const current = { ...opening, slides: [...opening.slides, added] };
    const base = withJobWrites(opening, current, byId(opening));
    expect(base.slides.map((s) => s.id)).toEqual(current.slides.map((s) => s.id));
    expect(base.slides.at(-1)).toEqual(added);
  });

  test("a slide the job adds after a preview is kept, back in the opening palette", () => {
    const added = { ...(previewed.slides[0] as Slide), id: "job-new" } as Slide;
    const current = { ...previewed, slides: [...previewed.slides, added] };
    const base = withJobWrites(opening, current, byId(previewed));
    expect(base.slides.map((s) => s.id)).toEqual([...opening.slides.map((s) => s.id), "job-new"]);
    expect(base.themeId).toBe(opening.themeId);
    // Untouched slides are the opening's own objects: previews never stack one re-fit on another.
    expect(base.slides[0]).toBe(opening.slides[0] as Slide);
    expect(base.slides.at(-1)).toEqual(inLessonTheme(added, opening));
  });

  test("a slide the job drops goes; one it rewrites comes from the job", () => {
    const rewritten = { ...(previewed.slides[1] as Slide), notes: "new notes" } as Slide;
    const current = { ...previewed, slides: [rewritten, ...previewed.slides.slice(2)] };
    const base = withJobWrites(opening, current, byId(previewed));
    expect(base.slides.map((s) => s.id)).toEqual(current.slides.map((s) => s.id));
    expect(base.slides[0]?.notes).toBe("new notes");
  });
});

describe("inLessonTheme", () => {
  test("a slide in another theme's palette is recoloured into the lesson's; its own stays", () => {
    const lesson = seededLesson();
    const other = lesson.themeId === "exam-hall" ? "playground" : "exam-hall";
    const slide = lesson.slides[0] as Slide;
    expect(inLessonTheme(slide, lesson)).toBe(slide);
    const foreign = recolourSlide(slide, renderTheme(lesson), renderTheme(lesson, other));
    expect(inLessonTheme(foreign, lesson)).toEqual(
      recolourSlide(foreign, renderTheme(lesson, other), renderTheme(lesson)),
    );
  });
});
