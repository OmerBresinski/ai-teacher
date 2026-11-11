import { z } from "zod";
import { FindingSchema } from "./finding";
import { type Provenance, provenanceFields } from "./generated-from";
import { GenerationUsageSchema } from "./generation";
import type { AgeBand } from "./lesson";
import { AgeBandSchema } from "./lesson";
import { DocumentParseError, describeIssues, migrate } from "./migrate";
import { type RichDoc, RichDocSchema, richDocToPlainText } from "./rich-text";
import { type Id, type PhotoSource, PhotoSourceSchema } from "./slide";

/*
 * Worksheet document (ADR 0021). A page is A4 portrait (595x842pt) or US Letter (612x792pt).
 * Behavioural reference: TeachDeck `lib/model/types.ts:14-18,360-428`,
 * `lib/model/schema.ts:352-462,496-515`, `lib/model/worksheet-factories.ts:18` and
 * `lib/worksheet/word-search.ts:13-14`.
 */

export const PAGE_A4 = { w: 595, h: 842 } as const;
/** US Letter portrait, 8.5 x 11in at 72pt to the inch (research/02 decision 14). */
export const PAGE_LETTER = { w: 612, h: 792 } as const;

export type PageSize = "A4" | "Letter";

/** Up to four success criteria in the header (research/02 decision 15). */
export const MAX_CRITERIA = 4;

/** Word-search grid side, in cells. */
export const WORD_SEARCH_MIN_SIZE = 8;
export const WORD_SEARCH_MAX_SIZE = 15;

export type Worksheet = {
  version: 1;
  id: Id;
  title: string;
  themeId: string;
  createdAt: string;
  updatedAt: string;
  header: WorksheetHeader;
  blocks: WorksheetBlock[];
  /** Auto-generated from question blocks; toggled on export. */
  includeAnswerKey: boolean;
  /** Paper the sheet is laid out and printed on. A4 unless the teacher says otherwise. */
  pageSize: PageSize;
  /** Red / Amber / Green strip at the foot of the last content page. */
  selfAssessment?: boolean;
  /**
   * Whether "(2 marks)" prints beside the questions and the header counts marks (UX ruling 60).
   * Marks are an assessment convention: on for a sheet whose job is Assess, otherwise unset, which
   * means off. The minutes are computed the same either way.
   */
  showMarks?: boolean;
  ageBand?: AgeBand;
  yearGroup?: string;
  subject?: string;
  /** The reading age the copy is pitched at, e.g. "Year 4". Blank means the year group. */
  readingLevel?: string;
  /** BCP-47 tag for spellcheck and hyphenation; "en-GB" unless the teacher says otherwise. */
  language?: string;
  /** F06 (ADR 0025 §4): the lesson this sheet was generated beside, when it was. */
  lessonId?: Id;
  /** ADR 0030: the `lesson.worksheet` job's checkpoint, usage and residual findings. */
  generation?: WorksheetGeneration;
};

/**
 * `failed` is terminal: the job stopped and saved why (`generation.failure`) before it let the
 * row go. The next request for the lesson reuses the row, as it reuses a `framed` one.
 */
export const WORKSHEET_GENERATION_STAGES = ["framed", "filled", "checked", "failed"] as const;
export type WorksheetGenerationStage = (typeof WORKSHEET_GENERATION_STAGES)[number];

/**
 * Why a worksheet job stopped (WORKSHEETS-PLAN v2 §3c, T2). `too-few-checked` and
 * `not-enough-lesson` have no producer yet: the sheet gate (T7) and the greyed types (T6) add them.
 */
export const WORKSHEET_FAILURE_CODES = [
  "could-not-write",
  "too-few-checked",
  "spend-limit",
  "lesson-changed",
  "not-enough-lesson",
] as const;
export const WorksheetFailureCodeSchema = z.enum(WORKSHEET_FAILURE_CODES);
export type WorksheetFailureCode = z.infer<typeof WorksheetFailureCodeSchema>;

/** The teacher's words for each failure, saved as `failure.message` and shown wherever it shows. */
export const WORKSHEET_FAILURE_MESSAGES: Record<WorksheetFailureCode, string> = {
  "could-not-write": "We couldn’t write this sheet. Try again, or choose another type.",
  "too-few-checked":
    "We couldn’t write enough checked questions for this lesson. Try again, or choose another type.",
  "spend-limit": "This sheet reached its spending limit before it was finished. Try again later.",
  "lesson-changed": "The lesson changed while the sheet was being made. Try again.",
  "not-enough-lesson": "This lesson doesn’t have enough in it for this type of sheet.",
};

