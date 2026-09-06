import { describe, expect, test } from "bun:test";
import { worksheet } from "./fixtures.test-helpers";
import {
  isWorksheet,
  MAX_CRITERIA,
  parseStoredWorksheet,
  parseWorksheet,
  WORD_SEARCH_MAX_SIZE,
  WORD_SEARCH_MIN_SIZE,
  WorksheetBlockSchema,
} from "./worksheet";

const sixCriteria = ["a", "b", "c", "d", "e", "f"];

describe("parseWorksheet", () => {
  test("round-trips a TeachDeck-shaped worksheet through JSON", () => {
    const input = worksheet();
    expect(parseWorksheet(JSON.parse(JSON.stringify(input)))).toEqual(input);
    expect(isWorksheet(input)).toBe(true);
  });

  test("defaults a sheet saved before Letter existed to A4", () => {
    const { pageSize: _p, ...input } = worksheet();
    expect(parseWorksheet(input).pageSize).toBe("A4");
  });

  test("keeps Letter, the criteria and the self-assessment strip", () => {
    const input = { ...worksheet(), pageSize: "Letter" as const, selfAssessment: true };
    const parsed = parseWorksheet(input);
    expect(parsed.pageSize).toBe("Letter");
    expect(parsed.selfAssessment).toBe(true);
    expect(parsed.header.criteria).toEqual(["Find a half", "Find a quarter"]);
  });

  test("refuses more than four success criteria on import", () => {
    const input = worksheet();
    input.header.criteria = sixCriteria;
    expect(() => parseWorksheet(input)).toThrow(/header\.criteria/);
  });

  test("trims rather than refuses the same sheet coming out of storage", () => {
    const input = worksheet();
    input.header.criteria = sixCriteria;
    const parsed = parseStoredWorksheet(input);
    expect(parsed.header.criteria).toHaveLength(MAX_CRITERIA);
    expect(parsed.header.criteria).toEqual(["a", "b", "c", "d"]);
  });

  test("a word-search grid is 8 to 15 cells a side", () => {
    const block = (size: number) => ({
      id: "ws",
      type: "word-search",
      words: ["RAIN"],
      size,
      directions: "all",
      seed: 1,
      showWordBank: false,
    });
    expect(WorksheetBlockSchema.safeParse(block(20)).success).toBe(false);
    expect(WorksheetBlockSchema.safeParse(block(WORD_SEARCH_MIN_SIZE - 1)).success).toBe(false);
    expect(WorksheetBlockSchema.safeParse(block(WORD_SEARCH_MIN_SIZE)).success).toBe(true);
    expect(WorksheetBlockSchema.safeParse(block(WORD_SEARCH_MAX_SIZE)).success).toBe(true);
  });

  test("accepts every block type", () => {
    const doc = { type: "doc" as const };
    const blocks = [
      { id: "1", type: "heading", doc, level: 2 },
      { id: "2", type: "paragraph", doc },
      { id: "3", type: "instructions", doc },
      { id: "4", type: "question", doc, answerLines: 3 },
      { id: "5", type: "multiple-choice", doc, options: [] },
      { id: "6", type: "fill-gap", doc, gaps: [{ id: "g", answer: "x" }] },
      { id: "7", type: "matching", pairs: [{ id: "p", left: "a", right: "b" }] },
      { id: "8", type: "word-bank", words: ["a"] },
      { id: "9", type: "answer-box", heightPt: 120 },
      { id: "10", type: "lines", count: 4 },
      { id: "11", type: "image", src: "x.png", widthPct: 50 },
      { id: "12", type: "table", rows: [["a", "b"]], header: true },
      { id: "13", type: "divider" },
      { id: "14", type: "page-break" },
    ];
    for (const block of blocks) {
      expect(WorksheetBlockSchema.safeParse(block).success).toBe(true);
    }
    expect(WorksheetBlockSchema.safeParse({ id: "x", type: "sticker" }).success).toBe(false);
  });

  test("a future version is refused before validation", () => {
    expect(() => parseWorksheet({ ...worksheet(), version: 3 })).toThrow(/newer version/);
  });
});
