/*
 * Minutes-paced planning (lab fit-first, approach 8, 29 Sep). A teaching slide is sized to what a
 * teacher covers in two to four minutes of class time; the outline puts material on a slide only
 * while its minutes fit. Minutes are estimated from the facts the slide will carry, word for word:
 * a key idea is explained at a classroom pace (statement, reason, example, with questions to the
 * class), a term takes half a minute to define, a callout a minute to discuss, and a worked
 * example is read out and then modelled a step at a time.
 *
 * Calibrated on the plants diagnosis (plants-diag/NOTES.md): a worked example with a short problem
 * and three steps fits every theme and four steps with a long problem does not; two key ideas plus
 * a callout do not fit, one key idea with a term and a callout is at the limit.
 */

/** The most class time one teaching slide is planned to fill. */
export const TEACH_MINUTES_MAX = 4;
/** Characters of fact text a teacher gets through in a minute of explaining, with questions. */
const CHARS_PER_MINUTE = 90;
const TERM_MINUTES = 0.5;
const CALLOUT_MINUTES = 1;
const STEP_MINUTES = 0.8;

type KeyIdeaText = { statement: string; explanation: string; example: string };
type WorkedExampleText = { problem: string; steps: readonly string[] };

export function keyIdeaMinutes(k: KeyIdeaText | undefined): number {
  if (k === undefined) return 0;
  return Math.max(
    1,
    (k.statement.length + k.explanation.length + k.example.length) / CHARS_PER_MINUTE,
  );
}

export function workedExampleMinutes(x: WorkedExampleText | undefined): number {
  if (x === undefined) return 0;
  return x.problem.length / CHARS_PER_MINUTE + STEP_MINUTES * x.steps.length;
}

export const termMinutes = (terms: number) => TERM_MINUTES * terms;
export const calloutMinutes = CALLOUT_MINUTES;

/** Whether `minutes` of material fits one teaching slide. */
export const fitsMinutes = (minutes: number) => minutes <= TEACH_MINUTES_MAX + 1e-9;
