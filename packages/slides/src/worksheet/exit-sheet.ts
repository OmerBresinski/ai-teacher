import type { WorksheetBlock } from "@tj/domain/documents";
import { docFromText, uid } from "../factories";
import {
  type DigestAsked,
  EXIT_TICKET_MIN_ITEMS,
  isEarlyYears,
  type LessonDigest,
  sheetExitItems,
  UNAVAILABLE_REASONS,
} from "./digest";
import { numberQuestions } from "./factories";

/*
 * The Exit ticket sheet (worksheets plan v2 §2d, ticket T6): the lesson's own exit ticket on
 * paper, copied from the exit-ticket slide through the digest. No model call ($0). The slide keeps
 * its exit ticket (11 Nov, item 46); the sheet is a copy, read when the sheet is asked for, so a
 * teacher's edits to the slide carry over (D1).
 *
 * Pure and here, beside the digest, so the worker (`@tj/generation` `buildSheet`) and the
 * `/worksheets/new` flow make the same sheet.
 */

/** Recorded in `generation.promptVersions` for a sheet built from the slides (no prompt). */
export const SLIDE_SHEET_VERSION = "worksheet-slides.v1";

export const EXIT_SHEET_HEADING = "Exit ticket";
export const EXIT_SHEET_INSTRUCTION = "Answer each question in the space below it.";

export type SlideSheetBuild =
  | { ok: true; blocks: WorksheetBlock[] }
  | { ok: false; code: "not-enough-lesson"; reason: string };

/** D12: the working goes after the answer in brackets, unless the answer already shows it. */
export function answerWithWorking(item: Pick<DigestAsked, "answer" | "working">): string {
  const answer = item.answer.trim();
  const working = item.working?.trim();
  if (!working || answer.includes(working)) return answer;
  return `${answer} (${working})`;
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

const MIN_LINES = 2;
const MAX_LINES = 6;

/**
 * Lines to write on: about one per ten words of the model answer, 2 to 6 (the block guide's
 * range). Years 1-2 write a word or a number: 2 lines, or 4 for a drawing task.
 */
export function exitAnswerLines(item: DigestAsked, early: boolean): number {
  if (early) return /^\W*draw\b/i.test(item.question) ? 4 : MIN_LINES;
  const lines = Math.ceil(wordCount(item.answer) / 10);
  return Math.min(MAX_LINES, Math.max(MIN_LINES, lines));
}

/**
 * The Exit ticket sheet's blocks: a heading, one instruction line and one numbered `question`
 * per exit task, its answer from the slide's model answer and working. Fewer than
 * `EXIT_TICKET_MIN_ITEMS` tasks (after the Years 1-2 spoken-task filter) is no sheet, with the
 * greyed reason.
 */
export function exitTicketBlocks(digest: LessonDigest, ids: () => string = uid): SlideSheetBuild {
  const items = sheetExitItems(digest);
  if (items.length < EXIT_TICKET_MIN_ITEMS) {
    return { ok: false, code: "not-enough-lesson", reason: UNAVAILABLE_REASONS["exit-ticket"] };
  }
  const early = isEarlyYears(digest.lesson.yearGroup);
  const blocks: WorksheetBlock[] = [
    { id: ids(), type: "heading", doc: docFromText(EXIT_SHEET_HEADING), level: 1 },
    { id: ids(), type: "instructions", doc: docFromText(EXIT_SHEET_INSTRUCTION) },
    ...items.map(
      (item): WorksheetBlock => ({
        id: ids(),
        type: "question",
        doc: docFromText(item.question),
        answerLines: exitAnswerLines(item, early),
        answer: answerWithWorking(item),
      }),
    ),
  ];
  return { ok: true, blocks: numberQuestions(blocks) };
}
