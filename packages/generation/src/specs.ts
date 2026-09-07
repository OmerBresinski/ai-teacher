import {
  type FactId,
  FindingSchema,
  GENERATABLE_SLIDE_KINDS,
  type LessonFacts,
  LessonFactsSchema,
} from "@tj/domain/documents";
import { BlockSpecSchema, SlideSpecSchema, SPEC_LIMITS } from "@tj/slides";
import { z } from "zod";

/*
 * What each stage asks the model for (ADR 0025 §8, §11, §12, §14). Content only — the model
 * never sees an id it did not receive, and never produces geometry. `SlideSpecSchema` and
 * `BlockSpecSchema` are `@tj/slides`' and are re-exported so a prompt and its materialiser agree.
 */

export { BlockSpecSchema, SlideSpecSchema };

const line = (max: number) => z.string().trim().min(1).max(max);

/* ------------------------------------------------------------------ */
/* Plan                                                                */
/* ------------------------------------------------------------------ */

/** The fact lists a model may refer to from the outline, by ordinal. */
export const FACT_LIST_TYPES = ["objective", "vocabulary", "workedExample", "question"] as const;
export type FactListType = (typeof FACT_LIST_TYPES)[number];

/** An ordinal reference into one of the fact lists: `{ type: "objective", index: 0 }`. */
export const OrdinalRefSchema = z.strictObject({
  type: z.enum(FACT_LIST_TYPES),
  index: z.number().int().nonnegative(),
});
export type OrdinalRef = z.infer<typeof OrdinalRefSchema>;

/**
 * `LessonFacts` without ids: the model gives ordered lists and refers to them by position;
 * `assignFactIds` mints the stable ids (ADR 0025 §1). Bounds keep one call inside its token cap.
 */
export const PlanOutputSchema = z
  .strictObject({
    objectives: z
      .array(z.strictObject({ text: line(SPEC_LIMITS.item) }))
      .min(1)
      .max(4),
    vocabulary: z
      .array(
        z.strictObject({
          term: line(SPEC_LIMITS.term),
          definition: line(SPEC_LIMITS.definition),
        }),
      )
      .max(8),
    workedExamples: z
      .array(
        z.strictObject({
          problem: line(SPEC_LIMITS.body),
          steps: z.array(line(SPEC_LIMITS.item)).min(1).max(6),
          answer: line(SPEC_LIMITS.answer),
        }),
      )
      .max(3),
    questions: z
      .array(
        z.strictObject({
          stem: line(SPEC_LIMITS.stem),
          answer: line(SPEC_LIMITS.answer),
          reasoning: line(SPEC_LIMITS.body),
        }),
      )
      .max(8),
    outline: z
      .array(
        z.strictObject({
          kind: z.enum(GENERATABLE_SLIDE_KINDS),
          minutes: z.number().int().min(1),
          factRefs: z.array(OrdinalRefSchema),
        }),
      )
      .min(2)
      .max(16),
  })
  .superRefine((plan, ctx) => {
    // Every ordinal must land inside its list, and the deck must open with the two slides Plan
    // materialises itself (ADR 0025 §7).
    const sizes: Record<FactListType, number> = {
      objective: plan.objectives.length,
      vocabulary: plan.vocabulary.length,
      workedExample: plan.workedExamples.length,
      question: plan.questions.length,
    };
    plan.outline.forEach((entry, i) => {
      entry.factRefs.forEach((ref, j) => {
        if (ref.index >= sizes[ref.type]) {
          ctx.addIssue({
            code: "custom",
            message: `${ref.type} index ${ref.index} is out of range (${sizes[ref.type]} given)`,
            path: ["outline", i, "factRefs", j, "index"],
          });
        }
      });
    });
    if (plan.outline[0]?.kind !== "title" || plan.outline[1]?.kind !== "objectives") {
      ctx.addIssue({
        code: "custom",
        message: 'The outline starts with a "title" slide then an "objectives" slide.',
        path: ["outline"],
      });
    }
  });
export type PlanOutput = z.infer<typeof PlanOutputSchema>;

/** The id prefix each fact list gets (ADR 0025 §1: `o1`, `v3`, `x1`, `q2`, `m1`, `s4`). */
const ID_PREFIX: Record<FactListType | "misconception" | "outline", string> = {
  objective: "o",
  vocabulary: "v",
  workedExample: "x",
  question: "q",
  misconception: "m",
  outline: "s",
};

/**
 * Mint the stable fact ids and rewrite the outline's ordinal references to them. Pure; the
 * result validates against `LessonFactsSchema` (asserted here so a bug fails loudly, not later).
 */
export function assignFactIds(plan: PlanOutput, durationMin: number): LessonFacts {
  const id = (type: keyof typeof ID_PREFIX, index: number): FactId =>
    `${ID_PREFIX[type]}${index + 1}`;
  return LessonFactsSchema.parse({
    objectives: plan.objectives.map((o, i) => ({ id: id("objective", i), ...o })),
    vocabulary: plan.vocabulary.map((v, i) => ({ id: id("vocabulary", i), ...v })),
    workedExamples: plan.workedExamples.map((x, i) => ({ id: id("workedExample", i), ...x })),
    questions: plan.questions.map((q, i) => ({ id: id("question", i), ...q })),
    misconceptions: [],
    outline: plan.outline.map((entry, i) => ({
      id: id("outline", i),
      kind: entry.kind,
      minutes: entry.minutes,
      factRefs: entry.factRefs.map((ref) => id(ref.type, ref.index)),
    })),
    durationMin,
  });
}

/* ------------------------------------------------------------------ */
/* Generate — worksheet                                                */
/* ------------------------------------------------------------------ */

export const WorksheetSpecSchema = z.strictObject({
  title: line(SPEC_LIMITS.title),
  /** The objective line under the title ("I can …"). */
  subtitle: line(SPEC_LIMITS.heading).optional(),
  /** Success criteria; the worksheet header shows at most four. */
  criteria: z.array(line(SPEC_LIMITS.item)).max(4),
  // The prompt asks for 4–10; the schema allows two more so an eleventh block is not a retry.
  blocks: z.array(BlockSpecSchema).min(4).max(12),
});
export type WorksheetSpec = z.infer<typeof WorksheetSpecSchema>;

/* ------------------------------------------------------------------ */
/* Evaluate / Repair                                                   */
/* ------------------------------------------------------------------ */

export const EvaluateOutputSchema = z.strictObject({
  findings: z.array(FindingSchema).max(20),
});
export type EvaluateOutput = z.infer<typeof EvaluateOutputSchema>;

/** Repair asks for the same spec the target was generated from, one target at a time. */
export const RepairSlideOutputSchema = SlideSpecSchema;
export const RepairBlockOutputSchema = BlockSpecSchema;
