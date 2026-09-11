import {
  allDistinct,
  decodeEntities,
  GENERATABLE_BLOCK_TYPES,
  GENERATABLE_SLIDE_KINDS,
  hasLeakedPupilPhrase,
  hasLeakedRepairPhrase,
  isClassifyStem,
  isDoubleStatement,
  isOneOf,
  sameLeadingToken,
} from "@tj/domain/documents";
import { z } from "zod";

/*
 * Slide and block specs (ADR 0025 §8): what the model produces for one slide or one worksheet
 * block. Content only — text slots, answers and `factRefs` — never coordinates or rich text;
 * `materialiseSlide` / `materialiseBlock` place it with the layout recipes. Every text slot is
 * trimmed and non-empty so the doc builders never write an empty text node (Tiptap refuses one).
 *
 * The sanitiser (Generation quality §3; TEACH-210) lives here too, as refinements: a degenerate or
 * leaking spec — equal answer options, a footnote that repeats an item, a house-rule phrase in
 * pupil text, repair commentary in notes, a classify task as `sort` — is a validation issue, which
 * `callStructured` turns into the one retry with the message in context (ADR 0025 §14). HTML
 * entities are decoded rather than rejected. Every message is written for the model to act on.
 */

/** The `___` marker a fill-gap sentence uses for each blank. */
export const GAP_MARKER = "___";

/**
 * One pupil-facing text slot: trimmed, entities decoded (`&amp;` → `&`; a decoded string is never
 * longer, so `max` is checked after), non-empty, capped, and free of prompt vocabulary.
 */
const line = (max: number) =>
  z
    .string()
    .trim()
    .overwrite(decodeEntities)
    .min(1)
    .max(max)
    .refine((text) => !hasLeakedPupilPhrase(text), { message: LEAKED_PUPIL });

/** Teacher notes: the same decoding and cap, but the leak test is for repair commentary. */
const notesLine = (max: number) =>
  z
    .string()
    .trim()
    .overwrite(decodeEntities)
    .min(1)
    .max(max)
    .refine((text) => !hasLeakedRepairPhrase(text), { message: LEAKED_REPAIR });

export const LEAKED_PUPIL =
  "Pupil-facing text must not contain instructions to the model or house rules (no names, British English, fact ids, JSON).";
export const LEAKED_REPAIR =
  "Notes are for the teacher: say what to do in the room, never describe the correction that was made or the finding.";

export const SPEC_LIMITS = {
  title: 80,
  caption: 24,
  heading: 80,
  item: 160,
  /** A worked-example step: the WORKING card holds four two-line steps at the body floor (TEACH-247). */
  step: 56,
  /** A worked-example question: two body lines at the floor across the slide (TEACH-247). */
  question: 120,
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
  notes: notesLine(SPEC_LIMITS.notes).optional(),
};

/**
 * A leading enumerator the model wrote into a list member ("1. ", "2) ", "a) ", "- ") — the layout
 * numbers or bullets the list itself, so it would render twice (TEACH-223). Stripped, not refused.
 */
const ENUMERATOR = /^\s*(?:\d{1,2}[.)]|[a-z][.)]|[-•*])\s+/i;
export const stripEnumerator = (text: string) => text.replace(ENUMERATOR, "");

/** One member of a list the layout numbers or bullets: `line`, with any enumerator stripped. */
const listLine = (max: number) =>
  z
    .string()
    .trim()
    .overwrite(decodeEntities)
    .overwrite(stripEnumerator)
    .min(1)
    .max(max)
    .refine((text) => !hasLeakedPupilPhrase(text), { message: LEAKED_PUPIL });

const items = (min: number, max: number) => z.array(listLine(SPEC_LIMITS.item)).min(min).max(max);

const exactlyOneCorrect = (options: { correct: boolean }[]) =>
  options.filter((option) => option.correct).length === 1;

/** Count of `___` markers in a fill-gap sentence. */
export function countGaps(sentence: string): number {
  return sentence.split(GAP_MARKER).length - 1;
}

