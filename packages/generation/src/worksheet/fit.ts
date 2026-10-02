import type { AgeBand, Lesson } from "@tj/domain/documents";

/*
 * Who the sheet is for (TEACH-86, rulings 144 and 146): what the lesson call is told about the
 * pupils, and the one rule code holds rather than the model, that marked exam-style items belong
 * at KS4 and post-16 only (or where the brief asks for exam practice). Everything else — task
 * forms, counts, reading load, scaffolds — the model fits to the year group, subject and
 * difficulty; there is no fixed template here.
 */

export type WorksheetFit = {
  ageBand?: AgeBand;
  yearGroup?: string;
  subject?: string;
  /** The reading age the copy is pitched at, when the teacher set one. */
  readingLevel?: string;
  /** The brief's level ("support", "core", "stretch" …), when it set one. */
  level?: string;
  /** Marked, exam-style items are allowed (KS4, post-16, or the brief asks for exam practice). */
  examStyle: boolean;
};

const EXAM_BANDS: ReadonlySet<AgeBand> = new Set(["ks4", "post16"]);
const ASKS_FOR_EXAM = /\b(exam|gcse|a[- ]level|past paper|mark scheme)/i;

export function worksheetFit(lesson: Lesson): WorksheetFit {
  const brief = lesson.brief;
  const asked = brief ? ASKS_FOR_EXAM.test(JSON.stringify(brief)) : false;
  const fit: WorksheetFit = {
    examStyle: (lesson.ageBand !== undefined && EXAM_BANDS.has(lesson.ageBand)) || asked,
  };
  if (lesson.ageBand !== undefined) fit.ageBand = lesson.ageBand;
  if (lesson.yearGroup !== undefined) fit.yearGroup = lesson.yearGroup;
  if (lesson.subject !== undefined) fit.subject = lesson.subject;
  if (lesson.readingLevel !== undefined) fit.readingLevel = lesson.readingLevel;
  if (brief?.level !== undefined) fit.level = brief.level;
  return fit;
}
