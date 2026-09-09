import { describe, expect, test } from "bun:test";
import type { PageSize, Worksheet, WorksheetBlock } from "@tj/domain/documents";
import { parseWorksheet, worksheetMarks } from "@tj/domain/documents";
import { answerKey } from "../worksheet/answers";
import { BLOCK_GAP, LINE_GAP, pageMetrics } from "../worksheet/metrics";
import { buildFlow, HEADER_KEY, paginate, RAG_KEY } from "../worksheet/paginate";
import { generateWordSearch } from "../worksheet/word-search";
import {
  fractionsPracticeWorksheet,
  plantLabelsWorksheet,
  RIVER_WORD_SEARCH_SEED,
  RIVER_WORDS,
  ROMAN_SOURCE_TEXT,
  riverVocabularyWorksheet,
  romanSourceWorksheet,
} from "./demo-worksheet";

const SHEETS: [string, () => Worksheet][] = [
  ["Fractions practice", fractionsPracticeWorksheet],
  ["Roman source investigation", romanSourceWorksheet],
  ["Label a flowering plant", plantLabelsWorksheet],
  ["River vocabulary", riverVocabularyWorksheet],
];

const text = (block: WorksheetBlock): string =>
  "doc" in block ? JSON.stringify(block.doc).replace(/[^a-zA-Z0-9 ]/g, "") : "";

/**
 * A generous stand-in for DOM measurement (`measure.tsx` needs a browser): 11pt body copy at
 * roughly 80 characters a line, 16pt a line, every block padded by `BLOCK_GAP`. It over-reads
 * rather than under-reads, so a sheet that fits here fits on paper; the print e2e counts the
 * real pages.
 */
function estimateHeight(block: WorksheetBlock, contentW: number): number {
  const lines = (chars: number) => Math.max(1, Math.ceil(chars / 80)) * 16;
  const body = text(block).length;
  switch (block.type) {
    case "heading":
      return 24 + BLOCK_GAP;
    case "paragraph":
    case "instructions":
      return lines(body) + BLOCK_GAP;
    case "question":
      return lines(body) + 8 + block.answerLines * LINE_GAP + BLOCK_GAP;
    case "multiple-choice":
      return lines(body) + block.options.length * 18 + BLOCK_GAP;
    case "fill-gap":
      return lines(body) + BLOCK_GAP;
    case "matching":
      return block.pairs.length * 30 + BLOCK_GAP;
    case "word-search":
      return block.size * 20 + 48 + BLOCK_GAP;
    case "word-bank":
      return 32 + BLOCK_GAP;
    case "answer-box":
      return block.heightPt + 18 + BLOCK_GAP;
    case "lines":
      return block.count * LINE_GAP + BLOCK_GAP;
    case "image":
      // The plant drawing is 240 by 260, so its height is 1.08 times the rendered width.
      return (contentW * block.widthPct) / 100 + 24 + BLOCK_GAP;
    case "table":
      return block.rows.length * 24 + BLOCK_GAP;
    case "divider":
    case "page-break":
      return BLOCK_GAP;
  }
}

/**
 * The name / date / class row, the title, the objective and the marks line, with the criteria gone
 * to the foot (TEACH-196): 115pt on paper, measured on the seeds.
 */
const HEADER_HEIGHT = 120;

/**
 * The self-assessment strip at the foot (TEACH-196): the "Tick what you can do now" heading, one
 * 10.5pt line per criterion, then the confidence scale. 66pt plus 20.5pt a criterion on paper (107pt,
 * 127pt and 147pt for two, three and four, measured), read generously here like the blocks.
 */
const stripHeight = (sheet: Worksheet) => 72 + 22 * (sheet.header.criteria?.length ?? 0);

function pagesOf(sheet: Worksheet, size: PageSize) {
  const metrics = pageMetrics(size);
  const heights: Record<string, number> = { [HEADER_KEY]: HEADER_HEIGHT };
  for (const block of sheet.blocks) heights[block.id] = estimateHeight(block, metrics.contentW);
  if (sheet.selfAssessment) heights[RAG_KEY] = stripHeight(sheet);
  return paginate(buildFlow(sheet, false), heights, HEADER_HEIGHT, metrics.contentH);
}

