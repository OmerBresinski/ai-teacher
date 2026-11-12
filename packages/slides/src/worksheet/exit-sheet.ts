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

const yearOf = (yearGroup: string) =>
  isEarlyYears(yearGroup) ? 2 : Number(/\d+/.exec(yearGroup)?.[0]) || 7;

/**
 * R5 (12 Nov key check: "a one-word answer gets 3 lines while a two-part explanation gets 2"):
 * answer space comes from the key, within the year band's limits. Words a pupil writes on one
 * ruled line (bigger hands, the 15 mm/11 mm/9 mm rulings of `SHEET_SIZES`; a key is written in
 * full sentences, a pupil's answer is usually shorter) and the most lines a task gets.
 */
export const WORDS_PER_LINE = { ks1: 8, ks2: 9, secondary: 11 } as const;
export const MAX_ANSWER_LINES = { ks1: 4, ks2: 5, secondary: 6 } as const;
const bandOfYear = (year: number) => (year <= 2 ? "ks1" : year <= 6 ? "ks2" : "secondary");

const plain = (text: string) =>
  text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The task names its options and the key is one of them, near word for word ("...: leaving close
 * wooden houses standing or pulling houses down to make gaps?" / "Pulling houses down to make
 * gaps."): the pupil copies a choice, one line.
 */
export function picksAnOption(task: string, answer: string): boolean {
  const a = plain(answer).replace(/^(the|a|an) /, "");
  return a.length > 0 && wordCount(a) <= 8 && / or /.test(plain(task)) && plain(task).includes(a);
}

/** The task asks for two or three things ("Name two ways", "Give one reason and one example"). */
const ASKS_PARTS =
  /\b(two|three|2|3|both)\b(?:\s+\w+)?\s+(reasons?|ways?|things?|facts?|examples?|products?|features?|differences?|changes?|causes?|jobs?|steps?|gases?|substances?)\b|\bone\b[^.?]*\band one\b|,? (?:and|then) (?:what|how|why|which|explain|say|give|name)\b/i;

/** The task asks the pupil to judge a claim or give a reason: an explanation, wherever the word sits. */
const ASKS_REASON =
  /\b(explain|why|because|is (?:the \w+|this|that|it|she|he|they) (?:right|correct|true)|are they right|correct (?:the|this|their|his|her) )/i;

/** How many parts the key has: its sentences, or its ";" parts. */
const answerParts = (answer: string) =>
  Math.max(sentencesOf(answer).length, answer.split(";").filter((p) => p.trim()).length);

/**
 * Lines for a task written on ruled lines (explain or short), from the key: its length at the
 * band's words per line, at
 * least one line per part the key has or the task asks for, an explanation at least 2 lines (3 from
 * Year 3) when its key is more than a few words, a picked option one line; at most the band's cap.
 */
export function answerLinesFor(
  space: "explain" | "short",
  answer: string,
  yearGroup: string,
  task = "",
): number {
  const band = bandOfYear(yearOf(yearGroup));
  const words = wordCount(answer);
  if (task && picksAnOption(task, answer)) return 1;
  // A short list ("Glucose and oxygen.") fits one line however many things the task asks for.
  const asked = words > 4 && ASKS_PARTS.test(task) ? 2 : 1;
  const parts = Math.max(answerParts(answer), asked);
  let lines = Math.max(Math.ceil(words / WORDS_PER_LINE[band]), parts);
  if ((space === "explain" || ASKS_REASON.test(task)) && words > 4)
    lines = Math.max(lines, band === "ks1" ? 2 : 3);
  return Math.min(MAX_ANSWER_LINES[band], Math.max(1, lines));
}

/** A task drawn rather than written: a bar model, number line or diagram to make. */
const DRAWN_METHOD = /\b(bar model|number line|diagram|tape diagram|array)\b/i;

/**
 * The working box (R5): a bar model or number line gets a box to draw in; otherwise the base box
 * for up to two steps of working and a sixth of a box more for each step after, at most a third
 * more than the base (print's page fill grows a box up to twice). Steps are the operations in
 * the key's working.
 */
export function workingBoxPt(task: string, working: string | undefined): number {
  if (DRAWN_METHOD.test(task)) return DRAW_BOX_PT;
  const steps = (working?.match(/[×÷+−*]|\s-\s|=/g) ?? []).filter((s) => s !== "=").length;
  return Math.min(64, WORKING_BOX_PT + Math.max(0, steps - 2) * 8);
}

/** The blocks under a task (or a lettered part) that give the pupil room to answer. */
function spaceBlocks(
  space: AnswerSpace,
  answer: string,
  yearGroup: string,
  ids: () => string,
  label?: string,
  task = "",
  working?: string,
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
    const h = workingBoxPt(task, working);
    return [box(h, label ? `${label} Working and answer` : "Working and answer")];
  }
  const lines = answerLinesFor(space, answer, yearGroup, task);
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

/**
 * One task as blocks: the numbered question, then its answer space by task type (lettered parts
 * when `split` and the slide packed several tasks into one). Shared with the Practice sheet (T7).
 */
export function answeredTaskBlocks(
  item: Pick<DigestAsked, "question" | "answer" | "working">,
  yearGroup: string,
  ids: () => string,
  { split = true }: { split?: boolean } = {},
): WorksheetBlock[] {
  const parts = split ? letteredParts(item) : undefined;
  if (!parts) {
    const space = answerSpace(item.question, item.working);
    const ruled = space === "explain" || space === "short";
    return [
      {
        id: ids(),
        type: "question",
        doc: docFromText(item.question),
        answerLines: ruled ? answerLinesFor(space, item.answer, yearGroup, item.question) : 0,
        answer: answerWithWorking(item),
      },
      ...(ruled
        ? []
        : spaceBlocks(space, item.answer, yearGroup, ids, undefined, item.question, item.working)),
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
        p.task,
        i === last ? item.working : undefined,
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
    ...items.flatMap((item) => answeredTaskBlocks(item, digest.lesson.yearGroup, ids)),
  ];
  return { ok: true, blocks: numberQuestions(blocks) };
}
