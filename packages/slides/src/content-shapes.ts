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

/** A word budget for one slot: at most `max` words; `count` bounds a list slot's members. */
export type SlotBudget = { max: number; count?: readonly [min: number, max: number] };

/**
 * What each shape's slots hold, in words. The single source for the slide prompt and the spec
 * check, so the two cannot disagree. Placeholder numbers: `look/layout-first` replaces them with
 * what each composition fits at its body size (measured, not guessed) and records how.
 */
export const CONTENT_BUDGETS: Record<
  ContentShape,
  { heading: SlotBudget; lead: SlotBudget } & Partial<
    Record<"body" | "points" | "side" | "sidePoints" | "steps", SlotBudget>
  >
> = {
  explain: { heading: { max: 5 }, lead: { max: 20 }, body: { max: 30 } },
  list: { heading: { max: 5 }, lead: { max: 20 }, points: { max: 8, count: [2, 4] } },
  compare: {
    heading: { max: 5 },
    lead: { max: 16 },
    side: { max: 3 },
    sidePoints: { max: 8, count: [2, 3] },
  },
  sequence: { heading: { max: 5 }, lead: { max: 16 }, steps: { max: 8, count: [2, 4] } },
};
