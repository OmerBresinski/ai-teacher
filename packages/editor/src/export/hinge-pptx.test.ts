import { describe, expect, it } from "bun:test";
import type { Lesson } from "@tj/domain/documents";
import { creditedLesson } from "@tj/domain/documents/fixtures";
import { dimInk, surfaceStyle } from "@tj/slides/surfaces";
import { layoutTemplate } from "@tj/slides/templates";
import { atKeyStage, getTheme } from "@tj/slides/themes";
import JSZip from "jszip";
import { buildSlidePlan, exportLessonPptx } from "./pptx";

/*
 * TEACH-256 part b: the hinge reveals in one click, so PowerPoint gets one more build slide: the
 * right card ringed and ticked in `verdict-right`, its key in `key:right`, the others washed.
 * Cards and keys are rounded rectangles (own corners), the tick an ellipse.
 */
async function hingeDeck(themeId: string) {
  const theme = atKeyStage(getTheme(themeId, null), "ks2");
  const r = layoutTemplate(
    {
      template: "hinge",
      heading: "Which of these metals is magnetic?",
      options: ["Copper", "Iron", "Aluminium", "All of them"],
      correct: 2,
    },
    theme,
    "ks2",
  );
  const slide = {
    id: "s1",
    kind: r.slide.kind,
    elements: r.slide.elements,
    question: r.slide.question,
  };
  const lesson = { ...creditedLesson(), themeId, slides: [slide] } as never as Lesson;
  const zip = await JSZip.loadAsync(await (await exportLessonPptx(lesson, theme)).arrayBuffer());
  const xml = async (n: number) =>
    (await zip.file(`ppt/slides/slide${n}.xml`)?.async("string")) ?? "";
  return {
    lesson,
    theme,
    ask: await xml(1),
    reveal: await xml(2),
    third: zip.file("ppt/slides/slide3.xml"),
  };
}

describe("PPTX hinge reveal", () => {
  it("one build slide for the one-click reveal", async () => {
    const { lesson, third } = await hingeDeck("paper");
    expect(buildSlidePlan(lesson).map((b) => b.step)).toEqual([0, 1]);
    expect(third).toBeNull();
  }, 30_000);

  for (const id of ["paper", "dark-slate", "dark-ember"])
    it(`${id}: the reveal slide adds ring, key and tick in the theme's roles; the ask slide has none`, async () => {
      const { ask, reveal, theme } = await hingeDeck(id);
      const right = surfaceStyle(theme, "verdict-right").fill.slice(1).toUpperCase();
      const key = surfaceStyle(theme, "key", "right").fill.slice(1).toUpperCase();
      expect(ask).not.toContain(`val="${right}"`);
      expect(reveal).toContain(`val="${right}"`);
      expect(reveal).toContain(`val="${key}"`);
      const geoms = (x: string) => [...x.matchAll(/<a:prstGeom prst="(\w+)"/g)].map((m) => m[1]);
      expect(geoms(reveal).filter((g) => g === "ellipse").length).toBe(
        geoms(ask).filter((g) => g === "ellipse").length + 1,
      );
      // Part d (ruling 258): the three wrong cards are redrawn with words in the dim tone, never
      // washed over with a see-through shape.
      const dim = dimInk(theme).slice(1).toUpperCase();
      expect(ask).not.toContain(`val="${dim}"`);
      expect(reveal).toContain(`val="${dim}"`);
      expect(reveal).not.toContain("Reveal wash");
      expect(reveal).not.toContain("<a:alpha");
    }, 30_000);
});
