import { z } from "zod";
import { type ClassContext, ClassContextSchema } from "./class-context";
import { guarded } from "./identifier-guard";

/*
 * Brief (ADR 0024 §1; F01). What the teacher states before generation: the topic or objective,
 * the duration, optional class context and the answers to at most two clarifying questions. It
 * holds only what the Lesson does not already carry — `subject`, `yearGroup`, `ageBand`,
 * `readingLevel` and `language` stay canonical on the Lesson and are not duplicated here. Stored
 * as the optional `Lesson.brief` field, so a TeachDeck file without one is still a valid document.
 */

export const BRIEF_TOPIC_MAX = 500;
export const BRIEF_ANSWER_MAX = 500;
export const BRIEF_DURATION_MIN = 5;
export const BRIEF_DURATION_MAX = 180;
/** F01: "at most two clarifying questions, each with a default the teacher can accept". */
export const MAX_CLARIFYING_QUESTIONS = 2;
/** The deck lengths a teacher may ask for (TDD ruling 75); `lessonFromBrief` defaults to 10. */
export const SLIDE_COUNTS = [6, 8, 10, 12] as const;
export type SlideCount = (typeof SLIDE_COUNTS)[number];
export const DEFAULT_SLIDE_COUNT: SlideCount = 10;
/**
 * The deck length a teacher picks (ruling 164): a tier, and the writer chooses the exact count
 * inside its range, title and objectives slides included. Code holds the writer to the range.
 */
export const SLIDE_TIERS = ["quick", "standard", "detailed"] as const;
export type SlideTier = (typeof SLIDE_TIERS)[number];
export const DEFAULT_SLIDE_TIER: SlideTier = "standard";
export const SLIDE_TIER_RANGES: Record<SlideTier, { min: number; max: number }> = {
  quick: { min: 6, max: 8 },
  standard: { min: 9, max: 12 },
  detailed: { min: 13, max: 20 },
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
export const BRIEF_LEVELS = ["easier", "standard", "harder"] as const;
export type BriefLevel = (typeof BRIEF_LEVELS)[number];

export type Brief = {
  /** Topic or objective, free text. */
  topic: string;
  durationMin: number;
  classContext?: ClassContext;
  /** How many slides the deck should have; absent on lessons created before the field existed. */
  slideCount?: SlideCount;
  /**
   * The deck length tier (ruling 164). New lessons carry this and no `slideCount`; a lesson with
   * only a `slideCount` (made before tiers) keeps its exact count.
   */
  slideTier?: SlideTier;
  level?: BriefLevel;
  /** Answers to the clarifying questions, keyed by the question id the brief screen chose. */
  answers?: Record<string, string>;
};

export const BriefSchema = z.strictObject({
  topic: guarded(z.string().min(1).max(BRIEF_TOPIC_MAX)),
  durationMin: z.number().int().min(BRIEF_DURATION_MIN).max(BRIEF_DURATION_MAX),
  classContext: ClassContextSchema.optional(),
  slideCount: z.union(SLIDE_COUNTS.map((n) => z.literal(n))).optional(),
  slideTier: z.enum(SLIDE_TIERS).optional(),
  level: z.enum(BRIEF_LEVELS).optional(),
  answers: z
    .record(z.string().min(1).max(64), guarded(z.string().max(BRIEF_ANSWER_MAX)))
    .refine((answers) => Object.keys(answers).length <= MAX_CLARIFYING_QUESTIONS, {
      message: `At most ${MAX_CLARIFYING_QUESTIONS} clarifying questions can be answered.`,
    })
    .optional(),
});

type DeckLength = { slideTier?: SlideTier | undefined; slideCount?: number | undefined };

/**
 * The tier a brief stands for: its `slideTier`, else the tier its exact count falls in (a lesson
 * made before tiers), else Standard.
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
