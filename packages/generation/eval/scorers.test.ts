import { describe, expect, test } from "bun:test";
import { generatedLesson, generatedWorksheet } from "@tj/domain/documents/fixtures";
import { modelFindingsScorer, schemaScorer, scoreLesson } from "./scorers";

/* Function-only Mastra scorers over the generated fixture: no judge, no spend. */

describe("eval scorers", () => {
  test("a clean four-slide lesson scores 1 on the schema checks", async () => {
    const result = await schemaScorer.run({
      input: "fixture",
      output: { lesson: generatedLesson(), worksheet: generatedWorksheet() },
    });
    expect(result.score).toBe(1);
    expect(result.reason).toContain("0 error");
  });

  test("one schema error on four slides scores 0.75", async () => {
    const lesson = generatedLesson();
    const mc = lesson.slides[3];
    if (mc?.question?.type !== "multiple-choice") throw new Error("fixture");
    mc.question = {
      ...mc.question,
      options: mc.question.options.map((o) => ({ ...o, correct: false })),
    };
    const result = await schemaScorer.run({ input: "fixture", output: { lesson } });
    expect(result.score).toBe(0.75);
  });

  test("the model-findings scorer counts residual model checks only", async () => {
    const lesson = generatedLesson();
    // One `age-fit` warning is stored on the fixture; a schema finding and a budget stop are not model checks.
    lesson.generation?.findings.push(
      { check: "timing", severity: "warning", target: {}, message: "" },
      { check: "budget", severity: "error", target: {}, message: "" },
    );
    const result = await modelFindingsScorer.run({ input: "fixture", output: { lesson } });
    expect(result.score).toBe(0.75);
    expect(result.reason).toContain("1 model findings over 4 slides");
  });

  test("scoreLesson returns both keyed scores and no content", async () => {
    const scores = await scoreLesson("fixture", { lesson: generatedLesson() });
    expect(scores).toEqual({ schema: 1, modelFindings: 0.75 });
    expect(JSON.stringify(scores)).not.toContain("water");
  });
});
