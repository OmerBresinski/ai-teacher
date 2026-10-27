import { describe, expect, it } from "bun:test";
import type { Lesson, Slide } from "@tj/domain/documents";
import { creditedLesson } from "@tj/domain/documents/fixtures";
import { PLACEHOLDER_IMAGE } from "@tj/slides";
import { layoutTemplate } from "@tj/slides/templates";
import { getTheme } from "@tj/slides/themes";
import JSZip from "jszip";
import { exportLessonPptx } from "./pptx";

/*
 * TEACH-251 part av (UX ruling 37): a lesson is editable, and so exportable, while its pictures
 * still arrive. A slot whose picture is still coming exports as nothing: the words come through,
 * no placeholder art and no warning.
 */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("PPTX with a picture still on its way", () => {
  it("exports the words and leaves the pending slot out", async () => {
    const theme = getTheme("paper", null);
    const r = layoutTemplate(
      {
        template: "picture-text",
        heading: "Wrapping the mummy",
        lead: "Embalmers wrapped the dried body in linen.",
        points: ["They tucked amulets between the layers."],
        figure: { photo: PLACEHOLDER_IMAGE, aspect: 1.5, alt: "Embalmers at work" },
      },
      theme,
      "ks2",
    );
    const slide = { id: "s1", ...r.slide } as never as Slide;
    expect(slide.elements.some((e) => e.type === "image" && e.src === PLACEHOLDER_IMAGE)).toBe(
      true,
    );
    const lesson = { ...creditedLesson(), themeId: "paper", slides: [slide] } as never as Lesson;
    const warnings: string[] = [];
    const blob = await exportLessonPptx(lesson, theme, {
      rasteriseSvg: async () => PNG,
      onWarning: (w: string) => warnings.push(w),
    } as never);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
    expect(xml).toContain("<a:t>Embalmers wrapped the dried body in linen.");
    expect(xml).not.toContain("<p:pic>");
    expect(warnings).toEqual([]);
  });
});
