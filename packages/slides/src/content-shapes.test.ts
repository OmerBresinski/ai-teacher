import { describe, expect, test } from "bun:test";
import {
  budgetFor,
  COMPOSITION_BUDGETS,
  CONTENT_BUDGETS,
  CONTENT_SHAPES,
  type ContentShape,
  type ShapeComposition,
  shapeOf,
} from "./content-shapes";
import { type Counts, check, leadLinesFor, measure } from "./content-shapes.measure";
import { THEMES } from "./themes";

/*
 * The budgets in `content-shapes.ts`, checked against the fit code: each shape and composition is
 * rendered at its budget through `materialiseSlide` (the full-measure explain through the look and
 * the fit directly, the path a slide takes when no panel is placed) with the filler below, and
 * must come out on one slide, at the body size, in the composition it was measured for. The
 * measured maximum is found again here, so a CSS or font change that moves it either way by more
 * than the rounding breaks the test: re-measure and update the numbers.
 */

const SLOT: Record<ContentShape, "body" | "points" | "sidePoints" | "steps"> = {
  explain: "body",
  list: "points",
  compare: "sidePoints",
  sequence: "steps",
};

describe("content budgets are what the renderer fits", () => {
  for (const shape of CONTENT_SHAPES) {
    for (const composition of Object.keys(COMPOSITION_BUDGETS[shape]) as ShapeComposition[]) {
      const budget = COMPOSITION_BUDGETS[shape][composition];
      if (!budget) continue;
      test(`${shape}, ${composition}: the budget fits on every theme, and is the measure rounded down`, () => {
        const counts = {
          heading: budget.heading.max,
          lead: budget.lead.max,
          slot: budget[SLOT[shape]]?.max ?? 0,
          ...(budget.side ? { side: budget.side.max } : {}),
        };
        const measured = THEMES.map((t) => measure(shape, composition, t));
        if (process.env.PRINT_BUDGETS) {
          console.log(
            shape,
            composition,
            JSON.stringify(measured.map((m, i) => [THEMES[i]?.id, m])),
          );
        }
        for (const t of THEMES) {
          expect(
            check(shape, composition, counts, t, leadLinesFor(composition)),
            `${t.id} at the budget`,
          ).not.toBeTypeOf("string");
        }
        const least = (k: keyof Counts) => Math.min(...measured.map((m) => m[k] ?? 0));
        // Rounded down for safety, but not so far that a change in the fonts would go unnoticed.
        for (const [k, max] of Object.entries(counts) as [keyof Counts, number][]) {
          expect(max, `${k} within the measure`).toBeLessThanOrEqual(least(k));
          expect(max, `${k} not far under the measure`).toBeGreaterThanOrEqual(
            Math.floor(least(k) * 0.75),
          );
        }
      });
    }
  }

  test("CONTENT_BUDGETS is the composition the writer gets", () => {
    expect(CONTENT_BUDGETS.explain).toEqual(COMPOSITION_BUDGETS.explain.panel as never);
    expect(CONTENT_BUDGETS.list).toEqual(COMPOSITION_BUDGETS.list.full as never);
    expect(budgetFor("list", true)).toEqual(COMPOSITION_BUDGETS.list.panel as never);
    expect(budgetFor("compare", true)).toEqual(CONTENT_BUDGETS.compare);
  });

  test("a spec's fields name its shape", () => {
    expect(shapeOf({})).toBe("explain");
    expect(shapeOf({ points: ["a", "b"] })).toBe("list");
    expect(shapeOf({ steps: ["a", "b"], points: ["a", "b"] })).toBe("sequence");
    expect(shapeOf({ compare: {}, steps: ["a", "b"] })).toBe("compare");
  });
});
