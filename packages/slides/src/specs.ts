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
 *
 * Two kinds of rule (ADR 0025 §7, TEACH-257). A **shape** rule says whether the model gave us the
 * thing at all: the kind literal, a required field, a type, a list the recipe has exactly N slots
 * for, a non-empty string. A shape miss on the retry fails the call. An **editorial** rule is one
 * we wrote about the content — a length cap, a wording rule, distinctness, one `___` per answer —
 * and is tagged with `editorialIssue`, so `callStructured` can tell the two apart: an editorial
 * miss on the retry is accepted and becomes a `spec-rule` finding for Repair. The `soft` build of
 * a schema leaves every editorial rule out; it exists so the accepted answer can still be parsed
 * (trimmed, decoded, enumerators stripped) and never goes to a model.
 */

/** The `___` marker a fill-gap sentence uses for each blank. */
export const GAP_MARKER = "___";

/** The `params` key an editorial issue carries (Zod keeps `params` on custom issues). */
export const EDITORIAL_PARAM = "editorial";

/** What `editorialIssue` returns: the one object both `.refine(fn, …)` and `ctx.addIssue(…)` take. */
export type EditorialIssue = {
  code: "custom";
  message: string;
  path?: PropertyKey[] | undefined;
  params: { [EDITORIAL_PARAM]: true };
};

/**
 * The tag every editorial rule carries. Use it as the second argument of `.refine` or as the
 * argument of `ctx.addIssue` in a `superRefine`; a rule written any other way is a shape rule.
 */
export function editorialIssue(message: string, path?: PropertyKey[]): EditorialIssue {
  return {
    code: "custom",
    message,
    ...(path === undefined ? {} : { path }),
    params: { [EDITORIAL_PARAM]: true },
  };
}

/** Whether one Zod issue came from an editorial rule (see `editorialIssue`). */
export function isEditorialIssue(issue: object): boolean {
  const params: unknown = (issue as { params?: unknown }).params;
  return (
    typeof params === "object" &&
    params !== null &&
    (params as Record<string, unknown>)[EDITORIAL_PARAM] === true
  );
}

/** Which build of a spec schema: `soft` leaves out every editorial rule (never sent to a model). */
export type SpecSchemaOptions = { soft?: boolean | undefined };

export const LEAKED_PUPIL =
  "Pupil-facing text must not contain instructions to the model or house rules (no names, British English, fact ids, JSON).";
export const LEAKED_REPAIR =
  "Notes are for the teacher: say what to do in the room, never describe the correction that was made or the finding.";

export const SPEC_LIMITS = {
  title: 80,
  caption: 24,
  heading: 80,
  item: 160,
  /**
   * A worked-example step: one line (~56 characters) at the body floor across the card. The schema
   * accepts `ceilingOf` this — two lines — so a sentence-long step never fails the job (TEACH-248:
   * a hard 56 cap failed a production lesson twice).
   */
  step: 56,
  /** A worked-example question: two body lines at the floor across the slide (TEACH-247). */
  question: 80,
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

/**
 * What a schema enforces for a cap of `aim` characters (TEACH-255; the TEACH-248 pattern for every
 * text cap): `SPEC_LIMITS` is the one-line ideal the prompts advertise; the ceiling is one and a
 * half times it, past which no recipe can lay the text out. Between the two the fit engine steps
 * the type down and the residual badge reports — the job never fails. The TEACH-253 eval lost
 * three of twenty-four lessons to `option` and `term` enforced at their ideals.
 */
export const ceilingOf = (aim: number) => Math.ceil(aim * 1.5);

/** The message a text over its ceiling gets; the ceiling, not the aim, is what was broken. */
export const tooLong = (aim: number) => `Too long: at most ${ceilingOf(aim)} characters.`;

/**
 * A leading enumerator the model wrote into a list member ("1. ", "2) ", "a) ", "- ") — the layout
 * numbers or bullets the list itself, so it would render twice (TEACH-223). Stripped, not refused.
 */
const ENUMERATOR = /^\s*(?:\d{1,2}[.)]|[a-z][.)]|[-•*])\s+/i;
export const stripEnumerator = (text: string) => text.replace(ENUMERATOR, "");

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
const FOOTNOTE_REPEATS = editorialIssue(
  "The footnote repeats one of the items; leave it out or say something new.",
  ["footnote"],
);

