import { describe, expect, it } from "bun:test";
import type { Slide, Theme } from "@tj/domain/documents";
import { figureGroupOf } from "./figures";
import { fitsPlanned } from "./fit-check";
import { fitSlide } from "./fit-slide";
import { PALETTE_MAX as MAX } from "./fixtures/palette-max";
import { materialiseSlide } from "./materialise";
import {
  FIGURE_SUBJECTS,
  PALETTE,
  PALETTE_FORM_IDS,
  type PaletteForm,
  paletteFor,
  paletteMenu,
  unitsOf,
} from "./palette";
import { type SlideSpec, SlideSpecSchema } from "./specs";
import type { SlideStructure } from "./structure";
import { resolveFontSize } from "./text-style";
import { THEMES } from "./themes";

/*
 * The palette drift test (plan PR 5): every slide form filled to its maximum units with realistic,
 * long-ish classroom text must fit at body size, with no step-down, on all 10 themes. The menu can
 * never promise more than a slide shows. A form that stops fitting has its units lowered in
 * `palette.ts`, never a word or character limit added.
 */

const meta = { promptVersion: "palette", model: "test", at: "2026-09-30" };

const slideForms = PALETTE.filter((f) => f.renderer.on === "slide");

function materialise(form: PaletteForm, spec: SlideSpec, theme: Theme): Slide {
  if (form.renderer.on !== "slide") throw new Error("off-slide form");
  const structure: SlideStructure =
    form.renderer.structure === "photo" ? { photo: { subject: "root hairs on a seedling" } } : {};
  const slide = materialiseSlide(spec, theme.id, meta, undefined, form.renderer.variant, structure);
  return fitSlide(slide, theme).slide;
}

/** The smallest size each preset is set at on a slide: stepped text shows up as a smaller one. */
function sizes(slide: Slide, theme: Theme): Map<string, number> {
  const out = new Map<string, number>();
  const note = (key: string, size: number) => out.set(key, Math.min(out.get(key) ?? size, size));
  for (const el of slide.elements) {
    // A worked step's reason is a step under its step by design (UX ruling 151), not a fit step.
    if (el.type === "text" && el.name !== "Row side") {
      note(el.style.preset, el.style.fontSize ?? resolveFontSize(theme, el.style.preset));
    }
    if (el.type === "option" && el.textStyle?.fontSize) note("option", el.textStyle.fontSize);
  }
  return out;
}

describe("palette records", () => {
  it("lists every form once, in the plan's table", () => {
    expect(PALETTE.map((f) => f.id)).toEqual([...PALETTE_FORM_IDS]);
  });

  it.each(PALETTE.map((f) => [f.id, f]))("%s: its example is a valid fill", (_id, form) => {
    if (typeof form.example === "string") return;
    expect(SlideSpecSchema.safeParse(form.example).success).toBe(true);
    const units = unitsOf(form, form.example);
    for (const unit of form.holds) {
      if (unit.slot.startsWith("structure.")) continue;
      expect(units[unit.slot], unit.slot).toBeGreaterThanOrEqual(unit.min);
      if (unit.max !== undefined) expect(units[unit.slot], unit.slot).toBeLessThanOrEqual(unit.max);
    }
  });

  it("gates the figure by subject", () => {
    const ids = (s?: string) => paletteFor(s).map((f) => f.id);
    expect(ids("History")).not.toContain("figure");
    expect(ids("English")).not.toContain("figure");
    expect(ids("Maths")).toContain("figure");
    expect(ids("Combined science")).toContain("figure");
    expect(ids()).toContain("figure");
    expect(paletteMenu("Mathematics")).toContain("right-triangle");
    expect(paletteMenu("Mathematics")).not.toContain("energy-profile");
    expect(paletteMenu("Chemistry")).toContain("energy-profile");
    expect(Object.keys(FIGURE_SUBJECTS).sort()).toEqual([
      "energy-profile",
      "right-triangle",
      "triangle",
    ]);
  });

  it("the menu names no word or character counts", () => {
    for (const subject of [undefined, "Maths", "History"]) {
      const menu = paletteMenu(subject);
      expect(menu).not.toMatch(/\b(words?|characters?|chars?)\b/i);
      for (const form of paletteFor(subject)) expect(menu).toContain(`${form.id} (`);
    }
  });
});

