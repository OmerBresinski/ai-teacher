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
  /** Options on a multiple-choice item: 3 for EYFS to Year 4, 4 above (ruling 147). */
  optionCount: 3 | 4;
};

const EXAM_BANDS: ReadonlySet<AgeBand> = new Set(["ks4", "post16"]);
/** Whole words only: "examples" or "examine" is not a request for exam practice. */
export const ASKS_FOR_EXAM = /\b(exams?|gcse|a[- ]levels?|past papers?|mark schemes?)\b/i;

/** The teacher's own words on the brief: the topic, the class notes and the clarifying answers. */
function briefText(brief: Lesson["brief"]): string {
  if (!brief) return "";
  return [
    brief.topic,
    brief.classContext?.priorKnowledge,
    brief.classContext?.notes,
    ...Object.values(brief.answers ?? {}),
  ]
    .filter((t): t is string => typeof t === "string")
    .join("\n");
}

/** Year number from "Year 4" / "Y4", when the year group names one. */
const yearNumber = (yearGroup: string | undefined): number | undefined => {
  const m = /(?:year|y)\s*(\d{1,2})/i.exec(yearGroup ?? "");
  return m?.[1] ? Number(m[1]) : undefined;
};

/** Ruling 147: three options for EYFS, KS1 and Years 3–4; four from Year 5 up. */
export function optionCountFor(ageBand: AgeBand | undefined, yearGroup?: string): 3 | 4 {
  if (ageBand === "eyfs" || ageBand === "ks1") return 3;
  const year = yearNumber(yearGroup);
  if (year !== undefined) return year <= 4 ? 3 : 4;
  return 4;
}

export function worksheetFit(lesson: Lesson): WorksheetFit {
  const asked = ASKS_FOR_EXAM.test(briefText(lesson.brief));
  const brief = lesson.brief;
  const fit: WorksheetFit = {
    examStyle: (lesson.ageBand !== undefined && EXAM_BANDS.has(lesson.ageBand)) || asked,
    optionCount: optionCountFor(lesson.ageBand, lesson.yearGroup),
  };
  if (lesson.ageBand !== undefined) fit.ageBand = lesson.ageBand;
  if (lesson.yearGroup !== undefined) fit.yearGroup = lesson.yearGroup;
  if (lesson.subject !== undefined) fit.subject = lesson.subject;
  if (lesson.readingLevel !== undefined) fit.readingLevel = lesson.readingLevel;
  if (brief?.level !== undefined) fit.level = brief.level;
  return fit;
}
