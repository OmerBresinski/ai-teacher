import type { Worksheet, WorksheetBlock } from "@tj/domain/documents";
import { type AnswerEntry, answerKey } from "./answers";
import { gapWidths } from "./gaps";
import { CONTENT_H } from "./metrics";

/**
 * Pagination (TeachDeck `lib/worksheet/paginate.ts`; SPEC §9): blocks flow across the sheet's
 * pages, whichever paper it is on. Heights are measured from the real DOM at 1:1 (see
 * `measure.tsx`) and handed to this pure function, so the editor and the print route always split
 * at the same place.
 */

export type FlowItem =
  /** `gapChars`: a fill-gap block's blank width (`gapWidths`); unset on every other block. */
  | { key: string; kind: "block"; block: WorksheetBlock; gapChars?: number }
  | { key: string; kind: "rag" }
  | { key: string; kind: "key-title" }
  | { key: string; kind: "key-entry"; entry: AnswerEntry };

export type WorksheetPage = {
  index: number;
  items: FlowItem[];
};

export type Pagination = {
  pages: WorksheetPage[];
  /** Keys of items taller than a whole page — these block printing. */
  oversize: string[];
};

export const HEADER_KEY = "__header__";
export const KEY_TITLE_KEY = "__answer-key__";
export const RAG_KEY = "__rag__";

/** The document as a single ordered flow: blocks, then the answer key pages. */
export function buildFlow(worksheet: Worksheet, includeAnswerKey: boolean): FlowItem[] {
  const gaps = gapWidths(worksheet.blocks);
  const items: FlowItem[] = worksheet.blocks.map((block) => ({
    key: block.id,
    kind: "block" as const,
    block,
    gapChars: gaps.get(block.id),
  }));
  // The self-assessment strip is the last thing a pupil fills in, so it goes after the questions
  // and before the answer key. It flows straight after them, on whichever page it fits.
  if (worksheet.selfAssessment) items.push({ key: RAG_KEY, kind: "rag" });
  if (!includeAnswerKey) return items;
  const entries = answerKey(worksheet.blocks);
  if (entries.length === 0) return items;
  items.push({ key: KEY_TITLE_KEY, kind: "key-title" });
  for (const entry of entries) items.push({ key: `key:${entry.id}`, kind: "key-entry", entry });
  return items;
}

const isPageBreak = (item: FlowItem) => item.kind === "block" && item.block.type === "page-break";

const isAnswerSpace = (block: WorksheetBlock) =>
  block.type === "answer-box" || block.type === "lines";

/**
 * Whether a block must print on the same page as the block after it, on paper and in Word alike
 * (`export/docx.ts` sets Word's "keep with next" from this). A heading or an instruction line
 * never ends a page (it belongs to what it introduces), and a question never sits at the foot of a
 * page with its answer box or lines over the page: the pupil would write the answer under the
 * wrong question.
 */
export function blockKeepsWithNext(
  block: WorksheetBlock,
  next: WorksheetBlock | undefined,
): boolean {
  if (!next || next.type === "page-break") return false;
  if (block.type === "heading" || block.type === "instructions") return true;
  return !isAnswerSpace(block) && isAnswerSpace(next);
}

/** `blockKeepsWithNext` over the flow: the strip and the key are never kept with anything. */
export function keepsWithNext(item: FlowItem, next: FlowItem | undefined): boolean {
  return (
    item.kind === "block" && next?.kind === "block" && blockKeepsWithNext(item.block, next.block)
  );
}

/** The answer key always starts a fresh page (research/02 decision 17). */
const startsPage = (item: FlowItem) => item.kind === "key-title";

export function paginate(
  items: FlowItem[],
  heights: Record<string, number>,
  headerHeight: number,
  /** Height of one page's content box; varies with the paper (A4 or Letter). */
  contentH: number = CONTENT_H,
): Pagination {
  const pages: WorksheetPage[] = [];
  const oversize: string[] = [];
  let current: FlowItem[] = [];
  let used = 0;

  const available = () => contentH - (pages.length === 0 ? headerHeight : 0);
  const flush = () => {
    pages.push({ index: pages.length, items: current });
    current = [];
    used = 0;
  };

  for (const [i, item] of items.entries()) {
    // A page break carries no height of its own: it ends the page it sits on. But a break that
    // lands on an otherwise-empty page — a fresh page with nothing on it yet — has nothing to
    // break, so it is a no-op: it stays on the page without flushing. This covers both a leading
    // break (the flow's first item) and a second break landing right after one that just flushed;
    // either way, flushing here would only print a blank page.
    if (isPageBreak(item)) {
      const landsOnEmptyPage = current.length === 0;
      current.push(item);
      if (!landsOnEmptyPage) flush();
      continue;
    }
    if (startsPage(item) && current.length > 0) flush();

    const height = heights[item.key] ?? 0;
    let room = available();
    // A run kept together (a heading, its instructions, the first question and its answer box)
    // moves to a fresh page whole when it does not fit what is left of this one. Only the run's
    // first item decides, and only when the run fits a fresh page: a run taller than a page
    // breaks between its items as before rather than leaving a page empty.
    const prev = items[i - 1];
    if (current.length > 0 && !(prev && keepsWithNext(prev, item))) {
      let run = height;
      for (let j = i; keepsWithNext(items[j] as FlowItem, items[j + 1]); j++)
        run += heights[(items[j + 1] as FlowItem).key] ?? 0;
      if (run > height && used + run > room && run <= contentH) {
        flush();
        room = available();
      }
    }
    // Move to a fresh page when this one is out of room — but only once page 1 already carries
    // something. Reflowing an empty page 1 would leave it holding only the header strip, which
    // prints as a baffling blank first page; instead the block stays put and is reported as
    // oversize, which blocks Print with the existing "won't fit" warning.
    if (used + height > room && current.length > 0) {
      flush();
      room = available();
    }
    if (height > room) oversize.push(item.key);
    current.push(item);
    used += height;
  }

  if (current.length > 0 || pages.length === 0) flush();
  return { pages, oversize };
}