/** `footnote` must add something: not one of the items or steps again. */
const footnoteNotAnItem = (spec: {
  footnote?: string | undefined;
  items?: string[];
  steps?: string[];
}) => spec.footnote === undefined || !isOneOf(spec.footnote, spec.items ?? spec.steps ?? []);
const FOOTNOTE_REPEATS = {
  message: "The footnote repeats one of the items; leave it out or say something new.",
  path: ["footnote"],
};

const distinctOptions = (spec: { options: { text: string }[] }) =>
  allDistinct(spec.options.map((o) => o.text));
const OPTIONS_DIFFER = { message: "Every option must be different.", path: ["options"] };

const distinctPairs = (spec: { pairs: { left: string; right: string }[] }) =>
  allDistinct(spec.pairs.map((p) => p.left)) && allDistinct(spec.pairs.map((p) => p.right));
const PAIRS_DIFFER = {
  message:
    "matching: every left-hand side and every right-hand side must be different, or there is nothing to match.",
  path: ["pairs"],
};

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
    // No heading: the slide always carries the reader's stem (TEACH-198).
    items: items(1, 4),
  }),
  z
    .strictObject({
      kind: z.literal("starter"),
      ...specBase,
      heading: line(SPEC_LIMITS.heading).optional(),
      items: items(1, 3),
      footnote: line(SPEC_LIMITS.footnote).optional(),
    })
    .refine(footnoteNotAnItem, FOOTNOTE_REPEATS),
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
    kind: z.literal("image-text"),
    ...specBase,
    /** The small label over the heading; the recipe's "KEY IDEA" when absent (TEACH-243). */
    caption: line(SPEC_LIMITS.caption).optional(),
    heading: line(SPEC_LIMITS.heading),
    body: line(SPEC_LIMITS.body),
  }),
  z.strictObject({
    kind: z.literal("worked-example"),
    ...specBase,
    heading: line(SPEC_LIMITS.heading).optional(),
    question: line(SPEC_LIMITS.question),
    steps: z.array(listLine(SPEC_LIMITS.step)).min(1).max(4),
  }),
  z
    .strictObject({
      kind: z.literal("instructions"),
      ...specBase,
      heading: line(SPEC_LIMITS.heading).optional(),
      steps: items(1, 4),
      footnote: line(SPEC_LIMITS.footnote).optional(),
    })
    .refine(footnoteNotAnItem, FOOTNOTE_REPEATS),
  z.strictObject({
    kind: z.literal("discussion"),
    ...specBase,
    prompt: line(SPEC_LIMITS.stem),
    footnote: line(SPEC_LIMITS.footnote).optional(),
  }),
  z
    .strictObject({
      kind: z.literal("true-false"),
      ...specBase,
      statement: line(SPEC_LIMITS.stem),
      correct: z.boolean(),
      explanation: line(SPEC_LIMITS.body).optional(),
    })
    .refine((spec) => !isDoubleStatement(spec.statement), {
      message: "A true/false statement makes one claim a pupil can judge, not two joined by 'and'.",
      path: ["statement"],
    }),
  z
    .strictObject({
      kind: z.literal("multiple-choice"),
      ...specBase,
      stem: line(SPEC_LIMITS.stem),
      options: z
        .array(z.strictObject({ text: listLine(SPEC_LIMITS.option), correct: z.boolean() }))
        .length(4),
      explanation: line(SPEC_LIMITS.body).optional(),
    })
    .refine((spec) => exactlyOneCorrect(spec.options), {
      message: "Exactly one option is correct.",
      path: ["options"],
    })
    .refine(distinctOptions, OPTIONS_DIFFER),
  z
    .strictObject({
      kind: z.literal("matching"),
      ...specBase,
      stem: line(SPEC_LIMITS.stem),
      pairs: z
        .array(
          z.strictObject({ left: line(SPEC_LIMITS.term), right: line(SPEC_LIMITS.definition) }),
        )
        .length(3),
    })
    .refine(distinctPairs, PAIRS_DIFFER),
  z
    .strictObject({
      kind: z.literal("fill-gap"),
      ...specBase,
      stem: line(SPEC_LIMITS.stem),
      sentence: line(SPEC_LIMITS.body),
      answers: z.array(line(SPEC_LIMITS.answer)).min(1).max(3),
    })
    .refine(gapsMatchAnswers, oneMarkerPerAnswer),
  z
    .strictObject({
      kind: z.literal("sort"),
      ...specBase,
      stem: line(SPEC_LIMITS.stem),
      /** In the correct order; the recipe shows them in reading order. */
      steps: z.array(listLine(SPEC_LIMITS.option)).length(4),
    })
    .refine((spec) => allDistinct(spec.steps), {
      message: "sort: every step must be different.",
      path: ["steps"],
    })
    .refine((spec) => !isClassifyStem(spec.stem), {
      message:
        "sort is for a genuine sequence. A classify or group task is a matching or multiple-choice slide.",
      path: ["stem"],
    })
    .refine((spec) => !sameLeadingToken(spec.steps), {
      message:
        "sort: the steps read as a list of the same kind of thing, not an order; use matching or multiple-choice for a classify task.",
      path: ["steps"],
    }),
  z.strictObject({
    kind: z.literal("open-response"),
    ...specBase,
    stem: line(SPEC_LIMITS.stem),
    modelAnswer: line(SPEC_LIMITS.body).optional(),
  }),
  z
    .strictObject({
      kind: z.literal("exit-ticket"),
      ...specBase,
      heading: line(SPEC_LIMITS.heading).optional(),
      items: items(3, 3),
      footnote: line(SPEC_LIMITS.footnote).optional(),
    })
    .refine(footnoteNotAnItem, FOOTNOTE_REPEATS),
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
        .array(z.strictObject({ text: listLine(SPEC_LIMITS.option), correct: z.boolean() }))
        .length(4),
    })
    .refine((spec) => exactlyOneCorrect(spec.options), {
      message: "Exactly one option is correct.",
      path: ["options"],
    })
    .refine(distinctOptions, OPTIONS_DIFFER),
  z
    .strictObject({
      type: z.literal("fill-gap"),
      ...blockBase,
      sentence: line(SPEC_LIMITS.body),
      answers: z.array(line(SPEC_LIMITS.answer)).min(1).max(4),
    })
    .refine(gapsMatchAnswers, oneMarkerPerAnswer),
  z
    .strictObject({
      type: z.literal("matching"),
      ...blockBase,
      pairs: z
        .array(
          z.strictObject({ left: line(SPEC_LIMITS.term), right: line(SPEC_LIMITS.definition) }),
        )
        .min(3)
        .max(5),
    })
    .refine(distinctPairs, PAIRS_DIFFER),
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

