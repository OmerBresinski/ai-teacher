/*
 * Ruling 163 (B1): is this a history lesson for the picture rules? The input check names the
 * lesson's real past period once (`historicalPeriod`, `fictionInPeriod` on the lesson), so the
 * rules hold when the teacher leaves the intake's optional subject blank. The subject test stays
 * as a fallback, and keeps lessons stored before the fields existed working as they did.
 */

/**
 * Does a story, play or poem set in a past period (A Christmas Carol) count as historical?
 * Pending Greg's ruling on fiction in a period: `false` exempts fiction (the writer's generated
 * pictures stay allowed); flipping it to `true` is the strict reading.
 */
export const FICTION_IN_PERIOD_IS_HISTORICAL = false;

/** The lesson fields the history test reads; a whole `Lesson` or the writer's brief fits. */
export interface PeriodFields {
  subject?: string;
  historicalPeriod?: string | null;
  fictionInPeriod?: boolean | null;
}

/** True for a history subject, or a lesson set in a real past period (fiction per the constant). */
export function isHistoricalLesson(lesson: PeriodFields | undefined): boolean {
  if (!lesson) return false;
  if (/^hist/i.test(lesson.subject ?? "")) return true;
  if (!lesson.historicalPeriod) return false;
  return lesson.fictionInPeriod === true ? FICTION_IN_PERIOD_IS_HISTORICAL : true;
}

/** The input check's two outputs as the lesson stores them: unset when there is no period. */
export function periodFields(output: {
  historical_period?: string | null;
  fiction_in_period?: boolean;
}): { historicalPeriod?: string; fictionInPeriod?: boolean } {
  if (!output.historical_period) return {};
  return {
    historicalPeriod: output.historical_period,
    fictionInPeriod: output.fiction_in_period === true,
  };
}
