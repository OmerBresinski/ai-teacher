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

/** About 5 cm: a blank bordered box to draw, shade or label in. */
export const DRAW_BOX_PT = 128;
/** Space to show the working and write the answer. */
export const WORKING_BOX_PT = 48;
/** One ruled line's height, for a labelled part's one-line box. */
const LINE_PT = 28;

/** The kind of space a task needs (Lead review of T6, item A1). */
export type AnswerSpace = "draw" | "calculation" | "explain" | "short";

const DRAW = /\b(draw|shade|sketch|label|circle|colour|color)\b/i;
const EXPLAIN = /^\W*(explain|how|why|describe|compare|suggest|evaluate|justify|discuss)\b/i;
const CALC = /\d\s*[+\-−×x÷*/=]\s*\d|\b(calculate|work out)\b/i;

/**
 * Draw, shade, sketch, label or circle → a drawing box; a calculation (working on the slide, or
 * sums in the task) → working space; explain / how / why → 3-4 lines; anything else is a word or
 * a number → one line (more only when the model answer is long).
 */
export function answerSpace(task: string, working: string | undefined): AnswerSpace {
  if (DRAW.test(task)) return "draw";
  if (working?.trim() || CALC.test(task)) return "calculation";
  if (EXPLAIN.test(task)) return "explain";
  return "short";
}

/** Lines for a task written on ruled lines (explain or short). */
export function answerLinesFor(
  space: "explain" | "short",
  answer: string,
  yearGroup: string,
): number {
  const year = isEarlyYears(yearGroup) ? 2 : Number(/\d+/.exec(yearGroup)?.[0]) || 7;
  if (space === "explain") return year >= 10 ? 4 : year <= 2 ? 2 : 3;
  const words = wordCount(answer);
  return words <= 4 ? 1 : Math.min(4, Math.max(2, Math.ceil(words / 10)));
}

/** The blocks under a task (or a lettered part) that give the pupil room to answer. */
function spaceBlocks(
  space: AnswerSpace,
  answer: string,
  yearGroup: string,
  ids: () => string,
  label?: string,
): WorksheetBlock[] {
  const box = (heightPt: number, text?: string): WorksheetBlock => ({
    id: ids(),
    type: "answer-box",
    heightPt,
    ...(text ? { label: text } : {}),
  });
  if (space === "draw") return [box(DRAW_BOX_PT, label)];
  // One box for the working and the answer, so a short sheet stays on one page.
  if (space === "calculation") {
    return [box(WORKING_BOX_PT, label ? `${label} Working and answer` : "Working and answer")];
  }
  const lines = answerLinesFor(space, answer, yearGroup);
  return label ? [box(lines * LINE_PT, label)] : [{ id: ids(), type: "lines", count: lines }];
}

const sentencesOf = (text: string): string[] =>
  (text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? []).map((s) => s.trim()).filter(Boolean);

/**
 * A slide task that packs several tasks into one line, with an answer in matching ";" parts:
 * "Draw a square. Shade half. Find half of 18." / "Two equal parts, one shaded; 9" becomes
 * (a) "Draw a square. Shade half." (b) "Find half of 18." Each of the last parts is one sentence;
 * the first takes the rest. Anything else stays whole (`undefined`).
 */
export function letteredParts(
  item: Pick<DigestAsked, "question" | "answer">,
): { task: string; answer: string }[] | undefined {
  const answers = item.answer
    .split(";")
    .map((a) => a.trim())
    .filter(Boolean);
  if (answers.length < 2) return undefined;
  const sentences = sentencesOf(item.question);
  if (sentences.length < answers.length) return undefined;
  const cut = sentences.length - (answers.length - 1);
  const tasks = [sentences.slice(0, cut).join(" "), ...sentences.slice(cut)];
  return tasks.map((task, i) => ({ task, answer: answers[i] as string }));
}

const LETTERS = "abcdefgh";

/** One exit task as blocks: the numbered question, then its answer space (lettered when split). */
function taskBlocks(item: DigestAsked, yearGroup: string, ids: () => string): WorksheetBlock[] {
  const parts = letteredParts(item);
  if (!parts) {
    const space = answerSpace(item.question, item.working);
    const ruled = space === "explain" || space === "short";
    return [
      {
        id: ids(),
        type: "question",
        doc: docFromText(item.question),
        answerLines: ruled ? answerLinesFor(space, item.answer, yearGroup) : 0,
        answer: answerWithWorking(item),
      },
      ...(ruled ? [] : spaceBlocks(space, item.answer, yearGroup, ids)),
    ];
  }
  // The working belongs to the last part (it is where the slide's sum ends).
  const last = parts.length - 1;
  const label = (i: number) => `${LETTERS[i]})`;
  const answer = parts
    .map(
      (p, i) =>
        `${label(i)} ${i === last ? answerWithWorking({ answer: p.answer, working: item.working }) : p.answer}`,
    )
    .join("; ");
  return [
    {
      id: ids(),
      type: "question",
      doc: docFromText(parts.map((p, i) => `${label(i)} ${p.task}`).join("\n")),
      answerLines: 0,
      answer,
    },
    ...parts.flatMap((p, i) =>
      spaceBlocks(
        answerSpace(p.task, i === last ? item.working : undefined),
        p.answer,
        yearGroup,
        ids,
        label(i),
      ),
    ),
  ];
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
  const blocks: WorksheetBlock[] = [
    { id: ids(), type: "heading", doc: docFromText(EXIT_SHEET_HEADING), level: 1 },
    { id: ids(), type: "instructions", doc: docFromText(EXIT_SHEET_INSTRUCTION) },
    ...items.flatMap((item) => taskBlocks(item, digest.lesson.yearGroup, ids)),
  ];
  return { ok: true, blocks: numberQuestions(blocks) };
}
