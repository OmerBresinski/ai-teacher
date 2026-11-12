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
export type UnfinishedReason = "failed" | "not-completed" | "placeholder" | "missing-answer";

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

/**
 * Made by the new path (worksheets plan v2: digest, build, gate, one save): its generation record
 * names the slide-sheet build (`SLIDE_SHEET_VERSION`, "worksheet-slides.v1"), or it failed (only
 * the new path saves `failed`). R4 review (12 Nov): the print blocks below are new with that path;
 * sheets saved before it (old frame and fill jobs, hand-made sheets, recipe frames built in the
 * browser) printed whatever they held, and still do. The recipe id is no marker: `exit-ticket`
 * and `exam-style` are old ids too.
 */
export function madeByNewPath(sheet: Pick<Worksheet, "generation">): boolean {
  const g = sheet.generation;
  if (!g) return false;
  return g.stage === "failed" || /^worksheet-slides\./.test(g.promptVersions.build ?? "");
}

/**
 * Why a sheet must not print at all, first match wins; `null` when the pupil copy may print. Only
 * sheets `madeByNewPath` are judged. A question with no answer never stops the pupil copy (a
 * teacher may add one): it stops only the answer key (`answerKeyBlockedReason`).
 */
export function unfinishedWorksheetReason(
  sheet: Pick<Worksheet, "blocks" | "generation">,
): UnfinishedReason | null {
  if (!madeByNewPath(sheet)) return null;
  if (sheet.generation?.stage === "failed") return "failed";
  if (sheet.generation && !sheet.generation.completedAt) return "not-completed";
  if (sheet.blocks.some((b) => isPlaceholder(b) || hasPlaceholderQuestion(b))) return "placeholder";
  return null;
}

/**
 * Why the answer key (part `key` or `both`) must not print: the sheet's own reason, or, on a new
 * path sheet, a numbered question or multiple choice with no answer, which the key would print as
 * "No answer". A hand-made or old sheet's answers are the teacher's business.
 */
export function answerKeyBlockedReason(
  sheet: Pick<Worksheet, "blocks" | "generation">,
): UnfinishedReason | null {
  const reason = unfinishedWorksheetReason(sheet);
  if (reason) return reason;
  return madeByNewPath(sheet) && sheet.blocks.some(missingAnswer) ? "missing-answer" : null;
}

/**
 * True when the sheet must not look finished or print: a new-path sheet whose job failed or never
 * completed, or that still holds a placeholder. Old and hand-made sheets are never unfinished.
 */
export function isUnfinishedWorksheet(sheet: Pick<Worksheet, "blocks" | "generation">): boolean {
  return unfinishedWorksheetReason(sheet) !== null;
}
