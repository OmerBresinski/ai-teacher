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

const outlineEntry = z.strictObject({
  kind: z.enum(GENERATABLE_SLIDE_KINDS),
  minutes: z.number().int().min(1),
  factRefs: z.array(OrdinalRefSchema),
});

/** Which fact lists an outline entry may refer to, checked against the lists actually given. */
function refineOutlineRefs(
  ctx: z.RefinementCtx,
  path: (string | number)[],
  refs: OrdinalRef[],
  sizes: Partial<Record<FactListType, number>>,
) {
  refs.forEach((ref, j) => {
    const size = sizes[ref.type];
    if (size === undefined) {
      ctx.addIssue({
        code: "custom",
        message: `only ${Object.keys(sizes).join(", ")} references are allowed here`,
        path: [...path, j, "type"],
      });
    } else if (ref.index >= size) {
      ctx.addIssue({
        code: "custom",
        message: `${ref.type} index ${ref.index} is out of range (${size} given)`,
        path: [...path, j, "index"],
      });
    }
  });
}

/**
 * Plan's first call (ADR 0025 §7, TEACH-138): the objectives and the outline, so the objectives
 * slide can be shown while the rest of the facts are still being written. The other fact lists
 * do not exist yet, so the outline may refer to objectives only; the facts call adds the rest.
 */
export const PlanSkeletonSchema = z
  .strictObject({
    objectives: z
      .array(z.strictObject({ text: line(SPEC_LIMITS.item) }))
      .min(1)
      .max(4),
    outline: z.array(outlineEntry).min(2).max(16),
  })
  .superRefine((skeleton, ctx) => {
    skeleton.outline.forEach((entry, i) => {
      refineOutlineRefs(ctx, ["outline", i, "factRefs"], entry.factRefs, {
        objective: skeleton.objectives.length,
      });
    });
    // The deck opens with the two slides Plan materialises itself (ADR 0025 §7).
    if (skeleton.outline[0]?.kind !== "title" || skeleton.outline[1]?.kind !== "objectives") {
      ctx.addIssue({
        code: "custom",
        message: 'The outline starts with a "title" slide then an "objectives" slide.',
        path: ["outline"],
      });
    }
  });
export type PlanSkeleton = z.infer<typeof PlanSkeletonSchema>;

/**
 * Plan's second call: the remaining fact lists, kept lean so the call stays short (`reasoning` a
 * footnote, at most four steps, six terms), plus the vocabulary / worked-example / question
 * references each outline entry draws on. `planFactsSchemaFor(skeleton)` adds the range checks
 * that need the skeleton; this is the shape.
 */
const PlanFactsShape = z.strictObject({
  vocabulary: z
    .array(
      z.strictObject({
        term: line(SPEC_LIMITS.term),
        definition: line(SPEC_LIMITS.definition),
      }),
    )
    .max(6),
  workedExamples: z
    .array(
      z.strictObject({
        problem: line(SPEC_LIMITS.body),
        steps: z.array(line(SPEC_LIMITS.item)).min(1).max(4),
        answer: line(SPEC_LIMITS.answer),
      }),
    )
    .max(3),
  questions: z
    .array(
      z.strictObject({
        stem: line(SPEC_LIMITS.stem),
        answer: line(SPEC_LIMITS.answer),
        reasoning: line(SPEC_LIMITS.footnote),
      }),
    )
    .max(8),
  /** Per outline entry (by position), the facts from these lists it covers. */
  outlineFactRefs: z
    .array(
      z.strictObject({
        index: z.number().int().nonnegative(),
        factRefs: z.array(OrdinalRefSchema),
      }),
    )
    .max(16),
});
export type PlanFacts = z.infer<typeof PlanFactsShape>;

/** What the intermediate persist after the skeleton call carries: the lists still to come. */
export const EMPTY_PLAN_FACTS: PlanFacts = {
  vocabulary: [],
  workedExamples: [],
  questions: [],
  outlineFactRefs: [],
};

/** The facts schema for one skeleton: every reference lands inside its list and its outline. */
export function planFactsSchemaFor(skeleton: PlanSkeleton): z.ZodType<PlanFacts> {
  return PlanFactsShape.superRefine((facts, ctx) => {
    const sizes = {
      objective: skeleton.objectives.length,
      vocabulary: facts.vocabulary.length,
      workedExample: facts.workedExamples.length,
      question: facts.questions.length,
    };
    facts.outlineFactRefs.forEach((entry, i) => {
      if (entry.index >= skeleton.outline.length) {
        ctx.addIssue({
          code: "custom",
          message: `outline index ${entry.index} is out of range (${skeleton.outline.length} entries)`,
          path: ["outlineFactRefs", i, "index"],
        });
      }
      refineOutlineRefs(ctx, ["outlineFactRefs", i, "factRefs"], entry.factRefs, sizes);
    });
  });
}

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
 * Merge the skeleton and the facts, mint the stable fact ids and rewrite the outline's ordinal
 * references to them. Pure; the result validates against `LessonFactsSchema` (asserted here so a
 * bug fails loudly, not later). With `EMPTY_PLAN_FACTS` it yields the skeleton-only facts the
 * objectives slide is built from.
 */
export function assignFactIds(
  skeleton: PlanSkeleton,
  facts: PlanFacts,
  durationMin: number,
): LessonFacts {
  const id = (type: keyof typeof ID_PREFIX, index: number): FactId =>
    `${ID_PREFIX[type]}${index + 1}`;
  const added = new Map<number, OrdinalRef[]>();
  for (const entry of facts.outlineFactRefs)
    added.set(entry.index, [...(added.get(entry.index) ?? []), ...entry.factRefs]);
  return LessonFactsSchema.parse({
    objectives: skeleton.objectives.map((o, i) => ({ id: id("objective", i), ...o })),
    vocabulary: facts.vocabulary.map((v, i) => ({ id: id("vocabulary", i), ...v })),
    workedExamples: facts.workedExamples.map((x, i) => ({ id: id("workedExample", i), ...x })),
    questions: facts.questions.map((q, i) => ({ id: id("question", i), ...q })),
    misconceptions: [],
    outline: skeleton.outline.map((entry, i) => ({
      id: id("outline", i),
      kind: entry.kind,
      minutes: entry.minutes,
      factRefs: dedupe(
        [...entry.factRefs, ...(added.get(i) ?? [])].map((ref) => id(ref.type, ref.index)),
      ),
    })),
    durationMin,
  });
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
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