const distinctOptions = (spec: { options: { text: string }[] }) =>
  allDistinct(spec.options.map((o) => o.text));
const OPTIONS_DIFFER = editorialIssue("Every option must be different.", ["options"]);
const ONE_CORRECT = editorialIssue("Exactly one option is correct.", ["options"]);

const distinctPairs = (spec: { pairs: { left: string; right: string }[] }) =>
  allDistinct(spec.pairs.map((p) => p.left)) && allDistinct(spec.pairs.map((p) => p.right));
/** Which side collided, so the retry names it (TEACH-255). */
const pairsDiffer = (spec: { pairs: { left: string; right: string }[] }, ctx: z.RefinementCtx) => {
  if (distinctPairs(spec)) return;
  const side = allDistinct(spec.pairs.map((p) => p.left)) ? "right-hand" : "left-hand";
  ctx.addIssue(
    editorialIssue(
      `matching: two pairs have the same ${side} side; every ${side} side must be different, or there is nothing to match.`,
      ["pairs"],
    ),
  );
};

const oneMarkerPerAnswer = editorialIssue(
  `The sentence needs one ${GAP_MARKER} marker per answer.`,
  ["sentence"],
);
const gapsMatchAnswers = (spec: { sentence: string; answers: string[] }) =>
  countGaps(spec.sentence) === spec.answers.length;

/** A list the recipe can hold more of than the aim, so the cap is editorial: overflow, not a crash. */
const atMost = (n: number, what: string) => editorialIssue(`Too many ${what}: at most ${n}.`);

/* ------------------------------------------------------------------ */
/* The two builds                                                      */
/* ------------------------------------------------------------------ */

