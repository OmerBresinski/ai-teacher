import { z } from "zod";

export const DocumentKind = z.enum(["lesson", "worksheet"]);
export type DocumentKind = z.infer<typeof DocumentKind>;

export const DocumentSummary = z.object({
  id: z.string().min(1),
  kind: DocumentKind,
  title: z.string(),
  /** Slides for a lesson, blocks for a worksheet. */
  count: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  themeId: z.string(),
  subject: z.string().optional(),
  yearGroup: z.string().optional(),
  deletedAt: z.iso.datetime().optional(),
});
export type DocumentSummary = z.infer<typeof DocumentSummary>;

export const Series = z.object({
  id: z.string().min(1),
  title: z.string(),
  /** Lesson ids, in teaching order. */
  lessonIds: z.array(z.string()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().optional(),
});
export type Series = z.infer<typeof Series>;

export const SeriesWithLessons = z.object({
  series: Series,
  lessons: z.array(DocumentSummary),
});
export type SeriesWithLessons = z.infer<typeof SeriesWithLessons>;

export const LibraryTheme = z.object({
  id: z.string(),
  name: z.string(),
  swatch: z.string(),
  ink: z.string(),
  tags: z.array(z.string()),
});
export type LibraryTheme = z.infer<typeof LibraryTheme>;