export const WorksheetFailureSchema = z.strictObject({
  code: WorksheetFailureCodeSchema,
  message: z.string(),
});
export type WorksheetFailure = z.infer<typeof WorksheetFailureSchema>;

/**
 * The nine worksheet recipes by id (Worksheets and activities, rulings 46 to 55). The recipes
 * themselves live in `@tj/slides` (`WORKSHEET_RECIPES`, ADR 0030 item 4), which domain cannot
 * import, so the id list is here and `@tj/slides` asserts the catalogue matches it. The
 * `/worksheet` request, the job payload and `Worksheet.generation` all validate against it.
 */
export const WORKSHEET_RECIPE_IDS = [
  "exit-ticket",
  "knowledge-check",
  "misconception-check",
  "cloze",
  "matching",
  "word-search",
  "worked-example",
  "reading",
  "exam-style",
  // Worksheets plan v2 (T6): the launch types written from the lesson's slides.
  "practice",
  "quick-quiz",
  "key-words",
] as const;
export const RecipeIdSchema = z.enum(WORKSHEET_RECIPE_IDS);
export type RecipeId = z.infer<typeof RecipeIdSchema>;

/**
 * The launch sheet types (worksheets plan v2 §2): built from the lesson's slides as they stand
 * (`lessonDigest`), saved once, finished or failed (D8), with no frame and no repair pass (D7).
 * `exit-ticket` is the old id, rebuilt from the exit-ticket slide; `exam-style` is the old id,
 * written new for Years 10-11 as Exam practice (T7).
 */
export const SLIDE_SHEET_RECIPE_IDS = [
  "practice",
  "quick-quiz",
  "key-words",
  "exit-ticket",
  "exam-style",
] as const;
export type SlideSheetRecipeId = (typeof SLIDE_SHEET_RECIPE_IDS)[number];

export function isSlideSheetRecipe(id: string): id is SlideSheetRecipeId {
  return (SLIDE_SHEET_RECIPE_IDS as readonly string[]).includes(id);
}

/**
 * The types a teacher can ask for today, in picker order. Only Exit ticket until Practice (T7),
 * Quick quiz (T8) and Key words (T9) land; the old seven are hidden but still parse.
 */
export const OFFERED_RECIPE_IDS: readonly SlideSheetRecipeId[] = [
  "practice",
  "exam-style",
  "exit-ticket",
];

/** What `"auto"` (and the retired default, `knowledge-check`) means: Practice (T7). */
export const DEFAULT_SHEET_RECIPE_ID: SlideSheetRecipeId = "practice";

/** Exam practice is offered to Years 10 and 11 only (plan v2 §2). */
export function offeredForYear(type: SlideSheetRecipeId, year: number | undefined): boolean {
  return type !== "exam-style" || year === 10 || year === 11;
}

/**
 * The offered type a request names, `"auto"` and `knowledge-check` mapped to the default, or
 * `null` when the type is not offered (the API answers 422 `WORKSHEET_TYPE_UNAVAILABLE_MESSAGE`).
 */
export function offeredRecipeFor(id: string): SlideSheetRecipeId | null {
  const wanted = id === "auto" || id === "knowledge-check" ? DEFAULT_SHEET_RECIPE_ID : id;
  return (OFFERED_RECIPE_IDS as readonly string[]).includes(wanted)
    ? (wanted as SlideSheetRecipeId)
    : null;
}

export const WORKSHEET_TYPE_UNAVAILABLE_MESSAGE = "That worksheet type is not available yet.";

/** The practice times `POST /lessons/:id/worksheet` offers (ADR 0030 item 8). */
export const PRACTICE_MINUTES_OPTIONS = [5, 10, 15, 20, 30, 45] as const;
export type PracticeMinutes = (typeof PRACTICE_MINUTES_OPTIONS)[number];

/**
 * ADR 0030: the worksheet job's own state, a subset of the lesson's `GenerationSchema` plus the
 * recipe and the practice time it was built for.
 */
export const WorksheetGenerationSchema = z.strictObject({
  jobId: z.string(),
  stage: z.enum(WORKSHEET_GENERATION_STAGES),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
  promptVersions: z.record(z.string(), z.string()),
  usage: GenerationUsageSchema,
  findings: z.array(FindingSchema),
  recipeId: RecipeIdSchema,
  practiceMinutes: z.number().int().positive(),
  /** Set only at `stage: "failed"`: why the job stopped. */
  failure: WorksheetFailureSchema.optional(),
});
export type WorksheetGeneration = z.infer<typeof WorksheetGenerationSchema>;

