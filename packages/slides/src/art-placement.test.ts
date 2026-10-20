import { describe, expect, test } from "bun:test";
import type { Slide, SlideElement, SlideKind, Theme } from "@tj/domain/documents";
import { ART_PLACEMENT, artOf, cropArt, isGroundArt, mirrorArt } from "./art";
import { slideArtLayers, slideArtRole } from "./background";
import { renderedHeights } from "./lint";
import { materialiseSlides } from "./materialise";
import type { SlideSpec } from "./specs";
import { layoutTemplate, type Stage, type TemplateInput } from "./templates/index";
import { MYTH_CASES } from "./templates/myth-fixtures";
import { templateSamples } from "./templates/samples";
import { WORKED_CASES } from "./templates/worked-fixtures";
import { measureHeadless } from "./text-measure";
import { atKeyStage, getTheme, THEMES } from "./themes";

/*
 * Decision 41 A, ruling 291 (Greg, 20 Oct): the theme corner art sits where the approved slides put
 * it, per slide type (`ART_PLACEMENT` in art.ts), and never over text, a picture or a card.
 */
const STAGES: Stage[] = ["ks1", "ks2", "ks3"];
type Box = { x: number; y: number; w: number; h: number };
const ART_THEMES = ["treehouse", "crayon", "playground", "splash"];

/**
 * The boxes the slide actually covers, measured independently of `background.ts`: every text grown
 * to the height the headless ruler measures for its words, and every group's children placed in
 * slide space (children sit in the group's local space), as well as the group itself.
 */
function drawnBoxes(slide: Slide, theme: Theme): Box[] {
  const grown = renderedHeights(slide, measureHeadless(theme));
  const out: Box[] = [];
  const walk = (els: readonly SlideElement[], dx: number, dy: number) => {
    for (const e of els) {
      out.push({ x: e.x + dx, y: e.y + dy, w: e.w, h: e.h });
      if (e.type === "group") walk(e.children, e.x + dx, e.y + dy);
    }
  };
  walk(grown.elements, 0, 0);
  return out;
}
const meets = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const art = (t: Theme, slide: Slide) => slideArtLayers(t, slide).filter((l) => !isGroundArt(l));
const box = (l: Box) => [l.x, l.y, l.w, Math.round(l.h * 100) / 100];

const LONG_HEADING =
  "Why do some materials keep their shape while others flow and spread to fill every container";
const meta = { promptVersion: "t", model: "m", at: "2026-10-20T00:00:00.000Z" };
const LONG_BODY = Array.from(
  { length: 14 },
  (_, i) =>
    `Roads linked the towns in Roman Britain, so soldiers, traders and news could travel quickly, sentence ${i + 1}.`,
).join(" ");

