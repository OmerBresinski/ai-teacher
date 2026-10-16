import { describe, expect, it } from "bun:test";
import type { Lesson, Slide } from "@tj/domain/documents";
import { creditedLesson } from "@tj/domain/documents/fixtures";
import { layoutTemplate } from "@tj/slides/templates";
import { getTheme } from "@tj/slides/themes";
import JSZip from "jszip";
import { exportLessonPptx } from "./pptx";

/*
 * TEACH-75 part af (C8): a step with its library model exports to PowerPoint with every word (the
 * badge's number, the title, the do and see lines) and the model, drawn as a picture of the
 * restyled drawing (never dropped, never an embedded SVG).
 */
const SVG = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" class="slide tk theme-primary" viewBox="0 0 990 450"><g><rect width="90" height="90"/><text x="9" y="40">Sand stays</text></g></svg>',
)}`;
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("PPTX: steps with a model", () => {
  it("exports every text and the model picture", async () => {
    const theme = getTheme("paper", null);
    const r = layoutTemplate(
      {
        template: "steps",
        heading: "Filter",
        step: { n: 2, do: "Pour the mixture through filter paper.", see: "Water drips through." },
        figure: { drawn: { src: SVG, aspect: 2.2, alt: "Filter", bare: true } },
      },
      theme,
      "ks2",
    );
    const slide = { id: "s1", ...r.slide } as never as Slide;
    const lesson = { ...creditedLesson(), themeId: "paper", slides: [slide] } as never as Lesson;
    const drawn: string[] = [];
    const warnings: string[] = [];
    const blob = await exportLessonPptx(lesson, theme, {
      rasteriseSvg: async (src: string) => {
        drawn.push(decodeURIComponent(src));
        return PNG;
      },
      onWarning: (w: string) => warnings.push(w),
    } as never);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
    for (const w of [
      "2",
      "Filter",
      "Pour the mixture through filter paper.",
      "Water drips through.",
    ])
      expect(xml).toContain(`<a:t>${w}`);
    expect(xml).toContain('prst="ellipse"');
    expect(xml).toContain("<p:pic>");
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toContain('data-restyle="tj"');
    expect(
      Object.keys(zip.files).some((f) => f.startsWith("ppt/media/") && f.endsWith(".png")),
    ).toBe(true);
    expect(warnings).toEqual([]);
  });
});
