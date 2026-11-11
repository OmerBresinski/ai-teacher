import { describe, expect, test } from "bun:test";
import { isUnfinishedWorksheet, unfinishedWorksheetReason } from "@tj/domain/documents";
import { DEMO_LESSON_FACTS } from "./demo-facts";
import { numberQuestions } from "./factories";
import { resolveRecipe } from "./recipes";

/*
 * `isUnfinishedWorksheet` (in `@tj/domain`) against what the recipes really build. A v5 lesson
 * carries its objectives and nothing else, so Knowledge check tops its questions up with
 * placeholder questions: that sheet must never look finished, with or without a completed job.
 */

const v5Facts = {
  ...DEMO_LESSON_FACTS,
  questions: [],
  vocabulary: [],
  misconceptions: [],
  workedExamples: [],
};

describe("isUnfinishedWorksheet on recipe output", () => {
  test("Knowledge check built from empty lesson facts is unfinished", () => {
    const blocks = numberQuestions(resolveRecipe("knowledge-check").build(v5Facts));
    expect(isUnfinishedWorksheet({ blocks, generation: undefined })).toBe(true);
    expect(unfinishedWorksheetReason({ blocks, generation: undefined })).toBe("placeholder");
  });

  test("the same recipe from no facts at all is unfinished too", () => {
    const blocks = numberQuestions(resolveRecipe("knowledge-check").build(undefined));
    expect(isUnfinishedWorksheet({ blocks, generation: undefined })).toBe(true);
  });
});