describe("theme art per slide type (decision 41 A)", () => {
  test("sweep: every theme x template x stage, long headings and continuations: art meets nothing drawn", () => {
    const misses: string[] = [];
    let checked = 0;
    let withArt = 0;
    const check = (name: string, t: Theme, slide: Slide) => {
      const layers = art(t, slide);
      if (layers.length) withArt++;
      const boxes = drawnBoxes(slide, t);
      for (const l of layers) {
        if (boxes.some((b) => meets(l, b))) misses.push(`${t.id} ${name} art ${box(l)}`);
      }
      checked++;
    };
    for (const theme of THEMES) {
      for (const stage of STAGES) {
        const t = atKeyStage(theme, stage);
        for (const input of templateSamples(() => "/photo.jpg")) {
          const laid = (i: TemplateInput) => ({ id: "s", ...layoutTemplate(i, t, stage).slide });
          check(`${stage} ${input.template}`, t, laid(input));
          check(
            `${stage} ${input.template} long heading`,
            t,
            laid({ ...input, heading: LONG_HEADING }),
          );
        }
      }
      const spec = {
        kind: "content",
        factRefs: [],
        heading: "Roman towns and daily life",
        body: LONG_BODY,
      } as SlideSpec;
      const slides = materialiseSlides(spec, theme.id, meta);
      expect(slides.length).toBeGreaterThan(1);
      for (const [i, s] of slides.entries()) check(`continuation ${i + 1}`, theme, s);
    }
    expect(misses).toEqual([]);
    expect(checked).toBeGreaterThan(THEMES.length * STAGES.length * templateSamples().length * 2);
    expect(withArt).toBeGreaterThan(200);
  });

  test("the approved placements: what each art theme draws on the worked example, myth and quick check", () => {
    const w = WORKED_CASES["y8-panel"];
    const m = MYTH_CASES.find((c) => c.name === "y6-falling");
    if (!w || !m) throw new Error("fixtures missing");
    const quick = {
      template: "question-set",
      heading: "Quick check: the heart",
      questions: ["Which organ pumps blood?", "Which vessels carry blood away?"],
      answers: ["The heart", "Arteries"],
    } as TemplateInput;
    const drawn = (themeId: string, input: TemplateInput, stage: Stage) => {
      const t = atKeyStage(getTheme(themeId), stage);
      return art(t, { id: "s", ...layoutTemplate(input, t, stage).slide }).map(box);
    };
    const got = Object.fromEntries(
      ART_THEMES.map((id) => [
        id,
        {
          worked: drawn(id, w.input, w.stage),
          myth: drawn(id, m.input, m.stage),
          quick: drawn(id, quick, "ks2"),
        },
      ]),
    );
    // Read from the round 3-5 renders (worked-*, myth-*, quick-*): the content art at its own
    // place, hidden under a full-bleed panel and cut where a panel starts. The myth's panels start
    // at 142.7 and the quick check's answer field at 139: the cut leaves a 6pt gap.
    expect(got).toEqual({
      // Vine: none on the worked example (full-bleed panel), top-right above the panels elsewhere.
      treehouse: { worked: [], myth: [[906, 0, 54, 136.7]], quick: [[906, 0, 54, 133]] },
      // Star top-right and the red margin line; the worked panel hides the star.
      crayon: {
        worked: [[40, 0, 3, 531]],
        myth: [[912, 4, 36, 34]],
        quick: [
          [912, 4, 36, 34],
          [40, 0, 3, 531],
        ],
      },
      // The sun peeking in top-right, the rainbow bottom-left; the worked panel hides the sun.
      playground: {
        worked: [[-22, 488, 76, 42]],
        myth: [[890, -84, 124, 124]],
        quick: [
          [890, -84, 124, 124],
          [-22, 488, 76, 42],
        ],
      },
      // Bubbles bottom-right, under the panel on all three (as in the gold).
      splash: { worked: [], myth: [], quick: [] },
    });
  });

  test("worked example and myth: never the picture motif, never mirrored onto the heading", () => {
    const w = WORKED_CASES["y8-panel"];
    const m = MYTH_CASES.find((c) => c.name === "y6-falling");
    if (!w || !m) throw new Error("fixtures missing");
    for (const [input, stage] of [
      [w.input, w.stage],
      [m.input, m.stage],
    ] as const) {
      const t = atKeyStage(getTheme("treehouse"), stage);
      const slide = { id: "s", ...layoutTemplate(input, t, stage).slide };
      expect(slideArtRole(slide)).toEqual({ role: "content" });
    }
  });

  test("a real picture keeps ruling 107's picture motif where no gold shows one", () => {
    const t = getTheme("treehouse");
    const photo: SlideElement = {
      id: "p",
      type: "image",
      name: "Photo",
      x: 520,
      y: 140,
      w: 380,
      h: 300,
      src: "/photo.jpg",
    } as SlideElement;
    for (const kind of ["starter", "multiple-choice", "content"] as SlideKind[]) {
      expect(slideArtRole({ id: "s", kind, elements: [photo] })).toEqual({
        role: "picture",
        side: "right",
      });
    }
    const pic = templateSamples(() => "/photo.jpg").find((s) => s.template === "picture-text");
    if (!pic) throw new Error("sample missing");
    expect(slideArtRole({ id: "s", ...layoutTemplate(pic, t, "ks2").slide }).role).toBe("picture");
  });

  test("a cut keeps the art's scale and side, mirrored or standing on the foot", () => {
    const [vine] = artOf(getTheme("treehouse"))?.content ?? [];
    if (!vine) throw new Error("no vine");
    const cut = cropArt(vine, 0, 100);
    expect(cut && box(cut)).toEqual([906, 0, 54, 100]);
    // The SVG's viewBox is cut to the same rows (60 x 330 view over 54 x 330 points).
    expect(cut?.image).toContain(encodeURIComponent("viewBox='0 0 60 100'"));
    const mirrored = mirrorArt(vine, 960);
    const mcut = cropArt(mirrored, 0, 100);
    expect(mcut && box(mcut)).toEqual([0, 0, 54, 100]);
    expect(mcut?.image).toBe(cut?.flipped);
    const [bubbles] = artOf(getTheme("splash"))?.content ?? [];
    if (!bubbles) throw new Error("no bubbles");
    const foot = cropArt(bubbles, 420, 526);
    expect(foot && box(foot)).toEqual([908, 420, 48, 106]);
  });

  test("every placement row names the gold it was read from, and its marks", () => {
    for (const [kind, row] of Object.entries(ART_PLACEMENT)) {
      expect(row?.gold.length, kind).toBeGreaterThan(0);
      expect(row?.gold, kind).not.toBe("gap");
    }
    expect(ART_PLACEMENT["worked-example"]?.marks).toEqual(["Move arrow", "Check tick"]);
    expect(ART_PLACEMENT.content?.marks).toEqual(["Proof icon"]);
  });
});