function buildSpecs(soft: boolean) {
  /** One editorial `.refine`: in the strict build only. */
  const rule = <S extends z.ZodType>(
    schema: S,
    check: (value: z.output<S>) => unknown,
    issue: EditorialIssue,
  ): S => (soft ? schema : (schema.refine(check, issue) as S));
  /** One editorial `.superRefine`: in the strict build only. */
  const rules = <S extends z.ZodType>(
    schema: S,
    refinement: (value: z.output<S>, ctx: z.RefinementCtx) => void,
  ): S => (soft ? schema : (schema.superRefine(refinement) as S));

  /**
   * One pupil-facing text slot: trimmed, entities decoded (`&amp;` → `&`; a decoded string is never
   * longer, so the cap is checked after), non-empty (shape), capped at the ceiling and free of
   * prompt vocabulary (both editorial).
   */
  const line = (max: number) =>
    rule(
      rule(
        z.string().trim().overwrite(decodeEntities).min(1),
        (text) => text.length <= ceilingOf(max),
        editorialIssue(tooLong(max)),
      ),
      (text) => !hasLeakedPupilPhrase(text),
      editorialIssue(LEAKED_PUPIL),
    );

  /** Teacher notes: the same decoding and cap, but the leak test is for repair commentary. */
  const notesLine = (max: number) =>
    rule(
      rule(
        z.string().trim().overwrite(decodeEntities).min(1),
        (text) => text.length <= ceilingOf(max),
        editorialIssue(tooLong(max)),
      ),
      (text) => !hasLeakedRepairPhrase(text),
      editorialIssue(LEAKED_REPAIR),
    );

  /** One member of a list the layout numbers or bullets: `line`, with any enumerator stripped. */
  const listLine = (max: number) =>
    rule(
      rule(
        z.string().trim().overwrite(decodeEntities).overwrite(stripEnumerator).min(1),
        (text) => text.length <= ceilingOf(max),
        editorialIssue(tooLong(max)),
      ),
      (text) => !hasLeakedPupilPhrase(text),
      editorialIssue(LEAKED_PUPIL),
    );

  /**
   * A list the recipe lays one slot per member for (`LIST_SLOTS`): the bounds are shape —
   * `fillItems` refuses a spec with more members than slots, so accepting one would crash the
   * materialiser, not overflow a slide.
   */
  const items = (min: number, max: number) => z.array(listLine(SPEC_LIMITS.item)).min(min).max(max);

  const specBase = {
    /** `LessonFacts` ids this slide or block covers; copied to every element's `generatedFrom`. */
    factRefs: z.array(z.string()),
    /** Teacher notes for the slide (`Slide.notes`). */
    notes: notesLine(SPEC_LIMITS.notes).optional(),
  };

  /* ---------------------------------------------------------------- */
  /* Slide specs                                                       */
  /* ---------------------------------------------------------------- */

  const slide = z.discriminatedUnion("kind", [
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
    rule(
      z.strictObject({
        kind: z.literal("starter"),
        ...specBase,
        heading: line(SPEC_LIMITS.heading).optional(),
        items: items(1, 3),
        footnote: line(SPEC_LIMITS.footnote).optional(),
      }),
      footnoteNotAnItem,
      FOOTNOTE_REPEATS,
    ),
    z.strictObject({
      kind: z.literal("vocabulary"),
      ...specBase,
      // The recipe shows `vocabularySlots(themeId)` entries and drops the rest, so the cap is
      // editorial; an empty list is not a vocabulary slide.
      entries: rule(
        z
          .array(
            z.strictObject({
              term: line(SPEC_LIMITS.term),
              definition: line(SPEC_LIMITS.definition),
            }),
          )
          .min(1),
        (entries) => entries.length <= 6,
        atMost(6, "entries"),
      ),
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
      // The working is one numbered doc, so a fifth step overflows the card rather than crashing:
      // editorial (TEACH-245 asks the writer to merge, not drop).
      steps: rule(
        z.array(listLine(SPEC_LIMITS.step)).min(1),
        (steps) => steps.length <= 4,
        atMost(4, "steps; merge neighbouring steps"),
      ),
    }),
    rule(
      z.strictObject({
        kind: z.literal("instructions"),
        ...specBase,
        heading: line(SPEC_LIMITS.heading).optional(),
        steps: items(1, 4),
        footnote: line(SPEC_LIMITS.footnote).optional(),
      }),
      footnoteNotAnItem,
      FOOTNOTE_REPEATS,
    ),
    z.strictObject({
      kind: z.literal("discussion"),
      ...specBase,
      prompt: line(SPEC_LIMITS.stem),
      footnote: line(SPEC_LIMITS.footnote).optional(),
    }),
    rule(
      z.strictObject({
        kind: z.literal("true-false"),
        ...specBase,
        statement: line(SPEC_LIMITS.stem),
        correct: z.boolean(),
        explanation: line(SPEC_LIMITS.body).optional(),
      }),
      (spec) => !isDoubleStatement(spec.statement),
      editorialIssue(
        "A true/false statement makes one claim a pupil can judge, not two joined by 'and'.",
        ["statement"],
      ),
    ),
    rule(
      rule(
        z.strictObject({
          kind: z.literal("multiple-choice"),
          ...specBase,
          stem: line(SPEC_LIMITS.stem),
          // Four option elements on the recipe: exactly four is shape.
          options: z
            .array(z.strictObject({ text: listLine(SPEC_LIMITS.option), correct: z.boolean() }))
            .length(4),
          explanation: line(SPEC_LIMITS.body).optional(),
        }),
        (spec) => exactlyOneCorrect(spec.options),
        ONE_CORRECT,
      ),
      distinctOptions,
      OPTIONS_DIFFER,
    ),
    rules(
      z.strictObject({
        kind: z.literal("matching"),
        ...specBase,
        stem: line(SPEC_LIMITS.stem),
        // Three term cards and three definition cards on the recipe: exactly three is shape.
        pairs: z
          .array(
            z.strictObject({ left: line(SPEC_LIMITS.term), right: line(SPEC_LIMITS.definition) }),
          )
          .length(3),
      }),
      pairsDiffer,
    ),
    rule(
      z.strictObject({
        kind: z.literal("fill-gap"),
        ...specBase,
        stem: line(SPEC_LIMITS.stem),
        sentence: line(SPEC_LIMITS.body),
        answers: rule(
          z.array(line(SPEC_LIMITS.answer)).min(1),
          (answers) => answers.length <= 3,
          atMost(3, "answers"),
        ),
      }),
      gapsMatchAnswers,
      oneMarkerPerAnswer,
    ),
    rule(
      rule(
        rule(
          z.strictObject({
            kind: z.literal("sort"),
            ...specBase,
            stem: line(SPEC_LIMITS.stem),
            /** In the correct order; the recipe shows them in reading order. Four cards: shape. */
            steps: z.array(listLine(SPEC_LIMITS.option)).length(4),
          }),
          (spec) => allDistinct(spec.steps),
          editorialIssue("sort: every step must be different.", ["steps"]),
        ),
        (spec) => !isClassifyStem(spec.stem),
        editorialIssue(
          "sort is for a genuine sequence. A classify or group task is a matching or multiple-choice slide.",
          ["stem"],
        ),
      ),
      (spec) => !sameLeadingToken(spec.steps),
      editorialIssue(
        "sort: the steps read as a list of the same kind of thing, not an order; use matching or multiple-choice for a classify task.",
        ["steps"],
      ),
    ),
    z.strictObject({
      kind: z.literal("open-response"),
      ...specBase,
      stem: line(SPEC_LIMITS.stem),
      modelAnswer: line(SPEC_LIMITS.body).optional(),
    }),
    rule(
      z.strictObject({
        kind: z.literal("exit-ticket"),
        ...specBase,
        heading: line(SPEC_LIMITS.heading).optional(),
        items: items(3, 3),
        footnote: line(SPEC_LIMITS.footnote).optional(),
      }),
      footnoteNotAnItem,
      FOOTNOTE_REPEATS,
    ),
    z.strictObject({
      kind: z.literal("plenary"),
      ...specBase,
      heading: line(SPEC_LIMITS.heading).optional(),
      items: items(1, 3),
    }),
  ]);

  /* ---------------------------------------------------------------- */
  /* Block specs                                                       */
  /* ---------------------------------------------------------------- */

  const blockBase = {
    factRefs: z.array(z.string()),
  };

  const block = z.discriminatedUnion("type", [
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
    rule(
      rule(
        z.strictObject({
          type: z.literal("multiple-choice"),
          ...blockBase,
          text: line(SPEC_LIMITS.body),
          options: z
            .array(z.strictObject({ text: listLine(SPEC_LIMITS.option), correct: z.boolean() }))
            .length(4),
        }),
        (spec) => exactlyOneCorrect(spec.options),
        ONE_CORRECT,
      ),
      distinctOptions,
      OPTIONS_DIFFER,
    ),
    rule(
      z.strictObject({
        type: z.literal("fill-gap"),
        ...blockBase,
        sentence: line(SPEC_LIMITS.body),
        answers: rule(
          z.array(line(SPEC_LIMITS.answer)).min(1),
          (answers) => answers.length <= 4,
          atMost(4, "answers"),
        ),
      }),
      gapsMatchAnswers,
      oneMarkerPerAnswer,
    ),
    rules(
      z.strictObject({
        type: z.literal("matching"),
        ...blockBase,
        // A block has no fixed cards: the floor is shape (two pairs is not a matching task), the
        // cap editorial.
        pairs: rule(
          z
            .array(
              z.strictObject({
                left: line(SPEC_LIMITS.term),
                right: line(SPEC_LIMITS.definition),
              }),
            )
            .min(3),
          (pairs) => pairs.length <= 5,
          atMost(5, "pairs"),
        ),
      }),
      pairsDiffer,
    ),
    z.strictObject({
      type: z.literal("word-bank"),
      ...blockBase,
      words: rule(
        z.array(line(SPEC_LIMITS.word)).min(3),
        (words) => words.length <= 10,
        atMost(10, "words"),
      ),
    }),
  ]);

  return { slide, block };
}

