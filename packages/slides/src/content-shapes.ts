/*
 * The shape of a teaching slide (look/layout-first). The planner tags each key idea with one of
 * these; the slide writer fills that shape's slots; `materialiseSlide` places them explicitly
 * instead of inferring a compare or a sequence from prose (`inferStructure` stays the fallback
 * for stored lessons).
 *
 * - explain:  a lead and a short body, the right panel holding a key term, key idea or diagram.
 * - list:     a lead naming a set of parallel things, then 2–4 `points`.
 * - compare:  two labelled sides with 2–3 points each (`compare`).
 * - sequence: a process or method in order, 2–4 `steps`.
 */

export const CONTENT_SHAPES = ["explain", "list", "compare", "sequence"] as const;
export type ContentShape = (typeof CONTENT_SHAPES)[number];

/**
 * The shape a content spec's fields name: `compare`, then `steps`, then `points`; `explain` when
 * it names none (a body alone, perhaps with a diagram).
 */
export function shapeOf(spec: {
  compare?: unknown;
  steps?: readonly unknown[] | undefined;
  points?: readonly unknown[] | undefined;
}): ContentShape {
  if (spec.compare) return "compare";
  if (spec.steps?.length) return "sequence";
  if (spec.points?.length) return "list";
  return "explain";
}

/** A word budget for one slot: at most `max` words; `count` bounds a list slot's members. */
export type SlotBudget = { max: number; count?: readonly [min: number, max: number] };

type ShapeBudget = { heading: SlotBudget; lead: SlotBudget } & Partial<
  Record<"body" | "points" | "side" | "sidePoints" | "steps", SlotBudget>
>;

/** Where a shape's words sit: beside the right panel (key term, key idea, diagram) or across. */
export type ShapeComposition = "panel" | "full";

/**
 * What each slot holds, in words, per composition: measured, not guessed (look/shape-render,
 * 26 Sept 2026, at the reading size of `text-style.ts` `readingSize`). The test
 * (`content-shapes.test.ts`, probe in `content-shapes.measure.ts`) re-runs the measure and fails
 * when a font or layout change moves it past the rounding.
 *
 * Method. A content spec of the shape, with N words of teaching prose (5.2 letters a word; plain
 * English runs about 4.7) in each slot and every list at its most members, goes through
 * `materialiseSlide` on each of the six themes (the full-measure explain through `applyLook` and
 * `fitSlide`, the path a slide takes when no panel is placed). It counts only when it comes out as
 * one slide with no overflow, all running text at the reading size (no step down, so no
 * continuation), a one-line display heading, and the composition measured: `panel` has the
 * key-term panel beside the words, `full` has none. Lead first: the heading (one display line) and
 * a compare side's label (one line of its card); then the lead, up to two lines across or three
 * beside the panel, and at most 18 words; then the shape's slot in what is left, up to its target
 * (points 6, compare points 6, steps 8), the lead giving words back down to 12 while that buys the
 * slot more (`TARGETS`). A budget is the least count across the themes (Chalk & Cream is the
 * tightest), an explain body less a tenth. Short of target: compare points 4 (5 with a lead of 10
 * words), list points beside a panel 5, steps 6 on Chalk & Cream (8 on four themes).
 */
export const COMPOSITION_BUDGETS: Record<
  ContentShape,
  Partial<Record<ShapeComposition, ShapeBudget>>
> = {
  explain: {
    panel: { heading: { max: 4 }, lead: { max: 15 }, body: { max: 20 } },
    full: { heading: { max: 4 }, lead: { max: 18 }, body: { max: 46 } },
  },
  list: {
    panel: { heading: { max: 4 }, lead: { max: 12 }, points: { max: 5, count: [2, 4] } },
    full: { heading: { max: 4 }, lead: { max: 18 }, points: { max: 6, count: [2, 4] } },
  },
  compare: {
    full: {
      heading: { max: 4 },
      lead: { max: 18 },
      side: { max: 5 },
      sidePoints: { max: 4, count: [2, 3] },
    },
  },
  sequence: {
    full: { heading: { max: 4 }, lead: { max: 12 }, steps: { max: 6, count: [2, 4] } },
  },
};

/** The tighter of a shape's compositions, slot by slot. */
function tightest(shape: ContentShape): ShapeBudget {
  const all = Object.values(COMPOSITION_BUDGETS[shape]).filter((b) => b !== undefined);
  const out: Record<string, SlotBudget> = {};
  for (const b of all) {
    for (const [slot, budget] of Object.entries(b) as [string, SlotBudget][]) {
      const was = out[slot];
      if (!was || budget.max < was.max) out[slot] = budget;
    }
  }
  return out as ShapeBudget;
}

/**
 * What each shape's slots hold, in words, for the writer: the composition it will get where that
 * is known when it writes, else the tighter. An explain slide always has its panel (a key term, or
 * the key idea itself). A list takes the key-term panel only when one of the lesson's terms turns
 * up in its words, which the writer's own words decide, so it gets the tighter (the panel's).
 * Compare and sequence have one composition. The single source for the slide prompt and the spec
 * check (`specs.ts`), so the two cannot disagree.
 */
export const CONTENT_BUDGETS: Record<ContentShape, ShapeBudget> = {
  explain: COMPOSITION_BUDGETS.explain.panel as ShapeBudget,
  list: tightest("list"),
  compare: tightest("compare"),
  sequence: tightest("sequence"),
};
