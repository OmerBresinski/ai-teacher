import { describe, expect, test } from "bun:test";
import { SAFE } from "./grid";
import { materialiseSlide } from "./materialise";
import { SAFE_BOTTOM } from "./metrics";
import { layoutTemplate, type Stage } from "./templates";
import { SPLIT_NAMES } from "./templates/split-compare";
import { splitSides } from "./templates/split-compare-capacity";
import { THEMES } from "./themes";

const meta = { promptVersion: "test", model: "test", at: "2026-09-30T00:00:00.000Z" };

describe("safe area", () => {
  test("every sort card sits inside the safe area, above the bottom bar, on every theme", () => {
    const spec = {
      kind: "sort" as const,
      factRefs: [],
      stem: "Put these four parts of a persuasive speech in the order a speaker would use them.",
      steps: [
        "Opening position that states the view",
        "Arguments with evidence and support",
        "Counterargument and rebuttal",
        "Conclusion and a call to action",
      ],
    };
    for (const t of THEMES) {
      const slide = materialiseSlide(spec, t.id, meta);
      const cards = slide.elements.filter((e) => e.type === "option");
      expect(cards).toHaveLength(4);
      for (const c of cards)
        expect(c.y + c.h, `${t.id} card bottom`).toBeLessThanOrEqual(SAFE_BOTTOM);
    }
  });

  /** Full-bleed by design (TEACH-75 part w): split-compare's ground and colour fields, as backdrops are in `reflow.ts`. */
  const FULL_BLEED = new Set<string>([SPLIT_NAMES.ground, SPLIT_NAMES.field]);
  test("split-compare: only its named full-bleed ground and fields leave the safe area, on every theme", () => {
    for (const t of THEMES)
      for (const stage of ["ks1", "ks2", "ks3"] as Stage[])
        for (const n of [2, 3] as const)
          for (const zone of ["picture", "quote", "text"] as const) {
            const r = layoutTemplate(
              {
                template: "split-compare",
                heading: "Two kinds",
                sides: splitSides("KS2", n, zone),
              },
              t,
              stage,
            );
            const outside = r.slide.elements.filter(
              (e) =>
                e.x < SAFE.x ||
                e.y < SAFE.y ||
                e.x + e.w > SAFE.x + SAFE.w ||
                e.y + e.h > SAFE_BOTTOM,
            );
            expect(outside.length).toBeGreaterThan(0);
            for (const e of outside)
              expect(FULL_BLEED.has(e.name ?? ""), `${t.id} ${stage} ${n} ${zone} ${e.name}`).toBe(
                true,
              );
          }
  });
});
