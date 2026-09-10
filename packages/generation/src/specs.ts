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
import { contentSentence, phaseOfKind } from "./prompts/shape";
import type { LessonShape, TierWeights } from "./shapes";
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
  avoid: z.array(line(40)).max(6).optional(),
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

/**
 * The kinds that teach, so may sit in the explain phase and count towards its share; the same set
 * `checkLesson`'s `explanation-share` counts. `vocabulary` is teaching, not practice (TEACH-237: a
 * "New to it" lesson must have one and must explain for 40 %, so refusing it in the explain phase
 * rejected a good outline twice in production).
 */
const EXPLAIN_KINDS: ReadonlySet<string> = new Set([
  "content",
  "worked-example",
  "image-text",
  "vocabulary",
]);
/**
 * A phase-share rule tolerates rounding (TEACH-237): the model writes whole minutes to a total
 * that is itself allowed to be ten per cent out, so a phase two minutes under its share is not a
 * Terra retry. The prompt still asks for the full share.
 */
const SHARE_TOLERANCE_MIN = 2;
/** The kinds a Recall lesson checks with when `open-response` is forbidden (the Shape sentence). */
const RETRIEVAL_KINDS = "matching, fill-gap, multiple-choice or true-false";
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
  /**
   * Whether the topic is something a camera captures (TEACH-238). Optional here because the resume
   * path rebuilds a skeleton from `LessonFacts`, which does not keep it; `refineShape` requires it
   * of a live model answer, and a "yes" without an `image-text` slide is the model contradicting
   * itself — the one picture rule the TEACH-227 test allows.
   */
  photographable: z.strictObject({ yes: z.boolean(), why: line(SPEC_LIMITS.item) }).optional(),
});

/** What the skeleton's refinements need from the brief. */
export type PlanSkeletonContext = {
  durationMin: number;
  /**
   * The lesson's shape (`lessonShapeOf`): its deterministic column becomes the refinements below.
   * Absent, only the structural rules apply (`PlanSkeletonSchema`: tests and the resume path).
   */
  shape?: LessonShape | undefined;
};

/**
 * Plan's first call (ADR 0025 §7, TEACH-138; Generation quality §2, TEACH-211; Lesson shape,
 * TEACH-229): the objectives and the outline, so the objectives slide can be shown while the rest
 * of the facts are still being written. The other fact lists do not exist yet, so the outline may
 * refer to objectives only; the facts call adds the rest. The outline is a lesson that teaches
 * before it tests: a `phase` on every entry after the two Plan materialises itself, in order
 * starter → explain → practise → check, and a `brief` saying what each slide adds; then the
 * lesson's shape — which kinds it must and must not have, what opens the explain phase, the
 * explain and practise shares — every sentence of the prompt's Shape block as one check. Every
 * message here is what the retry shows the model.
 */
/** Lower-case content words of a short phrase (stop words and plural `s` dropped). */
function contentWordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .map((w) => w.replace(/s$/, ""))
    .filter((w) => w.length > 2 && !STOP.has(w));
}
const STOP = new Set(["the", "and", "with", "close", "up", "closeup", "shot", "photo", "view"]);

/**
 * Whether `text` uses `term` as a whole word or phrase, allowing the usual English inflections
 * (`particle` → `particles`, `melt` → `melting`/`melted`, `gnaw` → `gnaws`/`gnawing`); a term
 * inside another word ("art" in "particle") does not count.
 */
export function usesTerm(text: string, term: string): boolean {
  const escaped = term
    .trim()
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+")
    .replace(/e$/, "e?");
  return new RegExp(`\\b${escaped}(?:e?s|es|ed|ing|d)?\\b`, "i").test(text);
}

/**
 * A problem or stem that leans on a picture the slide may not have: a picture noun after a
 * determiner or an "at/in/from/on" pointer ("a photo shows", "look at the diagram", "in the
 * picture", "this image"), or "shown/pictured above/below/here". A picture noun as a plain
 * subject ("why do scientists draw particle diagrams?") is not a reference to one.
 */
