import { z } from "zod";

/*
 * LessonFacts (ADR 0025 §1; F06). The one object every Artefact of a Lesson is derived from:
 * objectives, vocabulary, worked examples, questions with answers, misconceptions (empty at MVP),
 * the ordered `outline` Plan decides and Generate follows, and the duration. Stored as the
 * optional `Lesson.facts` field beside the slides, so a fact edit and its cascade are one document
 * and one undo transaction (ADR 0022 §4). `classContext` is read from `Lesson.brief`, not copied.
 *
 * Every fact carries a stable short id minted by the worker (`o1`, `v3`, `q2`, `x1`, `s4`) that is
 * never renumbered; `factRefs` on outline entries, elements and blocks point at these ids.
 */

/** A short fact id: one lower-case letter for the kind and a number, e.g. `o1`, `v12`. */
export type FactId = string;

export const FACT_ID_PATTERN = /^[a-z]\d+$/;

export const FactIdSchema = z.string().regex(FACT_ID_PATTERN, {
  message: "Fact ids are one lower-case letter followed by digits, e.g. o1 or v3.",
});

/**
 * The slide kinds the pipeline may generate (ADR 0025 §8). `image-text` and `image-match` wait for
 * an image source; `timer`, `blank` and `embed` have no content spec.
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
export type VocabularyItem = { id: FactId; term: string; definition: string };
export type WorkedExample = { id: FactId; problem: string; steps: string[]; answer: string };
export type FactQuestion = { id: FactId; stem: string; answer: string; reasoning: string };
export type Misconception = { id: FactId; text: string };

/** One slide of the lesson structure Plan decides and Generate follows, in order. */
export type OutlineEntry = {
  id: FactId;
  kind: GeneratableSlideKind;
  /** Whole minutes the slide is expected to take; the sum is checked against `durationMin`. */
  minutes: number;
  /** The facts this slide covers. */
  factRefs: FactId[];
};

export type LessonFacts = {
  objectives: Objective[];
  vocabulary: VocabularyItem[];
  workedExamples: WorkedExample[];
  questions: FactQuestion[];
  /** Typed now, empty at MVP. */
  misconceptions: Misconception[];
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

export const VocabularyItemSchema = z.strictObject({
  id: FactIdSchema,
  term: z.string(),
  definition: z.string(),
});

export const WorkedExampleSchema = z.strictObject({
  id: FactIdSchema,
  problem: z.string(),
  steps: z.array(z.string()),
  answer: z.string(),
});

export const FactQuestionSchema = z.strictObject({
  id: FactIdSchema,
  stem: z.string(),
  answer: z.string(),
  reasoning: z.string(),
});

export const MisconceptionSchema = z.strictObject({
  id: FactIdSchema,
  text: z.string(),
});

export const OutlineEntrySchema = z.strictObject({
  id: FactIdSchema,
  kind: GeneratableSlideKindSchema,
  minutes: z.number().int().min(1),
  factRefs: z.array(FactIdSchema),
});

/** The arrays whose ids `factRefs` may point at. Outline entries are structure, not facts. */
const FACT_ARRAYS = [
  "objectives",
  "vocabulary",
  "workedExamples",
  "questions",
  "misconceptions",
] as const;

export const LessonFactsSchema = z
  .strictObject({
    objectives: z.array(ObjectiveSchema),
    vocabulary: z.array(VocabularyItemSchema),
    workedExamples: z.array(WorkedExampleSchema),
    questions: z.array(FactQuestionSchema),
    misconceptions: z.array(MisconceptionSchema),
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
      facts[key].forEach((fact, i) => {
        claim(fact.id, [key, i, "id"]);
        factIds.add(fact.id);
      });
    }
    facts.outline.forEach((entry, i) => {
      claim(entry.id, ["outline", i, "id"]);
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
    });
  });
