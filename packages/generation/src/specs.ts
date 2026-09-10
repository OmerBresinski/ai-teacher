import {
  type FactArray,
  type FactId,
  FactIdSchema,
  FindingSeveritySchema,
  FindingTargetSchema,
  GENERATABLE_SLIDE_KINDS,
  IMAGE_PURPOSES,
  isFactIdOf,
  LESSON_PHASES,
  type LessonFacts,
  LessonFactsSchema,
  QUESTION_TIERS,
  QUESTION_USES,
} from "@tj/domain/documents";
import { BlockSpecSchema, noPictureReference, SlideSpecSchema, SPEC_LIMITS } from "@tj/slides";
import { z } from "zod";
import { INPUT_CHECKS } from "./types";

/*
 * What each stage asks the model for (ADR 0025 §8, §11, §12, §14). Content only — the model
 * never sees an id it did not receive, and never produces geometry. `SlideSpecSchema` and
 * `BlockSpecSchema` are `@tj/slides`' and are re-exported so a prompt and its materialiser agree.
 */

export { BlockSpecSchema, SlideSpecSchema };

const line = (max: number) => z.string().trim().min(1).max(max);

/* ------------------------------------------------------------------ */
/* Check input                                                         */
/* ------------------------------------------------------------------ */

/**
 * The `Finding` shape, narrowed: a fixed `check`, always an `error`, no target (the finding is
 * about the brief, not a slide) and a message the teacher reads. The model never echoes the text
 * it objected to — the message names the problem, not the words.
 */
export const InputFindingSchema = z.strictObject({
  check: z.enum(INPUT_CHECKS),
  severity: z.literal("error"),
  target: z.strictObject({}),
  message: line(SPEC_LIMITS.body),
});
export const CheckInputOutputSchema = z.strictObject({
  findings: z.array(InputFindingSchema).max(3),
});
export type CheckInputOutput = z.infer<typeof CheckInputOutputSchema>;

/* ------------------------------------------------------------------ */
/* Plan                                                                */
/* ------------------------------------------------------------------ */

/** The fact lists a model may refer to from the outline, by ordinal. */
export const FACT_LIST_TYPES = [
  "objective",
  "keyIdea",
  "vocabulary",
  "workedExample",
  "question",
  "misconception",
] as const;
export type FactListType = (typeof FACT_LIST_TYPES)[number];

/** An ordinal reference into one of the fact lists: `{ type: "objective", index: 0 }`. */
export const OrdinalRefSchema = z.strictObject({
  type: z.enum(FACT_LIST_TYPES),
  index: z.number().int().nonnegative(),
});
export type OrdinalRef = z.infer<typeof OrdinalRefSchema>;

/**
 * The picture brief as Plan writes it (Generation quality §4): the list form is required here,
 * where the stored schema still accepts the older string for lessons written before it.
 */
const PlanImageBriefSchema = z.strictObject({
  subject: line(60),
  mustShow: z.array(line(40)).min(1).max(4),
  purpose: z.enum(IMAGE_PURPOSES),
  avoid: z.array(line(40)).max(3).optional(),
});

const OutlineBriefSpec = z.strictObject({
  adds: line(SPEC_LIMITS.item),
  avoids: line(SPEC_LIMITS.item).optional(),
});

const outlineEntry = z.strictObject({
  kind: z.enum(GENERATABLE_SLIDE_KINDS),
  minutes: z.number().int().min(1),
  factRefs: z.array(OrdinalRefSchema),
  imageBrief: PlanImageBriefSchema.optional(),
  /** Required from position 2 (checked in the skeleton's refinement, so the message can say so). */
  brief: OutlineBriefSpec.optional(),
  phase: z.enum(LESSON_PHASES).optional(),
});

/** The share of a lesson that must explain (content, worked example, picture): 30 %. */
export const EXPLAIN_SHARE_MIN_PERCENT = 30;
/** The kinds that explain; the same set `checkLesson`'s `explanation-share` counts. */
const EXPLAIN_KINDS: ReadonlySet<string> = new Set(["content", "worked-example", "image-text"]);
/** The fewest questions of each tier a plan gives (the prompt asks for 4 / 5 / 3). */
const TIER_MINIMUMS = { easy: 3, core: 3, stretch: 2 } as const;
/** The brief answer that asks for an explain slide per objective (`brief-questions.ts`). */
export const PRIOR_CONFIDENCE_KEY = "priorConfidence";
export const PRIOR_CONFIDENCE_NEW = "New to it";
const PHASE_ORDER: Record<(typeof LESSON_PHASES)[number], number> = {
  starter: 0,
  explain: 1,
  practise: 2,
  check: 3,
};

