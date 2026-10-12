import { describe, expect, it } from "bun:test";
import type { Lesson, Slide } from "@tj/domain/documents";
import { creditedLesson } from "@tj/domain/documents/fixtures";
import { layoutTemplate, type TemplateInput } from "@tj/slides/templates";
import { atKeyStage, getTheme } from "@tj/slides/themes";
import JSZip from "jszip";
import { buildSlidePlan, exportLessonPptx } from "./pptx";

/*
 * TEACH-75 part w, row 3: split-compare's reveal exports as build slides with no exporter change.
 * A side marked `reveal` writes its content at revealStep 1 over an opaque cover, so the first
 * PowerPoint slide shows the "?" medal and the second the side's words over it.
 */

const theme = atKeyStage(getTheme("splash", null), "ks2");
// A 1x1 PNG, so the picture case needs no network.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const SIDES = {
  quote: [
    { title: "Owner", text: "Profits rose.", quote: "More cloth!" },
    { title: "Worker", text: "Long hours every day.", quote: "Till dark.", reveal: true },
  ],
  picture: [
    { title: "Shield", text: "Runny lava.", picture: { photo: PNG, aspect: 4 / 3 } },
    {
      title: "Composite",
      text: "Sticky lava piles up.",
      picture: { photo: PNG, aspect: 4 / 3 },
      reveal: true,
    },
  ],
  text: [
    { title: "Shield", text: "Runny lava travels far." },
    { title: "Composite", text: "Sticky lava piles up steeply.", reveal: true },
  ],
};

function lessonWith(sides: TemplateInput["sides"]): Lesson {
  const r = layoutTemplate(
    { template: "split-compare", heading: "Two kinds", sides },
    theme,
    "ks2",
  );
  const split = { ...r.slide, id: "split", notes: "" } as unknown as Slide;
  const base = creditedLesson();
  return { ...base, themeId: "splash", slides: [split, ...base.slides.slice(0, 1)] } as Lesson;
}

async function slideXml(lesson: Lesson) {
  const blob = await exportLessonPptx(lesson, theme, { onWarning: () => {} });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const xml = async (k: number) =>
    (await zip.file(`ppt/slides/slide${k}.xml`)?.async("string")) ?? "";
  return { count: names.length, xml };
}

describe("split-compare reveal in PowerPoint (TEACH-75 part w)", () => {
  for (const zone of ["quote", "picture", "text"] as const)
    it(`${zone}: one hidden side gives two build slides, "?" first, the words second`, async () => {
      const lesson = lessonWith(SIDES[zone]);
      const plain = lesson.slides.length - 1;
      expect(buildSlidePlan(lesson)).toHaveLength(2 + plain);
      const { count, xml } = await slideXml(lesson);
      // Two build slides for the split, the plain slides 1:1, and the credits slide if any.
      expect(count).toBeGreaterThanOrEqual(2 + plain);
      const hidden = SIDES[zone][1]?.text as string;
      const [first, second] = [await xml(1), await xml(2)];
      expect(first).toContain(">?<");
      expect(first).not.toContain(hidden);
      expect(second).toContain(hidden);
      // The medal is still drawn on the second slide, under the cover painted after it.
      expect(second.indexOf(">?<")).toBeLessThan(second.indexOf(hidden));
    }, 30_000);
});
