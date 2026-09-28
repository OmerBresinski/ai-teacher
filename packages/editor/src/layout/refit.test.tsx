import { describe, expect, test } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import type { Lesson, Slide, TextElement } from "@tj/domain/documents";
import { docFromText, newLesson } from "../model/factories";
import { FIT_VERSION, getTheme } from "../model/themes";
import { renderedHeights } from "./fit-plan";
import { lintSlide } from "./lint";
import { storedSlideId, useFittedLesson } from "./refit";
import { refitStaleLesson } from "./refit-run";
import type { Measurer } from "./reflow";
import { rulerFor } from "./test-ruler";

/* The fit migration for read-only surfaces (Present, the viewer, print and the exports). */

function textAt(id: string, y: number, h: number): TextElement {
  return {
    id,
    type: "text",
    x: 58,
    y,
    w: 413,
    h,
    doc: docFromText("Some words on the slide"),
    style: { preset: "body", autoHeight: true },
  };
}
/** Two boxes that already overlap: `lintSlide` flags this one on geometry alone. */
const brokenSlide = (id: string): Slide => ({
  id,
  kind: "vocabulary",
  elements: [textAt(`${id}-def`, 185, 100), textAt(`${id}-term`, 240, 41)],
});
const cleanSlide = (id: string): Slide => ({
  id,
  kind: "content",
  elements: [textAt(`${id}-body`, 140, 41)],
});
const lessonOf = (slides: Slide[], fitVersion: number): Lesson => ({
  ...newLesson("Stored under the old sizes", "chalk"),
  fitVersion,
  slides,
});
const theme = getTheme("chalk");
const ruler = rulerFor(theme);
const deps = { measurer: () => ruler, warm: () => {} };

describe("refitStaleLesson", () => {
  test("a lesson at the current fit version comes back as the same object", () => {
    const lesson = lessonOf([brokenSlide("a")], FIT_VERSION);
    expect(refitStaleLesson(lesson, deps)).toBe(lesson);
  });

  test("a stale lesson with nothing flagged comes back as the same object, unstamped", () => {
    const lesson = lessonOf([cleanSlide("a")], 0);
    expect(refitStaleLesson(lesson, { ...deps, measurer: () => (() => 1) as Measurer })).toBe(
      lesson,
    );
  });

  test("a stale lesson is tidied in a copy: flagged slides fit, the stored lesson is untouched", () => {
    const lesson = lessonOf([cleanSlide("a"), brokenSlide("b")], 0);
    const before = JSON.stringify(lesson);
    const out = refitStaleLesson(lesson, deps);
    expect(out).not.toBe(lesson);
    expect(JSON.stringify(lesson)).toBe(before);
    expect(out.fitVersion).toBe(FIT_VERSION);
    expect(out.slides[0]).toBe(lesson.slides[0] as Slide);
    for (const slide of out.slides) {
      expect(lintSlide(renderedHeights(slide, ruler), ruler, theme).ok).toBe(true);
    }
  });
});

describe("storedSlideId", () => {
  const stored = lessonOf([cleanSlide("a"), cleanSlide("b")], 0);
  const fitted = { ...stored, slides: [cleanSlide("a"), cleanSlide("a2"), cleanSlide("b")] };

  test("a stored slide keeps its id; a continuation maps to the slide it continues", () => {
    expect(storedSlideId(fitted, stored, "b")).toBe("b");
    expect(storedSlideId(fitted, stored, "a2")).toBe("a");
  });
});

describe("useFittedLesson", () => {
  test("a current lesson is returned at once, without waiting for fonts", () => {
    const lesson = lessonOf([cleanSlide("a")], FIT_VERSION);
    const never = () => new Promise<void>(() => {});
    const { result } = renderHook(() => useFittedLesson(lesson, never));
    expect(result.current).toBe(lesson);
  });

  test("a stale lesson is null until the fonts are ready, then the fitted copy", async () => {
    const lesson = lessonOf([cleanSlide("a")], 0);
    let release = () => {};
    const fonts = new Promise<void>((r) => {
      release = r;
    });
    const ready = () => fonts;
    const { result } = renderHook(() => useFittedLesson(lesson, ready));
    expect(result.current).toBeNull();
    release();
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.id).toBe(lesson.id);
  });

  test("no lesson, no fit", () => {
    const { result } = renderHook(() => useFittedLesson(null));
    expect(result.current).toBeNull();
  });
});