/** Which fact lists an outline entry may refer to, checked against the lists actually given. */
function refineOutlineRefs(
  ctx: z.RefinementCtx,
  path: (string | number)[],
  refs: OrdinalRef[],
  sizes: Partial<Record<FactListType, number>>,
) {
  refs.forEach((ref, j) => {
    refineRef(ctx, [...path, j], ref, sizes);
  });
}

/** One ordinal reference must name an allowed list and land inside it. */
function refineRef(
  ctx: z.RefinementCtx,
  path: (string | number)[],
  ref: OrdinalRef,
  sizes: Partial<Record<FactListType, number>>,
) {
  const size = sizes[ref.type];
  if (size === undefined) {
    ctx.addIssue({
      code: "custom",
      message: `only ${Object.keys(sizes).join(", ")} references are allowed here`,
      path: [...path, "type"],
    });
  } else if (ref.index >= size) {
    ctx.addIssue({
      code: "custom",
      message: `${ref.type} index ${ref.index} is out of range (${size} given)`,
      path: [...path, "index"],
    });
  }
}

const PlanSkeletonShape = z.strictObject({
  // Not `objectives`: with that key first, Sonnet 5 behind Bedrock's `json` tool returns the
  // whole answer as a string under it (reproduced 12/12 on 2026-09-07); `learningObjectives`,
  // like the five-key schema before it, does not.
  learningObjectives: z
    .array(z.strictObject({ text: line(SPEC_LIMITS.item) }))
    .min(1)
    .max(4),
  outline: z.array(outlineEntry).min(2).max(16),
});

/** What the skeleton's refinements need from the brief. */
export type PlanSkeletonContext = {
  durationMin: number;
  /** The teacher's clarifying answers; `priorConfidence: "New to it"` asks for one explain slide per objective. */
  answers?: Record<string, string> | undefined;
};

/**
 * Plan's first call (ADR 0025 §7, TEACH-138; Generation quality §2, TEACH-211): the objectives
 * and the outline, so the objectives slide can be shown while the rest of the facts are still
 * being written. The other fact lists do not exist yet, so the outline may refer to objectives
 * only; the facts call adds the rest. The outline is a lesson that teaches before it tests: a
 * `phase` on every entry after the two Plan materialises itself, in order starter → explain →
 * practise → check, with explain minutes at least 30 % of the lesson, and a `brief` saying what
 * each slide adds. Every message here is what the retry shows the model.
 */
