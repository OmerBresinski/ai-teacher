import { z } from "zod";
import { guarded } from "./identifier-guard";

/*
 * Class context (ADR 0024 §2; F01 "Definition of done"; F02 PRD reduced to this). Class-level
 * facts about the group a lesson is for, never about an individual: a size band, needs as counts
 * per category, what the class already knows, and notes. Every field is optional so generation
 * proceeds when the context is absent; the object is strict so a `roster` or `names` key can never
 * be smuggled in; every free-text field is refined by the Identifier guard.
 */

export const SIZE_BANDS = ["under15", "15to24", "25to30", "over30"] as const;
export type SizeBand = (typeof SIZE_BANDS)[number];

/**
 * Need categories, from the F02 PRD vocabulary: SEND, EAL, higher and lower attaining, and a
 * catch-all. Counts only — no field holds who they are. Renaming is a data edit, not a schema
 * version bump.
 */
export const NEED_CATEGORIES = [
  "send",
  "eal",
  "higherAttaining",
  "lowerAttaining",
  "other",
] as const;
export type NeedCategory = (typeof NEED_CATEGORIES)[number];

export const CLASS_CONTEXT_TEXT_MAX = 1000;

export type ClassContext = {
  sizeBand?: SizeBand;
  /** Number of pupils in each category; a missing category means none reported. */
  needs?: Partial<Record<NeedCategory, number>>;
  /** What the class already knows about the topic. */
  priorKnowledge?: string;
  notes?: string;
};

export const SizeBandSchema = z.enum(SIZE_BANDS);
export const NeedCategorySchema = z.enum(NEED_CATEGORIES);

export const ClassContextSchema = z.strictObject({
  sizeBand: SizeBandSchema.optional(),
  needs: z.partialRecord(NeedCategorySchema, z.number().int().nonnegative()).optional(),
  priorKnowledge: guarded(z.string().max(CLASS_CONTEXT_TEXT_MAX)).optional(),
  notes: guarded(z.string().max(CLASS_CONTEXT_TEXT_MAX)).optional(),
});
