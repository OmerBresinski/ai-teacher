import type { UnfinishedReason } from "@tj/domain/documents";

/*
 * The teacher-facing words for an unfinished worksheet (`isUnfinishedWorksheet`): the editor's
 * bar, the Print tooltip, the export dialog and the print route. Plain strings in their own file so
 * the print route's chunk takes them without the editor's components.
 */

export const UNFINISHED_TITLE = "This worksheet didn’t finish.";

/** Why, in the teacher's words, and what they can do about it. */
export const UNFINISHED_REASON: Record<UnfinishedReason, string> = {
  // The job saved its own reason (`generation.failure.message`); this is the fallback.
  failed: "We couldn’t write this sheet. Try again, or delete it.",
  "not-completed":
    "It stopped before every question was written. Delete it, then make a new one from the lesson.",
  placeholder: "Some questions are still placeholders. Write them, or delete the sheet.",
  "missing-answer": "Some questions have no answer for the key. Add them, or delete the sheet.",
};

/** The tooltip on Print and the note on the PDF and Word tabs. */
export const UNFINISHED_PRINT_BLOCKED =
  "This worksheet isn’t finished, so it can’t be printed yet.";

/** The bar while the sheet's job still holds it (`generatingJobId`). */
export const MAKING_TITLE = "This worksheet is still being made.";
export const MAKING_REASON = "It will be ready in a moment. The lesson says when it is.";

/** The bar's button on a failed sheet: the same request again, on the same sheet. */
export const RETRY_LABEL = "Try again";