describe("palette drift: every slide form at its maximum fits at body size on all 10 themes", () => {
  it("has a maximum fill for every slide form, at every unit's maximum", () => {
    for (const form of slideForms) {
      const spec = MAX[form.id];
      expect(spec, form.id).toBeDefined();
      if (!spec) continue;
      expect(SlideSpecSchema.safeParse(spec).success, form.id).toBe(true);
      const units = unitsOf(form, spec);
      for (const unit of form.holds) {
        if (unit.slot.startsWith("structure.") || unit.max === undefined) continue;
        expect(units[unit.slot], `${form.id} ${unit.slot}`).toBe(unit.max);
      }
    }
  });

  for (const form of slideForms) {
    it.each(THEMES.map((t) => [t.id, t]))(`${form.id} on %s`, (_id, theme) => {
      const spec = MAX[form.id] as SlideSpec;
      const full = materialise(form, spec, theme);
      expect(fitSlide(full, theme).overflow, "overflow").toEqual([]);
      // No step-down: no preset is set smaller than the same form with its short example.
      const base = sizes(materialise(form, form.example as SlideSpec, theme), theme);
      for (const [preset, size] of sizes(full, theme)) {
        const at = base.get(preset);
        // The hinge's 2×2 grid sets its options in body and may take one stop under it (rulings
        // 91 and 161); the column it would otherwise be is the larger option size.
        if (form.id === "hinge" && preset === "option") continue;
        if (at !== undefined) expect(size, `${preset} stepped`).toBeGreaterThanOrEqual(at);
      }
      // The form was placed as itself, not a fallback.
      if (form.renderer.on === "slide" && form.renderer.placed) {
        const placed = form.renderer.placed;
        expect(
          full.elements.some((e) => e.name === placed),
          `${placed} placed`,
        ).toBe(true);
      }
      if (form.id === "figure") expect(figureGroupOf(full)).toBeDefined();
    });
  }
});

/*
 * The same drift, through the save gate the designer's fit ladder runs (`fitsPlanned`, stepDown 0):
 * every text at its own size, nothing past the safe area, nothing overlapping, on all 10 themes.
 * The test above compares sizes with the form's short example, so a form whose example was itself
 * stepped down passed it while the ladder failed every fill on those themes (r6 smoke, y9-weimar:
 * the worked example's question sat one stop down on four themes whatever it said). An aside the
 * ladder moves to the notes before anything else (a hinge's "Why?" explanation) is left out.
 */
describe("palette drift through the save gate: every slide form at its maximum passes", () => {
  const ASIDES: Partial<Record<string, string>> = { hinge: "explanation" };
  for (const form of slideForms) {
    for (const which of ["maximum", "example"] as const) {
      it(`${form.id}, its ${which}`, () => {
        if (form.renderer.on !== "slide") return;
        const spec = { ...((which === "maximum" ? MAX[form.id] : form.example) as SlideSpec) };
        const aside = ASIDES[form.id];
        if (aside) delete (spec as Record<string, unknown>)[aside];
        const structure: SlideStructure =
          form.renderer.structure === "photo"
            ? { photo: { subject: "root hairs on a seedling" } }
            : {};
        const gate = fitsPlanned(spec, {
          stepDown: 0,
          ...(form.renderer.variant ? { variant: form.renderer.variant } : {}),
          structure,
        });
        expect(gate.failing.map((f) => f.theme)).toEqual([]);
      });
    }
  }

  it("counts a worked example's question in sentences, so a longer question is over the promise", () => {
    const form = PALETTE.find((f) => f.id === "worked-example") as PaletteForm;
    const spec = {
      ...(MAX["worked-example"] as SlideSpec),
      question:
        "A worker has 100 marks in savings. A loaf rises from 1 mark to 10 marks. What can the savings buy?",
    } as SlideSpec;
    const max = form.holds.find((u) => u.slot === "question")?.max;
    expect(unitsOf(form, spec).question).toBe(3);
    expect(max).toBe(1);
  });
});
