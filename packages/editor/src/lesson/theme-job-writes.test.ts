/**
 * The theme picker while a job writes (P1 26 Oct, jank audit #6): every preview re-themes the
 * opening lesson plus what the job wrote since, so a slide written while the picker is open never
 * drops out of the strip (it went 5 -> 4 -> 5).
 */
import { describe, expect, test } from "bun:test";
import type { Lesson, Slide } from "@tj/domain/documents";
import { recolourSlide } from "../layout/retheme";
import { renderTheme } from "../model/themes";
import { withJobWrites } from "./ThemeDialog";
import { seededLesson } from "./test-harness";

const previewed = (lesson: Lesson, themeId: string): Lesson => ({
  ...lesson,
  themeId,
  slides: lesson.slides.map((s) =>
    recolourSlide(s, renderTheme(lesson), renderTheme(lesson, themeId)),
  ),
});

describe("withJobWrites", () => {
  const opening = seededLesson();
  const other = opening.themeId === "exam-hall" ? "playground" : "exam-hall";
  const before = previewed(opening, other);

  test("a slide the job adds during the browse is kept, in the opening theme's colours", () => {
    const added = { ...(before.slides[0] as Slide), id: "job-new" } as Slide;
    const after = { ...before, slides: [...before.slides, added] };
    const base = withJobWrites(opening, before, after);
    expect(base.slides.map((s) => s.id)).toEqual([...opening.slides.map((s) => s.id), "job-new"]);
    expect(base.themeId).toBe(opening.themeId);
    // Untouched slides are the opening's own objects, so a preview never stacks one re-fit on another.
    expect(base.slides[0]).toBe(opening.slides[0] as Slide);
    expect(base.slides.at(-1)).toEqual(
      recolourSlide(added, renderTheme(after), renderTheme(opening)),
    );
  });

  test("a slide the job drops goes; one it rewrites comes from the job", () => {
    const rewritten = { ...(before.slides[1] as Slide), notes: "new notes" } as Slide;
    const after = { ...before, slides: [rewritten, ...before.slides.slice(2)] };
    const base = withJobWrites(opening, before, after);
    expect(base.slides.map((s) => s.id)).toEqual(after.slides.map((s) => s.id));
    expect(base.slides[0]?.notes).toBe("new notes");
  });
});
