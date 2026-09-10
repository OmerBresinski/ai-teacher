import type { Finding, Lesson } from "@tj/domain/documents";
import type { Audience } from "../prompts";

// The plain-text projections moved to `@tj/domain/documents/text` so `checkLesson` can measure the
// same text Evaluate reads (TEACH-210); re-exported so the stages' import paths stand.
export { blockText, slideText } from "@tj/domain/documents";

/*
 * Small pure helpers the stages share: the audience block from a lesson, the plain-text
 * projection of slides and blocks (what Evaluate and Repair read, ADR 0025 §11 — now in
 * `@tj/domain`), the generation-state accessor, and the finding a budget stop records (§15).
 */

/** The residual a stage records when the per-lesson budget stops it between calls (ADR 0025 §15). */
export const BUDGET_FINDING = (by: "usd" | "tokens", where: string): Finding => ({
  check: "budget",
  severity: "error",
  target: {},
  message: `Generation stopped at ${where}: the lesson's ${by === "usd" ? "cost" : "token"} cap was reached. What was written is kept.`,
});

export function audienceOf(lesson: Lesson): Audience {
  return {
    subject: lesson.subject,
    yearGroup: lesson.yearGroup,
    ageBand: lesson.ageBand,
    readingLevel: lesson.readingLevel,
    language: lesson.language,
    classContext: lesson.brief?.classContext,
  };
}

/** The generation record a later stage extends; Plan writes it, so it is present from then on. */
export function generationOf(lesson: Lesson): NonNullable<Lesson["generation"]> {
  if (!lesson.generation) throw new Error("lesson has no generation state; Plan has not run");
  return lesson.generation;
}
