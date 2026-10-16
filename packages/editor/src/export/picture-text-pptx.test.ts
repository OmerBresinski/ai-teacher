import { describe, expect, it } from "bun:test";
import type { Lesson, Slide } from "@tj/domain/documents";
import { creditedLesson } from "@tj/domain/documents/fixtures";
import { layoutTemplate, type TemplateInput } from "@tj/slides/templates";
import { getTheme } from "@tj/slides/themes";
import JSZip from "jszip";
import { exportLessonPptx } from "./pptx";

/*
 * TEACH-75 part ae (C6): picture and text exports with every word and its shapes. The plain look
 * keeps its lead, points and picture; the key card look its label, red term and meaning on sand
 * cards (own corners, drawn as custom geometry or a rounded rect), and nothing builds.
 */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function slideXml(input: TemplateInput) {
  const theme = getTheme("paper", null);
  const r = layoutTemplate(input, theme, "ks2");
  expect(r.over).toEqual([]);
  const slide = { id: "s1", ...r.slide } as never as Slide;
  const lesson = { ...creditedLesson(), themeId: "paper", slides: [slide] } as never as Lesson;
  const warnings: string[] = [];
  const blob = await exportLessonPptx(lesson, theme, {
    rasteriseSvg: async () => PNG,
    onWarning: (w: string) => warnings.push(w),
  } as never);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
  return { xml, warnings, files: Object.keys(zip.files) };
}

describe("PPTX: picture and text", () => {
  it("plain look: title, lead, points, the field and the picture", async () => {
    const { xml, files } = await slideXml({
      template: "picture-text",
      heading: "Wrapping the mummy",
      accentWord: "mummy",
      lead: "Embalmers wrapped the dried body in linen.",
      points: ["They tucked amulets between the layers.", "Wrapping took fifteen days."],
      figure: { photo: PNG, aspect: 1.5, alt: "Embalmers at work" },
      pictureText: { icon: "mummy" },
    });
    for (const w of [
      "Wrapping the ",
      "mummy",
      "Embalmers wrapped the dried body in linen.",
      "They tucked amulets between the layers.",
      "Wrapping took fifteen days.",
    ])
      expect(xml).toContain(`<a:t>${w}`);
    expect(xml).toContain("<p:pic>");
    // The field's one rounded corner is custom geometry; the dots are ellipses.
    expect(xml).toContain("<a:custGeom>");
    expect(xml).toContain('prst="ellipse"');
    expect(files.some((f) => f.startsWith("ppt/media/"))).toBe(true);
    expect(xml).not.toContain("<p:timing>");
  });

  it("key card look: label, red term and meaning on a sand card, no build", async () => {
    const { xml, warnings } = await slideXml({
      template: "picture-text",
      heading: "Magma and lava",
      pictureText: {
        cards: [
          {
            kind: "word",
            label: "Key word",
            term: "magma",
            meaning: "Melted rock under the ground.",
          },
          {
            kind: "fact",
            label: "Key fact",
            num: "400",
            unit: "metres",
            meaning: "Blown off the top.",
          },
        ],
      },
    });
    for (const w of ["KEY WORD", "magma", "Melted rock under the ground.", "400", "metres"])
      expect(xml).toContain(`<a:t>${w}`);
    expect(xml).toMatch(/<a:custGeom>|prst="roundRect"/);
    expect(xml).not.toContain("<p:timing>");
    expect(warnings).toEqual([]);
  });
});