export function planSkeletonSchemaFor(context: PlanSkeletonContext): z.ZodType<PlanSkeleton> {
  return PlanSkeletonShape.superRefine((skeleton, ctx) => {
    const issue = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: "custom", message, path });
    skeleton.outline.forEach((entry, i) => {
      refineOutlineRefs(ctx, ["outline", i, "factRefs"], entry.factRefs, {
        objective: skeleton.learningObjectives.length,
      });
      // The picture brief rides exactly on picture slides: illustrate reads it, nothing else does.
      if (entry.kind === "image-text" && entry.imageBrief === undefined) {
        issue("image-text entries carry an imageBrief", ["outline", i, "imageBrief"]);
      }
      if (entry.kind !== "image-text" && entry.imageBrief !== undefined) {
        issue("imageBrief is only allowed on image-text entries", ["outline", i, "imageBrief"]);
      }
      if (i >= 2) {
        if (entry.brief === undefined) {
          issue(
            `Outline position ${i} needs a brief: "adds" says what this slide contributes that no other slide does.`,
            ["outline", i, "brief"],
          );
        }
        if (entry.phase === undefined) {
          issue(`Outline position ${i} needs a phase: starter, explain, practise or check.`, [
            "outline",
            i,
            "phase",
          ]);
        }
      } else if (entry.phase !== undefined || entry.brief !== undefined) {
        issue("The title and objectives slides carry no phase or brief.", ["outline", i]);
      }
    });
    // The deck opens with the two slides Plan materialises itself (ADR 0025 §7).
    if (skeleton.outline[0]?.kind !== "title" || skeleton.outline[1]?.kind !== "objectives") {
      issue('The outline starts with a "title" slide then an "objectives" slide.', ["outline"]);
    }
    // Phases run starter → explain → practise → check and never go back.
    let last = -1;
    let lastPhase: string | undefined;
    let explainMinutes = 0;
    const phases = new Set<string>();
    skeleton.outline.forEach((entry, i) => {
      if (entry.phase === undefined) return;
      phases.add(entry.phase);
      // Only slides that teach count towards the explain share — the same kinds `checkLesson`
      // counts — so a vocabulary or question slide tagged "explain" does not pad it.
      if (entry.phase === "explain" && EXPLAIN_KINDS.has(entry.kind)) {
        explainMinutes += entry.minutes;
      }
      if (entry.phase === "explain" && !EXPLAIN_KINDS.has(entry.kind)) {
        issue(
          `Outline position ${i} is a ${entry.kind} slide in the explain phase; explain slides are content, worked-example or image-text. Give it the phase it belongs to, or change its kind.`,
          ["outline", i, "phase"],
        );
      }
      const rank = PHASE_ORDER[entry.phase];
      if (rank < last) {
        issue(
          `Outline position ${i} is a "${entry.phase}" slide but position ${i - 1} is already "${lastPhase}"; phases run starter, explain, practise, check and never go back. Move this slide before the first "${lastPhase}" slide, or give it the phase "${lastPhase}".`,
          ["outline", i, "phase"],
        );
      }
      last = Math.max(last, rank);
      lastPhase = entry.phase;
    });
    for (const needed of ["explain", "practise", "check"] as const) {
      if (!phases.has(needed)) {
        issue(`The lesson needs at least one "${needed}" slide.`, ["outline"]);
      }
    }
    const minExplain = Math.ceil((context.durationMin * EXPLAIN_SHARE_MIN_PERCENT) / 100);
    if (explainMinutes < minExplain) {
      issue(
        `The explain phase needs at least ${minExplain} minutes (${EXPLAIN_SHARE_MIN_PERCENT}% of ${context.durationMin}); it has ${explainMinutes}. Add or lengthen content, worked-example or image-text slides.`,
        ["outline"],
      );
    }
    // A class new to the topic gets a content or worked-example slide for every objective.
    if (context.answers?.[PRIOR_CONFIDENCE_KEY] === PRIOR_CONFIDENCE_NEW) {
      const explained = new Set<number>();
      for (const entry of skeleton.outline) {
        if (entry.kind !== "content" && entry.kind !== "worked-example") continue;
        for (const ref of entry.factRefs) if (ref.type === "objective") explained.add(ref.index);
      }
      skeleton.learningObjectives.forEach((_, i) => {
        if (!explained.has(i)) {
          issue(
            `The class is new to this: objective ${i} needs a content or worked-example slide that names it.`,
            ["outline"],
          );
        }
      });
    }
  });
}

/**
 * The skeleton shape without the brief-dependent refinements: for tests and the resume path,
 * which parse a skeleton the pipeline has already accepted once.
 */
export const PlanSkeletonSchema = planSkeletonSchemaFor({ durationMin: 1 });
export type PlanSkeleton = z.infer<typeof PlanSkeletonShape>;

/**
 * Plan's second call: the remaining fact lists, kept lean so the call stays short (`reasoning` a
 * footnote, at most four steps, six terms), plus the vocabulary / worked-example / question
 * references each outline entry draws on. `planFactsSchemaFor(skeleton)` adds the range checks
 * that need the skeleton; this is the shape.
 */
/** An ordinal reference that must name an objective (`assignFactIds` resolves it to `o<n>`). */
const ObjectiveOrdinalSchema = z.strictObject({
  type: z.literal("objective"),
  index: z.number().int().nonnegative(),
});
/** An ordinal reference that must name a misconception (resolved to `m<n>`). */
const MisconceptionOrdinalSchema = z.strictObject({
  type: z.literal("misconception"),
  index: z.number().int().nonnegative(),
});

