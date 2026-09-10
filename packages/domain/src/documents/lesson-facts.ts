import { z } from "zod";

/*
 * LessonFacts (ADR 0025 §1; F06; Generation quality §1). The one object every Artefact of a Lesson
 * is derived from: objectives, key ideas (the teaching points `content` slides are built from),
 * vocabulary, worked examples, questions with answers and distractors, misconceptions, the pitch,
 * the ordered `outline` Plan decides and Generate follows, and the duration. Stored as the
 * optional `Lesson.facts` field beside the slides, so a fact edit and its cascade are one document
 * and one undo transaction (ADR 0022 §4). `classContext` is read from `Lesson.brief`, not copied.
 *
 * Every fact carries a stable short id minted by the worker (`o1`, `k1`, `v3`, `q2`, `x1`, `m1`,
 * `s4`) that is never renumbered; `factRefs` on outline entries, elements and blocks point at these
 * ids, and a fact's own `objectiveRefs` / `misconceptionRef` link it to the objective it serves or
 * the misconception it heads off. Everything added after the first stored lessons is optional
 * (ADR 0021 §2): a lesson from before it still parses.
 */

/** A short fact id: one lower-case letter for the kind and a number, e.g. `o1`, `v12`. */
export type FactId = string;

export const FACT_ID_PATTERN = /^[a-z]\d+$/;

export const FactIdSchema = z.string().regex(FACT_ID_PATTERN, {
  message: "Fact ids are one lower-case letter followed by digits, e.g. o1 or v3.",
});

/**
 * The slide kinds the pipeline may generate (ADR 0025 §8). `image-match` still waits for an
 * image source; `timer`, `blank` and `embed` have no content spec.
 */
export const GENERATABLE_SLIDE_KINDS = [
  "title",
  "objectives",
  "starter",
  "vocabulary",
  "content",
  "worked-example",
  "instructions",
  "discussion",
  "true-false",
  "multiple-choice",
  "matching",
  "fill-gap",
  "sort",
  "open-response",
  "exit-ticket",
  "plenary",
  "image-text",
] as const;
export type GeneratableSlideKind = (typeof GENERATABLE_SLIDE_KINDS)[number];
export const GeneratableSlideKindSchema = z.enum(GENERATABLE_SLIDE_KINDS);

/** The worksheet block types the pipeline may generate (ADR 0025 §8). */
export const GENERATABLE_BLOCK_TYPES = [
  "heading",
  "instructions",
  "paragraph",
  "question",
  "multiple-choice",
  "fill-gap",
  "matching",
  "word-bank",
] as const;
export type GeneratableBlockType = (typeof GENERATABLE_BLOCK_TYPES)[number];
export const GeneratableBlockTypeSchema = z.enum(GENERATABLE_BLOCK_TYPES);

/**
 * Reserved for F05 (ADR 0025 §20): where the objective sits in a curriculum scheme. Plan marks a
 * model-inferred objective by leaving it out; F05 fills it in.
 */
export type CurriculumRef = {
  scheme: string;
  code: string;
  version: string;
  status: "inferred" | "confirmed";
};

export type Objective = { id: FactId; text: string; curriculumRef?: CurriculumRef };

/**
 * A teaching point: what a pupil must understand, explained, with one concrete example and an
 * optional analogy. `content` slides are built from these; 2–5 per lesson.
 */
export type KeyIdea = {
  id: FactId;
  statement: string;
  explanation: string;
  example: string;
  analogy?: string;
  objectiveRefs: FactId[];
};

export type VocabularyItem = {
  id: FactId;
  term: string;
  definition: string;
  objectiveRefs?: FactId[];
};

export type WorkedExample = {
  id: FactId;
  problem: string;
  steps: string[];
  answer: string;
  /** The misconception this example is chosen to head off. */
  misconceptionRef?: FactId;
};

/** Where a question may be used, so the same stem is not on a slide, the sheet and the exit ticket. */
export const QUESTION_USES = ["slide", "worksheet", "exit", "any"] as const;
export type QuestionUse = (typeof QUESTION_USES)[number];

export const QUESTION_TIERS = ["easy", "core", "stretch"] as const;
export type QuestionTier = (typeof QUESTION_TIERS)[number];

/** A wrong answer a pupil holding a named misconception would give. */
export type Distractor = { text: string; misconceptionRef?: FactId };

export type FactQuestion = {
  id: FactId;
  stem: string;
  answer: string;
  reasoning: string;
  objectiveRefs?: FactId[];
  distractors?: Distractor[];
  use?: QuestionUse;
  tier?: QuestionTier;
};

/** What pupils at this level typically get wrong, and the correction. */
export type Misconception = {
  id: FactId;
  belief: string;
  correction: string;
  objectiveRefs: FactId[];
};

/** Plan's own statement of the reading target, checked deterministically by `checkLesson`. */
export type Pitch = { readingAgeTarget: number; sentenceLengthMax: number; avoid: string[] };

