import { describe, expect, test } from "bun:test";
import type { SlideElement } from "@tj/domain/documents";
import { contrastRatio } from "../look";
import { MIN_FONT_SIZE, THEMES } from "../themes";
import { BRIGHTEST_PIXEL, HOOK_NAMES, hookContrast, hookStyle } from "./hook";
import { HOOK_GROUPS, type HookGroup, hookFitsAt } from "./hook-capacity";
import CAPACITY from "./hook-capacity.json" with { type: "json" };
import { type Figure, layoutTemplate, mix, type Stage, type TemplateInput } from "./index";

/*
 * Full-bleed hook (UX ruling 203, P5): the words on the scrim at 4.5:1 or better on every theme
 * (over the brightest pixel, the worst case), fit on every theme and stage, the never-throw corpus
 * and the picture-missing paths.
 */
const STAGES: Stage[] = ["ks1", "ks2", "ks3"];
const photo: Figure = {
  photo: "https://x.test/volcano.jpg",
  aspect: 16 / 9,
  alt: "A volcano erupting at night",
};
/** About 40 words at KS2 and KS3 (the budget), about 30 at KS1. */
const LEAD = {
  ks2: "Deep under your feet, rock is so hot that it melts. When pressure builds up, this **molten rock** bursts through the crust as lava, ash and gas. What could make that pressure grow so strong, so fast?",
  ks1: "Look out of the window at the sky. What colour is it today? Is it the same colour every day, or does it change when the weather changes?",
};
const lead = (stage: Stage) => (stage === "ks1" ? LEAD.ks1 : LEAD.ks2);
const fontSizes = (els: SlideElement[]) =>
  els.flatMap((e) => {
    const s = (e as { style?: { fontSize?: number } }).style?.fontSize;
    return s === undefined ? [] : [{ name: e.name ?? e.type, size: s }];
  });

describe("hook", () => {
  test("the words on the scrim are at least 4.5:1 on every theme, even over the brightest pixel", () => {
    for (const theme of THEMES) {
      const st = hookStyle(theme);
      expect(hookContrast(theme), theme.id).toBeGreaterThanOrEqual(4.5);
      for (const under of [theme.colors.background, "#808080", BRIGHTEST_PIXEL])
        expect(contrastRatio(st.text, mix(st.scrim, under, st.opacity))).toBeGreaterThanOrEqual(
          4.5,
        );
      const c = theme.colors;
      expect([c.ink, c.background, c.surface, c.onAccent, c.accent]).toContain(st.text);
    }
  });

  test("the slide draws exactly that scrim, and the words in that colour", () => {
    for (const theme of THEMES) {
      const st = hookStyle(theme);
      const els = layoutTemplate(
        { template: "hook", heading: "Why do volcanoes erupt?", lead: LEAD.ks2, figure: photo },
        theme,
        "ks2",
      ).slide.elements;
      const scrim = els.find((e) => e.name === HOOK_NAMES.scrim);
      expect(scrim).toMatchObject({ x: 0, y: 0, w: 960, h: 540, opacity: st.opacity });
      expect((scrim as { fill?: string }).fill).toBe(st.scrim);
      const shot = els.findIndex((e) => e.name === HOOK_NAMES.photo);
      expect(shot).toBeGreaterThanOrEqual(0);
      expect(els.indexOf(scrim as SlideElement)).toBeGreaterThan(shot);
      const words = els.filter((e) => e.type === "text");
      expect(words).toHaveLength(2);
      for (const w of words) {
        expect(w.style?.color).toBe(st.text);
        expect(w.style?.align).toBe("center");
        expect(els.indexOf(w)).toBeGreaterThan(els.indexOf(scrim as SlideElement));
      }
    }
  });

  test("the writer's lead cap is the renderer's measurement: it fits", () => {
    for (const g of Object.keys(HOOK_GROUPS) as HookGroup[]) {
      const { chars } = CAPACITY[g];
      expect(hookFitsAt(HOOK_GROUPS[g], chars), g).toBe(true);
    }
  }, 30_000);

  for (const theme of THEMES)
    for (const stage of STAGES)
      test(`${theme.id} ${stage}: the heading and about 40 words fit, at or over the floor`, () => {
        const r = layoutTemplate(
          {
            template: "hook",
            heading: "Why do volcanoes erupt?",
            lead: lead(stage),
            figure: photo,
          },
          theme,
          stage,
        );
        expect(r.over).toEqual([]);
        for (const { size } of fontSizes(r.slide.elements))
          expect(size).toBeGreaterThanOrEqual(MIN_FONT_SIZE.body);
        expect(r.slide.kind).toBe("image-text");
      });

  test("the photo covers the slide; one that would be cut blind is shown whole on the scrim's colour", () => {
    const theme = THEMES[0];
    if (!theme) throw new Error("no theme");
    const els = layoutTemplate(
      { template: "hook", heading: "h", lead: "l", figure: photo },
      theme,
      "ks2",
    ).slide.elements;
    expect(els.find((e) => e.name === HOOK_NAMES.photo)).toMatchObject({
      x: 0,
      y: 0,
      w: 960,
      h: 540,
    });
    const tall: Figure = { photo: "https://x.test/tall.jpg", aspect: 0.66 };
    const whole = layoutTemplate(
      { template: "hook", heading: "h", lead: "l", figure: tall },
      theme,
      "ks2",
    ).slide.elements;
    const p = whole.find((e) => e.name === HOOK_NAMES.photo);
    expect(p?.h).toBeGreaterThanOrEqual(538);
    expect(p?.w).toBeLessThan(960);
    expect(whole.find((e) => e.name === "Ground")).toMatchObject({ w: 960, h: 540 });
  });

  test("a hook whose picture failed is a discussion prompt, never an empty dark slide", () => {
    for (const theme of THEMES) {
      const r = layoutTemplate(
        { template: "hook", heading: "Look at the sky", lead: LEAD.ks1 },
        theme,
        "ks1",
      );
      expect(r.slide.kind).toBe("discussion");
      expect(r.slide.elements.some((e) => e.name === HOOK_NAMES.scrim)).toBe(false);
      expect(r.slide.elements.filter((e) => e.type === "text").length).toBeGreaterThan(0);
    }
  });

  test("a picture still being found is an open full-bleed slot under the scrim", () => {
    const theme = THEMES[0];
    if (!theme) throw new Error("no theme");
    const els = layoutTemplate(
      { template: "hook", heading: "h", lead: "l", figure: { photo: "", request: "slot:picture" } },
      theme,
      "ks2",
    ).slide.elements;
    expect(els.find((e) => e.name === HOOK_NAMES.photo)).toMatchObject({ w: 960, h: 540 });
  });

  const ODD: TemplateInput[] = [
    { template: "hook", heading: "" },
    { template: "hook", heading: "", lead: "", figure: photo },
    { template: "hook", heading: "Long", lead: "word ".repeat(200), figure: photo },
    { template: "hook", heading: "Diagram", figure: { diagram: { kind: "nope" } } },
    { template: "hook", heading: "Open", figure: { photo: "" } },
  ];
  for (const stage of STAGES)
    test(`odd input at ${stage} still gives a slide on every theme`, () => {
      for (const theme of THEMES)
        for (const input of ODD) {
          const r = layoutTemplate(input, theme, stage);
          expect(Array.isArray(r.slide.elements)).toBe(true);
          expect(Array.isArray(r.over)).toBe(true);
        }
    });
});
