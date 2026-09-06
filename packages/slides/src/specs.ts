import { GENERATABLE_BLOCK_TYPES, GENERATABLE_SLIDE_KINDS } from "@tj/domain/documents";
import { z } from "zod";

/*
 * Slide and block specs (ADR 0025 §8): what the model produces for one slide or one worksheet
 * block. Content only — text slots, answers and `factRefs` — never coordinates or rich text;
 * `materialiseSlide` / `materialiseBlock` place it with the layout recipes. Every text slot is
 * trimmed and non-empty so the doc builders never write an empty text node (Tiptap refuses one).
 */

/** The `___` marker a fill-gap sentence uses for each blank. */
export const GAP_MARKER = "___";

const line = (max: number) => z.string().trim().min(1).max(max);

export const SPEC_LIMITS = {
  title: 80,
  heading: 80,
  item: 160,
  body: 400,
  stem: 200,
  option: 80,
  term: 60,
  definition: 160,
  footnote: 120,
  answer: 200,
  notes: 2000,
  word: 40,
} as const;

const specBase = {
  /** `LessonFacts` ids this slide or block covers; copied to every element's `generatedFrom`. */
  factRefs: z.array(z.string()),
  /** Teacher notes for the slide (`Slide.notes`). */
  notes: line(SPEC_LIMITS.notes).optional(),
};

const items = (min: number, max: number) => z.array(line(SPEC_LIMITS.item)).min(min).max(max);

const exactlyOneCorrect = (options: { correct: boolean }[]) =>
  options.filter((option) => option.correct).length === 1;

/** Count of `___` markers in a fill-gap sentence. */
export function countGaps(sentence: string): number {
  return sentence.split(GAP_MARKER).length - 1;
}

const oneMarkerPerAnswer = {
  message: `The sentence needs one ${GAP_MARKER} marker per answer.`,
  path: ["sentence"],
};
const gapsMatchAnswers = (spec: { sentence: string; answers: string[] }) =>
  countGaps(spec.sentence) === spec.answers.length;

/* ------------------------------------------------------------------ */
/* Slide specs                                                         */
/* ------------------------------------------------------------------ */

export const SlideSpecSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("title"),
    ...specBase,
    title: line(SPEC_LIMITS.title),
    subtitle: line(SPEC_LIMITS.heading),
  }),
  z.strictObject({
    kind: z.literal("objectives"),
    ...specBase,
    heading: line(SPEC_LIMITS.heading).optional(),
    items: items(1, 4),
  }),
  z.strictObject({
    kind: z.literal("starter"),
    ...specBase,
    heading: line(SPEC_LIMITS.heading).optional(),
    items: items(1, 3),
    footnote: line(SPEC_LIMITS.footnote).optional(),
  }),
  z.strictObject({
    kind: z.literal("vocabulary"),
    ...specBase,
    entries: z
      .array(
        z.strictObject({
          term: line(SPEC_LIMITS.term),
          definition: line(SPEC_LIMITS.definition),
        }),
      )
      .min(1)
      .max(6),
  }),
  z.strictObject({
    kind: z.literal("content"),
    ...specBase,
    heading: line(SPEC_LIMITS.heading),
    body: line(SPEC_LIMITS.body),
  }),
  z.strictObject({
    kind: z.literal("worked-example"),
    ...specBase,
    heading: line(SPEC_LIMITS.heading).optional(),
    question: line(SPEC_LIMITS.body),
    steps: items(1, 4),
  }),
  z.strictObject({
    kind: z.literal("instructions"),
    ...specBase,
    heading: line(SPEC_LIMITS.heading).optional(),
    steps: items(1, 4),
    footnote: line(SPEC_LIMITS.footnote).optional(),
  }),
  z.strictObject({
    kind: z.literal("discussion"),
    ...specBase,
    prompt: line(SPEC_LIMITS.stem),
    footnote: line(SPEC_LIMITS.footnote).optional(),
  }),
  z.strictObject({
    kind: z.literal("true-false"),
    ...specBase,
    statement: line(SPEC_LIMITS.stem),
    correct: z.boolean(),
    explanation: line(SPEC_LIMITS.body).optional(),
  }),
  z
    .strictObject({
      kind: z.literal("multiple-choice"),
      ...specBase,
      stem: line(SPEC_LIMITS.stem),
      options: z
        .array(z.strictObject({ text: line(SPEC_LIMITS.option), correct: z.boolean() }))
        .length(4),
      explanation: line(SPEC_LIMITS.body).optional(),
    })
    .refine((spec) => exactlyOneCorrect(spec.options), {
      message: "Exactly one option is correct.",
      path: ["options"],
    }),
  z.strictObject({
    kind: z.literal("matching"),
    ...specBase,
    stem: line(SPEC_LIMITS.stem),
    pairs: z
      .array(z.strictObject({ left: line(SPEC_LIMITS.term), right: line(SPEC_LIMITS.definition) }))
      .length(3),
  }),
  z
    .strictObject({
      kind: z.literal("fill-gap"),
      ...specBase,
      stem: line(SPEC_LIMITS.stem),
      sentence: line(SPEC_LIMITS.body),
      answers: z.array(line(SPEC_LIMITS.answer)).min(1).max(3),
    })
    .refine(gapsMatchAnswers, oneMarkerPerAnswer),
  z.strictObject({
    kind: z.literal("sort"),
    ...specBase,
    stem: line(SPEC_LIMITS.stem),
    /** In the correct order; the recipe shows them in reading order. */
    steps: z.array(line(SPEC_LIMITS.option)).length(4),
  }),
  z.strictObject({
    kind: z.literal("open-response"),
    ...specBase,
    stem: line(SPEC_LIMITS.stem),
    modelAnswer: line(SPEC_LIMITS.body).optional(),
  }),
  z.strictObject({
    kind: z.literal("exit-ticket"),
    ...specBase,
    heading: line(SPEC_LIMITS.heading).optional(),
    items: items(3, 3),
    footnote: line(SPEC_LIMITS.footnote).optional(),
  }),
  z.strictObject({
    kind: z.literal("plenary"),
    ...specBase,
    heading: line(SPEC_LIMITS.heading).optional(),
    items: items(1, 3),
  }),
]);
export type SlideSpec = z.infer<typeof SlideSpecSchema>;
export type SlideSpecOf<K extends SlideSpec["kind"]> = Extract<SlideSpec, { kind: K }>;

