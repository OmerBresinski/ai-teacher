import type { Worksheet, WorksheetBlock } from "@tj/domain/documents";
import { type AnswerEntry, answerKey } from "./answers";
import { gapWidths } from "./gaps";
import { BLOCK_GAP, CONTENT_H, LINE_GAP } from "./metrics";

/**
 * Pagination (TeachDeck `lib/worksheet/paginate.ts`; SPEC §9): blocks flow across the sheet's
 * pages, whichever paper it is on. Heights are measured from the real DOM at 1:1 (see
 * `measure.tsx`) and handed to this pure function, so the editor and the print route always split
 * at the same place.
 */

export type FlowItem =
  /**
   * `gapChars`: a fill-gap block's blank width (`gapWidths`); unset on every other block.
   * `split`: a lines question broken across a page (`splitLines`): "head" is the question with
   * its first lines, "tail" the rest of its lines on the next page, with no number or text.
   */
  | {
      key: string;
      kind: "block";
      block: WorksheetBlock;
      gapChars?: number;
      split?: "head" | "tail";
    }
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

/**
 * What a print or export carries (WS8, from the 11 Nov teacher review: "one careless photocopy
 * and the class has the answers"): the pupil sheet alone (the default), the answer key alone, or
 * both, the key on its own page marked "Teacher copy". The editor's page view passes a boolean
 * (its "Show answer key" switch): `true` is both, `false` the pupil sheet.
 */
export type SheetPart = "pupil" | "key" | "both";
export const SHEET_PARTS: readonly SheetPart[] = ["pupil", "key", "both"];

const partOf = (part: SheetPart | boolean): SheetPart =>
  part === true ? "both" : part === false ? "pupil" : part;

/** The document as a single ordered flow: blocks, then the answer key pages. */
export function buildFlow(worksheet: Worksheet, part: SheetPart | boolean): FlowItem[] {
  const which = partOf(part);
  if (which === "key") return keyItems(worksheet);
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
  return which === "both" ? [...items, ...keyItems(worksheet)] : items;
}

/** The answer key's flow: its title, then one entry per answered question; none without answers. */
function keyItems(worksheet: Worksheet): FlowItem[] {
  const entries = answerKey(worksheet.blocks);
  if (entries.length === 0) return [];
  return [
    { key: KEY_TITLE_KEY, kind: "key-title" },
    ...entries.map((entry) => ({ key: `key:${entry.id}`, kind: "key-entry" as const, entry })),
  ];
}

/** Whether a part prints the sheet's header strip on its first page (the key alone does not). */
export const partHasHeader = (part: SheetPart | boolean): boolean => partOf(part) !== "key";

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

/**
 * `blockKeepsWithNext` over the flow. The self-assessment strip also keeps with the block before
 * it, so it never sits alone on a last page: when it does not fit, the last question (with its
 * heading and box, which keep with it in turn) moves over with it.
 */
export function keepsWithNext(item: FlowItem, next: FlowItem | undefined): boolean {
  if (item.kind !== "block" || !next) return false;
  if (next.kind === "rag") return item.block.type !== "page-break";
  return next.kind === "block" && blockKeepsWithNext(item.block, next.block);
}

/** The answer key always starts a fresh page (research/02 decision 17). */
const startsPage = (item: FlowItem) => item.kind === "key-title";

/** A lines question splits only with at least this many lines on each side of the break. */
export const MIN_SPLIT_LINES = 2;

/**
 * A question with ruled lines that does not fit what is left of the page, split after its text
 * when moving it whole would leave more than a third of the page empty (WS8). Each side keeps at
 * least `MIN_SPLIT_LINES` lines, the text never leaves its first lines, and a question answered
 * in a box never splits (a box is one space to write in). Null when it should move whole.
 */
export function splitLines(
  item: FlowItem,
  height: number,
  left: number,
  contentH: number,
  lineGapPt: number,
): { head: FlowItem; headH: number; tail: FlowItem; tailH: number } | null {
  if (item.kind !== "block" || item.block.type !== "question" || item.split) return null;
  const n = item.block.answerLines;
  if (left <= contentH / 3 || n < 2 * MIN_SPLIT_LINES) return null;
  const fixed = height - n * lineGapPt;
  const fit = Math.min(n - MIN_SPLIT_LINES, Math.floor((left - fixed) / lineGapPt));
  if (fit < MIN_SPLIT_LINES) return null;
  const rest = n - fit;
  return {
    head: {
      ...item,
      key: `${item.key}#head`,
      block: { ...item.block, answerLines: fit },
      split: "head",
    },
    headH: fixed + fit * lineGapPt,
    tail: {
      ...item,
      key: `${item.key}#tail`,
      block: { ...item.block, answerLines: rest },
      split: "tail",
    },
    // The lines' 6pt top margin and the block gap under them; no question text.
    tailH: rest * lineGapPt + 6 + BLOCK_GAP,
  };
}

