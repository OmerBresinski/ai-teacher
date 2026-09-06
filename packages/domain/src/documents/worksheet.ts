import { z } from "zod";
import type { AgeBand } from "./lesson";
import { AgeBandSchema } from "./lesson";
import { describeIssues, migrate } from "./migrate";
import { type RichDoc, RichDocSchema } from "./rich-text";
import type { Id } from "./slide";

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
  ageBand?: AgeBand;
  yearGroup?: string;
  subject?: string;
  /** The reading age the copy is pitched at, e.g. "Year 4". Blank means the year group. */
  readingLevel?: string;
  /** BCP-47 tag for spellcheck and hyphenation; "en-GB" unless the teacher says otherwise. */
  language?: string;
};

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

export type WorksheetBlock =
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
  | { id: Id; type: "image"; src: string; alt?: string; widthPct: number; caption?: string }
  | { id: Id; type: "table"; rows: string[][]; header?: boolean }
  | { id: Id; type: "divider" }
  | { id: Id; type: "page-break" };

export const WorksheetBlockSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    type: z.literal("heading"),
    doc: RichDocSchema,
    level: z.union([z.literal(1), z.literal(2)]),
  }),
  z.object({ id: z.string(), type: z.literal("paragraph"), doc: RichDocSchema }),
  z.object({ id: z.string(), type: z.literal("instructions"), doc: RichDocSchema }),
  z.object({
    id: z.string(),
    type: z.literal("question"),
    doc: RichDocSchema,
    number: z.number().optional(),
    answerLines: z.number(),
    answer: z.string().optional(),
    marks: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("multiple-choice"),
    doc: RichDocSchema,
    options: z.array(z.object({ id: z.string(), text: z.string(), correct: z.boolean() })),
    number: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("fill-gap"),
    doc: RichDocSchema,
    gaps: z.array(z.object({ id: z.string(), answer: z.string() })),
    number: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("matching"),
    pairs: z.array(z.object({ id: z.string(), left: z.string(), right: z.string() })),
    number: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("word-search"),
    words: z.array(z.string()),
    size: z.number().min(WORD_SEARCH_MIN_SIZE).max(WORD_SEARCH_MAX_SIZE),
    directions: z.enum(["across-down", "all"]),
    seed: z.number(),
    showWordBank: z.boolean(),
    number: z.number().optional(),
  }),
  z.object({ id: z.string(), type: z.literal("word-bank"), words: z.array(z.string()) }),
  z.object({
    id: z.string(),
    type: z.literal("answer-box"),
    heightPt: z.number(),
    label: z.string().optional(),
  }),
  z.object({ id: z.string(), type: z.literal("lines"), count: z.number() }),
  z.object({
    id: z.string(),
    type: z.literal("image"),
    src: z.string(),
    alt: z.string().optional(),
    widthPct: z.number(),
    caption: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("table"),
    rows: z.array(z.array(z.string())),
    header: z.boolean().optional(),
  }),
  z.object({ id: z.string(), type: z.literal("divider") }),
  z.object({ id: z.string(), type: z.literal("page-break") }),
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
  ageBand: AgeBandSchema.optional(),
  yearGroup: z.string().optional(),
  subject: z.string().optional(),
  readingLevel: z.string().optional(),
  language: z.string().optional(),
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

export function parseWorksheet(input: unknown): Worksheet {
  const result = WorksheetSchema.safeParse(migrate(input));
  if (!result.success) throw new Error(describeIssues(result.error, "worksheet"));
  return result.data as Worksheet;
}

/** A worksheet out of storage. Tolerant where `parseWorksheet` is strict. */
export function parseStoredWorksheet(input: unknown): Worksheet {
  const result = StoredWorksheetSchema.safeParse(migrate(input));
  if (!result.success) throw new Error(describeIssues(result.error, "worksheet"));
  return result.data as Worksheet;
}

export function isWorksheet(input: unknown): input is Worksheet {
  return WorksheetSchema.safeParse(input).success;
}
