import { describe, expect, it } from "bun:test";
import type { Lesson } from "@tj/domain/documents";
import { creditedLesson } from "@tj/domain/documents/fixtures";
import { layoutTemplate, type Stage } from "@tj/slides/templates";
import { atKeyStage, getTheme } from "@tj/slides/themes";
import JSZip from "jszip";
import { exportLessonPptx } from "./pptx";

/*
 * Icon option 2 (TEACH-75 part u): from KS3 an items-row icon sits on a rounded-square tile; the
 * PPTX export draws that tile as a PowerPoint rounded rectangle, and KS2's medal stays an ellipse.
 */

const ITEMS = [
  { name: "Heart", text: "A muscle that pumps blood.", icon: "heart" },
  { name: "Blood", text: "Carries oxygen and nutrients.", icon: "blood" },
  { name: "Lungs", text: "Fill the blood with oxygen.", icon: "lungs" },
];

async function geometries(stage: Stage) {
  const theme = atKeyStage(getTheme("splash", null), stage);
  const r = layoutTemplate(
    { template: "items-row", heading: "Three parts work together", items: ITEMS },
    theme,
    stage,
  );
  const slide = { id: "s1", kind: "content", elements: r.slide.elements };
  const lesson = { ...creditedLesson(), themeId: "splash", slides: [slide] } as never as Lesson;
  const zip = await JSZip.loadAsync(await (await exportLessonPptx(lesson, theme)).arrayBuffer());
  const xml = (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
  return [...xml.matchAll(/<a:prstGeom prst="(\w+)"/g)].map((m) => m[1]);
}

describe("PPTX icon tiles (icon option 2)", () => {
  it("exports KS3 tiles as rounded rectangles, KS2 medals as ellipses", async () => {
    const ks3 = await geometries("ks3");
    const ks2 = await geometries("ks2");
    // Three tiles plus three (background-coloured) halos.
    expect(ks3.filter((g) => g === "roundRect").length).toBeGreaterThanOrEqual(6);
    expect(ks2.filter((g) => g === "roundRect").length).toBeLessThan(
      ks3.filter((g) => g === "roundRect").length,
    );
    expect(ks2.filter((g) => g === "ellipse").length).toBeGreaterThanOrEqual(6);
  }, 30_000);
});
