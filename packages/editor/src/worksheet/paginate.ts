import type { Worksheet, WorksheetBlock } from "@tj/domain/documents";
import { type AnswerEntry, answerKey } from "./answers";
import { CONTENT_H } from "./metrics";

/**
 * Pagination (TeachDeck `lib/worksheet/paginate.ts`; SPEC §9): blocks flow across the sheet's
 * pages, whichever paper it is on. Heights are measured from the real DOM at 1:1 (see
 * `measure.tsx`) and handed to this pure function, so the editor and the print route always split
 * at the same place.
 */

export type FlowItem =
  | { key: string; kind: "block"; block: WorksheetBlock }
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
  const items: FlowItem[] = worksheet.blocks.map((block) => ({
    key: block.id,
    kind: "block" as const,
    block,
  }));
  // The self-assessment strip is the last thing a pupil fills in, so it goes after the questions
  // and before the answer key. The page paints it at the foot of whichever page it lands on;
  // pagination only reserves its height.
  if (worksheet.selfAssessment) items.push({ key: RAG_KEY, kind: "rag" });
  if (!includeAnswerKey) return items;
  const entries = answerKey(worksheet.blocks);
  if (entries.length === 0) return items;
  items.push({ key: KEY_TITLE_KEY, kind: "key-title" });
  for (const entry of entries) items.push({ key: `key:${entry.id}`, kind: "key-entry", entry });
  return items;
}

const isPageBreak = (item: FlowItem) => item.kind === "block" && item.block.type === "page-break";

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

  for (const item of items) {
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