/**
 * The spec schema for one slide kind / block type, as a plain object schema, or `undefined` for a
 * kind the pipeline cannot generate (`image-text`, `blank`, `image` blocks …). Structured-output
 * providers (Bedrock's tool-based mode) require the top level to be `type: object`; the unions
 * above serialise as a top-level `anyOf`, which Bedrock rejects with a 400. A per-kind schema is
 * also the tighter ask: the model cannot answer with a different kind.
 */
export function slideSpecSchemaFor(kind: string): z.ZodType<SlideSpec> | undefined {
  const option = SlideSpecSchema.options.find((o) => o.shape.kind.value === kind);
  if (!option) return undefined;
  // Only an image-text slide has a photograph; every other kind may not refer to one
  // (TEACH-223 — a worked example that said "A photo shows an animal…" beside no photo).
  if (kind === "image-text") return option as unknown as z.ZodType<SlideSpec>;
  return option.superRefine(noPictureReference) as unknown as z.ZodType<SlideSpec>;
}

/**
 * Every string field of a spec (pupil-facing and `notes`) checked for a reference to a picture
 * that is not there; each offending field is its own issue so the retry names it.
 */
export function noPictureReference(spec: Record<string, unknown>, ctx: z.RefinementCtx): void {
  const visit = (value: unknown, path: (string | number)[]): void => {
    if (typeof value === "string") {
      const root = path[0];
      if (root !== "kind" && root !== "type" && root !== "factRefs" && NO_PHOTO_REF.test(value)) {
        ctx.addIssue({ code: "custom", message: PICTURE_NONE_ANY, path });
      }
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => {
        visit(v, [...path, i]);
      });
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) visit(v, [...path, k]);
    }
  };
  visit(spec, []);
}

