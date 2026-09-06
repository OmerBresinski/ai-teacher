import { z } from "zod";
import { DocumentParseError } from "./migrate";
import type { Id } from "./slide";

/*
 * Series (ADR 0021; D-001 replaces Journey). An ordered collection of lessons: the topic a
 * teacher teaches across a fortnight rather than in one hour. Membership is by id and is not
 * exclusive, so one lesson can sit in several series and the series holds no copy of it.
 * Behavioural reference: TeachDeck `lib/model/types.ts:72-84`, `lib/model/schema.ts:468-530`.
 */

export type Series = {
  id: Id;
  title: string;
  /** Lesson ids, in teaching order. */
  lessonIds: Id[];
  createdAt: string; // ISO
  updatedAt: string; // ISO
};

export const SeriesSchema = z.object({
  id: z.string(),
  title: z.string(),
  lessonIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * A series carries no slides, so there is nothing to migrate: it is parsed on the way out of
 * storage to keep a hand-edited or half-written record from reaching the library page.
 */
export function parseSeries(input: unknown): Series {
  const result = SeriesSchema.safeParse(input);
  if (!result.success) throw new DocumentParseError(result.error, "series");
  return result.data as Series;
}

export function isSeries(input: unknown): input is Series {
  return SeriesSchema.safeParse(input).success;
}
