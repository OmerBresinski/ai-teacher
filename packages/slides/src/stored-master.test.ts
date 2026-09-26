import { describe, expect, test } from "bun:test";
import type { Slide } from "@tj/domain/documents";
import { generatedLesson } from "@tj/domain/documents/fixtures";
import { figureGroupOf } from "./figures";
import { fitSlide } from "./fit-slide";
import storedLessons from "./fixtures/stored-master-lessons.json";
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

/*
 * Three lessons generated and stored on master (e49 B: fractions, rates, ratio), fitted by master's
 * engine (aa628bf8) and recorded as a digest per slide. The look's changes to the fit engine
 * (`reflow.ts`: the foot band, the frozen answers card, the heading kept at its size) touch only
 * elements the look names, so every stored slide, the quiz and exit slides among them, fits
 * exactly as it did before.
 */
describe("stored master lessons fit as they did on master", () => {
  type Stored = { name: string; themeId: string; slides: Slide[]; masterFit: string[] };
  const { lessons } = storedLessons as unknown as { lessons: Stored[] };
  const digest = (value: unknown) =>
    new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

  for (const lesson of lessons) {
    test(`${lesson.name}: every slide's fit is master's, and present draws it as stored`, () => {
      const t = getTheme(lesson.themeId);
      expect(lesson.slides.map((s) => s.kind)).toContain("exit-ticket");
      lesson.slides.forEach((slide, index) => {
        const fit = fitSlide(slide, t);
        expect({
          kind: slide.kind,
          fit: digest({ e: fit.slide.elements, o: fit.overflow }),
        }).toEqual({ kind: slide.kind, fit: lesson.masterFit[index] as string });
        const position = { index, total: lesson.slides.length };
        expect(presentedSlide(slide, t, position).elements).toEqual(slide.elements);
      });
    });
  }

  test("the fractions lesson carries a multiple-choice quiz", () => {
    const kinds = lessons.flatMap((l) => l.slides.map((s) => s.kind));
    expect(kinds).toContain("multiple-choice");
  });
});