/** What the picture is for; decides what `mustShow` has to make possible (Generation quality §4). */
export const IMAGE_PURPOSES = ["identify-parts", "observe", "compare", "context"] as const;
export type ImagePurpose = (typeof IMAGE_PURPOSES)[number];

/**
 * What the pipeline should photograph for an `image-text` slide (Images project; Generation
 * quality §4, TEACH-211). `mustShow` lists the concrete things a pupil must be able to see for the
 * slide's task to be possible — nouns a camera captures. No orientation: the slot's geometry
 * decides it (ADR 0025 §8, the model never produces geometry). Lessons stored before the list form
 * carried `mustShow` as one string and no `purpose`: the schema coerces the string to a one-item
 * list and defaults the purpose to `context`, so they still parse (ADR 0021 §2; no version bump).
 */
const MustShowItem = z.string().trim().min(1).max(120);
export const ImageBriefSchema = z.strictObject({
  subject: z.string().trim().min(1).max(60),
  mustShow: z
    .union([MustShowItem.transform((one) => [one]), z.array(MustShowItem).max(4)])
    .optional()
    .default([]),
  purpose: z.enum(IMAGE_PURPOSES).default("context"),
  // The same ceiling as Plan's `PlanImageBriefSchema` (TEACH-227 raised it to six; TEACH-237
  // aligned this one after a skeleton Plan accepted was refused here with a bare ZodError).
  avoid: z.array(MustShowItem).max(6).optional(),
});
export type ImageBrief = z.infer<typeof ImageBriefSchema>;

/** The teaching phase an outline entry belongs to; title and objectives carry none. */
export const LESSON_PHASES = ["starter", "explain", "practise", "check"] as const;
export type LessonPhase = (typeof LESSON_PHASES)[number];

/** One slide of the lesson structure Plan decides and Generate follows, in order. */
export type OutlineEntry = {
  id: FactId;
  kind: GeneratableSlideKind;
  /** Whole minutes the slide is expected to take; the sum is checked against `durationMin`. */
  minutes: number;
  /** The facts this slide covers. */
  factRefs: FactId[];
  /** Required exactly on `image-text` entries; forbidden elsewhere (checked below). */
  imageBrief?: ImageBrief;
  /** What this slide adds that no other does, and what it must not repeat from a neighbour. */
  brief?: OutlineBrief;
  /** Starter → explain → practise → check; absent on title/objectives and on older lessons. */
  phase?: LessonPhase;
};

export type OutlineBrief = { adds: string; avoids?: string };

export type LessonFacts = {
  objectives: Objective[];
  keyIdeas?: KeyIdea[];
  vocabulary: VocabularyItem[];
  workedExamples: WorkedExample[];
  questions: FactQuestion[];
  misconceptions: Misconception[];
  pitch?: Pitch;
  outline: OutlineEntry[];
  durationMin: number;
};

export const CurriculumRefSchema = z.strictObject({
  scheme: z.string(),
  code: z.string(),
  version: z.string(),
  status: z.enum(["inferred", "confirmed"]),
});

export const ObjectiveSchema = z.strictObject({
  id: FactIdSchema,
  text: z.string(),
  curriculumRef: CurriculumRefSchema.optional(),
});

const ObjectiveRefsSchema = z.array(FactIdSchema);

export const KeyIdeaSchema = z.strictObject({
  id: FactIdSchema,
  statement: z.string(),
  explanation: z.string(),
  example: z.string(),
  analogy: z.string().optional(),
  objectiveRefs: ObjectiveRefsSchema,
});

export const VocabularyItemSchema = z.strictObject({
  id: FactIdSchema,
  term: z.string(),
  definition: z.string(),
  objectiveRefs: ObjectiveRefsSchema.optional(),
});

export const WorkedExampleSchema = z.strictObject({
  id: FactIdSchema,
  problem: z.string(),
  steps: z.array(z.string()),
  answer: z.string(),
  misconceptionRef: FactIdSchema.optional(),
});

export const DistractorSchema = z.strictObject({
  text: z.string(),
  misconceptionRef: FactIdSchema.optional(),
});

export const FactQuestionSchema = z.strictObject({
  id: FactIdSchema,
  stem: z.string(),
  answer: z.string(),
  reasoning: z.string(),
  objectiveRefs: ObjectiveRefsSchema.optional(),
  distractors: z.array(DistractorSchema).optional(),
  use: z.enum(QUESTION_USES).optional(),
  tier: z.enum(QUESTION_TIERS).optional(),
});

export const MisconceptionSchema = z.strictObject({
  id: FactIdSchema,
  belief: z.string(),
  correction: z.string(),
  objectiveRefs: ObjectiveRefsSchema,
});

export const PitchSchema = z.strictObject({
  readingAgeTarget: z.number().int().min(1),
  sentenceLengthMax: z.number().int().min(1),
  avoid: z.array(z.string()),
});

export const OutlineBriefSchema = z.strictObject({
  adds: z.string(),
  avoids: z.string().optional(),
});

