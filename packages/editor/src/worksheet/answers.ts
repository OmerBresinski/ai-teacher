import type { WorksheetBlock } from "@tj/domain/documents";
import { docToPlainText } from "../text/static";

/**
 * The answer key (TeachDeck `lib/worksheet/answers.ts`; research/02 decision 17): a separate final
 * page that shares the sheet's numbering, never an inline reveal.
 */

export type FillGapBlock = Extract<WorksheetBlock, { type: "fill-gap" }>;
export type WordSearchBlock = Extract<WorksheetBlock, { type: "word-search" }>;

export type AnswerEntry = {
  /** Block id, so the key entry can be measured and traced back. */
  id: string;
  number: number;
  /** One line per part of the answer. */
  lines: string[];
  marks?: number;
  /** A word search answers with its solved grid, not with lines of text. */
  search?: WordSearchBlock;
};

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const optionLetter = (index: number) => LETTERS[index] ?? "?";

/**
 * Gaps in the order their tokens appear in the text. A gap whose token has been deleted from the
 * text is an orphan — it is excluded here rather than appended, so the answer key never prints an
 * answer to a blank that is not on the sheet.
 */
export function orderedGaps(block: FillGapBlock): FillGapBlock["gaps"] {
  const text = docToPlainText(block.doc);
  const seen: FillGapBlock["gaps"] = [];
  for (const match of text.matchAll(/\[\[gap:([^\]]+)\]\]/g)) {
    const gap = block.gaps.find((g) => g.id === match[1]);
    if (gap && !seen.includes(gap)) seen.push(gap);
  }
  return seen;
}

/**
 * The right-hand column of a matching block is shuffled — a matching exercise where the answer is
 * A, B, C down the page is not an exercise. The shuffle is derived from the block id so the sheet,
 * the answer key and the print route always agree.
 */
export function matchingOrder(id: string, count: number): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  let seed = 0;
  for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) >>> 0;
  for (let i = count - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    const a = order[i] as number;
    order[i] = order[j] as number;
    order[j] = a;
  }
  return order;
}

/** Letter shown against the right-hand item that answers left-hand item `i`. */
export function matchingLetters(id: string, count: number): string[] {
  const order = matchingOrder(id, count);
  const letters: string[] = new Array(count).fill("?");
  order.forEach((pairIndex, position) => {
    letters[pairIndex] = optionLetter(position);
  });
  return letters;
}

const NO_ANSWER = "No answer recorded.";

export function answerEntry(block: WorksheetBlock): AnswerEntry | null {
  const number = "number" in block ? block.number : undefined;
  if (!number) return null;

  switch (block.type) {
    case "question": {
      const answer = block.answer?.trim();
      return { id: block.id, number, marks: block.marks, lines: [answer || NO_ANSWER] };
    }
    case "multiple-choice": {
      const correct = block.options
        .map((option, i) => ({ option, letter: optionLetter(i) }))
        .filter(({ option }) => option.correct);
      if (correct.length === 0) return { id: block.id, number, lines: [NO_ANSWER] };
      return {
        id: block.id,
        number,
        lines: correct.map(({ option, letter }) => `${letter}. ${option.text}`),
      };
    }
    case "fill-gap":
      return {
        id: block.id,
        number,
        lines: orderedGaps(block).map((gap, i) => `${i + 1}. ${gap.answer || NO_ANSWER}`),
      };
    case "matching": {
      const letters = matchingLetters(block.id, block.pairs.length);
      return {
        id: block.id,
        number,
        lines: block.pairs.map((pair, i) => `${pair.left}: ${letters[i]} ${pair.right}`),
      };
    }
    case "word-search":
      // The key prints the same grid with the words ringed, so it carries the block itself rather
      // than a line of text.
      return { id: block.id, number, lines: [], search: block };
    default:
      return null;
  }
}

export function answerKey(blocks: WorksheetBlock[]): AnswerEntry[] {
  const entries: AnswerEntry[] = [];
  for (const block of blocks) {
    const entry = answerEntry(block);
    if (entry) entries.push(entry);
  }
  return entries;
}
