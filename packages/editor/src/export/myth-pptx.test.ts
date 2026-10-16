import { describe, expect, it } from "bun:test";
import type { Lesson, Slide } from "@tj/domain/documents";
import { creditedLesson } from "@tj/domain/documents/fixtures";
import { loadIcons } from "@tj/slides/icons";
import { layoutTemplate, type TemplateInput } from "@tj/slides/templates";
import { atKeyStage, getTheme } from "@tj/slides/themes";
import JSZip from "jszip";
import { buildSlidePlan, exportLessonPptx } from "./pptx";

/*
 * TEACH-75 part ag (G1), common acceptance row 6: myth and fact in PowerPoint. Each click is a build
 * slide (vote: the card, the verdict, the fact; straight: two). The seam arrow is a closed path
 * (`custGeom`), the discs are ellipses, the card and chips rounded rects, and the myth strike is
 * drawn as a thin rect over the claim from the verdict's build on.
 */
await loadIcons();
const theme = atKeyStage(getTheme("paper", null), "ks2");
const MYTH: NonNullable<TemplateInput["myth"]> = {
  opening: "vote",
  verdict: "myth",
  claim: "Heavier objects fall faster.",
  fact: "Without air resistance, all objects fall at the same rate.",
  factEm: "the same rate.",
  proof: {
    icons: ["hammer", "bird-feather"],
    line: "On the Moon, a hammer and a feather **land together.**",
  },
};

function lessonOf(myth: NonNullable<TemplateInput["myth"]>): Lesson {
  const r = layoutTemplate(
    { template: "myth", heading: "How things fall", myth },
    getTheme("paper", null),
    "ks2",
  );
  const slide = { ...r.slide, id: "myth", notes: "" } as unknown as Slide;
  return { ...creditedLesson(), themeId: "paper", slides: [slide] } as Lesson;
}

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
/** The SVGs the exporter asked to rasterise (the proof medals). */
let rasterised: string[] = [];
async function exported(lesson: Lesson) {
  rasterised = [];
  const blob = await exportLessonPptx(lesson, theme, {
    onWarning: () => {},
    rasteriseSvg: async (src) => {
      rasterised.push(decodeURIComponent(src));
      return PNG;
    },
  });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  return Promise.all(names.map(async (n) => (await zip.file(n)?.async("string")) ?? ""));
}
const geometries = (xml: string) =>
  [...xml.matchAll(/<a:(prstGeom prst="([a-zA-Z0-9]+)"|custGeom)/g)].map((m) => m[2] ?? "custGeom");
const count = (xml: string, k: string) => geometries(xml).filter((g) => g === k).length;

describe("myth and fact in PowerPoint (TEACH-75 part ag)", () => {
  it("vote: three build slides, card first, verdict, then the fact with its proof", async () => {
    const lesson = lessonOf(MYTH);
    expect(buildSlidePlan(lesson)).toHaveLength(3);
    const [s0, s1, s2] = await exported(lesson);
    expect(s0).toContain("True or false?");
    expect(s0).toContain("Heavier objects fall faster.");
    expect(s0).not.toContain("MYTH");
    expect(s1).toContain("MYTH");
    expect(s1).not.toContain("Without air resistance");
    expect(s2).toContain("Without air resistance");
    expect(s2).toContain("land together.");
    // The payoff is plain bold ink: no fill or highlight box behind it (the gold has none).
    expect(s2).not.toContain("<a:highlight");
    expect(s2).toMatch(/b="1"[^>]*>(?:(?!<\/a:r>).)*?<a:t>land together\.<\/a:t>/);
    // Card and the two chips are rounded rects; the stamp, seam and halo discs are ellipses.
    expect(count(s0 as string, "roundRect")).toBeGreaterThanOrEqual(3);
    expect(count(s2 as string, "ellipse")).toBe(3);
    // The seam arrow is a closed path (custGeom), as are the chip and stamp glyphs.
    expect(count(s2 as string, "custGeom")).toBeGreaterThan(count(s1 as string, "custGeom"));
    // The strike: a thin rect over the claim from the verdict's build on, not on the card's.
    expect(count(s1 as string, "rect")).toBeGreaterThan(count(s0 as string, "rect"));
    // Two proof medals, as pictures.
    // The two proof medals go out as pictures on the fact's build (a disc face, the drawing on it).
    expect(
      rasterised.filter((svg) => svg.includes('viewBox="0 0 240 240"')).length,
    ).toBeGreaterThanOrEqual(2);
    expect((s2 as string).match(/<p:pic\b/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect((s1 as string).match(/<p:pic\b/g)?.length ?? 0).toBe(0);
  });

  it("straight: two build slides, the verdict first", async () => {
    const lesson = lessonOf({ ...MYTH, opening: "straight" });
    expect(buildSlidePlan(lesson)).toHaveLength(2);
    const [s0, s1] = await exported(lesson);
    expect(s0).toContain("MYTH");
    expect(s0).not.toContain("True or false?");
    expect(s1).toContain("Without air resistance");
  });
});
