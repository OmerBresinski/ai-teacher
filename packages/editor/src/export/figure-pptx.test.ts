import { describe, expect, it } from "bun:test";
import type { Lesson, Slide } from "@tj/domain/documents";
import { creditedLesson } from "@tj/domain/documents/fixtures";
import { loadIcons } from "@tj/slides/icons";
import { layoutTemplate, type TemplateInput } from "@tj/slides/templates";
import { getTheme } from "@tj/slides/themes";
import JSZip from "jszip";
import { exportLessonPptx } from "./pptx";

/*
 * TEACH-239 part b (C7): a figure slide exports to PowerPoint with its title, the model as a picture
 * of the restyled drawing and its caption; a failed model's plate exports its medal and icon.
 */
const SVG = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" class="slide tk theme-primary" viewBox="0 0 1280 564"><text x="9" y="40">Evaporation</text></svg>',
)}`;
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function exported(input: TemplateInput) {
  const theme = getTheme("paper", null);
  const r = layoutTemplate(input, theme, "ks2");
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
  return { xml, drawn, warnings, zip };
}

describe("PPTX: the figure slide", () => {
  it("exports the title, the caption and the model picture", async () => {
    const { xml, drawn, warnings, zip } = await exported({
      template: "figure",
      heading: "The water cycle in a town",
      accentWord: "water cycle",
      lead: "The same water goes round and round.",
      figure: { drawn: { src: SVG, aspect: 2.27, alt: "Water cycle", bare: true } },
    });
    for (const w of ["The ", "water cycle", " in a town", "The same water goes round and round."])
      expect(xml).toContain(`<a:t>${w}`);
    expect(xml).toContain("<p:pic>");
    expect(drawn.some((d) => d.includes('data-restyle="tj"'))).toBe(true);
    expect(Object.keys(zip.files).some((f) => f.startsWith("ppt/media/"))).toBe(true);
    expect(warnings).toEqual([]);
  });
  it("a failed model exports its plate, medal and icon", async () => {
    await loadIcons();
    const { xml, warnings } = await exported({
      template: "figure",
      heading: "Inside a volcano",
      lead: "Magma rises from the chamber through the vent.",
      icon: "volcano",
    });
    expect(xml).toContain("<a:t>Magma rises from the chamber through the vent.");
    expect(xml).toContain('prst="ellipse"');
    expect(xml).toContain("<p:pic>");
    expect(warnings).toEqual([]);
  });
});