const STRICT = buildSpecs(false);
const SOFT = buildSpecs(true);

export const SlideSpecSchema = STRICT.slide;
export type SlideSpec = z.infer<typeof SlideSpecSchema>;
export type SlideSpecOf<K extends SlideSpec["kind"]> = Extract<SlideSpec, { kind: K }>;

export const BlockSpecSchema = STRICT.block;
export type BlockSpec = z.infer<typeof BlockSpecSchema>;
/** The block union in either build — what a worksheet schema nests (`@tj/generation`). */
export function blockSpecUnion(options: SpecSchemaOptions = {}): typeof BlockSpecSchema {
  return options.soft ? SOFT.block : STRICT.block;
}
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
 *
 * `{ soft: true }` is the same schema with every editorial rule left out (see the module note):
 * what `callStructured` parses an editorially-failed retry with. Never sent to a model.
 */
export function slideSpecSchemaFor(
  kind: string,
  options: SpecSchemaOptions = {},
): z.ZodType<SlideSpec> | undefined {
  const union = options.soft ? SOFT.slide : STRICT.slide;
  const option = union.options.find((o) => o.shape.kind.value === kind);
  if (!option) return undefined;
  // Only an image-text slide has a photograph; every other kind may not refer to one
  // (TEACH-223 — a worked example that said "A photo shows an animal…" beside no photo).
  if (kind === "image-text" || options.soft) return option as unknown as z.ZodType<SlideSpec>;
  return option.superRefine(noPictureReference) as unknown as z.ZodType<SlideSpec>;
}

