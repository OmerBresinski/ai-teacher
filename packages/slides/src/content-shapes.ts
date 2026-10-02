/*
 * The shape of a teaching slide (look/layout-first). The planner tags each key idea with one of
 * these; the slide writer fills that shape's slots; `materialiseSlide` places them explicitly
 * instead of inferring a compare or a sequence from prose (`inferStructure` stays the fallback
 * for stored lessons).
 *
 * - explain:  a lead, then how or why it holds and an example; a right panel (key term, key idea
 *             or diagram) when the words fit beside it, else the full measure. A body of one
 *             sentence with none of those is set as a key-idea card across the measure.
 * - list:     a lead naming a set of parallel things, then 2–3 `points`, each "Label: sentence".
 * - compare:  two labelled sides with two points each (`compare`).
 * - sequence: a process or method in order, 2–3 `steps`.
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
 * 26 Sept 2026; re-measured look/shape-fixes, same day). The test (`content-shapes.test.ts`, probe
 * in `content-shapes.measure.ts`) re-runs the measure and fails when a font or layout change moves
 * it past the rounding.
 *
 * Method. A content spec of the shape, with N words of teaching prose (5.2 letters a word; plain
 * English runs about 4.7) in each slot and every list at its most members, goes through
 * `materialiseSlide` on every theme (the full-measure explain through `applyLook` and
 * `fitSlide`, the path a slide takes when no panel is placed). It counts only when it comes out as
 * one slide with no overflow, all running text at or above the body floor (the one step down UX
 * ruling 91 allows, `floorBelow`, never lower), a one-line display heading, and the composition
 * measured: `panel` has a photograph beside the words (`PHOTO_TEXT_SHARE` of the measure for the
 * text, look/image-slot: the writer reads `panel` for a slide with a planned photo), `full` has
 * none. Lead first: the heading (one display line) and a compare side's label
 * (one line of its card); then the lead, up to two lines across or three beside the panel, and at
 * most 18 words; then the shape's slot in what is left, up to its target (`TARGETS`: an explain
 * body 36 words after the lead, a point 16, a compare point or a step 12), the lead giving words
 * back down to 12 while that buys the slot more. A budget is the least count across the themes,
 * an explain body and a compare point less a tenth (a point of long words, "securing service
 * through promised release", otherwise loses its cards to the fallback: gen6 Tempest).
 *
 * Why these numbers (E49, 26 Sept 2026: the v31 budgets, measured at the body size with no step
 * down, lost 5–15 to master, 12 of the losses "telegraphic fragments, too thin to teach from"):
 * a teaching slide carries its idea, how or why it holds, and an example, in full sentences, about
 * 35–55 words. An explain slide is written for the full measure (lead 18 + body 32) and takes a
 * right panel only when its words still fit the column beside it (`structure.ts` `splitContent`).
 * The members are what the words need: a compare has two points a side (three would be 5 words
 * each), a sequence up to three steps (four cards across hold 6 words each), a list up to three
 * "Label: one full sentence" points (four hold 12 words each with no slack: gen6 rivers' four
 * 12–13-word points fell back to a paragraph that overran; three hold 22, written to 16).
 */
export const COMPOSITION_BUDGETS: Record<
  ContentShape,
  Partial<Record<ShapeComposition, ShapeBudget>>
> = {
  explain: {
    panel: { heading: { max: 4 }, lead: { max: 13 }, body: { max: 32 } },
    full: { heading: { max: 4 }, lead: { max: 18 }, body: { max: 32 } },
  },
  list: {
    // Beside a photograph at `PHOTO_TEXT_SHARE` (look/image-slot, 27 Sept 2026; 0.55 since Greg's
    // P19 review: 13 → 11 a point): "Label: sentence" points, not fragments (6 words at the half
    // split lost E49).
    panel: { heading: { max: 4 }, lead: { max: 12 }, points: { max: 12, count: [2, 3] } },
    full: { heading: { max: 4 }, lead: { max: 18 }, points: { max: 16, count: [2, 3] } },
  },
  compare: {
    full: {
      heading: { max: 4 },
      lead: { max: 13 },
      side: { max: 5 },
      sidePoints: { max: 9, count: [2, 2] },
    },
  },
  sequence: {
    full: { heading: { max: 4 }, lead: { max: 18 }, steps: { max: 10, count: [2, 3] } },
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
 * What each shape's slots hold, in words, for the writer. An explain slide is written for the full
 * measure, its roomiest composition: the renderer sets a right panel (a key term, the key idea or a
 * diagram) beside the words only when they still fit the column. A written list takes the full
 * measure unless the plan gives it a drawing, when it gets `COMPOSITION_BUDGETS.list.panel`;
 * compare and sequence have one composition.
 * The renderer's capacity data, not the writer's: since generate-slide v33 the prompt carries no
 * word budget (one soft 40–60-word target and `SPEC_LIMITS`), so a slot over its budget is placed
 * by the renderer's fallback (`shapeFallback`), never retried (only `SPEC_LIMITS` retries).
 */
export const CONTENT_BUDGETS: Record<ContentShape, ShapeBudget> = {
  explain: COMPOSITION_BUDGETS.explain.full as ShapeBudget,
  list: COMPOSITION_BUDGETS.list.full as ShapeBudget,
  compare: tightest("compare"),
  sequence: tightest("sequence"),
};
