import { DEFAULT_THEME_ID } from "@tj/domain/documents";

/*
 * The theme a new lesson gets when the teacher has not used one yet (TEACH-258, ruling 116): no
 * theme question before generation, so the brief picks one from the class. The brief offers Years
 * 3 to 11: lower Key Stage 2 gets the bolder Playground, upper Key Stage 2 the default Chalk &
 * Cream, Key Stage 3 the calmer Reading Room, and the exam years Exam Hall. Essay subjects in secondary read better in Reading Room's serif at
 * any year. The teacher's own last choice always wins over this (`readLastClass().themeId`).
 */

const READING_SUBJECTS = new Set(["English", "History", "RE", "Languages"]);

function yearOf(yearGroup: string | undefined): number | null {
  if (!yearGroup) return null;
  if (yearGroup === "Reception") return 0;
  const match = /^Year (\d{1,2})$/.exec(yearGroup);
  return match ? Number(match[1]) : null;
}

export function defaultThemeFor(
  subject: string | undefined,
  yearGroup: string | undefined,
): string {
  const year = yearOf(yearGroup);
  if (year === null) return DEFAULT_THEME_ID;
  if (year <= 4) return "playground";
  if (year <= 6) return DEFAULT_THEME_ID;
  if (subject && READING_SUBJECTS.has(subject)) return "reading-room";
  if (year >= 10) return "exam-hall";
  return "reading-room";
}

/** The theme a lesson starts in: the teacher's last choice, else the class default. */
export function startingTheme(
  remembered: string | undefined,
  subject: string | undefined,
  yearGroup: string | undefined,
): string {
  return remembered || defaultThemeFor(subject, yearGroup);
}
