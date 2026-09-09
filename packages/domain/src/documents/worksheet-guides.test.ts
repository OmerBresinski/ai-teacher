import { describe, expect, test } from "bun:test";
import type { WorksheetBlock } from "./worksheet";
import {
  BLOCK_GUIDES,
  type BlockShape,
  defaultInstruction,
  TASK_BLOCK_TYPES,
  WORD_BANK_INSTRUCTION,
} from "./worksheet-guides";

const TYPES: WorksheetBlock["type"][] = [
  "heading",
  "paragraph",
  "instructions",
  "question",
  "multiple-choice",
  "fill-gap",
  "matching",
  "word-search",
  "word-bank",
  "answer-box",
  "lines",
  "image",
  "table",
  "divider",
  "page-break",
];

describe("BLOCK_GUIDES", () => {
  test("every block type has a guide with a label, a line, a guide and both examples", () => {
    expect(TYPES.length).toBe(15);
    for (const type of TYPES) {
      const guide = BLOCK_GUIDES[type];
      expect(guide, type).toBeDefined();
      for (const key of ["label", "line", "guide", "good", "bad"] as const) {
        expect(guide[key].trim().length, `${type}.${key}`).toBeGreaterThan(0);
      }
    }
    expect(Object.keys(BLOCK_GUIDES).sort()).toEqual([...TYPES].sort());
  });

  test("every task block has a default instruction addressed to the pupil", () => {
    for (const type of TASK_BLOCK_TYPES) {
      const line = defaultInstruction(type);
      expect(line, type).not.toBeNull();
      expect(line).toMatch(/\.$/);
    }
    expect(defaultInstruction("word-bank")).toBe(WORD_BANK_INSTRUCTION);
    // The word search prints its own lead, so no recipe or insert adds one.
    expect(defaultInstruction("word-search")).toBeNull();
    expect(BLOCK_GUIDES["multiple-choice"].instruction).toBe("Tick one box for each question.");
    expect(BLOCK_GUIDES.matching.instruction).toBe(
      "Match each item on the left to one on the right. Write the letter in the box.",
    );
  });

  test("shape ranges are whole numbers, low to high, and correct is one", () => {
    const ranges: (keyof BlockShape)[] = [
      "options",
      "pairs",
      "answers",
      "words",
      "answerLines",
      "marks",
    ];
    for (const type of TYPES) {
      const shape = BLOCK_GUIDES[type].shape;
      for (const key of ranges) {
        const range = shape[key] as [number, number] | undefined;
        if (!range) continue;
        const [low, high] = range;
        expect(Number.isInteger(low) && Number.isInteger(high), `${type}.${key}`).toBe(true);
        expect(low, `${type}.${key}`).toBeGreaterThanOrEqual(1);
        expect(low, `${type}.${key}`).toBeLessThanOrEqual(high);
      }
    }
    expect(BLOCK_GUIDES["multiple-choice"].shape).toEqual({ options: [2, 4], correct: 1 });
    expect(BLOCK_GUIDES.matching.shape).toEqual({ pairs: [3, 6], rightUnique: true });
    expect(BLOCK_GUIDES["fill-gap"].shape.answers).toEqual([1, 4]);
    expect(BLOCK_GUIDES["word-bank"].shape.words).toEqual([3, 10]);
  });

  test("copy has no em-dashes or exclamation marks", () => {
    for (const type of TYPES) {
      const text = JSON.stringify(BLOCK_GUIDES[type]);
      expect(text, type).not.toMatch(/[—!]/);
    }
  });
});