/**
 * Every string field of a spec (pupil-facing and `notes`) checked for a reference to a picture
 * that is not there; each offending field is its own issue so the retry names it. Editorial.
 */
export function noPictureReference(spec: Record<string, unknown>, ctx: z.RefinementCtx): void {
  const visit = (value: unknown, path: (string | number)[]): void => {
    if (typeof value === "string") {
      const root = path[0];
      if (root !== "kind" && root !== "type" && root !== "factRefs" && NO_PHOTO_REF.test(value)) {
        ctx.addIssue(editorialIssue(PICTURE_NONE_ANY, path));
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
 * does not show. Each failure is an editorial validation issue the retry names (ADR 0025 §14).
 */
export function imageTextSpecSchemaFor(
  photo: ImageTextPhoto | "none" | undefined,
  options: SpecSchemaOptions = {},
) {
  const base = slideSpecSchemaFor("image-text", options);
  if (!base || photo === undefined || options.soft) return base;
  return base.superRefine((spec, ctx) => {
    if (spec.kind !== "image-text") return;
    const slots: ["heading" | "body", string][] = [
      ["heading", spec.heading],
      ["body", spec.body],
    ];
    for (const [path, text] of slots) {
      if (photo === "none") {
        if (ANY_PICTURE.test(text)) ctx.addIssue(editorialIssue(PICTURE_NONE, [path]));
        continue;
      }
      if (photo.count === "one" && PLURAL_PICTURE.test(text)) {
        ctx.addIssue(editorialIssue(PICTURE_PLURAL, [path]));
      }
      const hidden = taskOnHiddenItem(text, photo);
      if (hidden) ctx.addIssue(editorialIssue(TASK_NOT_VISIBLE(hidden), [path]));
    }
  }) as unknown as z.ZodType<SlideSpec>;
}

export function blockSpecSchemaFor(
  type: string,
  options: SpecSchemaOptions = {},
): z.ZodType<BlockSpec> | undefined {
  const union = options.soft ? SOFT.block : STRICT.block;
  const option = union.options.find((o) => o.shape.type.value === type);
  if (!option) return undefined;
  if (options.soft) return option as unknown as z.ZodType<BlockSpec>;
  // A worksheet has no photographs at all.
  return option.superRefine(noPictureReference) as unknown as z.ZodType<BlockSpec>;
}
