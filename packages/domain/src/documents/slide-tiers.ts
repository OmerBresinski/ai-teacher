import { DEFAULT_SLIDE_TIER, SLIDE_COUNTS, type SlideTier } from "./brief";

/*
 * Ruling 164's tier ranges (Detailed 13–16 since the ruling that amends it, 11 Oct 2026) and the helpers built on them. Kept out of `brief.ts` so the brief
 * schema's chunk (shared with the print pages) carries only the tier names (bundle budget).
 */

export const SLIDE_TIER_RANGES: Record<SlideTier, { min: number; max: number }> = {
  quick: { min: 6, max: 8 },
  standard: { min: 9, max: 12 },
  detailed: { min: 13, max: 16 },
};
/**
 * The exact count the outline planners (objectives-first, facts) build for a tier: always inside
 * the tier's range, so the writer is never asked for slides the outline did not plan.
 */
export const PLANNER_COUNT_OF_TIER: Record<SlideTier, number> = {
  quick: 8,
  standard: 10,
  detailed: 16,
};
/** How hard the lesson is pitched relative to the year group (ruling 74). */

type DeckLength = { slideTier?: SlideTier | undefined; slideCount?: number | undefined };

/**
 * The tier a brief stands for: its `slideTier`, else the tier its exact count falls in (a lesson
 * made before tiers), else Standard. Any count above Standard is Detailed, so a lesson or setting
 * stored with 17–20 slides (Detailed was 13–20 before) still opens as Detailed.
 */
export function slideTierOf(brief: DeckLength | undefined): SlideTier {
  if (brief?.slideTier) return brief.slideTier;
  const n = brief?.slideCount;
  if (n === undefined) return DEFAULT_SLIDE_TIER;
  return n <= SLIDE_TIER_RANGES.quick.max
    ? "quick"
    : n <= SLIDE_TIER_RANGES.standard.max
      ? "standard"
      : "detailed";
}

/**
 * The exact count an outline planner builds: a tier's planner count (inside its range), else an
 * older lesson's own count, else the Standard tier's.
 */
export function plannerSlideCount(brief: DeckLength | undefined): number {
  if (brief?.slideTier) return PLANNER_COUNT_OF_TIER[brief.slideTier];
  const n = brief?.slideCount;
  if (n !== undefined && (SLIDE_COUNTS as readonly number[]).includes(n)) return n;
  return PLANNER_COUNT_OF_TIER[DEFAULT_SLIDE_TIER];
}
