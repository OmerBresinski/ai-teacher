import { z } from "zod";
import type { Lesson } from "./lesson";
import type { Series } from "./series";
import { type Slide, type SlideElement, SlideSchema } from "./slide";
import {
  type PageSize,
  type Worksheet,
  type WorksheetBlock,
  WorksheetBlockSchema,
  type WorksheetHeader,
  WorksheetSchema,
} from "./worksheet";

/*
 * Document summary (ADR 0024 §3; glossary "Document summary"). The list-endpoint shape of a
 * document: the promoted columns of the `documents` row, never the body. One `summarise()` here
 * replaces the mock store's hand-filled `DocumentSummary`; the repository module writes the
 * promoted columns from its result on every write, and the library reads them from the list query.
 */

export const DOCUMENT_KINDS = ["lesson", "worksheet", "series"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DocumentKindSchema = z.enum(DOCUMENT_KINDS);

export type DocumentSummary = {
  id: string;
  kind: DocumentKind;
  title: string;
  subject?: string;
  yearGroup?: string;
  themeId?: string;
  /** Slides for a lesson, blocks for a worksheet, lessons for a series. */
  itemCount: number;
  /** Worksheets only: the sum of the question blocks' marks, as the sheet prints them. */
  marks?: number;
  /**
   * What the card thumbnail paints: the first slide of a lesson, the top of page 1 of a worksheet
   * (UX ruling 31), `null` for a series.
   */
  cover: Slide | WorksheetCover | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * The top of a worksheet's page 1, enough for a card to draw it without pagination: the header
 * and the first blocks, tagged so a reader can tell it from a slide (a slide has no `kind`).
 */
export type WorksheetCover = {
  kind: "worksheet";
  header: WorksheetHeader;
  blocks: WorksheetBlock[];
  pageSize: PageSize;
  /** Mirrors `Worksheet.showMarks` so the miniature prints what the sheet prints. */
  showMarks?: boolean;
};

export const WorksheetCoverSchema = z.object({
  kind: z.literal("worksheet"),
  header: WorksheetSchema.shape.header,
  blocks: z.array(WorksheetBlockSchema),
  pageSize: z.enum(["A4", "Letter"]),
  showMarks: z.boolean().optional(),
}) as z.ZodType<WorksheetCover>;

/** Blocks a worksheet cover carries: the card is one frame high, so page 1's first few. */
export const COVER_BLOCKS = 8;
/** Characters of rich text a cover block keeps; a card never shows more. */
export const COVER_TEXT_CHARS = 160;
/** A data-URL image longer than this is dropped from the cover (ADR 0021 §5); inline SVGs stay. */
const COVER_IMAGE_BYTES = 16 * 1024;

export function isWorksheetCover(cover: DocumentSummary["cover"]): cover is WorksheetCover {
  return cover !== null && "kind" in cover && cover.kind === "worksheet";
}

export const DocumentSummarySchema = z.object({
  id: z.string(),
  kind: DocumentKindSchema,
  title: z.string(),
  subject: z.string().optional(),
  yearGroup: z.string().optional(),
  themeId: z.string().optional(),
  itemCount: z.number().int().nonnegative(),
  marks: z.number().int().nonnegative().optional(),
  // The tagged worksheet shape first: a slide has no `kind` key, so every stored slide cover
  // still parses through `SlideSchema`.
  cover: z.union([WorksheetCoverSchema, SlideSchema]).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Document = Lesson | Worksheet | Series;

/** The kind of a parsed document, from its distinguishing collection. */
export function documentKind(doc: Document): DocumentKind {
  if ("slides" in doc) return "lesson";
  if ("blocks" in doc) return "worksheet";
  return "series";
}

const isDataUrl = (src: string): boolean => src.startsWith("data:");

function stripDataUrls(elements: SlideElement[]): void {
  for (const element of elements) {
    if (element.type === "image" && isDataUrl(element.src)) element.src = "";
    else if (element.type === "group") stripDataUrls(element.children);
  }
}

/**
 * The first slide as the library card paints it. Data-URL images (in elements, nested groups and
 * the slide background) are stripped to an empty `src` so a list response and the promoted
 * `cover` column never carry megabytes of base64 (ADR 0021 §5); the renderer shows the image
 * frame without a picture. A deep copy, so a caller mutating the cover never reaches the document.
 */
export function coverOf(lesson: Lesson): Slide | null {
  const first = lesson.slides[0];
  if (!first) return null;
  const cover = structuredClone(first);
  stripDataUrls(cover.elements);
  if (cover.background?.image !== undefined && isDataUrl(cover.background.image)) {
    cover.background.image = "";
  }
  return cover;
}

/**
 * The marks a sheet is out of: the `marks` on its question blocks, which is what the paper prints
 * in brackets. The other numbered blocks (multiple choice, gaps, matching, word search) carry no
 * marks field and count for nothing here, exactly as they print.
 */
export function worksheetMarks(blocks: WorksheetBlock[]): number {
  let total = 0;
  for (const block of blocks) if (block.type === "question") total += block.marks ?? 0;
  return total;
}

/** Rich text cut to about `COVER_TEXT_CHARS` characters: the first paragraph nodes until the budget is spent. */
function clipDoc<T extends { content?: unknown[] }>(doc: T, budget: number): T {
  const nodes = (doc.content ?? []) as { content?: { text?: unknown }[] }[];
  const kept: unknown[] = [];
  let left = budget;
  for (const node of nodes) {
    if (left <= 0) break;
    const leaves = node.content ?? [];
    const out: unknown[] = [];
    for (const leaf of leaves) {
      if (left <= 0) break;
      if (typeof leaf.text === "string" && leaf.text.length > left) {
        out.push({ ...leaf, text: leaf.text.slice(0, left) });
        left = 0;
      } else {
        out.push(leaf);
        if (typeof leaf.text === "string") left -= leaf.text.length;
      }
    }
    kept.push(leaves.length > 0 ? { ...node, content: out } : node);
  }
  return { ...doc, content: kept };
}

/**
 * The top of page 1 as the library card paints it (UX ruling 31): the header and the first
 * `COVER_BLOCKS` blocks with their rich text clipped to `COVER_TEXT_CHARS`, page breaks dropped,
 * image blocks kept by `src` unless the src is a large data URL (the promoted column and the list
 * response never carry megabytes, ADR 0021 §5). A deep copy; the document is never touched.
 */
export function worksheetCoverOf(sheet: Worksheet): WorksheetCover {
  const blocks: WorksheetBlock[] = [];
  for (const source of sheet.blocks) {
    if (blocks.length >= COVER_BLOCKS) break;
    if (source.type === "page-break") continue;
    const block = structuredClone(source);
    if ("doc" in block) block.doc = clipDoc(block.doc, COVER_TEXT_CHARS);
    if (block.type === "image" && isDataUrl(block.src) && block.src.length > COVER_IMAGE_BYTES) {
      block.src = "";
    }
    blocks.push(block);
  }
  return {
    kind: "worksheet",
    header: structuredClone(sheet.header),
    blocks,
    pageSize: sheet.pageSize,
    ...(sheet.showMarks !== undefined ? { showMarks: sheet.showMarks } : {}),
  };
}

export function summarise(doc: Document): DocumentSummary {
  const base = { id: doc.id, title: doc.title, createdAt: doc.createdAt, updatedAt: doc.updatedAt };
  if ("slides" in doc) {
    return {
      ...base,
      kind: "lesson",
      subject: doc.subject,
      yearGroup: doc.yearGroup,
      themeId: doc.themeId,
      itemCount: doc.slides.length,
      cover: coverOf(doc),
    };
  }
  if ("blocks" in doc) {
    // Blocks, not pages: pagination needs DOM measurement (`@tj/editor` worksheet/paginate), so a
    // page count cannot be computed here or in the API.
    return {
      ...base,
      kind: "worksheet",
      subject: doc.subject,
      yearGroup: doc.yearGroup,
      themeId: doc.themeId,
      itemCount: doc.blocks.length,
      marks: worksheetMarks(doc.blocks),
      cover: worksheetCoverOf(doc),
    };
  }
  return { ...base, kind: "series", itemCount: doc.lessonIds.length, cover: null };
}
