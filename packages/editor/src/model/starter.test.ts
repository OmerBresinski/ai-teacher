import { describe, expect, test } from "bun:test";
import {
  OBJECTIVES_SLIDE_HEADING,
  objectiveLine,
  richDocToPlainText,
  type Slide,
} from "@tj/domain/documents";
import { demoLibrary, starterLesson } from "./starter";

const textOf = (slide: Slide, preset: string): string => {
  const element = slide.elements.find((e) => e.type === "text" && e.style.preset === preset);
  return element && "doc" in element && element.doc ? richDocToPlainText(element.doc) : "";
};

/** Every objectives slide a teacher can open without a model: the starter and the library. */
const objectivesSlides = () =>
  [starterLesson("Photosynthesis", "chalk"), ...demoLibrary()].flatMap((lesson) =>
    lesson.slides.filter((slide) => slide.kind === "objectives"),
  );

describe("seeded objectives slides", () => {
  test("every one is headed with the reader's stem", () => {
    const slides = objectivesSlides();
    expect(slides.length).toBe(3);
    for (const slide of slides) expect(textOf(slide, "heading")).toBe(OBJECTIVES_SLIDE_HEADING);
  });

  test("every line is already in the form objectiveLine renders (TEACH-198)", () => {
    for (const slide of objectivesSlides()) {
      const lines = textOf(slide, "body")
        .split("\n")
        .filter((line) => line.trim() !== "");
      expect(lines.length).toBe(3);
      for (const line of lines) expect(line).toBe(objectiveLine(line));
    }
  });

  test("the starter names the lesson in its first objective", () => {
    const [slide] = objectivesSlides();
    expect(slide ? textOf(slide, "body") : "").toContain("explain what photosynthesis means");
  });
});
