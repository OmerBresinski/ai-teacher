import { describe, expect, test } from "bun:test";
import { isUnfinishedWorksheet, unfinishedWorksheetReason } from "@tj/domain/documents";
import { DEMO_LESSON_FACTS } from "./demo-facts";
import { numberQuestions } from "./factories";
import { resolveRecipe } from "./recipes";

/*
 * `isUnfinishedWorksheet` (in `@tj/domain`) against what the recipes really build. A v5 lesson
 * carries its objectives and nothing else, so Knowledge check tops its questions up with
 * placeholder questions. R4 review (12 Nov): Knowledge check is a retired recipe, so such a sheet
 * is old or hand-made and prints as it did before the new path; only a sheet the new path made
 * (`madeByNewPath`) is held back for a placeholder.
 */

const v5Facts = {
  ...DEMO_LESSON_FACTS,
  questions: [],
  vocabulary: [],
  misconceptions: [],
  workedExamples: [],
};

const NEW_PATH = {
  jobId: "job-1",
  stage: "checked" as const,
  startedAt: "2026-11-12T10:01:00.000Z",
  completedAt: "2026-11-12T10:02:00.000Z",
  promptVersions: { build: "worksheet-slides.v1" },
  usage: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  findings: [],
  recipeId: "practice" as const,
  practiceMinutes: 10,
};

describe("isUnfinishedWorksheet on recipe output", () => {
  test("Knowledge check from empty facts, saved by hand or by the old job, prints as before", () => {
    const blocks = numberQuestions(resolveRecipe("knowledge-check").build(v5Facts));
    expect(isUnfinishedWorksheet({ blocks, generation: undefined })).toBe(false);
    expect(unfinishedWorksheetReason({ blocks, generation: undefined })).toBeNull();
  });

  test("the same placeholders on a new-path sheet are unfinished", () => {
    const blocks = numberQuestions(resolveRecipe("knowledge-check").build(undefined));
    expect(unfinishedWorksheetReason({ blocks, generation: NEW_PATH })).toBe("placeholder");
  });
});