export const OutlineEntrySchema = z.strictObject({
  id: FactIdSchema,
  kind: GeneratableSlideKindSchema,
  minutes: z.number().int().min(1),
  factRefs: z.array(FactIdSchema),
  imageBrief: ImageBriefSchema.optional(),
  brief: OutlineBriefSchema.optional(),
  phase: z.enum(LESSON_PHASES).optional(),
});

/** The arrays whose ids `factRefs` may point at. Outline entries are structure, not facts. */
export const FACT_ARRAYS = [
  "objectives",
  "keyIdeas",
  "vocabulary",
  "workedExamples",
  "questions",
  "misconceptions",
] as const;
export type FactArray = (typeof FACT_ARRAYS)[number];

/** The one-letter prefix each fact array's ids carry, as the worker mints them. */
export const FACT_ID_PREFIXES: Record<FactArray, string> = {
  objectives: "o",
  keyIdeas: "k",
  vocabulary: "v",
  workedExamples: "x",
  questions: "q",
  misconceptions: "m",
};

/** Whether `id` was minted for `array` (`o1` is an objective, `m2` a misconception). */
export const isFactIdOf = (array: FactArray, id: FactId): boolean =>
  id.startsWith(FACT_ID_PREFIXES[array]);

export const LessonFactsSchema = z
  .strictObject({
    objectives: z.array(ObjectiveSchema),
    keyIdeas: z.array(KeyIdeaSchema).optional(),
    vocabulary: z.array(VocabularyItemSchema),
    workedExamples: z.array(WorkedExampleSchema),
    questions: z.array(FactQuestionSchema),
    misconceptions: z.array(MisconceptionSchema),
    pitch: PitchSchema.optional(),
    outline: z.array(OutlineEntrySchema),
    durationMin: z.number().int().min(1),
  })
  .superRefine((facts, ctx) => {
    // Ids are the addressing scheme for `factRefs`, so they must be unique across every array
    // (outline included), and every reference must resolve to a fact — an outline entry is not
    // one. The same two rules `SlideSchema` applies to elements.
    const factIds = new Set<string>();
    const seen = new Set<string>();
    const claim = (id: string, path: (string | number)[]) => {
      if (seen.has(id)) {
        ctx.addIssue({ code: "custom", message: `duplicate fact id "${id}"`, path });
      }
      seen.add(id);
    };
    for (const key of FACT_ARRAYS) {
      (facts[key] ?? []).forEach((fact, i) => {
        claim(fact.id, [key, i, "id"]);
        factIds.add(fact.id);
      });
    }
    facts.outline.forEach((entry, i) => {
      claim(entry.id, ["outline", i, "id"]);
    });
    // A fact's own links must land on a fact of the right kind: `objectiveRefs` on objectives,
    // `misconceptionRef` on misconceptions. Same message shape as the outline's.
    const checkRef = (ref: FactId, array: FactArray, path: (string | number)[]) => {
      const kind = array === "objectives" ? "an objective" : "a misconception";
      if (!factIds.has(ref)) {
        ctx.addIssue({ code: "custom", message: `references missing ${kind} "${ref}"`, path });
      } else if (!isFactIdOf(array, ref)) {
        ctx.addIssue({ code: "custom", message: `"${ref}" is not ${kind} id`, path });
      }
    };
    const checkObjectiveRefs = (refs: FactId[] | undefined, path: (string | number)[]) => {
      refs?.forEach((ref, j) => {
        checkRef(ref, "objectives", [...path, j]);
      });
    };
    for (const key of ["keyIdeas", "vocabulary", "misconceptions"] as const) {
      (facts[key] ?? []).forEach((fact, i) => {
        checkObjectiveRefs(fact.objectiveRefs, [key, i, "objectiveRefs"]);
      });
    }
    facts.workedExamples.forEach((x, i) => {
      if (x.misconceptionRef !== undefined) {
        checkRef(x.misconceptionRef, "misconceptions", ["workedExamples", i, "misconceptionRef"]);
      }
    });
    facts.questions.forEach((q, i) => {
      checkObjectiveRefs(q.objectiveRefs, ["questions", i, "objectiveRefs"]);
      q.distractors?.forEach((d, j) => {
        if (d.misconceptionRef !== undefined) {
          checkRef(d.misconceptionRef, "misconceptions", [
            "questions",
            i,
            "distractors",
            j,
            "misconceptionRef",
          ]);
        }
      });
    });
    facts.outline.forEach((entry, i) => {
      entry.factRefs.forEach((ref, j) => {
        if (!factIds.has(ref)) {
          ctx.addIssue({
            code: "custom",
            message: `outline references missing fact "${ref}"`,
            path: ["outline", i, "factRefs", j],
          });
        }
      });
      if (entry.kind !== "image-text" && entry.imageBrief !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: `imageBrief is only allowed on image-text entries`,
          path: ["outline", i, "imageBrief"],
        });
      }
      // Without a brief illustrate would silently leave the placeholder: refuse the facts.
      if (entry.kind === "image-text" && entry.imageBrief === undefined) {
        ctx.addIssue({
          code: "custom",
          message: `image-text entries carry an imageBrief`,
          path: ["outline", i, "imageBrief"],
        });
      }
    });
  });
