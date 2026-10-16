import { describe, expect, test } from "bun:test";
import type { SlideElement } from "@tj/domain/documents";
import { THEMES } from "../themes";
import { type Figure, layoutTemplate, type Stage, type TemplateInput } from "./index";
import { STEP_FOOT, STEP_GAP, STEP_NAMES, stepModelOf } from "./steps-model";
import { measureStepCaps, stepWords } from "./steps-model-capacity";
import CAPACITY from "./steps-model-capacity.json" with { type: "json" };

/*
 * TEACH-75 part af (layout pilot C8, rulings 219, 229, 249): a step with a ready-made model is one
 * calm slide, title, one line, stage (`northstars-v13/steps-model2`, winner A).
 */
const SVG = (w: number, h: number, extra = "") =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" class="slide tk theme-primary" viewBox="0 0 ${w} ${h}"><style>.theme-primary{--hue-red:#e0533f;--hue-purple:#7a55c8}</style><g><rect x="10" y="10" width="200" height="100" fill="var(--plate)"/><text x="20" y="60">Sand stays</text></g>${extra}</svg>`,
  )}`;
const model = (aspect = 2.2): Figure => ({
  drawn: { src: SVG(Math.round(450 * aspect), 450), aspect, alt: "Filter", bare: true },
});
const STAGES: Stage[] = ["ks1", "ks2", "ks3", "ks4", "ks5"];
const theme = THEMES[0] as (typeof THEMES)[number];
const step = (
  s: Partial<NonNullable<TemplateInput["step"]>> = {},
  aspect = 2.2,
): TemplateInput => ({
  template: "steps",
  heading: "Filter",
  step: {
    n: 2,
    do: "Pour the mixture through filter paper.",
    see: "Water drips through. The sand stays.",
    ...s,
  },
  figure: model(aspect),
});
const named = (els: SlideElement[], n: string) => els.find((e) => e.name === n);
const words = (els: SlideElement[]) =>
  JSON.stringify(els.map((e) => (e as { doc?: unknown }).doc ?? null));

describe("steps with a model: title, one line, stage", () => {
  test("the do-line caps are the renderer's (renderer = table)", () => {
    expect(measureStepCaps()).toEqual(CAPACITY);
  });

  for (const stage of STAGES)
    test(`${stage}: badge, title, do, see, then the model centred, top-aligned, to the foot`, () => {
      const r = layoutTemplate(step(), theme, stage);
      expect(r.over).toEqual([]);
      const els = r.slide.elements;
      const badge = named(els, STEP_NAMES.badge) as SlideElement & { fill: string };
      const title = named(els, STEP_NAMES.title) as SlideElement;
      const doEl = named(els, STEP_NAMES.do) as SlideElement & { style: { color?: string } };
      const see = named(els, STEP_NAMES.see) as SlideElement & { style: { color?: string } };
      const m = named(els, STEP_NAMES.model) as SlideElement & { src: string };
      expect(badge.fill).toBe(theme.colors.ink);
      expect(title.x).toBeGreaterThan(badge.x + badge.w);
      expect(doEl.style.color).toBe(theme.colors.ink);
      expect(see.style.color).toBe(theme.colors.muted);
      expect(see.y).toBeGreaterThanOrEqual(doEl.y + doEl.h);
      // No track, no "of N", no panel: the badge is the only shape.
      expect(els.filter((e) => e.type === "shape")).toHaveLength(1);
      expect(m.y).toBe(Math.round(see.y + see.h + STEP_GAP));
      expect(m.y + m.h).toBeLessThanOrEqual(STEP_FOOT);
      expect(Math.abs(m.x + m.w / 2 - 480)).toBeLessThanOrEqual(1);
      expect(m.x).toBeGreaterThanOrEqual(64);
      expect(m.x + m.w).toBeLessThanOrEqual(896);
    });

  test("a tall model fills down to the foot (top-aligned, never floating)", () => {
    const r = layoutTemplate(step({}, 1.33), theme, "ks2");
    const m = named(r.slide.elements, STEP_NAMES.model) as SlideElement;
    expect(m.y + m.h).toBeGreaterThanOrEqual(STEP_FOOT - 1);
  });

  test("the ladder: do + see, then do only, then split (words kept and named over)", () => {
    for (const [g, stage] of [
      ["KS1", "ks1"],
      ["KS2", "ks2"],
      ["KS3-5", "ks3"],
    ] as const) {
      const cap = CAPACITY[g];
      const one = layoutTemplate(
        step({ do: stepWords(cap.oneLine), see: "It drips." }),
        theme,
        stage,
      );
      expect(named(one.slide.elements, STEP_NAMES.see)).toBeDefined();
      const two = layoutTemplate(
        step({ do: stepWords(cap.twoLines), see: "It drips." }),
        theme,
        stage,
      );
      expect(named(two.slide.elements, STEP_NAMES.see)).toBeUndefined();
      expect(two.over).toEqual([]);
      const over = layoutTemplate(step({ do: stepWords(cap.twoLines + 4) }), theme, stage);
      expect(over.over).toContain("step do line over 2 lines");
      expect(words(over.slide.elements)).toContain("Pour the mixture");
      // Split: the writer moves the words to the step slide before; this one keeps header + model.
      const split = layoutTemplate(step({ do: "", see: null }), theme, stage);
      expect(split.over).toEqual([]);
      expect(named(split.slide.elements, STEP_NAMES.do)).toBeUndefined();
      expect(named(split.slide.elements, STEP_NAMES.model)).toBeDefined();
    }
  });

  test("the model is restyled once into the slide's voice, even when re-laid", () => {
    const a = layoutTemplate(step(), theme, "ks2");
    const src = (named(a.slide.elements, STEP_NAMES.model) as { src: string }).src;
    const relaid = layoutTemplate(
      { ...step(), figure: { drawn: { src, aspect: 2.2, bare: true } } },
      THEMES[1] as (typeof THEMES)[number],
      "ks2",
    );
    const svg = decodeURIComponent(
      (named(relaid.slide.elements, STEP_NAMES.model) as { src: string }).src.split(",")[1] ?? "",
    );
    expect(svg.match(/data-restyle="tj"/g)).toHaveLength(1);
    const t1 = THEMES[1] as (typeof THEMES)[number];
    expect(svg).toContain(`--hue-red:${t1.colors.accent}`);
    expect(svg).toContain(`--hue-purple:${t1.colors.ink}`);
    expect(svg).toContain(`--ink-2:${t1.colors.muted}`);
    // after the kit CSS
    expect(svg.indexOf('data-restyle="tj"')).toBeGreaterThan(svg.indexOf(".theme-primary{"));
  });

  test("every theme and stage: nothing over, on the canvas, text at or over the floor", () => {
    for (const t of THEMES)
      for (const stage of STAGES) {
        const r = layoutTemplate(step(), t, stage);
        expect(r.over).toEqual([]);
        for (const e of r.slide.elements) {
          expect(e.x).toBeGreaterThanOrEqual(0);
          expect(e.x + e.w).toBeLessThanOrEqual(960);
          expect(e.y + e.h).toBeLessThanOrEqual(540);
          const fs = (e as { style?: { fontSize?: number } }).style?.fontSize;
          if (fs !== undefined) expect(fs).toBeGreaterThanOrEqual(20);
        }
      }
  });

  test("Arabic and Hebrew steps fit, on the canvas, with no text over the model", () => {
    for (const [heading, d] of [
      ["رشّح", "اسكب الخليط في ورق الترشيح ببطء."],
      ["סננו", "שפכו את התערובת דרך נייר הסינון."],
    ] as const)
      for (const stage of STAGES) {
        const r = layoutTemplate({ ...step({ do: d, see: null }), heading }, theme, stage);
        expect(r.over).toEqual([]);
        const m = named(r.slide.elements, STEP_NAMES.model) as SlideElement;
        const t = named(r.slide.elements, STEP_NAMES.do) as SlideElement;
        expect(t.y + t.h).toBeLessThanOrEqual(m.y);
      }
  });
});

describe("saved steps slides keep their old layout and every word", () => {
  const OLD: TemplateInput[] = [
    {
      template: "steps",
      heading: "Make a filter",
      points: ["Fold the paper.", "Put it in the funnel.", "Pour slowly."],
      figure: model(),
    },
    {
      template: "steps",
      heading: "Make a filter",
      points: ["Fold the paper.", "Put it in the funnel.", "Pour slowly."],
    },
    {
      template: "steps",
      heading: "Grow a bean",
      points: ["Soak it.", "Plant it."],
      figure: { photo: "p.jpg", aspect: 1.5 },
    },
  ];
  for (const [i, input] of OLD.entries())
    test(`old steps ${i + 1}: not the model step, every point laid, the same on a re-lay`, () => {
      expect(stepModelOf(input)).toBeUndefined();
      for (const stage of ["ks1", "ks3"] as Stage[]) {
        const a = layoutTemplate(input, theme, stage);
        expect(named(a.slide.elements, STEP_NAMES.badge)).toBeUndefined();
        for (const p of input.points ?? []) expect(words(a.slide.elements)).toContain(String(p));
        // Re-laid on another theme (a re-theme): the same words, nothing lost.
        const b = layoutTemplate(input, THEMES[2] as (typeof THEMES)[number], stage);
        const texts = (r: typeof a) =>
          r.slide.elements.filter((e) => e.type === "text").map((e) => words([e]));
        expect(texts(b)).toEqual(texts(a));
      }
    });

  test("the writer's current output (one point beside a library model) maps to the model step", () => {
    const writer: TemplateInput = {
      template: "steps",
      heading: "Filter",
      points: ["Pour the mixture through filter paper."],
      figure: model(),
    };
    expect(stepModelOf(writer)).toEqual({ do: "Pour the mixture through filter paper." });
    const r = layoutTemplate(writer, theme, "ks2");
    expect(r.over).toEqual([]);
    expect(named(r.slide.elements, STEP_NAMES.do)).toBeDefined();
    expect(named(r.slide.elements, STEP_NAMES.model)).toBeDefined();
  });
});
