import { describe, expect, test } from "bun:test";
import type { Slide } from "@tj/domain/documents";
import { generatedLesson } from "@tj/domain/documents/fixtures";
import { figureGroupOf } from "./figures";
import { FIGURE_RECT, layoutSlide } from "./layouts";
import { presentedSlide, withoutDiagramSlot, withSlotsShown } from "./materialise";
import { slotSide } from "./structure";
import { getTheme } from "./themes";

/*
 * A lesson stored before the look (master) renders as it was stored: it has no slots and no
 * counter, so present, export and the demo view hand its slides back unchanged, and a diagram
 * slide keeps its figure where `layouts.ts` drew it (look/slides-layout).
 */
describe("a lesson stored before the look renders as stored", () => {
  const lesson = generatedLesson();
  const t = getTheme(lesson.themeId);

  test("every slide comes back unchanged from present, the slot relayout and the demo view", () => {
    lesson.slides.forEach((slide, index) => {
      expect(withoutDiagramSlot(slide, t)).toBe(slide);
      expect(withSlotsShown(slide, t)).toBe(slide);
      expect(slotSide(slide, "left")).toBe(slide);
      const shown = presentedSlide(slide, t, { index, total: lesson.slides.length });
      expect(shown.elements).toEqual(slide.elements);
    });
  });

  test("a diagram slide keeps its figure at the left, as drawn", () => {
    const laid = layoutSlide("diagram", "chalk");
    const slide: Slide = { id: "d1", kind: "diagram", elements: laid.elements };
    const shown = presentedSlide(slide, getTheme("chalk"), { index: 3, total: 10 });
    expect(shown.elements).toEqual(slide.elements);
    const figure = figureGroupOf(shown);
    expect(figure && { x: figure.x, y: figure.y, w: figure.w, h: figure.h }).toEqual(FIGURE_RECT);
  });
});
