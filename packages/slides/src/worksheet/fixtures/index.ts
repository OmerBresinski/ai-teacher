import type { Lesson, Slide } from "@tj/domain/documents";
import halves from "./y2-halves.json";
import romans from "./y4-romans.json";
import rivers from "./y9-rivers.json";
import rates from "./y11-rates.json";

/*
 * Test fixtures only: four lessons recorded on 9 Nov with the current writer (worksheets plan v2
 * T5). The recordings carry no facts, so `fixtureLesson` adds what a planned lesson has.
 */

type Fixture = { title: string; subject: string; yearGroup: string; slides: unknown[] };

export const WORKSHEET_FIXTURES = { halves, romans, rivers, rates } as Record<
  "halves" | "romans" | "rivers" | "rates",
  Fixture
>;

export type WorksheetFixtureName = keyof typeof WORKSHEET_FIXTURES;

/** The recorded lesson as a stored `Lesson`, slides cloned so a test may edit them. */
export function fixtureLesson(name: WorksheetFixtureName, extra: Partial<Lesson> = {}): Lesson {
  const f = WORKSHEET_FIXTURES[name];
  return {
    version: 1,
    id: `fixture-${name}`,
    title: f.title,
    themeId: "studio",
    slides: structuredClone(f.slides) as Slide[],
    createdAt: "2026-11-09T00:00:00.000Z",
    updatedAt: "2026-11-09T00:00:00.000Z",
    subject: f.subject,
    yearGroup: f.yearGroup,
    ...extra,
  } as Lesson;
}
