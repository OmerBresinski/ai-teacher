import { z } from "zod";
import type { Lesson } from "./lesson";
import type { Series } from "./series";
import { type Slide, SlideSchema } from "./slide";
import type { Worksheet } from "./worksheet";

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
  /** The first slide of a lesson for the card thumbnail; `null` for the other kinds. */
  cover: Slide | null;
  createdAt: string;
  updatedAt: string;
};

export const DocumentSummarySchema = z.object({
  id: z.string(),
  kind: DocumentKindSchema,
  title: z.string(),
  subject: z.string().optional(),
  yearGroup: z.string().optional(),
  themeId: z.string().optional(),
  itemCount: z.number().int().nonnegative(),
  cover: SlideSchema.nullable(),
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
      cover: doc.slides[0] ?? null,
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
      cover: null,
    };
  }
  return { ...base, kind: "series", itemCount: doc.lessonIds.length, cover: null };
}
