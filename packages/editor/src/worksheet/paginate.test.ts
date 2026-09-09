import { describe, expect, test } from "bun:test";
import type { Worksheet, WorksheetBlock } from "@tj/domain/documents";
import { docFromText } from "../model/factories";
import { newWorksheet } from "../model/worksheet-factories";
import { answerKey, matchingLetters } from "./answers";
import { CONTENT_H, pageMetrics } from "./metrics";
import { buildFlow, type FlowItem, HEADER_KEY, KEY_TITLE_KEY, paginate, RAG_KEY } from "./paginate";

const block = (id: string, type: "paragraph" | "page-break" = "paragraph"): WorksheetBlock =>
  type === "page-break"
    ? { id, type: "page-break" }
    : { id, type: "paragraph", doc: docFromText(id) };

const flow = (blocks: WorksheetBlock[]): FlowItem[] =>
  blocks.map((b) => ({ key: b.id, kind: "block" as const, block: b }));

const keys = (items: FlowItem[]) => items.map((i) => i.key);

const question: WorksheetBlock = {
  id: "q1",
  type: "question",
  doc: docFromText("Q"),
  answerLines: 2,
  marks: 1,
  answer: "A",
  number: 1,
};

describe("paginate", () => {
  test("keeps everything on one page when it fits, and always produces at least one page", () => {
    const { pages, oversize } = paginate(flow([block("a"), block("b")]), { a: 100, b: 100 }, 80);
    expect(pages).toHaveLength(1);
    expect(keys(pages[0]?.items ?? [])).toEqual(["a", "b"]);
    expect(oversize).toEqual([]);

    const empty = paginate([], { [HEADER_KEY]: 90 }, 90);
    expect(empty.pages).toHaveLength(1);
    expect(empty.pages[0]?.items).toEqual([]);
  });

  test("moves the block that overflows onto the next page; page 1 has less room because of the header", () => {
    const { pages } = paginate(flow([block("a"), block("b")]), { a: CONTENT_H - 140, b: 200 }, 100);
    expect(pages).toHaveLength(2);
    expect(keys(pages[0]?.items ?? [])).toEqual(["a"]);
    expect(keys(pages[1]?.items ?? [])).toEqual(["b"]);

    const tall = CONTENT_H - 50;
    expect(paginate(flow([block("a")]), { a: tall }, 0)).toEqual({
      pages: [{ index: 0, items: flow([block("a")]) }],
      oversize: [],
    });
  });

  test("keeps a too-tall first block on page 1 and reports it oversize rather than printing a header-only page", () => {
    const { pages, oversize } = paginate(flow([block("a")]), { a: CONTENT_H - 50 }, 100);
    expect(pages).toHaveLength(1);
    expect(keys(pages[0]?.items ?? [])).toEqual(["a"]);
    expect(oversize).toEqual(["a"]);
  });

  test("flags a block taller than a whole page and still places it", () => {
    const { pages, oversize } = paginate(flow([block("a")]), { a: CONTENT_H + 10 }, 0);
    expect(oversize).toEqual(["a"]);
    expect(keys(pages[0]?.items ?? [])).toEqual(["a"]);
  });

  test("a page break ends the page; a second consecutive or leading break is a no-op", () => {
    const one = paginate(
      flow([block("a"), block("br", "page-break"), block("b")]),
      { a: 40, br: 0, b: 40 },
      0,
    );
    expect(one.pages.map((p) => keys(p.items))).toEqual([["a", "br"], ["b"]]);

    const two = paginate(
      flow([block("a"), block("br1", "page-break"), block("br2", "page-break"), block("b")]),
      { a: 40, br1: 0, br2: 0, b: 40 },
      0,
    );
    expect(two.pages.map((p) => keys(p.items))).toEqual([
      ["a", "br1"],
      ["br2", "b"],
    ]);

    const leading = paginate(flow([block("br", "page-break"), block("a")]), { br: 0, a: 40 }, 0);
    expect(leading.pages.map((p) => keys(p.items))).toEqual([["br", "a"]]);
  });

  test("always starts the answer key on a fresh page, after the RAG strip", () => {
    const sheet: Worksheet = {
      ...newWorksheet("Test"),
      blocks: [question],
      includeAnswerKey: true,
      selfAssessment: true,
    };
    const items = buildFlow(sheet, true);
    expect(keys(items)).toEqual(["q1", RAG_KEY, KEY_TITLE_KEY, "key:q1"]);
    const { pages } = paginate(
      items,
      { q1: 40, [RAG_KEY]: 60, [KEY_TITLE_KEY]: 40, "key:q1": 20 },
      0,
    );
    expect(pages.map((p) => keys(p.items))).toEqual([
      ["q1", RAG_KEY],
      [KEY_TITLE_KEY, "key:q1"],
    ]);
  });

  test("TEACH-196: the strip with criteria is one item, so it moves whole rather than parting from its label", () => {
    const base = newWorksheet("Test");
    const sheet: Worksheet = {
      ...base,
      blocks: [question],
      selfAssessment: true,
      header: { ...base.header, criteria: ["I can add fractions.", "I can simplify one."] },
    };
    const items = buildFlow(sheet, false);
    expect(keys(items)).toEqual(["q1", RAG_KEY]);
    const { pages, oversize } = paginate(items, { q1: 300, [RAG_KEY]: 150 }, 0, 400);
    expect(pages.map((p) => keys(p.items))).toEqual([["q1"], [RAG_KEY]]);
    expect(oversize).toEqual([]);
  });

  test("leaves the answer key and the RAG strip out unless the sheet asks for them", () => {
    const sheet: Worksheet = { ...newWorksheet("Test"), blocks: [question] };
    expect(keys(buildFlow(sheet, false))).toEqual(["q1"]);
    // No numbered block → no key even when asked.
    expect(keys(buildFlow({ ...sheet, blocks: [block("a")] }, true))).toEqual(["a"]);
  });

  test("splits at the page height of the sheet's own paper", () => {
    const letter = pageMetrics("Letter");
    const items = flow([block("a"), block("b")]);
    const heights = { a: letter.contentH - 20, b: 40 };
    expect(paginate(items, heights, 0).pages).toHaveLength(1);
    expect(paginate(items, heights, 0, letter.contentH).pages).toHaveLength(2);
  });
});

describe("answerKey", () => {
  test("numbers answers as the sheet numbers questions", () => {
    const blocks: WorksheetBlock[] = [
      block("p"),
      { ...question, marks: 2, answer: "Because." },
      {
        id: "q2",
        type: "multiple-choice",
        doc: docFromText("Q2"),
        number: 2,
        options: [
          { id: "o1", text: "Wrong", correct: false },
          { id: "o2", text: "Right", correct: true },
        ],
      },
    ];
    const entries = answerKey(blocks);
    expect(entries.map((e) => e.number)).toEqual([1, 2]);
    expect(entries[0]).toMatchObject({ marks: 2, lines: ["Because."] });
    expect(entries[1]?.lines).toEqual(["B. Right"]);
  });

  test("gives each matching pair the letter its shuffled right-hand item carries", () => {
    const letters = matchingLetters("block-id", 4);
    expect([...letters].sort()).toEqual(["A", "B", "C", "D"]);
  });
});
