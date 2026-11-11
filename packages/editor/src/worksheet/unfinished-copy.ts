import type { UnfinishedReason } from "@tj/domain/documents";

/*
 * The teacher-facing words for an unfinished worksheet (`isUnfinishedWorksheet`): the editor's
 * bar, the Print tooltip, the export dialog and the print route. Plain strings in their own file so
 * the print route's chunk takes them without the editor's components.
 */

export const UNFINISHED_TITLE = "This worksheet didn’t finish.";

/** Why, in the teacher's words, and what they can do about it. */
export const UNFINISHED_REASON: Record<UnfinishedReason, string> = {
  "not-completed":
    "It stopped before every question was written. Delete it, then make a new one from the lesson.",
  placeholder: "Some questions are still placeholders. Write them, or delete the sheet.",
  "missing-answer": "Some questions have no answer for the key. Add them, or delete the sheet.",
};

/** The tooltip on Print and the note on the PDF and Word tabs. */
export const UNFINISHED_PRINT_BLOCKED =
  "This worksheet isn’t finished, so it can’t be printed yet.";