const PlanFactsShape = z.strictObject({
  /**
   * The richer facts (Generation quality §1; TEACH-209 shape, TEACH-211 asks for them): key
   * ideas first, then misconceptions, then vocabulary, worked examples and at least twelve
   * tiered questions, then the pitch and the outline references. Order matters to the model —
   * every ordinal it writes must already exist.
   */
  keyIdeas: z
    .array(
      z.strictObject({
        statement: line(SPEC_LIMITS.item),
        explanation: line(SPEC_LIMITS.body),
        example: line(SPEC_LIMITS.body),
        analogy: line(SPEC_LIMITS.item).optional(),
        objectiveRefs: z.array(ObjectiveOrdinalSchema).min(1),
      }),
    )
    // The prompt asks for 2–5; the floor is 1 because a narrow lesson (an EYFS phonics sound) has
    // one honest key idea, and Terra held to one through the retry on the first paid run.
    .min(1, "Give at least one key idea: what a pupil must understand, explained with an example.")
    .max(5),
  misconceptions: z
    .array(
      z.strictObject({
        belief: line(SPEC_LIMITS.item),
        correction: line(SPEC_LIMITS.body),
        objectiveRefs: z.array(ObjectiveOrdinalSchema).min(1),
      }),
    )
    .min(
      2,
      "Give at least 2 misconceptions: what pupils at this level typically get wrong, with the correction.",
    )
    .max(4),
  vocabulary: z
    .array(
      z.strictObject({
        term: line(SPEC_LIMITS.term),
        definition: line(SPEC_LIMITS.definition),
        objectiveRefs: z.array(ObjectiveOrdinalSchema).min(1),
      }),
    )
    .max(8),
  workedExamples: z
    .array(
      z.strictObject({
        problem: line(SPEC_LIMITS.body),
        steps: z.array(line(SPEC_LIMITS.item)).min(1).max(6),
        answer: line(SPEC_LIMITS.answer),
        misconceptionRef: MisconceptionOrdinalSchema.optional(),
      }),
    )
    .max(4),
  questions: z
    .array(
      z.strictObject({
        stem: line(SPEC_LIMITS.stem),
        answer: line(SPEC_LIMITS.answer),
        reasoning: line(SPEC_LIMITS.footnote),
        tier: z.enum(QUESTION_TIERS),
        use: z.enum(QUESTION_USES),
        objectiveRefs: z.array(ObjectiveOrdinalSchema).min(1),
        distractors: z
          .array(
            z.strictObject({
              text: line(SPEC_LIMITS.option),
              misconceptionRef: MisconceptionOrdinalSchema.optional(),
            }),
          )
          .max(3)
          .optional(),
      }),
    )
    .min(
      12,
      "Give at least 12 questions: four easy, five core, three stretch, each tagged with a use.",
    )
    .max(20),
  pitch: z.strictObject({
    readingAgeTarget: z.number().int().min(5).max(18),
    sentenceLengthMax: z.number().int().min(6).max(30),
    avoid: z.array(line(SPEC_LIMITS.word)).max(6),
  }),
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
/**
 * What `assignFactIds` merges: the facts call's answer, or the skeleton-only stand-in below, which
 * has no pitch yet (a lesson's facts are `pitch`-less until the facts call lands).
 */
export type PlanFactsLike = Omit<PlanFacts, "pitch"> & { pitch?: PlanFacts["pitch"] | undefined };

export const EMPTY_PLAN_FACTS: PlanFactsLike = {
  keyIdeas: [],
  misconceptions: [],
  vocabulary: [],
  workedExamples: [],
  questions: [],
  outlineFactRefs: [],
};

/** The first outline positions Plan materialises itself; the facts call may not touch them. */
const FIRST_FACT_SLIDE = 2;

/**
 * The facts schema for one skeleton: every reference lands inside its list, every outline
 * position exists and is one of the slides the facts feed (not `title` / `objectives`, whose
 * objective references the skeleton fixed), and only the three lists this call produces may be
 * referenced — the objectives are already wired by the skeleton.
 */
export function planFactsSchemaFor(skeleton: PlanSkeleton): z.ZodType<PlanFacts> {
  return PlanFactsShape.superRefine((facts, ctx) => {
    const sizes = {
      keyIdea: facts.keyIdeas.length,
      vocabulary: facts.vocabulary.length,
      workedExample: facts.workedExamples.length,
      question: facts.questions.length,
      misconception: facts.misconceptions.length,
    };
    // A fact's own links: objectives are the skeleton's, misconceptions this call's.
    const objectives = { objective: skeleton.learningObjectives.length };
    const misconceptions = { misconception: sizes.misconception };
    for (const key of ["keyIdeas", "misconceptions", "vocabulary", "questions"] as const) {
      facts[key].forEach((fact, i) => {
        refineOutlineRefs(ctx, [key, i, "objectiveRefs"], fact.objectiveRefs, objectives);
      });
    }
    facts.workedExamples.forEach((x, i) => {
      if (x.misconceptionRef) {
        refineRef(
          ctx,
          ["workedExamples", i, "misconceptionRef"],
          x.misconceptionRef,
          misconceptions,
        );
      }
    });
    facts.questions.forEach((q, i) => {
      q.distractors?.forEach((d, j) => {
        if (d.misconceptionRef) {
          refineRef(
            ctx,
            ["questions", i, "distractors", j, "misconceptionRef"],
            d.misconceptionRef,
            misconceptions,
          );
        }
      });
    });
    facts.outlineFactRefs.forEach((entry, i) => {
      if (entry.index < FIRST_FACT_SLIDE || entry.index >= skeleton.outline.length) {
        ctx.addIssue({
          code: "custom",
          message: `outline index ${entry.index} is out of range (positions ${FIRST_FACT_SLIDE}–${skeleton.outline.length - 1} take facts)`,
          path: ["outlineFactRefs", i, "index"],
        });
      }
      refineOutlineRefs(ctx, ["outlineFactRefs", i, "factRefs"], entry.factRefs, sizes);
    });
    // Every objective is served by a key idea and checked by a question (the prompt's rule; the
    // objectives slide alone does not teach it).
    const served = new Set<number>();
    const checked = new Set<number>();
    for (const k of facts.keyIdeas) for (const ref of k.objectiveRefs) served.add(ref.index);
    for (const q of facts.questions) for (const ref of q.objectiveRefs) checked.add(ref.index);
    skeleton.learningObjectives.forEach((_, i) => {
      if (!served.has(i)) {
        ctx.addIssue({
          code: "custom",
          message: `Objective ${i} is served by no key idea; add one with { "type": "objective", "index": ${i} } in its objectiveRefs, or add the objective to an existing key idea.`,
          path: ["keyIdeas"],
        });
      }
      if (!checked.has(i)) {
        ctx.addIssue({
          code: "custom",
          message: `Objective ${i} is checked by no question; give at least one question objectiveRefs that include index ${i}.`,
          path: ["questions"],
        });
      }
    });
    // Three tiers, each present in numbers a sheet and an exit ticket can draw on.
    const tiers = { easy: 0, core: 0, stretch: 0 };
    for (const q of facts.questions) tiers[q.tier] += 1;
    for (const tier of ["easy", "core", "stretch"] as const) {
      if (tiers[tier] < TIER_MINIMUMS[tier]) {
        ctx.addIssue({
          code: "custom",
          message: `Only ${tiers[tier]} "${tier}" questions; give at least ${TIER_MINIMUMS[tier]} (the target is four easy, five core, three stretch).`,
          path: ["questions"],
        });
      }
    }
    // Kind fit: a content slide is built from a key idea, a worked-example slide from a worked
    // example. Both refs may also come from the skeleton, but the skeleton could only name
    // objectives, so they have to be given here.
    const given = new Map<number, Set<FactListType>>();
    for (const entry of facts.outlineFactRefs) {
      const types = given.get(entry.index) ?? new Set<FactListType>();
      for (const ref of entry.factRefs) types.add(ref.type);
      given.set(entry.index, types);
    }
    skeleton.outline.forEach((entry, i) => {
      const needs: FactListType | undefined =
        entry.kind === "content"
          ? "keyIdea"
          : entry.kind === "worked-example"
            ? "workedExample"
            : undefined;
      if (needs && !given.get(i)?.has(needs)) {
        ctx.addIssue({
          code: "custom",
          message: `Outline position ${i} is a ${entry.kind} slide and needs at least one ${needs} reference in outlineFactRefs.`,
          path: ["outlineFactRefs"],
        });
      }
    });
  });
}

/** The id prefix each fact list gets (ADR 0025 §1: `o1`, `k1`, `v3`, `x1`, `q2`, `m1`, `s4`). */
const ID_PREFIX: Record<FactListType | "outline", string> = {
  objective: "o",
  keyIdea: "k",
  vocabulary: "v",
  workedExample: "x",
  question: "q",
  misconception: "m",
  outline: "s",
};

/**
 * Merge the skeleton and the facts, mint the stable fact ids and rewrite every ordinal reference
 * (the outline's `factRefs`, each fact's `objectiveRefs` / `misconceptionRef`) to them. Pure; the
 * result validates against `LessonFactsSchema` (asserted here so a bug fails loudly, not later).
 * With `EMPTY_PLAN_FACTS` it yields the skeleton-only facts the objectives slide is built from.
 * A list or field the facts call did not produce is left out, never written empty.
 */
export function assignFactIds(
  skeleton: PlanSkeleton,
  facts: PlanFactsLike,
  durationMin: number,
): LessonFacts {
  const id = (type: keyof typeof ID_PREFIX, index: number): FactId =>
    `${ID_PREFIX[type]}${index + 1}`;
  const refId = (ref: OrdinalRef): FactId => id(ref.type, ref.index);
  const objectiveRefs = (refs: OrdinalRef[] | undefined) =>
    refs === undefined ? {} : { objectiveRefs: dedupe(refs.map(refId)) };
  const misconceptionRef = (ref: OrdinalRef | undefined) =>
    ref === undefined ? {} : { misconceptionRef: refId(ref) };
  const optional = <K extends string, V>(key: K, value: V | undefined) =>
    value === undefined ? {} : ({ [key]: value } as Record<K, V>);
  const added = new Map<number, OrdinalRef[]>();
  for (const entry of facts.outlineFactRefs)
    added.set(entry.index, [...(added.get(entry.index) ?? []), ...entry.factRefs]);
  return LessonFactsSchema.parse({
    objectives: skeleton.learningObjectives.map((o, i) => ({ id: id("objective", i), ...o })),
    ...optional(
      "keyIdeas",
      facts.keyIdeas.length === 0
        ? undefined
        : facts.keyIdeas.map((k, i) => ({
            id: id("keyIdea", i),
            statement: k.statement,
            explanation: k.explanation,
            example: k.example,
            ...optional("analogy", k.analogy),
            objectiveRefs: dedupe(k.objectiveRefs.map(refId)),
          })),
    ),
    vocabulary: facts.vocabulary.map(({ objectiveRefs: refs, ...v }, i) => ({
      id: id("vocabulary", i),
      ...v,
      ...objectiveRefs(refs),
    })),
    workedExamples: facts.workedExamples.map(({ misconceptionRef: ref, ...x }, i) => ({
      id: id("workedExample", i),
      ...x,
      ...misconceptionRef(ref),
    })),
    questions: facts.questions.map(({ objectiveRefs: refs, distractors, use, tier, ...q }, i) => ({
      id: id("question", i),
      ...q,
      ...objectiveRefs(refs),
      ...optional(
        "distractors",
        distractors?.map((d) => ({ text: d.text, ...misconceptionRef(d.misconceptionRef) })),
      ),
      ...optional("use", use),
      ...optional("tier", tier),
    })),
    misconceptions: facts.misconceptions.map((m, i) => ({
      id: id("misconception", i),
      belief: m.belief,
      correction: m.correction,
      objectiveRefs: dedupe(m.objectiveRefs.map(refId)),
    })),
    ...optional("pitch", facts.pitch),
    outline: skeleton.outline.map((entry, i) => ({
      id: id("outline", i),
      kind: entry.kind,
      minutes: entry.minutes,
      factRefs: dedupe([...entry.factRefs, ...(added.get(i) ?? [])].map(refId)),
      ...optional("imageBrief", entry.imageBrief),
      ...optional("brief", entry.brief),
      ...optional("phase", entry.phase),
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

export const WorksheetSpecSchema = z
  .strictObject({
    title: line(SPEC_LIMITS.title),
    /** The objective line under the title ("I can …"). */
    subtitle: line(SPEC_LIMITS.heading).optional(),
    /** Success criteria; the worksheet header shows at most four. */
    criteria: z.array(line(SPEC_LIMITS.item)).max(4),
    // The prompt asks for 4–10; the schema allows two more so an eleventh block is not a retry.
    blocks: z.array(BlockSpecSchema).min(4).max(12),
  })
  // A worksheet has no photographs: no block may refer to one (TEACH-223); same rule Repair's
  // `blockSpecSchemaFor` applies, so a sheet is held to it whichever path wrote it.
  .superRefine(noPictureReference);
export type WorksheetSpec = z.infer<typeof WorksheetSpecSchema>;

/* ------------------------------------------------------------------ */
/* Evaluate / Repair                                                   */
/* ------------------------------------------------------------------ */

/**
 * Evaluate's model checks (Generation quality §4; TEACH-216): a closed set, each finding with the
 * exact text it is about, and `error` only where a pupil would be taught something wrong. `image-fit`
 * is reserved for the picture-first ticket.
 */
export const EVALUATE_CHECKS = [
  "answer-correctness",
  "fact-consistency",
  "kind-misuse",
  "repetition",
  "pitch",
  "notes-quality",
  "image-fit",
] as const;
export type EvaluateCheck = (typeof EVALUATE_CHECKS)[number];
/** The checks that may carry `severity: "error"`. */
export const EVALUATE_ERROR_CHECKS: ReadonlySet<EvaluateCheck> = new Set([
  "answer-correctness",
  "fact-consistency",
]);

export const EvaluateFindingSchema = z
  .strictObject({
    check: z.enum(EVALUATE_CHECKS),
    severity: FindingSeveritySchema,
    target: FindingTargetSchema,
    message: line(SPEC_LIMITS.body),
    /** The exact span of slide or block text the finding is about; a finding without one is dropped. */
    evidence: line(SPEC_LIMITS.body),
  })
  .superRefine((finding, ctx) => {
    if (finding.severity === "error" && !EVALUATE_ERROR_CHECKS.has(finding.check)) {
      ctx.addIssue({
        code: "custom",
        message: `${finding.check} findings are warnings: only answer-correctness and fact-consistency may be errors. Set severity to "warning".`,
        path: ["severity"],
      });
    }
  });

export const EvaluateOutputSchema = z.strictObject({
  findings: z.array(EvaluateFindingSchema).max(20),
});
export type EvaluateOutput = z.infer<typeof EvaluateOutputSchema>;

/** Repair asks for the same spec the target was generated from, one target at a time. */
export const RepairSlideOutputSchema = SlideSpecSchema;
export const RepairBlockOutputSchema = BlockSpecSchema;

/* ------------------------------------------------------------------ */
/* Verify                                                              */
/* ------------------------------------------------------------------ */

/** The string fields Verify may correct, by fact kind (Generation quality, Decision 1; TEACH-212). */
export const VERIFY_FIELDS = [
  "term",
  "definition",
  "problem",
  "steps",
  "answer",
  "stem",
  "reasoning",
  "statement",
  "explanation",
  "example",
  "analogy",
  "belief",
  "correction",
] as const;
export type VerifyField = (typeof VERIFY_FIELDS)[number];

export const VERIFY_REASONS = [
  "wrong-term",
  "invented",
  "wrong-answer",
  "arithmetic",
  "false-statement",
  "off-topic",
  "ambiguous",
] as const;
export type VerifyReason = (typeof VERIFY_REASONS)[number];

/** Which fields each fact array carries, so a correction can be checked against its kind. */
export const VERIFY_FIELDS_BY_ARRAY: Record<
  Exclude<FactArray, "objectives">,
  readonly VerifyField[]
> = {
  keyIdeas: ["statement", "explanation", "example", "analogy"],
  vocabulary: ["term", "definition"],
  workedExamples: ["problem", "steps", "answer"],
  questions: ["stem", "answer", "reasoning"],
  misconceptions: ["belief", "correction"],
};

/** The cap each field's value is held to: the same limits the facts schema uses. */
export const VERIFY_LIMITS: Record<VerifyField, number> = {
  term: SPEC_LIMITS.term,
  definition: SPEC_LIMITS.definition,
  problem: SPEC_LIMITS.body,
  steps: SPEC_LIMITS.item,
  answer: SPEC_LIMITS.answer,
  stem: SPEC_LIMITS.stem,
  reasoning: SPEC_LIMITS.footnote,
  statement: SPEC_LIMITS.item,
  explanation: SPEC_LIMITS.body,
  example: SPEC_LIMITS.body,
  analogy: SPEC_LIMITS.item,
  belief: SPEC_LIMITS.item,
  correction: SPEC_LIMITS.body,
};

export const VerifyCorrectionSchema = z.strictObject({
  factId: FactIdSchema,
  field: z.enum(VERIFY_FIELDS),
  /** For `steps`: which step. */
  index: z.number().int().nonnegative().optional(),
  value: line(SPEC_LIMITS.body),
  reason: z.enum(VERIFY_REASONS),
});
export type VerifyCorrection = z.infer<typeof VerifyCorrectionSchema>;

export const VerifyOutputSchema = z.strictObject({
  corrections: z.array(VerifyCorrectionSchema).max(12),
});
export type VerifyOutput = z.infer<typeof VerifyOutputSchema>;

/** The fact array `id` was minted for, or `undefined` for an objective or an unknown id. */
export function verifiableArrayOf(id: FactId): Exclude<FactArray, "objectives"> | undefined {
  for (const key of Object.keys(VERIFY_FIELDS_BY_ARRAY) as Exclude<FactArray, "objectives">[]) {
    if (isFactIdOf(key, id)) return key;
  }
  return undefined;
}

/**
 * `VerifyOutputSchema` checked against the facts it patches: every `factId` exists and is not an
 * objective (objectives are the teacher's brief, not the model's to correct), every `field` exists
 * on that fact's kind, a `steps` correction names a step that exists, and the value fits the
 * field's own limit. Messages name the id and the field so the retry can fix them.
 */
export function verifyOutputSchemaFor(facts: LessonFacts): z.ZodType<VerifyOutput> {
  const byId = new Map<FactId, { array: Exclude<FactArray, "objectives">; steps?: number }>();
  for (const key of Object.keys(VERIFY_FIELDS_BY_ARRAY) as Exclude<FactArray, "objectives">[]) {
    for (const fact of facts[key] ?? []) {
      byId.set(fact.id, {
        array: key,
        ...("steps" in fact ? { steps: fact.steps.length } : {}),
      });
    }
  }
  return VerifyOutputSchema.superRefine((output, ctx) => {
    output.corrections.forEach((c, i) => {
      const issue = (message: string, path: (string | number)[]) =>
        ctx.addIssue({ code: "custom", message, path: ["corrections", i, ...path] });
      const fact = byId.get(c.factId);
      if (!fact) {
        issue(
          `unknown fact id ${c.factId}: correct only the facts listed, by their id (objectives cannot be changed)`,
          ["factId"],
        );
        return;
      }
      if (!VERIFY_FIELDS_BY_ARRAY[fact.array].includes(c.field)) {
        issue(
          `${c.factId} has no field "${c.field}"; its fields are ${VERIFY_FIELDS_BY_ARRAY[fact.array].join(", ")}`,
          ["field"],
        );
        return;
      }
      if (c.field === "steps") {
        if (c.index === undefined)
          issue(`a steps correction on ${c.factId} needs an index`, ["index"]);
        else if (c.index >= (fact.steps ?? 0)) {
          issue(`${c.factId} has ${fact.steps ?? 0} steps; index ${c.index} does not exist`, [
            "index",
          ]);
        }
      } else if (c.index !== undefined) {
        issue(`index is only for steps corrections`, ["index"]);
      }
      if (c.value.length > VERIFY_LIMITS[c.field]) {
        issue(`the value for ${c.field} must be at most ${VERIFY_LIMITS[c.field]} characters`, [
          "value",
        ]);
      }
    });
  });
}
