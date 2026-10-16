import { describe, expect, it } from "bun:test";
import type { Lesson } from "@tj/domain/documents";
import { creditedLesson } from "@tj/domain/documents/fixtures";
import { layoutTemplate } from "@tj/slides/templates";
import { SOURCE_CASES } from "@tj/slides/templates/source-fixtures";
import { atKeyStage, getTheme } from "@tj/slides/themes";
import JSZip from "jszip";
import { exportLessonPptx } from "./pptx";

/*
 * TEACH-75 part ab: a source in PowerPoint. The card and each highlight are rounded rectangles,
 * the joins are lines, and each click's highlight, join and note become one more build slide.
 */
async function sourceDeck(name: string) {
  const k = SOURCE_CASES.find((c) => c.name === name);
  if (!k) throw new Error(name);
  const theme = atKeyStage(getTheme("paper", null), k.stage);
  const r = layoutTemplate(k.input, theme, k.stage);
  const slide = { id: "s1", kind: r.slide.kind, elements: r.slide.elements };
  const lesson = { ...creditedLesson(), themeId: "paper", slides: [slide] } as never as Lesson;
  const zip = await JSZip.loadAsync(await (await exportLessonPptx(lesson, theme)).arrayBuffer());
  const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  const xml = async (n: number) =>
    (await zip.file(`ppt/slides/slide${n}.xml`)?.async("string")) ?? "";
  return { slides: slides.length, xml };
}

describe("source PPTX", () => {
  it("each note is a build slide: the extract alone, then one more note per slide", async () => {
    const owen = await sourceDeck("owen");
    expect(owen.slides).toBe(4);
    const dickens = await sourceDeck("dickens");
    expect(dickens.slides).toBe(3);
  });

  it("the card and highlights are rounded rects, the joins lines; notes arrive in order", async () => {
    const d = await sourceDeck("dickens");
    const first = await d.xml(1);
    const last = await d.xml(3);
    expect(first).toContain('prst="roundRect"');
    expect(first).not.toContain("greed that grabs");
    expect(last).toContain("greed that grabs");
    expect(last).toContain("shut away from");
    expect(last).toMatch(/prst="line"|<p:cxnSp/);
    const rounds = (s: string) => (s.match(/prst="roundRect"/g) ?? []).length;
    expect(rounds(last)).toBeGreaterThan(rounds(first));
  });
});
