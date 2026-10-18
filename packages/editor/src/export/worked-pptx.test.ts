import { describe, expect, it } from "bun:test";
import type { Lesson } from "@tj/domain/documents";
import { creditedLesson } from "@tj/domain/documents/fixtures";
import { layoutTemplate } from "@tj/slides/templates";
import { atKeyStage, getTheme } from "@tj/slides/themes";
import JSZip from "jszip";
import { exportLessonPptx } from "./pptx";

/*
 * TEACH-215 part j (C11): a worked example's variables are the gold's Source Serif italic in
 * PowerPoint too, in a theme whose own quote face is upright (Poster: Lexend).
 */
describe("worked example: maths variables in PowerPoint", () => {
  it("Poster's x is Source Serif 4, italic", async () => {
    const theme = atKeyStage(getTheme("poster", null), "ks3");
    const r = layoutTemplate(
      {
        template: "worked",
        heading: "Solve 3x + 5 = 20",
        lines: [{ eq: "3x + 5 = 20" }, { move: "Subtract 5 from both sides", eq: "3x = 15" }],
      },
      theme,
      "ks3",
    );
    const slide = { id: "w1", kind: r.slide.kind, elements: r.slide.elements };
    const lesson = { ...creditedLesson(), themeId: "poster", slides: [slide] } as never as Lesson;
    const zip = await JSZip.loadAsync(await (await exportLessonPptx(lesson, theme)).arrayBuffer());
    const xml = (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
    const runs = [...xml.matchAll(/<a:r>(.*?)<\/a:r>/g)].map((m) => m[1] ?? "");
    const xs = runs.filter((r) => /<a:t>x<\/a:t>/.test(r));
    expect(xs.length).toBeGreaterThan(0);
    for (const r of xs) {
      expect(r).toMatch(/ i="1"/);
      expect(r).toContain('typeface="Source Serif 4"');
    }
  });
});
