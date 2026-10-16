import { describe, expect, test } from "bun:test";
import type { ImageElement, ShapeElement, TextElement } from "@tj/domain/documents";
import { loadIcons } from "../icons/loader";
import { atKeyStage, THEMES } from "../themes";
import {
  FIGURE_CAPTION_FITS,
  FIGURE_CAPTION_GAP,
  FIGURE_FOOT,
  FIGURE_GAP,
  FIGURE_NAMES,
  figureBox,
} from "./figure";
import { FIGURE_CAPTION_CAP, FIGURE_WIDE_ASPECT, figureSlideAllowed } from "./figure-rules";
import { layoutTemplate, mix, type Stage, type TemplateInput } from "./index";
import { v2Colors } from "./items-row-deps";

/*
 * TEACH-239 part b (C7): the figure slide, from the v13 figure gold (winner A, open stage).
 */
await loadIcons();
const SVG = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" class="slide tk theme-primary" viewBox="0 0 1280 564"><text x="9" y="40">Evaporation</text></svg>',
)}`;
const model = (aspect = 2.27) => ({ drawn: { src: SVG, aspect, alt: "Water cycle", bare: true } });
const base: TemplateInput = {
  template: "figure",
  heading: "The water cycle in a town",
  accentWord: "water cycle",
  lead: "The same water goes round and round.",
  figure: model(),
};
const paper = THEMES.find((t) => t.id === "paper") ?? (THEMES[0] as (typeof THEMES)[number]);
const lay = (input: Partial<TemplateInput> = {}, stage: Stage = "ks2", theme = paper) =>
  layoutTemplate({ ...base, ...input } as TemplateInput, theme, stage);
const named = (els: readonly unknown[], name: string): unknown[] =>
  (els as { name?: string }[]).filter((e) => e.name === name);

describe("figure slide: the open stage", () => {
  test("the model fills the stage at its own shape, centred, free space split 40/60", () => {
    const r = lay();
    const [title] = named(r.slide.elements, FIGURE_NAMES.title) as TextElement[];
    const [img] = named(r.slide.elements, FIGURE_NAMES.model) as ImageElement[];
    const [cap] = named(r.slide.elements, FIGURE_NAMES.caption) as TextElement[];
    expect(r.over).toEqual([]);
    expect(r.slide.kind).toBe("diagram");
    if (!title || !img || !cap) throw new Error("missing element");
    expect(Math.abs(img.x + img.w / 2 - 480)).toBeLessThanOrEqual(1);
    expect(Math.abs(img.w / img.h - 2.27)).toBeLessThan(0.02);
    const top = title.y + title.h + FIGURE_GAP;
    const stageH = FIGURE_FOOT - cap.h - FIGURE_CAPTION_GAP - top;
    const free = stageH - img.h;
    expect(Math.abs(img.y - top - free * 0.4)).toBeLessThanOrEqual(1);
    // The caption hangs under the figure at the title's left edge, muted.
    expect(cap.y).toBe(img.y + img.h + FIGURE_CAPTION_GAP);
    expect(cap.x).toBe(title.x);
    expect(cap.style.color).toBe(atKeyStage(paper, "ks2").colors.muted);
  });

  test("figureBox: a tall shape is held by the height, a wide one by the width", () => {
    const st = { x: 64, y: 100, w: 832, h: 340 };
    expect(figureBox(st, 1).h).toBe(340);
    const wide = figureBox(st, 4);
    expect(wide.w).toBe(832);
    expect(wide.y).toBe(Math.round(100 + (340 - 208) * 0.4));
  });

  test("the title's key word is the accent (a theme role), the one use of red", () => {
    const [title] = named(lay().slide.elements, FIGURE_NAMES.title) as TextElement[];
    const runs = title?.doc.content?.[0]?.content ?? [];
    const red = runs.filter((n) => JSON.stringify(n).includes(paper.colors.accent));
    expect(red.map((n) => ("text" in n ? n.text : ""))).toEqual(["water cycle"]);
  });

  test("the caption is static: no build or reveal, the same element on every frame", () => {
    const [cap] = named(lay().slide.elements, FIGURE_NAMES.caption) as TextElement[];
    expect(JSON.stringify(cap)).not.toMatch(/build|reveal|step/i);
  });

  test("no caption: the figure grows into its room", () => {
    const withCap = named(lay().slide.elements, FIGURE_NAMES.model)[0] as ImageElement;
    const without = named(
      lay({ lead: undefined }).slide.elements,
      FIGURE_NAMES.model,
    )[0] as ImageElement;
    expect(without.h).toBeGreaterThan(withCap.h);
    expect(lay({ lead: undefined }).fields ?? []).toEqual([]);
  });

  test("an over-cap caption is flagged for repair, never shrunk or cut", () => {
    const long =
      "The same water goes round and round for ever: it is never made, never used up and never lost.";
    const r = lay({ lead: long });
    expect(r.over).toContain("figure caption over one line");
    const f = r.fields?.find((x) => x.path === "lead");
    expect(f?.over).toBe(true);
    const [cap] = named(r.slide.elements, FIGURE_NAMES.caption) as TextElement[];
    expect(cap?.style.fontSize).toBe(
      (lay().slide.elements.find((e) => e.name === "Caption") as TextElement | undefined)?.style
        .fontSize,
    );
    expect(JSON.stringify(cap?.doc)).toContain("never lost.");
  });

  test("the caption cap is the writer's cap under the measured one-line fit, per age", () => {
    for (const [stage, age] of [
      ["ks1", "early"],
      ["ks2", "primary"],
      ["ks3", "secondary"],
    ] as const) {
      const f = lay({}, stage).fields?.find((x) => x.path === "lead");
      expect(f?.hardMax).toBe(FIGURE_CAPTION_FITS[age]);
      expect(f?.cap).toBe(Math.min(FIGURE_CAPTION_CAP[age], FIGURE_CAPTION_FITS[age]));
      expect(FIGURE_CAPTION_FITS[age]).toBeGreaterThan(0);
    }
  });

  test("a two-line title is flagged (it would take the figure's room)", () => {
    const r = lay({
      heading: "How the water cycle moves the same water round a busy town all year long",
    });
    expect(r.over).toContain("figure title over one line");
  });

  test("KS1 labels are restyled in Andika; KS2 keeps the slide's body face", () => {
    const src = (stage: Stage) =>
      decodeURIComponent(
        (named(lay({}, stage).slide.elements, FIGURE_NAMES.model)[0] as ImageElement).src,
      );
    expect(src("ks1")).toContain('"Andika"');
    expect(src("ks2")).not.toContain('"Andika"');
  });

  test("a photo takes the stage at its shape; a portrait one is held at 3:4 at most", () => {
    const r = lay({ figure: { photo: "https://x.test/p.jpg", aspect: 0.35, alt: "Tall" } });
    const [p] = named(r.slide.elements, "Photo") as ImageElement[];
    expect(p).toBeDefined();
    const panel = r.slide.elements.find((e) => e.name === "Photo panel") ?? p;
    expect(Math.abs((panel?.w ?? 0) / (panel?.h ?? 1) - 0.75)).toBeLessThan(0.02);
  });
});

describe("figure slide: the model failed", () => {
  const plate = (stage: Stage, icon?: string) =>
    lay({ figure: undefined, ...(icon ? { icon } : {}) }, stage);
  test("a sand plate with the topic's icon in a disc medal (KS1-2) or a tile (KS3)", () => {
    for (const stage of ["ks1", "ks2"] as const) {
      const r = plate(stage, "plant");
      expect(named(r.slide.elements, FIGURE_NAMES.plate)).toHaveLength(1);
      expect(named(r.slide.elements, FIGURE_NAMES.halo)).toHaveLength(1);
      expect((named(r.slide.elements, FIGURE_NAMES.medal)[0] as ShapeElement).shape).toBe(
        "ellipse",
      );
      expect(named(r.slide.elements, FIGURE_NAMES.icon)).toHaveLength(1);
      expect(r.over).toEqual([]);
    }
    const r3 = plate("ks3", "volcano");
    expect(named(r3.slide.elements, FIGURE_NAMES.halo)).toHaveLength(0);
    expect((named(r3.slide.elements, FIGURE_NAMES.medal)[0] as ShapeElement).shape).toBe("rounded");
  });
  test("no figure and no icon: the plate is flagged, never silently empty", () => {
    expect(plate("ks2").over).toContain("figure has no drawing and no icon");
    expect(plate("ks2", "zzqqxx-not-an-icon").iconMisses).toContain("zzqqxx-not-an-icon");
  });
});

describe("figure slide: every theme", () => {
  test("no literal colours: every fill and text colour comes from the theme", () => {
    for (const theme of THEMES)
      for (const stage of ["ks1", "ks2", "ks3"] as const) {
        for (const input of [{}, { figure: undefined, icon: "plant" }]) {
          const r = lay(input, stage, theme);
          expect(r.over).toEqual([]);
          const t = atKeyStage(theme, stage);
          const [cap] = named(r.slide.elements, FIGURE_NAMES.caption) as TextElement[];
          expect(cap?.style.color).toBe(t.colors.muted);
          const v = v2Colors(t);
          const roles = [v.sand, v.surface, mix(v.surface, v.sand, 0.4)];
          for (const e of r.slide.elements)
            if (e.type === "shape") expect(roles).toContain(String((e as ShapeElement).fill));
        }
      }
  });
});

describe("figure rules (leaf, ruling 229)", () => {
  const S = (template: string, extra: object = {}) => ({ template, ...extra });
  test("the first figure slide away from diagrams keeps the layout; a second does not", () => {
    const slides = [S("title"), S("figure"), S("explain"), S("figure")];
    expect(figureSlideAllowed(slides, 1)).toBe(true);
    expect(figureSlideAllowed(slides, 3)).toBe(false);
  });
  test("never beside another diagram slide", () => {
    expect(figureSlideAllowed([S("diagram-text"), S("figure")], 1)).toBe(false);
    expect(
      figureSlideAllowed([S("figure"), S("big-visual", { figure: { kind: "model" } })], 0),
    ).toBe(false);
    expect(
      figureSlideAllowed([S("figure"), S("big-visual", { figure: { shows: "a photo" } })], 0),
    ).toBe(true);
  });
  test("wide models come here: the split with picture and text is one shared number", () => {
    expect(FIGURE_WIDE_ASPECT).toBe(1.45);
  });
});
