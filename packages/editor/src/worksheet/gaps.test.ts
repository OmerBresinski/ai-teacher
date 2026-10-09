import { describe, expect, test } from "bun:test";
import type { WorksheetBlock } from "@tj/domain/documents";
import { docFromText } from "../model/factories";
import { gapCharsIn, longestAnswer } from "./gaps";

function sentence(id: string, answers: string[]): WorksheetBlock & { type: "fill-gap" } {
  const gaps = answers.map((answer, i) => ({ id: `${id}-${i}`, answer }));
  return {
    id,
    type: "fill-gap",
    doc: docFromText(gaps.map((gap) => `[[gap:${gap.id}]]`).join(" and ")),
    gaps,
  };
}

describe("gapCharsIn", () => {
  test("every sentence in a run gets the run's longest answer", () => {
    const blocks: WorksheetBlock[] = [
      { id: "bank", type: "word-bank", words: ["Large language model (LLM)", "Prompt", "Token"] },
      sentence("s1", ["Large language model (LLM)"]),
      sentence("s2", ["Prompt"]),
      sentence("s3", ["Token"]),
    ];
    for (const id of ["s1", "s2", "s3"]) expect(gapCharsIn(blocks, id)).toBe(26);
  });

  test("any other block ends the run; the next run is sized on its own", () => {
    const blocks: WorksheetBlock[] = [
      sentence("a1", ["condensation"]),
      sentence("a2", ["rain"]),
      { id: "q", type: "question", doc: docFromText("Why?"), answerLines: 2 },
      sentence("b1", ["sun", "sea"]),
      sentence("b2", ["ice"]),
    ];
    expect(gapCharsIn(blocks, "a2")).toBe(12);
    expect(gapCharsIn(blocks, "b1")).toBe(3);
    expect(gapCharsIn(blocks, "b2")).toBe(3);
  });

  test("a block that is not a fill-gap has no blank width", () => {
    const blocks: WorksheetBlock[] = [{ id: "bank", type: "word-bank", words: ["rain"] }];
    expect(gapCharsIn(blocks, "bank")).toBeUndefined();
  });

  test("a new block list is measured again", () => {
    const before: WorksheetBlock[] = [sentence("s1", ["rain"]), sentence("s2", ["snow"])];
    expect(gapCharsIn(before, "s1")).toBe(4);
    const after = [before[0] as WorksheetBlock, sentence("s2", ["precipitation"])];
    expect(gapCharsIn(after, "s1")).toBe(13);
    expect(gapCharsIn(before, "s1")).toBe(4);
  });
});

describe("longestAnswer", () => {
  test("the block's longest answer, or 0 with no gaps", () => {
    expect(longestAnswer(sentence("s", ["sun", "cloud"]))).toBe(5);
    expect(longestAnswer(sentence("s", []))).toBe(0);
  });
});
