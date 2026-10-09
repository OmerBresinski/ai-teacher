import { describe, expect, test } from "bun:test";
import type { WorksheetBlock } from "@tj/domain/documents";
import { docFromText } from "../model/factories";
import { gapWidths } from "./gaps";

function sentence(id: string, answers: string[]): WorksheetBlock {
  const gaps = answers.map((answer, i) => ({ id: `${id}-${i}`, answer }));
  return {
    id,
    type: "fill-gap",
    doc: docFromText(gaps.map((gap) => `[[gap:${gap.id}]]`).join(" and ")),
    gaps,
  };
}

describe("gapWidths", () => {
  test("every sentence in a run gets the run's longest answer", () => {
    const widths = gapWidths([
      { id: "bank", type: "word-bank", words: ["Large language model (LLM)", "Prompt", "Token"] },
      sentence("s1", ["Large language model (LLM)"]),
      sentence("s2", ["Prompt"]),
      sentence("s3", ["Token"]),
    ]);
    expect(Object.fromEntries(widths)).toEqual({ s1: 26, s2: 26, s3: 26 });
  });

  test("any other block ends the run; the next run is sized on its own", () => {
    const widths = gapWidths([
      sentence("a1", ["condensation"]),
      sentence("a2", ["rain"]),
      { id: "q", type: "question", doc: docFromText("Why?"), answerLines: 2 },
      sentence("b1", ["sun", "sea"]),
      sentence("b2", ["ice"]),
    ]);
    expect(Object.fromEntries(widths)).toEqual({ a1: 12, a2: 12, b1: 3, b2: 3 });
  });

  test("a gap whose token was deleted from the text prints no blank, so it does not count", () => {
    const orphaned: WorksheetBlock = {
      id: "s2",
      type: "fill-gap",
      doc: docFromText("[[gap:kept]] is short."),
      gaps: [
        { id: "kept", answer: "rain" },
        { id: "gone", answer: "precipitation" },
      ],
    };
    const widths = gapWidths([sentence("s1", ["snow"]), orphaned]);
    expect(Object.fromEntries(widths)).toEqual({ s1: 4, s2: 4 });
  });
});