/**
 * A picture word on a slide or block that has no photograph. `diagram` is deliberately not here: a
 * teacher drawing "the three particle diagrams on the board" is a normal note.
 */
const NO_PHOTO_REF = /\b(photo|photos|photograph|photographs|picture|pictures|image|images)\b/i;
export const PICTURE_NONE_ANY =
  "This slide has no photograph: do not refer to a picture, photo or image (in the text or the notes).";

/* ------------------------------------------------------------------ */
/* image-text: written to its photograph (TEACH-220)                    */
/* ------------------------------------------------------------------ */

/** What an `image-text` slide's text may rely on: the photograph's evidence, or none at all. */
export type ImageTextPhoto = { visible: string[]; count: "one" | "several"; mustShow: string[] };

const TASK_VERBS =
  /\b(spot|find|count|point (?:to|at)|look (?:for|at)|identify|circle|label|see|notice)\b/gi;
const PLURAL_PICTURE = /\b(pictures|images|photos|photographs)\b/i;
const ANY_PICTURE = /\b(photo|photos|photograph|photographs|picture|pictures|image|images)\b/i;

export const PICTURE_PLURAL = "There is one photograph: say 'the photograph', never 'pictures'.";
export const PICTURE_NONE =
  "This slide has no photograph: write it as plain content and mention no picture, photo or image.";
export const TASK_NOT_VISIBLE = (item: string) =>
  `The photograph does not show "${item}": a task (spot, find, count, point to, identify, circle, label) may name only visible items.`;

/** Words after a task verb, so "spot four flower parts: petals, sepals" is caught within reach. */
const TASK_REACH = 12;

/** The first required item a task names that the photograph does not show, if any. */
export function taskOnHiddenItem(text: string, photo: ImageTextPhoto): string | undefined {
  const seen = new Set(photo.visible.map((v) => v.trim().toLowerCase()));
  const hidden = photo.mustShow.filter((m) => !seen.has(m.trim().toLowerCase()));
  if (hidden.length === 0) return undefined;
  const lower = text.toLowerCase();
  for (const match of lower.matchAll(TASK_VERBS)) {
    const from = (match.index ?? 0) + match[0].length;
    const reach = lower
      .slice(from)
      .split(/\s+/)
      .slice(0, TASK_REACH + 1)
      .join(" ");
    const named = hidden.find((item) => reach.includes(item.trim().toLowerCase()));
    if (named) return named;
  }
  return undefined;
}

/**
 * The `image-text` spec schema written to a photograph: with `"none"` the text may mention no
 * picture; with evidence it says "the photograph" for one and sets no task on an item the picture
 * does not show. Each failure is a validation issue the retry names (ADR 0025 §14).
 */
export function imageTextSpecSchemaFor(photo: ImageTextPhoto | "none" | undefined) {
  const base = slideSpecSchemaFor("image-text");
  if (!base || photo === undefined) return base;
  return base.superRefine((spec, ctx) => {
    if (spec.kind !== "image-text") return;
    const slots: ["heading" | "body", string][] = [
      ["heading", spec.heading],
      ["body", spec.body],
    ];
    for (const [path, text] of slots) {
      if (photo === "none") {
        if (ANY_PICTURE.test(text))
          ctx.addIssue({ code: "custom", message: PICTURE_NONE, path: [path] });
        continue;
      }
      if (photo.count === "one" && PLURAL_PICTURE.test(text)) {
        ctx.addIssue({ code: "custom", message: PICTURE_PLURAL, path: [path] });
      }
      const hidden = taskOnHiddenItem(text, photo);
      if (hidden) ctx.addIssue({ code: "custom", message: TASK_NOT_VISIBLE(hidden), path: [path] });
    }
  }) as unknown as z.ZodType<SlideSpec>;
}

export function blockSpecSchemaFor(type: string): z.ZodType<BlockSpec> | undefined {
  const option = BlockSpecSchema.options.find((o) => o.shape.type.value === type);
  if (!option) return undefined;
  // A worksheet has no photographs at all.
  return option.superRefine(noPictureReference) as unknown as z.ZodType<BlockSpec>;
}
