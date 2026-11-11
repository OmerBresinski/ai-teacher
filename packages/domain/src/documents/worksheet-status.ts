import { richDocToPlainText } from "./rich-text";
import type { Worksheet, WorksheetBlock } from "./worksheet";

/*
 * Whether a worksheet is finished enough to print. A sheet the `lesson.worksheet` job left half
 * made (ADR 0030), or one still holding a recipe's placeholder copy, must never look finished: the
 * Library labels it, the editor says so, and print, PDF and Word stay off until it is fixed.
 *
 * The placeholder strings live here, not in `@tj/slides`, so the predicate can read them without
 * an internal dependency; `@tj/slides/worksheet` re-exports them from their old names.
 */

/** The copy on a question the teacher has to write. */
export const PLACEHOLDER_QUESTION = "Write a question on the topic";

/** The prefix on the paragraph a recipe leaves for the model; `isPlaceholder` finds it again. */
export const PLACEHOLDER_PREFIX = "Generation writes this part: ";

/** True for the paragraph a recipe left for the model to replace. */
export function isPlaceholder(block: WorksheetBlock): boolean {
  if (block.type !== "paragraph") return false;
  const first = block.doc.content?.[0]?.content?.[0];
  return typeof first?.text === "string" && first.text.startsWith(PLACEHOLDER_PREFIX);
}

/** Why a sheet is unfinished, first match wins; `null` when it is finished. */
export type UnfinishedReason = "not-completed" | "placeholder" | "missing-answer";

const hasPlaceholderQuestion = (block: WorksheetBlock): boolean =>
  "doc" in block &&
  block.doc !== undefined &&
  richDocToPlainText(block.doc).trim() === PLACEHOLDER_QUESTION;

/** A numbered question or multiple-choice block the answer key would print "No answer" for. */
function missingAnswer(block: WorksheetBlock): boolean {
  if (!("number" in block) || !block.number) return false;
  if (block.type === "question") return !block.answer?.trim();
  if (block.type === "multiple-choice") return !block.options.some((option) => option.correct);
  return false;
}

export function unfinishedWorksheetReason(
  sheet: Pick<Worksheet, "blocks" | "generation">,
): UnfinishedReason | null {
  if (sheet.generation && !sheet.generation.completedAt) return "not-completed";
  if (sheet.blocks.some((b) => isPlaceholder(b) || hasPlaceholderQuestion(b))) return "placeholder";
  // A hand-made sheet's answers are the teacher's business (the block hints say so); only a
  // generated sheet promised an answer key.
  if (sheet.generation && sheet.blocks.some(missingAnswer)) return "missing-answer";
  return null;
}

/**
 * True when the sheet must not look finished: the job never completed, a placeholder is still on
 * the sheet, or a generated sheet has a numbered question with no answer. A blank hand-made sheet
 * (no `generation`, no placeholders) is never unfinished.
 */
export function isUnfinishedWorksheet(sheet: Pick<Worksheet, "blocks" | "generation">): boolean {
  return unfinishedWorksheetReason(sheet) !== null;
}
