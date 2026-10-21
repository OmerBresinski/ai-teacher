import { describe, expect, it } from "bun:test";
import type { Lesson, Slide } from "@tj/domain/documents";
import { creditedLesson } from "@tj/domain/documents/fixtures";
import { layoutTemplate } from "@tj/slides/templates";
import { atKeyStage, getTheme } from "@tj/slides/themes";
import JSZip from "jszip";
import { buildSlidePlan, exportLessonPptx } from "./pptx";

/*
 * TEACH-101 part g: the quick check in PowerPoint. Each answer is a field-coloured cover over its
 * "?" chip plus the answer at its own reveal step, so the exporter writes one build slide per
 * answer (plus the hidden slide) with no exporter change. Shapes: the sand field a plain rect
 * (square own corners), number badges and "?" chips ellipses.
 */

const QS: [string, string][] = [
  ["Which organ pumps blood around the body?", "The heart"],
  ["Which vessels carry blood away from the heart?", "Arteries"],
  ["Which gas does blood pick up in the lungs?", "Oxygen"],
  ["What is the beat you feel in your wrist?", "Your pulse"],
];

async function exported(themeId: string) {
  const theme = atKeyStage(getTheme(themeId, null), "ks2");
  const r = layoutTemplate(
    {
      template: "question-set",
      heading: "Quick check: the heart",
      questions: QS.map((q) => q[0]),
      answers: QS.map((q) => q[1]),
    },
    theme,
    "ks2",
  );
  const slide = { ...r.slide, id: "qc", notes: "" } as unknown as Slide;
  const base = creditedLesson();
  const lesson = { ...base, themeId, slides: [slide] } as Lesson;
  const blob = await exportLessonPptx(lesson, theme, { onWarning: () => {} });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = async (k: number) =>
    (await zip.file(`ppt/slides/slide${k}.xml`)?.async("string")) ?? "";
  return { lesson, slide, xml };
}

describe("quick check in PowerPoint (TEACH-101 part g)", () => {
  it("one build slide per answer after the hidden slide, answers appearing in order", async () => {
    const { lesson, xml } = await exported("splash");
    expect(buildSlidePlan(lesson)).toHaveLength(QS.length + 1);
    const hidden = await xml(1);
    expect(hidden.match(/>\?</g)?.length).toBe(QS.length);
    for (const [, a] of QS) expect(hidden).not.toContain(`>${a}<`);
    for (let k = 1; k <= QS.length; k++) {
      const x = await xml(k + 1);
      QS.forEach(([, a], i) => {
        if (i < k) expect(x).toContain(`>${a}<`);
        else expect(x).not.toContain(`>${a}<`);
      });
    }
  }, 30_000);

  it("the field is painted in the field-b sand; badges and chips are ellipses", async () => {
    for (const id of ["splash", "paper", "night-lab"]) {
      const { slide, xml } = await exported(id);
      const field = slide.elements.find((e) => e.name === "surface:field-b" && !e.revealStep) as {
        fill: string;
      };
      const sand = field.fill.replace("#", "").toUpperCase().slice(0, 6);
      const x = await xml(1);
      // The field's sand is written as a solid fill on the hidden slide (the covers come later).
      expect(x.includes(`<a:solidFill><a:srgbClr val="${sand}"`), id).toBe(true);
      const ellipses = x.match(/<a:prstGeom prst="ellipse">/g) ?? [];
      expect(ellipses.length, id).toBeGreaterThanOrEqual(2 * QS.length);
    }
  }, 30_000);
});