/* ------------------------------------------------------------------ */
/* Block specs                                                         */
/* ------------------------------------------------------------------ */

const blockBase = {
  factRefs: z.array(z.string()),
};

export const BlockSpecSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("heading"),
    ...blockBase,
    text: line(SPEC_LIMITS.heading),
    level: z.union([z.literal(1), z.literal(2)]),
  }),
  z.strictObject({
    type: z.literal("instructions"),
    ...blockBase,
    text: line(SPEC_LIMITS.body),
  }),
  z.strictObject({ type: z.literal("paragraph"), ...blockBase, text: line(SPEC_LIMITS.body) }),
  z.strictObject({
    type: z.literal("question"),
    ...blockBase,
    text: line(SPEC_LIMITS.body),
    answer: line(SPEC_LIMITS.body),
    answerLines: z.number().int().min(1).max(6),
    marks: z.number().int().min(1).optional(),
  }),
  z
    .strictObject({
      type: z.literal("multiple-choice"),
      ...blockBase,
      text: line(SPEC_LIMITS.body),
      options: z
        .array(z.strictObject({ text: line(SPEC_LIMITS.option), correct: z.boolean() }))
        .length(4),
    })
    .refine((spec) => exactlyOneCorrect(spec.options), {
      message: "Exactly one option is correct.",
      path: ["options"],
    }),
  z
    .strictObject({
      type: z.literal("fill-gap"),
      ...blockBase,
      sentence: line(SPEC_LIMITS.body),
      answers: z.array(line(SPEC_LIMITS.answer)).min(1).max(4),
    })
    .refine(gapsMatchAnswers, oneMarkerPerAnswer),
  z.strictObject({
    type: z.literal("matching"),
    ...blockBase,
    pairs: z
      .array(z.strictObject({ left: line(SPEC_LIMITS.term), right: line(SPEC_LIMITS.definition) }))
      .min(3)
      .max(5),
  }),
  z.strictObject({
    type: z.literal("word-bank"),
    ...blockBase,
    words: z.array(line(SPEC_LIMITS.word)).min(3).max(10),
  }),
]);
export type BlockSpec = z.infer<typeof BlockSpecSchema>;
export type BlockSpecOf<T extends BlockSpec["type"]> = Extract<BlockSpec, { type: T }>;

/* The two unions cover exactly the generatable kinds and types (ADR 0025 §8). */
const _slideKinds: readonly SlideSpec["kind"][] = GENERATABLE_SLIDE_KINDS;
const _blockTypes: readonly BlockSpec["type"][] = GENERATABLE_BLOCK_TYPES;
void _slideKinds;
void _blockTypes;
