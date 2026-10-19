import { describe, expect, it } from "bun:test";
import type { Lesson } from "@tj/domain/documents";
import { creditedLesson } from "@tj/domain/documents/fixtures";
import { layoutTemplate, type TemplateInput } from "@tj/slides/templates";
import { atKeyStage, getTheme } from "@tj/slides/themes";
import JSZip from "jszip";
import { buildSlidePlan, exportLessonPptx } from "./pptx";

/*
 * TEACH-17 part b: the worked example exports to PowerPoint with every step, move, the check and
 * the bar model, and its one-row-per-click reveal as build slides (one per step after the first).
 */
const Y8: TemplateInput = {
  template: "worked",
  heading: "Solve 3x + 5 = 20",
  lines: [
    { eq: "3x + 5 = 20" },
    { move: "Subtract 5 from both sides", eq: "3x = 15" },
    { move: "Divide both sides by 3", eq: "x = 5", answer: true },
  ],
  check: "3 × *5* + 5 = 20",
};

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function workedDeck(input: TemplateInput) {
  const theme = atKeyStage(getTheme("paper", null), "ks3");
  const r = layoutTemplate(input, theme, "ks3");
  const slide = { id: "s1", kind: r.slide.kind, elements: r.slide.elements };
  const lesson = { ...creditedLesson(), themeId: "paper", slides: [slide] } as never as Lesson;
  // Pictures are drawn as PNGs in the browser; here a 1-px PNG stands in and each SVG asked for is kept.
  const asked: string[] = [];
  const warnings: string[] = [];
  const blob = await exportLessonPptx(lesson, theme, {
    rasteriseSvg: async (src) => {
      asked.push(decodeURIComponent(src.replace(/^data:image\/svg\+xml;charset=utf-8,/, "")));
      return PNG;
    },
    onWarning: (m) => warnings.push(m),
  });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  const xml = async (n: number) =>
    (await zip.file(`ppt/slides/slide${n}.xml`)?.async("string")) ?? "";
  const text = (x: string) => [...x.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join("");
  return { lesson, slides, xml, text, zip, asked, warnings };
}

describe("PPTX worked example", () => {
  it("every step, move and the check; one build slide per row", async () => {
    const { lesson, slides, xml, text, warnings } = await workedDeck(Y8);
    expect(warnings).toEqual([]);
    // Rows 1-4 (three lines and the check) are steps 1-4.
    expect(buildSlidePlan(lesson).map((b) => b.step)).toEqual([0, 1, 2, 3, 4]);
    expect(slides).toHaveLength(5);
    const last = text(await xml(5));
    for (const w of ["Subtract", "from both sides", "Divide", "15", "Check:", "20"])
      expect(last).toContain(w);
    // Row 2 is not on the build slide before it; it is on its own.
    expect(text(await xml(2))).not.toContain("15");
    expect(text(await xml(3))).toContain("15");
    // The move arrows and the check tick are pictures.
    expect((await xml(5)).match(/<p:pic>/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  }, 30_000);

  it("the bar model exports as a picture with the rows", async () => {
    const { lesson, xml, asked, warnings } = await workedDeck({
      ...Y8,
      barPanel: { model: "algebra-bar", a: 3, b: 5, c: 20 },
    });
    expect(buildSlidePlan(lesson).map((b) => b.step)).toEqual([0, 1, 2, 3, 4]);
    const pics = async (n: number) => (await xml(n)).match(/<p:pic>/g)?.length ?? 0;
    // No panel before row 1; from row 1 on, the bar model is one more picture.
    expect(await pics(2)).toBe(1);
    expect(await pics(5)).toBe(2 + 1 + 1);
    expect(warnings).toEqual([]);
    // The bar model is drawn once per build slide it shows on (rows 1-4), each its own frame.
    const bars = asked.filter((x) => x.length > 2000);
    expect(bars).toHaveLength(4);
    expect(new Set(bars).size).toBe(4);
  }, 30_000);
});

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
