import { describe, expect, it } from "bun:test";
import type { Lesson, Slide } from "@tj/domain/documents";
import { creditedLesson } from "@tj/domain/documents/fixtures";
import { type AnswerGroup, endAnswerSlides } from "@tj/slides/templates/end-answers";
import { atKeyStage, getTheme } from "@tj/slides/themes";
import JSZip from "jszip";
import { resolveTextStyle } from "../slide/elements/kit";
import { exportLessonPptx } from "./pptx";

/*
 * TEACH-191 part b (ruling 240; THEME-FIT §3): the guard and Answers slides export with native
 * shapes (badges as ellipses, verdict chips and the guard disc as PowerPoint shapes, the hairline a
 * rect), the "Teacher only" pill never exported, and the Answers slides hidden (skipped by the
 * slideshow) unless the export includes the answers. Each reveal step becomes a build slide, so each slide
 * is one PowerPoint slide per reveal step.
 */
const GROUPS: AnswerGroup[] = [
  {
    kind: "practice",
    title: "True or false: the water cycle",
    items: [
      { n: 1, tf: true },
      { n: 2, tf: false, why: "They are tiny drops of water." },
    ],
  },
  {
    kind: "exit",
    title: "The water cycle",
    items: [
      { n: 1, a: "Evaporation" },
      { n: 2, a: "Condensation" },
    ],
  },
];

async function exported(includeAnswers: boolean) {
  const theme = getTheme("splash", null);
  const slides: Slide[] = endAnswerSlides(GROUPS, theme, "ks2");
  const lesson = { ...creditedLesson(), themeId: "splash", slides } as never as Lesson;
  const zip = await JSZip.loadAsync(
    await (await exportLessonPptx(lesson, theme, { includeAnswers })).arrayBuffer(),
  );
  const xml = async (n: number) =>
    (await zip.file(`ppt/slides/slide${n}.xml`)?.async("string")) ?? "";
  // Two groups reveal a group per click: the Answers slide builds as 3 slides (hidden, 1, 2).
  return {
    slides,
    guard: await xml(1),
    hidden: await xml(2),
    page: await xml(4),
    after: await xml(5),
  };
}

const geoms = (xml: string) => [...xml.matchAll(/<a:prstGeom prst="(\w+)"/g)].map((m) => m[1]);

describe("PPTX: end-of-deck answers", () => {
  it("draws native shapes, never the pill, one slide per Answers slide", async () => {
    const { slides, guard, hidden, page, after } = await exported(false);
    expect(slides.map((s) => s.answersRole)).toEqual(["guard", "answers"]);
    expect(after).toBe("");
    expect(hidden).toContain("?");
    expect(hidden).not.toContain("Evaporation");
    expect(geoms(guard)).toContain("ellipse");
    const g = geoms(page);
    // Four badges, two verdict chips, one hairline.
    expect(g.filter((x) => x === "ellipse").length).toBeGreaterThanOrEqual(4);
    expect(g.filter((x) => x === "roundRect").length).toBeGreaterThanOrEqual(2);
    expect(g).toContain("rect");
    expect(page).not.toContain("Teacher only");
    expect(page).toContain("Evaporation");
  }, 30_000);

  it("hides the Answers slides unless the answers are included; the guard is a normal slide", async () => {
    const off = await exported(false);
    expect(off.page).toMatch(/<p:sld[^>]* show="0"/);
    expect(off.guard).not.toMatch(/<p:sld[^>]* show="0"/);
    const on = await exported(true);
    expect(on.page).not.toMatch(/<p:sld[^>]* show="0"/);
  }, 30_000);

  // TEACH-215 part l: the group kicker exports as the web draws it, a caption (size, caps, the
  // preset's tracking), in a light and a dark theme.
  for (const id of ["paper", "dark-slate"])
    it(`exports the kicker as the web's caption (${id})`, async () => {
      const theme = atKeyStage(getTheme(id, null), "ks1");
      const slides: Slide[] = endAnswerSlides(GROUPS, theme, "ks1");
      const kicker = slides.flatMap((s) => s.elements).find((e) => e.name === "Kicker");
      const web = resolveTextStyle(kicker?.type === "text" ? kicker.style : undefined, theme);
      expect(web.preset).toBe("caption");
      const lesson = { ...creditedLesson(), themeId: id, slides } as never as Lesson;
      const zip = await JSZip.loadAsync(
        await (await exportLessonPptx(lesson, theme, { includeAnswers: true })).arrayBuffer(),
      );
      const xml = (await zip.file("ppt/slides/slide2.xml")?.async("string")) ?? "";
      const run = /<a:rPr([^>]*)>(?:(?!<\/a:r>).)*?<a:t>EXIT TICKET<\/a:t>/s.exec(xml)?.[1] ?? "";
      // One px is one pt on the 960-pt-wide PowerPoint slide.
      expect(run).toContain(`sz="${Math.round(web.fontSize * 100)}"`);
      expect(run).toContain(
        `spc="${Math.round(Number.parseFloat(web.letterSpacing) * web.fontSize * 100)}"`,
      );
      expect(run).toContain('b="1"');
    }, 30_000);
});