export function paginate(
  items: FlowItem[],
  heights: Record<string, number>,
  headerHeight: number,
  /** Height of one page's content box; varies with the paper (A4 or Letter). */
  contentH: number = CONTENT_H,
  /** The sheet's ruled-line spacing (`sheetSizes`), for splitting a lines question. */
  lineGapPt: number = LINE_GAP,
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
      const runHeight = (withStrip: boolean) => {
        let total = height;
        for (let j = i; keepsWithNext(items[j] as FlowItem, items[j + 1]); j++) {
          const next = items[j + 1] as FlowItem;
          if (next.kind === "rag" && !withStrip) break;
          total += heights[next.key] ?? 0;
        }
        return total;
      };
      // Lead, 12 Nov: the strip never stands alone on a page; the last question (with its
      // heading and space) moves over with it. A question and its space, a heading and what it
      // introduces, always move together.
      const run = runHeight(true);
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
      const split = splitLines(item, height, room - used, contentH, lineGapPt);
      if (split) {
        current.push(split.head);
        flush();
        current.push(split.tail);
        used = split.tailH;
        continue;
      }
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

/** Answer space never grows past this many times its own height when it fills a page. */
export const FILL_MAX = 2;
/** At most this many ruled lines are added to one question when it fills a page. */
export const FILL_MAX_LINES = 2;
/** Room left at a page's foot after filling, so a measuring rounding never pushes a block over. */
const FILL_SAFETY = 12;

/**
 * R3 (CRITIQUE-2, 12 Nov: "page 2 two-thirds blank", "Y5 17 mm boxes for four-step problems",
 * "two lines too little for Y2 handwriting"): the room a page has left after its last block goes
 * to that page's answer space, so a pupil gets more room to write instead of a blank half page.
 * Each answer box and each ruled-lines question on the page takes an equal share: a box grows by
 * its share (at most `FILL_MAX` times its height), a question gains whole lines (at most
 * `FILL_MAX_LINES`). Nothing moves between pages, so the split, the page count and the editor's
 * page view are unchanged; print passes `fill` (the editor keeps the stored sizes it edits). A page
 * holding a split question (whose parts have no measured height) is left as it is.
 */
export function fillPages(
  pagination: Pagination,
  heights: Record<string, number>,
  headerHeight: number,
  contentH: number = CONTENT_H,
  lineGapPt: number = LINE_GAP,
  /** The sheet's box multiplier (`sheetSizes().boxScale`): a box draws `heightPt * boxScale`. */
  boxScale = 1,
): Pagination {
  const pages = pagination.pages.map((page) => {
    if (page.items.some((it) => heights[it.key] === undefined)) return page;
    const used = page.items.reduce((sum, it) => sum + (heights[it.key] ?? 0), 0);
    const room = contentH - (page.index === 0 ? headerHeight : 0) - FILL_SAFETY;
    const spaces = page.items.filter(isFillable);
    if (spaces.length === 0 || room - used <= 0) return page;
    const share = (room - used) / spaces.length;
    return {
      ...page,
      items: page.items.map((it) => {
        if (!isFillable(it) || it.kind !== "block") return it;
        const b = it.block;
        if (b.type === "answer-box") {
          const drawn = b.heightPt * boxScale;
          const grow = Math.min(share, (FILL_MAX - 1) * drawn);
          return { ...it, block: { ...b, heightPt: Math.floor(b.heightPt + grow / boxScale) } };
        }
        if (b.type === "question") {
          const more = Math.min(FILL_MAX_LINES, Math.floor(share / lineGapPt));
          return more > 0 ? { ...it, block: { ...b, answerLines: b.answerLines + more } } : it;
        }
        return it;
      }),
    };
  });
  return { ...pagination, pages };
}

/** Answer space that can take a page's spare room: a box, or a question with ruled lines. */
const isFillable = (it: FlowItem) =>
  it.kind === "block" &&
  !it.split &&
  (it.block.type === "answer-box" || (it.block.type === "question" && it.block.answerLines > 0));
