/*
 * R3 (12 Nov): every new sheet carries its lesson's id, year group and subject. Generated lessons
 * currently store `subject: null` (the round 2 lessons all did), and no subject inference is
 * reachable from this branch (master's check-input names a lesson's historical period, not its
 * subject). SUBJECT INFERENCE HOOK: when the lesson pipeline gains one, call it in
 * `inferLessonSubject` and every sheet builder (Exit ticket, Practice, frame) picks it up here.
 */

/** The lesson's subject as stored, or what `inferLessonSubject` finds; undefined when neither knows. */
export function sheetSubject(lesson: {
  subject?: string | null;
  title?: string;
}): string | undefined {
  const stored = typeof lesson.subject === "string" ? lesson.subject.trim() : "";
  return stored || inferLessonSubject(lesson);
}

/** SUBJECT INFERENCE HOOK: no inference on this branch yet, so nothing is guessed. */
export function inferLessonSubject(_lesson: { title?: string }): string | undefined {
  return undefined;
}