/**
 * The page-1 header strip.
 *
 * `subtitle` is the free-text objective line ("I can explain the water cycle"). `criteria` are
 * the success-criteria checkboxes under it, up to four. They are separate fields on purpose: a
 * sheet written before criteria existed keeps its objective exactly where it was, so no document
 * migration is needed.
 */
export type WorksheetHeader = {
  showName: boolean;
  showDate: boolean;
  showClass: boolean;
  title?: string;
  subtitle?: string;
  criteria?: string[];
};

/**
 * Every block carries the F06/F07 provenance fields (ADR 0025 §2) on top of its own shape; the
 * intersection below keeps the per-type members readable.
 */
export type WorksheetBlock = WorksheetBlockBody & Provenance;

type WorksheetBlockBody =
  | { id: Id; type: "heading"; doc: RichDoc; level: 1 | 2 }
  | { id: Id; type: "paragraph"; doc: RichDoc }
  | { id: Id; type: "instructions"; doc: RichDoc }
  | {
      id: Id;
      type: "question";
      doc: RichDoc;
      number?: number;
      answerLines: number;
      answer?: string;
      marks?: number;
    }
  | {
      id: Id;
      type: "multiple-choice";
      doc: RichDoc;
      options: { id: Id; text: string; correct: boolean }[];
      number?: number;
    }
  | { id: Id; type: "fill-gap"; doc: RichDoc; gaps: { id: Id; answer: string }[]; number?: number }
  | { id: Id; type: "matching"; pairs: { id: Id; left: string; right: string }[]; number?: number }
  | {
      id: Id;
      type: "word-search";
      words: string[];
      /** Grid side in cells, 8 to 15. */
      size: number;
      /** `all` adds the diagonals and every direction backwards. */
      directions: "across-down" | "all";
      /** The grid is built from this; "Shuffle" bumps it. */
      seed: number;
      showWordBank: boolean;
      number?: number;
    }
  | { id: Id; type: "word-bank"; words: string[] }
  | { id: Id; type: "answer-box"; heightPt: number; label?: string }
  | { id: Id; type: "lines"; count: number }
  | {
      id: Id;
      type: "image";
      src: string;
      alt?: string;
      widthPct: number;
      caption?: string;
      /** Structured provenance of a Pexels photo (Images project, Decision 5). */
      source?: PhotoSource;
    }
  | { id: Id; type: "table"; rows: string[][]; header?: boolean }
  | { id: Id; type: "divider" }
  | { id: Id; type: "page-break" };

/** F06/F07 provenance on every block (ADR 0025 §2); `z.object` would strip undeclared keys. */
const blockMeta = provenanceFields;

export const WorksheetBlockSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    ...blockMeta,
    type: z.literal("heading"),
    doc: RichDocSchema,
    level: z.union([z.literal(1), z.literal(2)]),
  }),
  z.object({ id: z.string(), ...blockMeta, type: z.literal("paragraph"), doc: RichDocSchema }),
  z.object({ id: z.string(), ...blockMeta, type: z.literal("instructions"), doc: RichDocSchema }),
  z.object({
    id: z.string(),
    ...blockMeta,
    type: z.literal("question"),
    doc: RichDocSchema,
    number: z.number().optional(),
    answerLines: z.number(),
    answer: z.string().optional(),
    marks: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    ...blockMeta,
    type: z.literal("multiple-choice"),
    doc: RichDocSchema,
    options: z.array(z.object({ id: z.string(), text: z.string(), correct: z.boolean() })),
    number: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    ...blockMeta,
    type: z.literal("fill-gap"),
    doc: RichDocSchema,
    gaps: z.array(z.object({ id: z.string(), answer: z.string() })),
    number: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    ...blockMeta,
    type: z.literal("matching"),
    pairs: z.array(z.object({ id: z.string(), left: z.string(), right: z.string() })),
    number: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    ...blockMeta,
    type: z.literal("word-search"),
    words: z.array(z.string()),
    size: z.number().min(WORD_SEARCH_MIN_SIZE).max(WORD_SEARCH_MAX_SIZE),
    directions: z.enum(["across-down", "all"]),
    seed: z.number(),
    showWordBank: z.boolean(),
    number: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    ...blockMeta,
    type: z.literal("word-bank"),
    words: z.array(z.string()),
  }),
  z.object({
    id: z.string(),
    ...blockMeta,
    type: z.literal("answer-box"),
    heightPt: z.number(),
    label: z.string().optional(),
  }),
  z.object({ id: z.string(), ...blockMeta, type: z.literal("lines"), count: z.number() }),
  z.object({
    id: z.string(),
    ...blockMeta,
    type: z.literal("image"),
    src: z.string(),
    alt: z.string().optional(),
    widthPct: z.number(),
    caption: z.string().optional(),
    source: PhotoSourceSchema.optional(),
  }),
  z.object({
    id: z.string(),
    ...blockMeta,
    type: z.literal("table"),
    rows: z.array(z.array(z.string())),
    header: z.boolean().optional(),
  }),
  z.object({ id: z.string(), ...blockMeta, type: z.literal("divider") }),
  z.object({ id: z.string(), ...blockMeta, type: z.literal("page-break") }),
]) as z.ZodType<WorksheetBlock>;