describe("seeded worksheets", () => {
  test.each(SHEETS)(
    "%s is a real, schema-valid sheet whose paper matches its title",
    (title, build) => {
      const sheet = build();
      expect(() => parseWorksheet(sheet)).not.toThrow();
      expect(sheet.title).toBe(title);
      expect(sheet.header.title).toBe(title);
      expect(sheet.header.subtitle).toMatch(/^I can /);
      expect(sheet.header.criteria?.length).toBeGreaterThanOrEqual(2);
      expect(sheet.header.criteria?.length).toBeLessThanOrEqual(4);
      // The criteria print in the self-assessment strip at the foot (TEACH-196).
      expect(sheet.selfAssessment).toBe(true);
      expect(sheet.includeAnswerKey).toBe(false);
      const copy = sheet.blocks.map(text).join(" ");
      expect(copy).not.toContain("Write your first question here");
      expect(copy).not.toContain("Section heading");
      // Numbering is automatic and starts at 1.
      const numbers = sheet.blocks.flatMap((b) => ("number" in b && b.number ? [b.number] : []));
      expect(numbers).toEqual(numbers.map((_, i) => i + 1));
      // Every question carries marks and an answer, so the key derives from the sheet.
      for (const block of sheet.blocks) {
        if (block.type !== "question") continue;
        expect(block.marks).toBeGreaterThan(0);
        expect(block.answer?.length).toBeGreaterThan(0);
      }
      expect(answerKey(sheet.blocks).length).toBeGreaterThan(0);
    },
  );

  test.each(SHEETS)(
    "%s fits one or two pages of A4 and Letter with no heading orphaned",
    (_, build) => {
      const sheet = build();
      for (const size of ["A4", "Letter"] as const) {
        const { pages, oversize } = pagesOf(sheet, size);
        expect(oversize).toEqual([]);
        expect(pages.length).toBeGreaterThanOrEqual(1);
        expect(pages.length).toBeLessThanOrEqual(2);
        for (const page of pages) {
          const last = page.items[page.items.length - 1];
          expect(last?.kind === "block" && last.block.type === "heading").toBe(false);
        }
      }
    },
  );

  test("Fractions practice: six questions with rising marks and a worked example", () => {
    const sheet = fractionsPracticeWorksheet();
    const questions = sheet.blocks.filter((b) => b.type === "question");
    expect(questions).toHaveLength(6);
    const marks = questions.map((q) => (q.type === "question" ? (q.marks ?? 0) : 0));
    expect(marks).toEqual([1, 1, 2, 2, 3, 3]);
    expect(worksheetMarks(sheet.blocks)).toBe(12);
    expect(sheet.blocks[0]?.type).toBe("instructions");
    expect(sheet.blocks.some((b) => b.type === "paragraph" && text(b).includes("34 of 20"))).toBe(
      true,
    );
    expect(sheet.subject).toBe("Maths");
    expect(sheet.yearGroup).toBe("Year 4");
  });

  test("Roman source investigation: a 150 to 180 word source, four marked questions, an answer box", () => {
    const sheet = romanSourceWorksheet();
    const words = ROMAN_SOURCE_TEXT.trim().split(/\s+/).length;
    expect(words).toBeGreaterThanOrEqual(150);
    expect(words).toBeLessThanOrEqual(180);
    expect(sheet.blocks.filter((b) => b.type === "question")).toHaveLength(4);
    expect(worksheetMarks(sheet.blocks)).toBe(8);
    expect(sheet.blocks[sheet.blocks.length - 1]?.type).toBe("answer-box");
    expect(sheet.subject).toBe("History");
  });

  test("Label a flowering plant: an inline SVG drawing, a word bank, label lines and four questions", () => {
    const sheet = plantLabelsWorksheet();
    const types = sheet.blocks.map((b) => b.type);
    expect(types).toContain("image");
    expect(types).toContain("word-bank");
    expect(types).toContain("lines");
    const image = sheet.blocks.find((b) => b.type === "image");
    expect(image?.type === "image" && image.src.startsWith("data:image/svg+xml")).toBe(true);
    expect(image?.type === "image" && (image.alt?.length ?? 0) > 0).toBe(true);
    const bank = sheet.blocks.find((b) => b.type === "word-bank");
    expect(bank?.type === "word-bank" ? bank.words : []).toEqual([
      "roots",
      "stem",
      "leaves",
      "flower",
    ]);
    expect(sheet.blocks.filter((b) => b.type === "question")).toHaveLength(4);
    expect(worksheetMarks(sheet.blocks)).toBe(4);
    expect(sheet.yearGroup).toBe("Year 3");
  });

  test("River vocabulary: a 12 by 12 grid that places all twelve words, and six matching pairs", () => {
    const sheet = riverVocabularyWorksheet();
    const search = sheet.blocks.find((b) => b.type === "word-search");
    if (search?.type !== "word-search") throw new Error("no word search");
    expect(search.size).toBe(12);
    expect(search.showWordBank).toBe(true);
    expect(search.words).toEqual(RIVER_WORDS);
    const grid = generateWordSearch({
      words: search.words,
      size: search.size,
      directions: search.directions,
      seed: RIVER_WORD_SEARCH_SEED,
    });
    expect(grid.unplaced).toEqual([]);
    expect(grid.rejected).toEqual([]);
    expect(grid.placements).toHaveLength(12);
    const matching = sheet.blocks.find((b) => b.type === "matching");
    expect(matching?.type === "matching" ? matching.pairs : []).toHaveLength(6);
    expect(sheet.subject).toBe("Geography");
  });
});
