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
    lesson.slides.forEach((slide) => {
      expect(withoutDiagramSlot(slide, t)).toBe(slide);
      expect(withSlotsShown(slide, t)).toBe(slide);
      expect(slotSide(slide, "left")).toBe(slide);
      const shown = presentedSlide(slide, t);
      expect(shown.elements).toEqual(slide.elements);
    });
  });

  test("a diagram slide keeps its figure at the left, as drawn", () => {
    const laid = layoutSlide("diagram", "chalk");
    const slide: Slide = { id: "d1", kind: "diagram", elements: laid.elements };
    const shown = presentedSlide(slide, getTheme("chalk"));
    expect(shown.elements).toEqual(slide.elements);
    const figure = figureGroupOf(shown);
    expect(figure && { x: figure.x, y: figure.y, w: figure.w, h: figure.h }).toEqual(FIGURE_RECT);
  });
});

/*
 * Three lessons generated and stored on master (e49 B: fractions, rates, ratio), recorded as a
 * digest of each slide's fit. The slides are as stored; the digests are re-pinned at fit version 3
 * (ruling 140), where the teaching body sets at 0.7 of the display stop and the floor is 20: the
 * starters, worked examples, a content and an instructions slide and the exit tickets fit
 * differently, every other slide as it did on master. A digest that moves without a deliberate fit
 * change is a regression.
 */
describe("stored master lessons fit as pinned at fit version 3", () => {
  type Stored = { name: string; themeId: string; slides: Slide[]; masterFit: string[] };
  const { lessons } = storedLessons as unknown as { lessons: Stored[] };
  const digest = (value: unknown) =>
    new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

  for (const lesson of lessons) {
    test(`${lesson.name}: every slide's fit is the pinned one, and present draws it as stored`, () => {
      const t = getTheme(lesson.themeId);
      expect(lesson.slides.map((s) => s.kind)).toContain("exit-ticket");
      lesson.slides.forEach((slide, index) => {
        const fit = fitSlide(slide, t);
        expect({
          kind: slide.kind,
          fit: digest({ e: fit.slide.elements, o: fit.overflow }),
        }).toEqual({ kind: slide.kind, fit: lesson.masterFit[index] as string });
        expect(presentedSlide(slide, t).elements).toEqual(slide.elements);
      });
    });
  }

  test("the fractions lesson carries a multiple-choice quiz", () => {
    const kinds = lessons.flatMap((l) => l.slides.map((s) => s.kind));
    expect(kinds).toContain("multiple-choice");
  });
});
