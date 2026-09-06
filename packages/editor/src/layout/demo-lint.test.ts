import { describe, expect, test } from "bun:test";
import { demoLibrary, starterLesson } from "../model/starter";
import { getTheme, THEMES } from "../model/themes";
import { renderedHeights } from "./fit-plan";
import { findOverlaps, lintSlide } from "./lint";
import { rulerFor } from "./test-ruler";

/*
 * The demo has to be clean (TeachDeck `demo-lint.test.ts`): it is the first lesson every teacher
 * opens, it is hand-placed rather than laid out by a recipe, and the auto-height boxes are stored
 * at the height they were authored at — so every slide is held to the linter, and then to the
 * linter over the slide *as the renderer grows it*.
 */

const lessons = [
  ...demoLibrary().map((l) => [l.id, l] as const),
  ...THEMES.map((t) => [`starter (${t.id})`, starterLesson("Starter", t.id)] as const),
];

describe("the demo and starter lessons lint clean", () => {
  for (const [name, lesson] of lessons) {
    const theme = getTheme(lesson.themeId);
    lesson.slides.forEach((slide, i) => {
      test(`${name} slide ${i + 1} (${slide.kind}) passes every check`, () => {
        expect(lintSlide(slide, rulerFor(theme), theme)).toMatchObject({
          overlaps: [],
          overflow: [],
          laneOverflow: [],
          ok: true,
        });
      });
      test(`${name} slide ${i + 1} (${slide.kind}) has room for the text it holds`, () => {
        expect(findOverlaps(renderedHeights(slide, rulerFor(theme)))).toEqual([]);
      });
    });
  }
});