export const WorksheetSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  title: z.string(),
  themeId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  header: z.object({
    showName: z.boolean(),
    showDate: z.boolean(),
    showClass: z.boolean(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    // Up to four success criteria (research/02 decision 15). A sheet saved before they existed
    // simply has no array, and reads back unchanged.
    criteria: z.array(z.string()).max(MAX_CRITERIA).optional(),
  }),
  blocks: z.array(WorksheetBlockSchema),
  includeAnswerKey: z.boolean(),
  // Defaulted, not optional: every sheet saved before Letter existed is A4, and the rest of the
  // code can read `worksheet.pageSize` without a fallback.
  pageSize: z.enum(["A4", "Letter"]).default("A4"),
  selfAssessment: z.boolean().optional(),
  // UX ruling 60: absent means off, so no migration.
  showMarks: z.boolean().optional(),
  ageBand: AgeBandSchema.optional(),
  yearGroup: z.string().optional(),
  subject: z.string().optional(),
  readingLevel: z.string().optional(),
  language: z.string().optional(),
  // F06 (ADR 0025 §4).
  lessonId: z.string().optional(),
  // ADR 0030.
  generation: WorksheetGenerationSchema.optional(),
});

/**
 * The same worksheet, read the way a stored document is read.
 *
 * `WorksheetSchema` refuses a header carrying more than four criteria, which is right for a
 * file arriving from outside: an import that is wrong should say so. It is the wrong answer for
 * a document already in the library — a sheet written by an older build, or by a bug, would be
 * stranded behind an error with no way back. The stored path therefore trims to the cap and
 * opens the sheet.
 */
export const StoredWorksheetSchema = WorksheetSchema.extend({
  header: WorksheetSchema.shape.header.extend({
    criteria: z
      .array(z.string())
      .optional()
      .transform((list) => (list === undefined ? undefined : list.slice(0, MAX_CRITERIA))),
  }),
});

type FillGapBlock = Extract<WorksheetBlock, { type: "fill-gap" }>;

/**
 * The fill-gap sentences from `blocks[start]` on, up to the first block that is not one: the
 * sentences a word bank above them serves, and the run whose blanks share one width.
 */
export function fillGapRun(blocks: readonly WorksheetBlock[], start: number): FillGapBlock[] {
  const run: FillGapBlock[] = [];
  for (const block of blocks.slice(start)) {
    if (block.type !== "fill-gap") break;
    run.push(block);
  }
  return run;
}

/**
 * Gaps in the order their tokens appear in the text. A gap whose token has been deleted from the
 * text is an orphan — it is excluded here rather than appended, so the answer key never prints an
 * answer to a blank that is not on the sheet, and a word bank is checked against the blanks a
 * pupil sees.
 */
export function orderedGaps(block: FillGapBlock): FillGapBlock["gaps"] {
  const text = richDocToPlainText(block.doc);
  const seen: FillGapBlock["gaps"] = [];
  for (const match of text.matchAll(/\[\[gap:([^\]]+)\]\]/g)) {
    const gap = block.gaps.find((g) => g.id === match[1]);
    if (gap && !seen.includes(gap)) seen.push(gap);
  }
  return seen;
}

export function parseWorksheet(input: unknown): Worksheet {
  const result = WorksheetSchema.safeParse(migrate(input));
  if (!result.success) throw new DocumentParseError(describeIssues(result.error, "worksheet"));
  return result.data as Worksheet;
}

/** A worksheet out of storage. Tolerant where `parseWorksheet` is strict. */
export function parseStoredWorksheet(input: unknown): Worksheet {
  const result = StoredWorksheetSchema.safeParse(migrate(input));
  if (!result.success) throw new DocumentParseError(describeIssues(result.error, "worksheet"));
  return result.data as Worksheet;
}

export function isWorksheet(input: unknown): input is Worksheet {
  return WorksheetSchema.safeParse(input).success;
}
