import { describe, expect, test } from "bun:test";
import { CALLOUT_NAMES, fitSlide, getTheme, materialiseSlide, THEMES } from "@tj/slides";
import { FULL_SLIDES } from "./full-slides";

const META = { promptVersion: "test", model: "test", at: "2026-09-29" };

/** The full slides the prompts show for size must really fit, callout included, on every theme. */
describe("full slides", () => {
  for (const { label, spec } of FULL_SLIDES) {
    test(`${label} fits every theme`, () => {
      for (const t of THEMES) {
        const slide = materialiseSlide(spec, t.id, META);
        expect(fitSlide(slide, getTheme(t.id)).overflow).toEqual([]);
        if ("callout" in spec && spec.callout) {
          const placed = slide.elements.some(
            (e) => e.name === CALLOUT_NAMES.card || e.name === CALLOUT_NAMES.text,
          );
          expect(placed).toBe(true);
        }
      }
    });
  }
});
