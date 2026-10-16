import { describe, expect, it } from "bun:test";
import type { Lesson, Slide } from "@tj/domain/documents";
import { creditedLesson } from "@tj/domain/documents/fixtures";
import { loadIcons } from "@tj/slides/icons";
import { layoutTemplate, type TemplateInput } from "@tj/slides/templates";
import { atKeyStage, getTheme } from "@tj/slides/themes";
import JSZip from "jszip";
import { exportLessonPptx } from "./pptx";

/*
 * TEACH-75 part ac (C4), common acceptance row 6: stages in PowerPoint. The strip's end frames
 * keep their own outer corners and every block arrow (and its halo) is a closed path, all
 * `custGeom`; the middle frames are plain rects. Stages have no reveal: one slide, no build slides.
 */
await loadIcons();
const theme = atKeyStage(getTheme("paper", null), "ks2");
const INPUT: TemplateInput = {
  template: "stages",
  heading: "From wheat to bread",
  stages: [
    { name: "Grow", line: "Farmers sow wheat in autumn.", icon: "wheat" },
    { name: "Harvest", line: "Combines cut the ripe wheat.", icon: "combine-harvester" },
    { name: "Mill", line: "Mills grind the grain into flour.", icon: "flour" },
    { name: "Bake", line: "Bakers mix, prove and bake.", icon: "oven" },
    { name: "Sell", line: "Shops sell the bread.", icon: "bakery" },
  ],
};

async function exported() {
  const r = layoutTemplate(INPUT, getTheme("paper", null), "ks2");
  const slide = { ...r.slide, id: "stages", notes: "" } as unknown as Slide;
  const base = creditedLesson();
  const lesson = { ...base, themeId: "paper", slides: [slide] } as Lesson;
  const blob = await exportLessonPptx(lesson, theme, { onWarning: () => {} });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  return {
    count: names.length,
    xml: (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "",
  };
}
const geometries = (xml: string) =>
  [...xml.matchAll(/<a:(prstGeom prst="([a-zA-Z0-9]+)"|custGeom)/g)].map((m) => m[2] ?? "custGeom");

describe("stages in PowerPoint (TEACH-75 part ac)", () => {
  it("end frames and arrows are custGeom, middle frames rects, and there is one slide", async () => {
    const { count, xml } = await exported();
    expect(count).toBe(1);
    const g = geometries(xml);
    // 2 end frames + 4 arrows + 4 halos as closed paths.
    expect(g.filter((k) => k === "custGeom").length).toBe(10);
    expect(g.filter((k) => k === "rect").length).toBeGreaterThanOrEqual(3);
  });
});
