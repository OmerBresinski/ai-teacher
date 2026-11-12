import { describe, expect, test } from "bun:test";
import type { WorksheetBlock } from "@tj/domain/documents";
import { docFromText } from "../model/factories";
import { FILL_MAX, FILL_MAX_LINES, type FlowItem, fillPages, type Pagination } from "./paginate";

/*
 * R3 (CRITIQUE-2): a page's leftover room goes to its answer space in print, so a sheet never
 * prints a half-blank page beside cramped boxes; nothing moves between pages.
 */
const q = (id: string, answerLines: number): FlowItem => ({
  key: id,
  kind: "block",
  block: { id, type: "question", doc: docFromText("Q"), answerLines } as WorksheetBlock,
});
const box = (id: string, heightPt: number): FlowItem => ({
  key: id,
  kind: "block",
  block: { id, type: "answer-box", heightPt } as WorksheetBlock,
});
const pages = (...p: FlowItem[][]): Pagination => ({
  pages: p.map((items, index) => ({ index, items })),
  oversize: [],
});
const block = (it: FlowItem | undefined) => (it?.kind === "block" ? it.block : undefined);

describe("fillPages", () => {
  test("a page's spare room is shared by its boxes, never past FILL_MAX times their height", () => {
    const flow = pages([q("q1", 0), box("b1", 60), q("q2", 0), box("b2", 60)]);
    const heights = { q1: 30, b1: 75, q2: 30, b2: 75 };
    // 700 tall, 100 of header, 210 used, 12 kept: 378 spare, 189 each, capped at one more box.
    const filled = fillPages(flow, heights, 100, 700, 30, 1.25);
    const b1 = block(filled.pages[0]?.items[1]);
    expect(b1?.type === "answer-box" && b1.heightPt).toBe(
      60 + Math.floor((75 * (FILL_MAX - 1)) / 1.25),
    );
    // A little room: each box takes its share exactly.
    const tight = fillPages(flow, heights, 100, 400, 30, 1.25);
    const t1 = block(tight.pages[0]?.items[1]);
    expect(t1?.type === "answer-box" && t1.heightPt).toBe(
      Math.floor(60 + (400 - 100 - 12 - 210) / 2 / 1.25),
    );
  });

  test("a lines question gains whole lines, at most FILL_MAX_LINES; the page count never changes", () => {
    const flow = pages([q("a", 2), q("b", 2)], [q("c", 2)]);
    const heights = { a: 120, b: 120, c: 120 };
    const filled = fillPages(flow, heights, 0, 700, 42);
    expect(filled.pages).toHaveLength(2);
    const lines = filled.pages.flatMap((p) =>
      p.items.map((it) => {
        const b = block(it);
        return b?.type === "question" ? b.answerLines : -1;
      }),
    );
    expect(lines).toEqual([2 + FILL_MAX_LINES, 2 + FILL_MAX_LINES, 2 + FILL_MAX_LINES]);
  });

  test("a full page, a page with a split question and an unmeasured page stay as they are", () => {
    const flow = pages([q("a", 2), box("b", 60)]);
    expect(fillPages(flow, { a: 400, b: 300 }, 0, 700, 42)).toEqual(flow);
    const split: FlowItem = {
      ...(q("s", 4) as FlowItem & { kind: "block" }),
      key: "s#head",
      split: "head",
    };
    const withSplit = pages([split, box("b", 60)]);
    expect(fillPages(withSplit, { b: 60 }, 0, 700, 42)).toEqual(withSplit);
    expect(fillPages(flow, { a: 10 }, 0, 700, 42)).toEqual(flow);
  });
});
