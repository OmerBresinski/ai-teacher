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
 * `free` slots across the objectives: `min` each first, then the rest by weight (ties to the
 * needier, then the earlier). When the deck cannot give every objective `min`, one each in weight
 * order (heaviest first, then earliest), round after round, up to `min`.
 */
function countsFor(
  free: number,
  arcs: readonly (Pick<ObjectiveArc, "lean"> | undefined)[],
  min: number,
): number[] {
  const n = arcs.length;
  const weights = arcs.map(weightOf);
  const needs = arcs.map(needOf);
  if (free >= min * n) {
    const extra = share(free - min * n, weights, needs);
    return extra.map((e) => min + e);
  }
  const counts = arcs.map(() => 0);
  const byWeight = weights
    .map((w, i) => ({ w, i }))
    .sort((a, b) => b.w - a.w || a.i - b.i)
    .map((x) => x.i);
  let left = free;
  for (let round = 0; round < min && left > 0; round++) {
    for (const i of byWeight) {
      if (left <= 0) break;
      counts[i] = (counts[i] ?? 0) + 1;
      left -= 1;
    }
  }
  return counts;
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
  const counts = countsFor(slideCount - fixed, arcs, CYCLE_MIN);
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

/* ------------------------------------------------------------------ r6: structure is not fixed */

/*
 * Designer r6 (Greg, 30 Sep: "structure is not fixed"). The title is the only fixed slide and it
 * carries the objectives (the r4 agenda title; a separate objectives slide only when that title
 * does not fit). There is no forced starter, objectives slide or exit ticket: an exit ticket is
 * the teacher's, picked as a worksheet recipe in the creation flow. An opening (retrieval or a
 * hook) and a closing (a check, a plenary or a debate) are each an optional slot the objectives
 * call asks for from its arc. Every other slide is an objective's, at least `R6_CYCLE_MIN` each:
 * teach, show, check, and practise when there is room.
 */

/** The fewest slots an r6 cycle is planned with: teach, show (or a worked example), check. */
export const R6_CYCLE_MIN = 3;

export const OPENING_KINDS = ["retrieval", "hook"] as const;
export const CLOSING_KINDS = ["check", "plenary", "debate"] as const;
export type OpeningKind = (typeof OPENING_KINDS)[number];
export type ClosingKind = (typeof CLOSING_KINDS)[number];
/** An optional opening or closing slot as the objectives call asks for it. */
export type Bookend<K extends string = string> = { kind: K; prompt?: string | undefined };
export type Bookends = {
  opening?: Bookend<OpeningKind> | undefined;
  closing?: Bookend<ClosingKind> | undefined;
};

/** The count of optional slots asked for. */
export const bookendCount = (b: Bookends | undefined): number =>
  (b?.opening ? 1 : 0) + (b?.closing ? 1 : 0);

/**
 * The most objectives a deck of `slideCount` holds at `R6_CYCLE_MIN` slots each, after the title
 * (and, when `fixed` is 2, the objectives slide) and `bookends` optional slots. Never below 1.
 */
export function maxObjectives(slideCount: number, bookends = 0, fixed = 1): number {
  return Math.max(1, Math.floor((slideCount - fixed - bookends) / R6_CYCLE_MIN));
}

/**
 * The bookends a deck keeps once `objectives` have their minimum: the objectives come first, so
 * the closing is dropped, then the opening, until every objective has `R6_CYCLE_MIN` slots (or
 * no bookend is left). Returns what was kept and what was dropped, for the log.
 */
export function fitBookends(
  slideCount: number,
  objectives: number,
  bookends: Bookends | undefined,
  fixed = 1,
): { kept: Bookends; dropped: ("opening" | "closing")[] } {
  const kept: Bookends = { ...(bookends ?? {}) };
  const dropped: ("opening" | "closing")[] = [];
  const room = () => slideCount - fixed - bookendCount(kept) >= objectives * R6_CYCLE_MIN;
  if (!room() && kept.closing) {
    kept.closing = undefined;
    dropped.push("closing");
  }
  if (!room() && kept.opening) {
    kept.opening = undefined;
    dropped.push("opening");
  }
  return {
    kept: {
      ...(kept.opening ? { opening: kept.opening } : {}),
      ...(kept.closing ? { closing: kept.closing } : {}),
    },
    dropped,
  };
}

/**
 * An r6 cycle's roles: teach, then show (the worked example, for a method: its second slot is a
 * teach slot, where the worked example lives), then check; practise before the check when there is
 * a fourth slot; further slots teach again after the first, so the teaching is spread across the
 * cycle before the practise and the check. Two slots teach and check; one only teaches.
 */
export function r6RolesFor(count: number, lean?: ObjectiveArc["lean"] | undefined): SlotRole[] {
  if (count <= 0) return [];
  if (count === 1) return ["teach"];
  if (count === 2) return ["teach", "check"];
  const second: SlotRole = lean === "worked-example" ? "teach" : "show";
  const tail: SlotRole[] = count >= 4 ? ["practise", "check"] : ["check"];
  const extra: SlotRole[] = Array.from({ length: count - 2 - tail.length }, () => "teach");
  return ["teach", ...extra, second, ...tail];
}

export type R6Allocation = Allocation & {
  /** Slides before the cycles that code writes: 1 (objectives on the title) or 2. */
  fixed: number;
  /** 1-based slide of the opening slot, when kept. */
  openingSlide?: number | undefined;
  /** 1-based slide of the closing slot, when kept (always the last slide). */
  closingSlide?: number | undefined;
  /** The bookends kept, and those dropped so every objective has its minimum. */
  bookends: Bookends;
  dropped: ("opening" | "closing")[];
};

/**
 * Exactly `slideCount` slides for r6: the title (with the objectives, or followed by an
 * objectives slide when they do not fit on it), the opening when kept, the cycles, the closing
 * when kept. Cycles get `R6_CYCLE_MIN` each first, then the rest by weight; a deck too small for
 * that gives what it can, heaviest first, and reports the objectives under `R6_CYCLE_MIN` in
 * `short`. `exitSlide` is the closing slide, or 0 when the deck has none.
 */
export function allocateR6(
  slideCount: number,
  arcs: readonly (Pick<ObjectiveArc, "lean"> | undefined)[],
  opts: { objectivesOnTitle: boolean; bookends?: Bookends | undefined },
): R6Allocation {
  const n = arcs.length;
  const fixed = opts.objectivesOnTitle ? 1 : 2;
  if (n === 0) throw new Error("allocate: no objectives");
  if (!Number.isInteger(slideCount) || slideCount < fixed + 1) {
    throw new Error(`allocate: ${slideCount} slides leave no room for a cycle`);
  }
  const { kept, dropped } = fitBookends(slideCount, n, opts.bookends, fixed);
  const free = slideCount - fixed - bookendCount(kept);
  const counts = countsFor(free, arcs, R6_CYCLE_MIN);
  const openingSlide = kept.opening ? fixed + 1 : undefined;
  let next = fixed + (kept.opening ? 1 : 0) + 1;
  const cycles = counts.map((count, objective) => {
    const slot = {
      objective,
      count,
      first: next,
      slideCount,
      roles: r6RolesFor(count, arcs[objective]?.lean),
    };
    next += count;
    return slot;
  });
  const closingSlide = kept.closing ? slideCount : undefined;
  return {
    slideCount,
    cycles,
    exitSlide: closingSlide ?? 0,
    short: counts.flatMap((c, i) => (c < R6_CYCLE_MIN ? [i] : [])),
    fixed,
    ...(openingSlide ? { openingSlide } : {}),
    ...(closingSlide ? { closingSlide } : {}),
    bookends: kept,
    dropped,
  };
}
