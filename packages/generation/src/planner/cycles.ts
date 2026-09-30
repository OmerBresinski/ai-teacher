import { type SlotRole, slotRoles } from "../prompts/design-cycle";
import type { ObjectiveArc } from "../prompts/plan-objectives";

/*
 * Allocation for the lesson designer (the lesson designer plan, pipeline step 3; TEACH-199): the
 * deck has exactly the slides the teacher asked for. Four are fixed — the title, the objectives,
 * the starter and the exit ticket — and every other slide is a slot shared among the objectives'
 * design cycles by weight. Each objective gets a teach slot and a check slot first when the deck
 * has room for both; what is left goes by weight, largest remainder first. Nothing later adds a
 * slide: the count is fixed here, and a deck too small for the minimums says which objectives it
 * shorted rather than growing.
 */

/** Slides the designer writes in code around the cycles: title, objectives, starter, exit ticket. */
export const FIXED_SLIDES = 4;
/** Title and objectives come first, then the starter; the cycles start on this slide (1-based). */
export const FIRST_CYCLE_SLIDE = 4;
/**
 * The fixed slides when the objectives ride on the title slide (`DESIGNER_OBJECTIVES_ON_TITLE`,
 * designer r4): title, starter, exit ticket. The freed slide goes to the cycles.
 */
export const FIXED_SLIDES_OBJECTIVES_ON_TITLE = 3;
/** A cycle's minimum: one slot that teaches the objective, one that checks it. */
export const CYCLE_MIN = 2;

/** Arc leans whose content needs more room: a method, a process, a contrast or a structure. */
const HEAVY_LEANS = new Set(["worked-example", "sequence", "compare", "diagram-slot", "figure"]);

/**
 * Arc leans that say the objective has concrete or structural content, so it wants a visual
 * (the design minimums' test, `planner/coded-slides.ts`). The visual forms themselves already
 * open their cycle with a show slot (`slotRoles`); a process or a contrast does not.
 */
export const VISUAL_NEED_LEANS: ReadonlySet<string> = new Set([
  "photo",
  "figure",
  "diagram-slot",
  "sequence",
  "compare",
]);

/**
 * Which objective takes a spare slot when the weights tie (designer r4): a method first (a third
 * slot is its practise), then a process or a contrast (a third slot is its show slot), then the
 * rest. The visual forms already show in their first slot.
 */
function needOf(arc: Pick<ObjectiveArc, "lean"> | undefined): number {
  if (arc?.lean === "worked-example") return 2;
  if (arc?.lean === "sequence" || arc?.lean === "compare") return 1;
  return 0;
}

/** An objective's share of the free slots, from its arc (1 when it has none). */
export function weightOf(arc: Pick<ObjectiveArc, "lean"> | undefined): number {
  if (!arc) return 1;
  if (HEAVY_LEANS.has(arc.lean)) return 1.5;
  if (arc.lean === "photo") return 1.25;
  return 1;
}

export type CycleSlots = {
  /** 0-based objective index. */
  objective: number;
  /** Slots this objective's design cycle fills. */
  count: number;
  /** 1-based slide number of its first slot (0 slots: where it would have started). */
  first: number;
  /** The deck's size, for the prompt's "slides 4 to 6 of 10". */
  slideCount: number;
  /** Each slot's role, in order (`slotRolesFor`): the design-cycle prompt's `slots.roles`. */
  roles: SlotRole[];
};

/**
 * The roles of an objective's slots: the prompt's `slotRoles`, except that a method objective
 * with 2 slots gets [teach, practise] (designer prompts r1: with 3 objectives in 10 slides every
 * objective has 2 slots, so no practise slot existed; judges valued practice on a new case over a
 * second closed check, and the exit ticket's line still checks the objective).
 */