const PICTURE_NOUN = "(?:photo|photograph|picture|image|diagram)s?";
const PRESUMES_PICTURE = new RegExp(
  [
    `\\b(?:a|an|the|this|that|these|those|each|its)\\s+(?:\\w+\\s+)?${PICTURE_NOUN}\\b`,
    `\\b(?:at|in|from|on)\\s+${PICTURE_NOUN}\\b`,
    `\\b(?:shown|pictured|drawn)\\s+(?:above|below|here|opposite)\\b`,
  ].join("|"),
  "i",
);
const SELF_CONTAINED =
  "Problems and question stems are self-contained: never 'a photo shows', 'the diagram', 'pictured above' — name the thing and its features in words.";

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
      // mustShow lists what must be visible *in* the subject, never the subject itself
      // (TEACH-224: "rodent" cannot be seen or missed; "front teeth" can). Only an item that is
      // the subject's head noun alone — its first content word, the kind of thing — is refused:
      // "front teeth" for "rodent front teeth close-up" names a part and is exactly what the
      // list is for (production, 2026-09-10: the stricter rule failed every Plan). The judge's
      // `onSubject` answer covers the rest.
      if (entry.imageBrief) {
        const head = contentWordsOf(entry.imageBrief.subject)[0];
        entry.imageBrief.mustShow.forEach((item, j) => {
          const words = contentWordsOf(item);
          if (head !== undefined && words.length === 1 && words[0] === head) {
            issue(
              `mustShow names the subject ("${item}"); list what must be visible in it — parts and objects a camera captures.`,
              ["outline", i, "imageBrief", "mustShow", j],
            );
          }
        });
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
    const phases = new Set<string>();
    skeleton.outline.forEach((entry, i) => {
      if (entry.phase === undefined) return;
      phases.add(entry.phase);
      if (entry.phase === "explain" && !EXPLAIN_KINDS.has(entry.kind)) {
        issue(
          `Outline position ${i} is a ${entry.kind} slide in the explain phase; explain slides are content, worked-example, image-text or vocabulary. Give it the phase it belongs to, or change its kind.`,
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
    if (context.shape) refineShape(skeleton, context.shape, context.durationMin, issue);
  });
}

/**
 * The shape's deterministic column (`shapes.ts`, project "Lesson shape by objective verb") as
 * refinements, one per field, in the order the Shape block states them. Each message says what to
 * add and where. Four of the table's rows are left to the prompt on purpose, by the TEACH-227 rule
 * that a rejection must buy quality worth a Terra retry: a content brief that "mentions defining"
 * or "mentions criteria" is wording the model chooses; `requireTwoCases` and
 * `requireMisconceptionConfronted` (TEACH-237) can be met on slides a kind check cannot see.
 */
function refineShape(
  skeleton: PlanSkeleton,
  shape: LessonShape,
  durationMin: number,
  issue: (message: string, path: (string | number)[]) => void,
) {
  const outline = skeleton.outline;
  const kinds = new Set<string>(outline.map((e) => e.kind));
  const count = (kind: string) => outline.filter((e) => e.kind === kind).length;
  const minutesIn = (phase: string, only?: ReadonlySet<string>) =>
    outline
      .filter((e) => e.phase === phase && (only === undefined || only.has(e.kind)))
      .reduce((sum, e) => sum + e.minutes, 0);
  const share = (percent: number) => Math.floor((durationMin * percent) / 100);
  /** The phase's minutes are under its share by more than the tolerance: how many to add. */
  const shortBy = (minutes: number, percent: number) => {
    const missing = share(percent) - minutes;
    return missing > SHARE_TOLERANCE_MIN ? missing : 0;
  };
  const plural = (n: number) => (n === 1 ? "minute" : "minutes");

  // firstExplainKind: the explain phase opens with the definition. A vocabulary slide may come
  // first — the terms, then the definition that uses them — so the opener is the first explain
  // slide that is not vocabulary.
  const firstExplain = outline.findIndex((e) => e.phase === "explain" && e.kind !== "vocabulary");
  const opener = outline[firstExplain];
  if (shape.firstExplainKind !== null && opener && opener.kind !== shape.firstExplainKind) {
    issue(
      `Outline position ${firstExplain} is the first explain-phase slide (after any vocabulary) and is a ${opener.kind}; for this lesson it is a content slide that defines the topic and names two or three examples. Put that content slide at position ${firstExplain} and move this one after it.`,
      ["outline", firstExplain, "kind"],
    );
  }
  // requiredKinds and requireVocabulary: each present at least once, in any phase — the table names
  // kinds, not phases; the message's phase is where the slide usually goes.
  const required = shape.requireVocabulary
    ? [...new Set([...shape.requiredKinds, "vocabulary" as const])]
    : shape.requiredKinds;
  for (const kind of required) {
    if (!kinds.has(kind)) {
      issue(
        `The outline has no ${kind} slide and this lesson needs one; add it in the ${phaseOfKind(kind)} phase.`,
        ["outline"],
      );
    }
  }
  // photographable (TEACH-238): the model says whether the topic can be photographed, and a "yes"
  // needs the picture slide it implies. No subject heuristic — that would fire on a good abstract
  // outline; this fires only on the model's own contradiction.
  if (skeleton.photographable === undefined) {
    issue(
      'Say whether this topic can be photographed: "photographable": { "yes": true|false, "why": one sentence }.',
      ["photographable"],
    );
  } else if (skeleton.photographable.yes && !kinds.has("image-text")) {
    // The message does not quote `why`: issue messages are logged on a retry (ADR 0015).
    issue(
      'You said this topic can be photographed ("photographable": true); add one image-text slide in the explain phase with an imageBrief.',
      ["outline"],
    );
  }
  // forbiddenKinds: none present.
  outline.forEach((entry, i) => {
    if (shape.forbiddenKinds.includes(entry.kind)) {
      issue(
        `Outline position ${i} is ${anOf(entry.kind)} slide; ${anOf(shape.verb)} lesson has none. Make it ${RETRIEVAL_KINDS}.`,
        ["outline", i, "kind"],
      );
    }
  });
  // minContent: the definition (when the shape opens with one), then the mechanism on its own
  // slide. An image-text slide is a content slide with a photograph (heading and body over the
  // picture), so it counts (TEACH-237): a definition, a picture that shows the mechanism and a
  // worked example is a good Explain outline.
  const content = count("content") + count("image-text");
  if (content < shape.minContent) {
    issue(
      `The outline has ${content} content or image-text slide${content === 1 ? "" : "s"}. ${contentSentence(shape)}; add one in the explain phase.`,
      ["outline"],
    );
  }
  // minCheckEntries: slides where pupils answer — the practise and check phases together.
  const answering = outline.filter((e) => e.phase === "practise" || e.phase === "check").length;
  if (answering < shape.minCheckEntries) {
    issue(
      `Only ${answering} slide${answering === 1 ? "" : "s"} where pupils answer (practise and check phases); this lesson needs at least ${shape.minCheckEntries}. Add a practise slide.`,
      ["outline"],
    );
  }
  // explainMinPercent: only slides that teach count — the same kinds `checkLesson` counts — so a
  // question slide tagged "explain" does not pad it.
  const explainMinutes = minutesIn("explain", EXPLAIN_KINDS);
  const explainShort = shortBy(explainMinutes, shape.explainMinPercent);
  if (explainShort > 0) {
    issue(
      `The explain phase needs at least ${share(shape.explainMinPercent)} minutes (${shape.explainMinPercent}% of ${durationMin}); it has ${explainMinutes}. Add ${explainShort} ${plural(explainShort)} to content, worked-example, image-text or vocabulary slides.`,
      ["outline"],
    );
  }
  // practiseMinPercent: every practise-phase slide counts.
  const practiseMinutes = minutesIn("practise");
  const practiseShort =
    shape.practiseMinPercent > 0 ? shortBy(practiseMinutes, shape.practiseMinPercent) : 0;
  if (practiseShort > 0) {
    issue(
      `The practise phase needs at least ${share(shape.practiseMinPercent)} minutes (${shape.practiseMinPercent}% of ${durationMin}); it has ${practiseMinutes}. Add ${practiseShort} ${plural(practiseShort)} to practise slides.`,
      ["outline"],
    );
  }
  // requireWorkedExampleBeforePractise: the method before any practice (index order). A missing
  // worked-example is the requiredKinds issue above, not a second one here.
  const firstPractise = outline.findIndex((e) => e.phase === "practise");
  const method = outline.findIndex((e) => e.kind === "worked-example");
  if (
    shape.requireWorkedExampleBeforePractise &&
    method !== -1 &&
    firstPractise !== -1 &&
    method > firstPractise
  ) {
    issue(
      `Outline position ${firstPractise} is a practise slide but the worked-example (the method) is at position ${method}; pupils practise only after the method. Move the worked-example before position ${firstPractise}, in the explain phase.`,
      ["outline", firstPractise, "phase"],
    );
  }
  // requireTwoCases is a prompt rule, not a rejection (TEACH-237): two cases can be set against
  // each other on a discussion, content or open-response slide, which a kind check cannot see.
  // A class new to the topic gets a teaching slide — content, worked-example or image-text (a
  // content slide with a photograph, TEACH-237) — for every objective (TEACH-211; the confidence
  // override the shape table keeps).
  if (shape.confidence === "New to it") {
    const explained = new Set<number>();
    for (const entry of outline) {
      if (!EXPLAIN_KINDS.has(entry.kind) || entry.kind === "vocabulary") continue;
      for (const ref of entry.factRefs) if (ref.type === "objective") explained.add(ref.index);
    }
    skeleton.learningObjectives.forEach((_, i) => {
      if (!explained.has(i)) {
        issue(
          `The class is new to this: objective ${i} needs a content, worked-example or image-text slide that names it.`,
          ["outline"],
        );
      }
    });
  }
}

function anOf(word: string): string {
  return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;
}

/**
 * The skeleton shape without the brief-dependent refinements (no lesson shape): for tests and the
 * resume path, which parse a skeleton the pipeline has already accepted once.
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
    .min(12, "Give at least 12 questions across the three tiers, each tagged with a use.")
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

/** The fewest questions of each tier: one under the shape's target (`tierWeights`, TEACH-229). */
export function tierMinimumsOf(weights: TierWeights): TierWeights {
  return {
    easy: Math.max(weights.easy - 1, 1),
    core: Math.max(weights.core - 1, 1),
    stretch: Math.max(weights.stretch - 1, 1),
  };
}

/**
 * The facts schema for one skeleton and its lesson shape: every reference lands inside its list,
 * every outline position exists and is one of the slides the facts feed (not `title` /
 * `objectives`, whose objective references the skeleton fixed), only the three lists this call
 * produces may be referenced — the objectives are already wired by the skeleton — the tiers meet
 * the shape's floor.
 */
export function planFactsSchemaFor(
  skeleton: PlanSkeleton,
  shape: LessonShape,
): z.ZodType<PlanFacts> {
  const minimums = tierMinimumsOf(shape.tierWeights);
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
    // Self-contained facts (TEACH-224): a problem or stem that presumes a picture cannot be used
    // on a slide that has none; a vocabulary term nobody explains cannot be asked about; and the
    // pitch cannot forbid a word the lesson defines.
    facts.workedExamples.forEach((x, i) => {
      if (PRESUMES_PICTURE.test(x.problem)) {
        ctx.addIssue({
          code: "custom",
          message: SELF_CONTAINED,
          path: ["workedExamples", i, "problem"],
        });
      }
    });
    facts.questions.forEach((q, i) => {
      if (PRESUMES_PICTURE.test(q.stem)) {
        ctx.addIssue({ code: "custom", message: SELF_CONTAINED, path: ["questions", i, "stem"] });
      }
    });
    // Whether every vocabulary term is taught before it is asked about is left to the prompt rule
    // (TEACH-227): the schema rejection cost a 25 s Terra retry for "evidence" in production.
    const defined = new Set(facts.vocabulary.map((v) => v.term.trim().toLowerCase()));
    facts.pitch.avoid.forEach((word, i) => {
      if (defined.has(word.trim().toLowerCase())) {
        ctx.addIssue({
          code: "custom",
          message: `pitch.avoid lists "${word}", which the vocabulary defines; a lesson cannot avoid a word it teaches.`,
          path: ["pitch", "avoid", i],
        });
      }
    });
    // Three tiers, each present in numbers a sheet and an exit ticket can draw on: the shape's
    // weights less one.
    const tiers = { easy: 0, core: 0, stretch: 0 };
    for (const q of facts.questions) tiers[q.tier] += 1;
    const { easy, core, stretch } = shape.tierWeights;
    for (const tier of ["easy", "core", "stretch"] as const) {
      if (tiers[tier] < minimums[tier]) {
        ctx.addIssue({
          code: "custom",
          message: `Only ${tiers[tier]} "${tier}" questions; give at least ${minimums[tier]} (the target is ${easy} easy, ${core} core, ${stretch} stretch).`,
          path: ["questions"],
        });
      }
    }
    // requireMisconceptionConfronted is a prompt rule, not a rejection (TEACH-237): the facts
    // prompt asks for distractors tied to misconceptions, but `misconceptionRef` is optional and a
    // good answer that names the belief in the distractor text without the ref would be sent back.

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
