import type { RichDoc, WorksheetBlock } from "@tj/domain/documents";

/*
 * Time on task (TEACH-183; moved from `@tj/editor`'s `worksheet/metrics.ts` with the recipes,
 * ADR 0030 item 4). The worksheet job sizes the model's fill against a practice time and flags a
 * sheet that lands far from it, so the rule has to live where the worker can read it. The page
 * geometry stays in the editor: it is pt and CSS, and nothing here needs it.
 */

/**
 * The per-type minute weights `estimateMinutes` sums. Exported so the worksheet job can derive
 * how many blocks of a type fit a practice time (`packages/generation/src/worksheet/frame.ts`)
 * from the same numbers the header uses to say "about 15 min".
 */
export const MINUTE_WEIGHTS = {
  /** A mark and a half per mark on a question block. */
  perMark: 1.5,
  wordSearch: 8,
  matching: 4,
  /** One per gap in a fill-gap block. */
  perGap: 1,
  multipleChoice: 1,
  /** A paragraph is read at eighty words a minute. */
  wordsPerMinute: 80,
  /**
   * A question with no marks (every Practice and Exit ticket item): a minute to read it and write
   * a short answer, plus its answer space, which says how much writing it asks for.
   */
  unmarkedQuestion: 1,
  /** Each ruled answer line under an unmarked question. */
  perAnswerLine: 0.5,
  /** A working-and-answer box after an unmarked question, per 48pt of box (one sum's working). */
  perBox48pt: 1,
} as const;

/**
 * Pupils in Reception to Year 2 read and write more slowly, so their sheet's minutes are scaled
 * up by a quarter; every other year takes the weights as they are.
 */
export const EARLY_YEARS_FACTOR = 1.25;

export type MinutesOptions = {
  /** The sheet's year group ("Year 2", "Reception"): Reception to Year 2 take longer. */
  yearGroup?: string;
};

const early = (yearGroup: string | undefined): boolean => {
  if (!yearGroup) return false;
  if (/reception/i.test(yearGroup)) return true;
  const n = Number(/(\d+)/.exec(yearGroup)?.[1]);
  return n >= 1 && n <= 2;
};

const unmarkedQuestion = (block: WorksheetBlock | undefined): boolean =>
  block?.type === "question" && !block.marks;

/** The marks a sheet is worth: the sum over its question blocks. */
export function marksTotal(blocks: readonly WorksheetBlock[]): number {
  return blocks.reduce((sum, b) => sum + (b.type === "question" ? (b.marks ?? 0) : 0), 0);
}

const wordCount = (doc: RichDoc): number => {
  const text = (doc.content ?? [])
    .flatMap((node) => node.content ?? [])
    .map((leaf) => (typeof leaf.text === "string" ? leaf.text : ""))
    .join(" ")
    .trim();
  return text ? text.split(/\s+/).length : 0;
};

/**
 * How long a sheet takes a pupil, in whole minutes (TEACH-183). Marks at a minute and a half each,
 * a word search 8, a matching block 4, a paragraph a minute per 80 words, a gap a minute, a
 * multiple choice item a minute; a question with no marks a minute plus its answer space (half a
 * minute a line, a minute per 48pt of working box), so a Practice sheet's seven unmarked items are
 * not read as zero (WS8); a quarter longer for Reception to Year 2; the sum to the nearest
 * five, and never under five. A rough guide
 * for the header and the recipe cards, not a timer.
 */
export function estimateMinutes(
  blocks: readonly WorksheetBlock[],
  options: MinutesOptions = {},
): number {
  return roundMinutes(minutesUnrounded(blocks, options));
}

/** The same sum as `estimateMinutes`, before rounding to five: what the fill is sized against. */
export function minutesUnrounded(
  blocks: readonly WorksheetBlock[],
  options: MinutesOptions = {},
): number {
  let minutes = minutesRaw(marksTotal(blocks));
  for (const [i, block] of blocks.entries()) {
    const afterUnmarked = unmarkedQuestion(blocks[i - 1]);
    switch (block.type) {
      case "question":
        if (!block.marks)
          minutes +=
            MINUTE_WEIGHTS.unmarkedQuestion + block.answerLines * MINUTE_WEIGHTS.perAnswerLine;
        break;
      case "answer-box":
        if (afterUnmarked) minutes += (block.heightPt / 48) * MINUTE_WEIGHTS.perBox48pt;
        break;
      case "lines":
        if (afterUnmarked) minutes += block.count * MINUTE_WEIGHTS.perAnswerLine;
        break;
      case "word-search":
        minutes += MINUTE_WEIGHTS.wordSearch;
        break;
      case "matching":
        minutes += MINUTE_WEIGHTS.matching;
        break;
      case "paragraph":
        minutes += wordCount(block.doc) / MINUTE_WEIGHTS.wordsPerMinute;
        break;
      case "fill-gap":
        minutes += block.gaps.length * MINUTE_WEIGHTS.perGap;
        break;
      case "multiple-choice":
        minutes += MINUTE_WEIGHTS.multipleChoice;
        break;
      default:
        break;
    }
  }
  return early(options.yearGroup) ? minutes * EARLY_YEARS_FACTOR : minutes;
}

/** A mark and a half per mark, before rounding. */
const minutesRaw = (marks: number): number => marks * MINUTE_WEIGHTS.perMark;

/** To the nearest five minutes, never under five. */
const roundMinutes = (minutes: number): number => Math.max(5, Math.round(minutes / 5) * 5);

/**
 * The minutes a sheet takes from its marks alone (TEACH-184 item 7): the same rate and rounding
 * as `estimateMinutes`, so a library card built from `DocumentSummary.marks` says what the sheet
 * header says for a sheet of questions. The summary carries no per-block detail (word searches,
 * matching, gaps), so a sheet with those reads a little short on its card; a `minutes` column on
 * the summary would close that gap and is a schema change, left for later.
 */
export function minutesForMarks(marks: number): number {
  return roundMinutes(minutesRaw(marks));
}

/**
 * The header line and the recipe cards: "12 marks · about 25 min" with the marks switch on,
 * "about 25 min" alone with it off (UX ruling 60). The minutes are the same either way.
 */
export function sheetSummary(
  blocks: readonly WorksheetBlock[],
  showMarks = false,
  options: MinutesOptions = {},
): string {
  const minutes = `about ${estimateMinutes(blocks, options)} min`;
  if (!showMarks) return minutes;
  const marks = marksTotal(blocks);
  return `${marks} ${marks === 1 ? "mark" : "marks"} · ${minutes}`;
}