export function slotRolesFor(count: number, lean?: ObjectiveArc["lean"] | undefined): SlotRole[] {
  if (count === 2 && lean === "worked-example") return ["teach", "practise"];
  const roles = slotRoles(count, lean);
  // Designer r4: a cycle with room for 3 or more slots whose arc wants a visual always has a show
  // slot. The visual leans open with one already; a process or a contrast is taught first in its
  // own form, then shown (the r3 judges missed visuals on rivers and plants).
  if (count >= 3 && lean && VISUAL_NEED_LEANS.has(lean) && !roles.includes("show")) {
    roles[1] = "show";
  }
  return roles;
}

export type Allocation = {
  slideCount: number;
  cycles: CycleSlots[];
  /** 1-based slide number of the exit ticket (always the last slide). */
  exitSlide: number;
  /** Objectives left under `CYCLE_MIN` slots because the deck is too small; empty normally. */
  short: number[];
};

/**
 * `total` shared by `weights`, largest remainder first; ties go to the heavier, then the needier
 * (`needs`, higher first), then the earlier objective.
 */
function share(total: number, weights: readonly number[], needs: readonly number[] = []): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((s, n) => s + n, 0);
  const order = exact
    .map((x, i) => ({ i, rem: x - Math.floor(x), w: weights[i] ?? 0, need: needs[i] ?? 0 }))
    .sort((a, b) => b.rem - a.rem || b.w - a.w || b.need - a.need || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    left -= 1;
  }
  return out;
}

/**
 * Exactly `slideCount` slides: the fixed ones (`FIXED_SLIDES`, or 3 with `objectivesOnTitle`)
 * and the rest as cycle slots across the objectives. Minimums first (`CYCLE_MIN` each), then the
 * rest by weight. When the deck cannot give every objective its minimum, each gets one slot in
 * weight order (heaviest first, then earliest), and objectives still at zero are checked by their
 * exit-ticket line alone; both are reported in `short`. The sum of the counts is always
 * `slideCount` less the fixed slides; the cycles start on the slide after the starter.
 */
export function allocate(
  slideCount: number,
  arcs: readonly (Pick<ObjectiveArc, "lean"> | undefined)[],
  opts: { objectivesOnTitle?: boolean } = {},
): Allocation {
  const n = arcs.length;
  const fixed = opts.objectivesOnTitle ? FIXED_SLIDES_OBJECTIVES_ON_TITLE : FIXED_SLIDES;
  if (n === 0) throw new Error("allocate: no objectives");
  if (!Number.isInteger(slideCount) || slideCount < fixed + 1) {
    throw new Error(`allocate: ${slideCount} slides leave no room for a cycle`);
  }
  const free = slideCount - fixed;
  const weights = arcs.map(weightOf);
  const needs = arcs.map(needOf);
  let counts: number[];
  if (free >= CYCLE_MIN * n) {
    const extra = share(free - CYCLE_MIN * n, weights, needs);
    counts = extra.map((e) => CYCLE_MIN + e);
  } else {
    // Too small for the minimums: one each by weight, then a second each by weight.
    counts = arcs.map(() => 0);
    const byWeight = weights
      .map((w, i) => ({ w, i }))
      .sort((a, b) => b.w - a.w || a.i - b.i)
      .map((x) => x.i);
    let left = free;
    for (let round = 0; round < CYCLE_MIN && left > 0; round++) {
      for (const i of byWeight) {
        if (left <= 0) break;
        counts[i] = (counts[i] ?? 0) + 1;
        left -= 1;
      }
    }
  }
  // The exit ticket is the last fixed slide; the others open the deck.
  let next = fixed;
  const cycles = counts.map((count, objective) => {
    const slot = {
      objective,
      count,
      first: next,
      slideCount,
      roles: slotRolesFor(count, arcs[objective]?.lean),
    };
    next += count;
    return slot;
  });
  return {
    slideCount,
    cycles,
    exitSlide: slideCount,
    short: counts.flatMap((c, i) => (c < CYCLE_MIN ? [i] : [])),
  };
}
