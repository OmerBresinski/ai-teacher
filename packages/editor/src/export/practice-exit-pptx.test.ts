import { describe, expect, it } from "bun:test";
import type { Lesson, Slide } from "@tj/domain/documents";
import { creditedLesson } from "@tj/domain/documents/fixtures";
import { layoutTemplate, type TemplateInput } from "@tj/slides/templates";
import { atKeyStage, getTheme } from "@tj/slides/themes";
import JSZip from "jszip";
import { exportLessonPptx } from "./pptx";

/*
 * TEACH-230 part b: practice and the exit ticket in PowerPoint. Badges are native ellipses,
 * hairlines plain rects, the ticket and the picture card rounded rects, the sand floor a shape
 * under the ticket. Nothing builds (the gold has no reveal), so each slide is one PowerPoint slide.
 */
const theme = atKeyStage(getTheme("paper", null), "ks2");

const EXIT: TemplateInput = {
  template: "exit-ticket",
  heading: "Fractions of amounts",
  questions: ["Find 1/6 of 42.", "Find 4/5 of 30.", "Find 3/8 of 32."],
  answers: ["7", "24", "12"],
};
const PRACTICE: TemplateInput = {
  template: "practice",
  heading: "Plants and water",
  questions: [
    "Which part of a plant takes in water?",
    "Name the tubes that carry water.",
    "Why do leaves wilt on a hot day?",
    "Plan a test about light.",
  ],
};

function lessonWith(input: TemplateInput): Lesson {
  const r = layoutTemplate(input, theme, "ks2");
  const slide = { ...r.slide, id: "work", notes: "" } as unknown as Slide;
  const base = creditedLesson();
  return { ...base, themeId: "paper", slides: [slide] } as Lesson;
}

async function slides(lesson: Lesson) {
  const blob = await exportLessonPptx(lesson, theme, { onWarning: () => {} });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const first = (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
  return { count: names.length, first };
}
const count = (xml: string, geom: string) =>
  (xml.match(new RegExp(`prstGeom prst="${geom}"`, "g")) ?? []).length;

describe("practice and exit ticket in PowerPoint (TEACH-230 part b)", () => {
  it("the exit ticket: three ellipse badges, a rounded ticket, one slide, no answers drawn", async () => {
    const { count: n, first } = await slides(lessonWith(EXIT));
    expect(n).toBe(1);
    expect(count(first, "ellipse")).toBe(3);
    expect(count(first, "roundRect")).toBeGreaterThanOrEqual(1);
    expect(first).toContain("EXIT TICKET");
    expect(first).not.toContain(">24<");
  });

  it("practice: four ellipse badges and four rect hairlines on one slide", async () => {
    const { count: n, first } = await slides(lessonWith(PRACTICE));
    expect(n).toBe(1);
    expect(count(first, "ellipse")).toBe(4);
    expect(count(first, "rect")).toBeGreaterThanOrEqual(4);
  });
});
