import { describe, expect, test } from "bun:test";
import type { WorksheetBlock } from "@tj/domain/documents";
import { docFromText } from "../model/factories";
import { newBlock } from "../model/worksheet-factories";
import { PLACEHOLDER_QUESTION } from "../model/worksheet-recipes";
import { blockProblems } from "./block-problems";
import { blankStem } from "./block-types";

/* One rule per test (TEACH-194 item 5). The factories' defaults are all clean. */

const mc = () => {
  const block = newBlock("multiple-choice");
  if (block.type !== "multiple-choice") throw new Error("mc");
  return block;
};
const matching = () => {
  const block = newBlock("matching");
  if (block.type !== "matching") throw new Error("matching");
  return block;
};

describe("blockProblems", () => {
  test("the factory defaults have no problems, except the question with no answer", () => {
    const types: WorksheetBlock["type"][] = [
      "heading",
      "paragraph",
      "instructions",
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
    for (const type of types) expect(blockProblems(newBlock(type)), type).toEqual([]);
  });

  test("question: an unwritten stem (fresh insert or recipe placeholder) carries no hint yet", () => {
    const block = newBlock("question");
    expect(blockProblems(blankStem(structuredClone(block)))).toEqual([]);
    expect(
      blockProblems({ ...block, doc: docFromText(PLACEHOLDER_QUESTION) } as WorksheetBlock),
    ).toEqual([]);
  });

  test("question: no answer, or a blank one", () => {
    const block = newBlock("question");
    expect(blockProblems(block)).toEqual(["No answer for the key. Add one in the toolbar."]);
    expect(blockProblems({ ...block, answer: "   " } as WorksheetBlock)).toHaveLength(1);
    expect(blockProblems({ ...block, answer: "9" } as WorksheetBlock)).toEqual([]);
  });

  test("multiple choice: none correct, once there is a stem", () => {
    const block = mc();
    for (const option of block.options) option.correct = false;
    expect(blockProblems(block)).toEqual(["No option is marked correct. Tick one on the sheet."]);
    // A fresh insert (`blankStem`) has no stem yet: nothing to mark, so no hint.
    expect(blockProblems(blankStem(structuredClone(block)))).toEqual([]);
  });

  test("multiple choice: more than one correct", () => {
    const block = mc();
    for (const [i, option] of block.options.entries()) option.correct = i < 2;
    expect(blockProblems(block)).toEqual(["2 options are marked correct. Only one should be."]);
  });

  test("multiple choice: fewer than 2 or more than 4 options, from the guide's shape", () => {
    const one = mc();
    one.options = one.options.slice(0, 1);
    expect(blockProblems(one)).toEqual(["Multiple choice needs at least 2 options."]);
    const five = mc();
    five.options.push({ id: "e", text: "Option E", correct: false });
    expect(blockProblems(five)).toEqual(["Multiple choice takes at most 4 options."]);
  });

  test("matching: a duplicate right side is named once, ignoring case and blanks", () => {
    const block = matching();
    const rights = ["Rodent", "rodent ", "Non-rodent"];
    block.pairs = block.pairs.map((pair, i) => ({ ...pair, right: rights[i] ?? pair.right }));
    expect(blockProblems(block)).toEqual([
      "“rodent” appears twice on the right. Every right-hand item must be different.",
    ]);
    block.pairs.push({ id: "d", left: "", right: "" }, { id: "e", left: "", right: "" });
    expect(blockProblems(block)).toHaveLength(1);
  });

  test("matching: fewer than 3 pairs", () => {
    const block = matching();
    block.pairs = block.pairs.slice(0, 2);
    expect(blockProblems(block)).toEqual(["Matching needs at least 3 pairs."]);
  });

  test("fill-gap: a blank answer", () => {
    const block = newBlock("fill-gap");
    if (block.type !== "fill-gap") throw new Error("fill-gap");
    block.gaps = block.gaps.map((gap, i) => ({ ...gap, answer: i === 0 ? "" : gap.answer }));
    expect(blockProblems(block)).toEqual([
      "1 gap has no answer. Add it under Gaps in the toolbar.",
    ]);
    block.gaps = block.gaps.map((gap) => ({ ...gap, answer: " " }));
    expect(blockProblems(block)).toEqual([
      "2 gaps have no answer. Add them under Gaps in the toolbar.",
    ]);
  });

  test("word search: an unplaced word is named, and stays in the block's words", () => {
    const block = newBlock("word-search");
    if (block.type !== "word-search") throw new Error("word-search");
    // Eight-letter words on an 8 by 8 with only across and down: the ninth has nowhere to go.
    block.size = 8;
    block.words = Array.from({ length: 17 }, (_, i) => `w${String.fromCharCode(97 + i)}rdsabc`);
    const problems = blockProblems(block);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]).toMatch(
      /^“[a-z]+” could not be placed\. Shuffle or make the grid bigger\.$/,
    );
    expect(block.words.length).toBe(17);
  });

  test("word search: a word longer than the grid is named", () => {
    const block = newBlock("word-search");
    if (block.type !== "word-search") throw new Error("word-search");
    block.size = 8;
    block.words = ["evaporation", "rain"];
    expect(blockProblems(block)).toEqual([
      "“evaporation” is longer than the grid. Make the grid bigger or the word shorter.",
    ]);
  });
});
