import { describe, expect, it } from "bun:test";
import type { Lesson, TextElement } from "@tj/domain/documents";
import { creditedLesson } from "@tj/domain/documents/fixtures";
import { fittedFontSize, growFixedText } from "@tj/slides";
import { layoutTemplate } from "@tj/slides/templates";
import { atKeyStage, getTheme } from "@tj/slides/themes";
import JSZip from "jszip";
import { exportLessonPptx } from "./pptx";

/*
 * TEACH-75 part o: the PPTX export draws a fixed-height title at the size and in the box the
 * renderer draws it, so a teacher's long title is not clipped or overflowing in PowerPoint either.
 */

const theme = atKeyStage(getTheme("splash", null), "ks2");

function titleSlide(extra: string) {
  const r = layoutTemplate(
    {
      template: "title",
      heading: "The heart and circulatory system",
      lead: "Recall: what changes in your body when you run?",
      figure: { photo: "", aspect: 4 / 3, alt: "a runner" },
    },
    theme,
    "ks2",
  );
  const elements = r.slide.elements
    .filter((e) => e.type === "text")
    .map((e) => {
      if (e.name !== "Title") return e;
      const t = e as TextElement;
      const words = `The heart and circulatory system ${extra}`;
      return {
        ...t,
        doc: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: words }] }],
        },
      } as TextElement;
    });
  return { id: "t1", kind: "title" as const, elements, background: r.slide.background };
}

async function exported(slide: ReturnType<typeof titleSlide>) {
  const lesson = { ...creditedLesson(), themeId: "splash", slides: [slide] } as never as Lesson;
  const blob = await exportLessonPptx(lesson, theme);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
  // The title is the first text box drawn; its runs carry the size in hundredths of a point.
  const sizes = [...xml.matchAll(/<a:rPr[^>]*\ssz="(\d+)"/g)].map((m) => Number(m[1]) / 100);
  const offs = [...xml.matchAll(/<a:off x="\d+" y="(\d+)"\/><a:ext cx="\d+" cy="(\d+)"/g)].map(
    (m) => ({ y: Number(m[1]) / 12700, h: Number(m[2]) / 12700 }),
  );
  return { sizes, offs };
}

describe("PPTX title fit (TEACH-75 part o)", () => {
  it("exports an edited title at the size the renderer draws it", async () => {
    const slide = titleSlide("and lungs");
    const title = slide.elements.find((e) => e.name === "Title") as TextElement;
    const fitted = fittedFontSize(title, theme);
    expect(fitted).toBeDefined();
    const { sizes } = await exported(slide);
    expect(sizes[0]).toBe(fitted as number);
  }, 30_000);

  it("exports a title too long for its floor in the grown box, subtitle pushed below it", async () => {
    const slide = titleSlide(
      "and how the blood carries oxygen from the lungs round the whole body, then back to the heart again, through arteries, veins and capillaries, every minute of the day and night",
    );
    const grown = growFixedText(slide.elements, theme);
    const title = grown.find((e) => e.name === "Title") as TextElement;
    const sub = grown.find((e) => e.name === "Subtitle") as TextElement;
    const stored = slide.elements.find((e) => e.name === "Title") as TextElement;
    expect(title.h).toBeGreaterThan(stored.h);
    expect(sub.y).toBeGreaterThanOrEqual(title.y + title.h - 1);
    const { offs } = await exported(slide);
    const at = (y: number, h: number) =>
      offs.some((o) => Math.abs(o.y - y) < 1 && Math.abs(o.h - h) < 1);
    expect(at(title.y, title.h)).toBe(true);
    expect(at(sub.y, sub.h)).toBe(true);
  }, 30_000);
});
