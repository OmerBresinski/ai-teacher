import { describe, expect, test } from "bun:test";
import type { Slide, SlideKind } from "@tj/domain/documents";
import { ART_PLACEMENT, artOf, isGroundArt } from "./art";
import { elementBoxes, slideArtLayers, slideArtRole } from "./background";
import { layoutTemplate, type Stage, type TemplateInput } from "./templates/index";
import { MYTH_CASES } from "./templates/myth-fixtures";
import { templateSamples } from "./templates/samples";
import { WORKED_CASES } from "./templates/worked-fixtures";
import { atKeyStage, getTheme, THEMES } from "./themes";

/*
 * Decision 41 A (Greg, 20 Oct): the theme corner art sits where the approved slides put it, per
 * slide type (`ART_PLACEMENT` in art.ts), and never over text, a picture or a card.
 */
const STAGES: Stage[] = ["ks1", "ks2", "ks3"];
const laid = (themeId: string, input: TemplateInput, stage: Stage = "ks2"): Slide => ({
  id: "s",
  ...layoutTemplate(input, atKeyStage(getTheme(themeId), stage), stage).slide,
});
const meets =
  (a: Slide["elements"][number] | { x: number; y: number; w: number; h: number }) =>
  (b: { x: number; y: number; w: number; h: number }) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const drawn = (themeId: string, slide: Slide) =>
  slideArtLayers(atKeyStage(getTheme(themeId), "ks2"), slide).filter((l) => !isGroundArt(l));

describe("theme art per slide type (decision 41 A)", () => {
  test("sweep: every theme x every template x every stage draws art over no element", () => {
    const misses: string[] = [];
    let checked = 0;
    let withArt = 0;
    for (const theme of THEMES) {
      for (const stage of STAGES) {
        const t = atKeyStage(theme, stage);
        for (const input of templateSamples(() => "/photo.jpg")) {
          const slide: Slide = { id: "s", ...layoutTemplate(input, t, stage).slide };
          const art = slideArtLayers(t, slide).filter((l) => !isGroundArt(l));
          if (art.length) withArt++;
          for (const l of art) {
            const hit = elementBoxes(slide).find(meets(l));
            if (hit) misses.push(`${theme.id} ${stage} ${input.template} art ${l.x},${l.y}`);
          }
          checked++;
        }
      }
    }
    expect(misses).toEqual([]);
    expect(checked).toBe(THEMES.length * STAGES.length * templateSamples().length);
    expect(withArt).toBeGreaterThan(100);
  });

  test("the worked example and the myth wear the content art, not the picture motif", () => {
    const worked = WORKED_CASES["y8-panel"] ?? Object.values(WORKED_CASES)[0];
    const myth = MYTH_CASES.find((m) => m.name === "y6-falling") ?? MYTH_CASES[0];
    if (!worked || !myth) throw new Error("fixtures missing");
    for (const [input, stage] of [
      [worked.input, worked.stage],
      [myth.input, myth.stage],
    ] as const) {
      const slide = laid("treehouse", input as TemplateInput, stage as Stage);
      expect(slideArtRole(slide)).toEqual({ role: "content" });
      // Never mirrored to the heading's side: the vine stays in the right margin, or is hidden.
      for (const l of drawn("treehouse", slide)) expect(l.x).toBeGreaterThan(900);
    }
  });

  test("Treehouse: the vine shows top-right above the quick check's and the myth's panels", () => {
    const quick = laid("treehouse", {
      template: "question-set",
      heading: "Quick check: the heart",
      questions: ["Which organ pumps blood?", "Which vessels carry blood away?"],
      answers: ["The heart", "Arteries"],
    } as TemplateInput);
    const myth = MYTH_CASES.find((m) => m.name === "y6-falling") ?? MYTH_CASES[0];
    if (!myth) throw new Error("fixtures missing");
    for (const slide of [quick, laid("treehouse", myth.input as TemplateInput, myth.stage)]) {
      const [vine] = drawn("treehouse", slide);
      expect(vine).toBeDefined();
      expect(vine?.x).toBe(906);
      expect(vine?.y).toBe(0);
      // Cut at the panel, not dropped whole and not drawn over it.
      expect(vine?.h).toBeLessThan(330);
      expect(vine?.h).toBeGreaterThan(330 * 0.35);
      expect(vine?.image).toContain("viewBox%3D'0%200%2060%20");
    }
  });

  test("slide types with no gold keep today's rule: a photo slide wears the picture motif", () => {
    const pic = templateSamples(() => "/photo.jpg").find((s) => s.template === "picture-text");
    if (!pic) throw new Error("sample missing");
    const slide = laid("treehouse", pic);
    expect(slideArtRole(slide).role).toBe("picture");
  });

  test("every placement row names the gold it was read from", () => {
    for (const [kind, row] of Object.entries(ART_PLACEMENT) as [SlideKind, { gold: string }][]) {
      expect(row.gold.length, kind).toBeGreaterThan(0);
      expect(row.gold, kind).not.toBe("gap");
    }
    expect(artOf(getTheme("treehouse"))?.content?.length).toBe(1);
  });
});
