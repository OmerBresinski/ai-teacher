import { describe, expect, test } from "bun:test";
import { createBudget } from "@tj/ai";
import { createFakeAi } from "@tj/ai/testing";
import { generatedLesson, generatedWorksheet } from "@tj/domain/documents/fixtures";
import { PLACEHOLDER_IMAGE } from "@tj/slides";
import { RUBRIC_DIMENSIONS, type RubricDimension } from "./rubric-prompt";
import {
  hasPlacedPhoto,
  type JudgeDeps,
  modelFindingsScorer,
  rubricJudgeInput,
  rubricMean,
  schemaScorer,
  scoreLesson,
} from "./scorers";

/* Function-only Mastra scorers over the generated fixture (no spend), and the rubric judge on the fake. */

const SENTINEL = "RATIONALE-SENTINEL";

/** One valid judge answer: every dimension `score` (or `null` for `imageFit`), the same rationale. */
const rubricJson = (score: number, over: Partial<Record<RubricDimension, number | null>> = {}) =>
  JSON.stringify({
    dimensions: Object.fromEntries(
      RUBRIC_DIMENSIONS.map((d) => [
        d,
        { score: d in over ? over[d] : d === "imageFit" ? null : score, rationale: SENTINEL },
      ]),
    ),
  });

const judgeOn = (ai: JudgeDeps["ai"], budget = createBudget({ capUsd: 5, capTokens: 1e6 })) => ({
  ai,
  budget,
  signal: new AbortController().signal,
  context: { lessonId: "gen-water-cycle", jobId: "eval-job" },
});

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

  test("scoreLesson without a judge returns both keyed scores, a null rubric and no content", async () => {
    const scored = await scoreLesson("fixture", { lesson: generatedLesson() });
    expect(scored).toEqual({ scores: { schema: 1, modelFindings: 0.75, rubric: null } });
    expect(JSON.stringify(scored)).not.toContain("water");
  });
});

describe("rubric judge", () => {
  test("one valid answer: one frontier call on stage evaluate; mean of the scored dimensions; rationales kept apart", async () => {
    const ai = createFakeAi({
      script: [rubricJson(4, { imageFit: 2 })],
      usage: { inputTokens: 8000, outputTokens: 600 },
    });
    const scored = await scoreLesson(
      "fixture",
      { lesson: generatedLesson(), worksheet: generatedWorksheet() },
      judgeOn(ai),
    );
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]?.modelClass).toBe("frontier");
    expect(ai.calls[0]?.context?.stage).toBe("evaluate");
    expect(ai.calls[0]?.context?.promptVersion).toBe("rubric-judge.v1");
    expect(scored.scores.schema).toBe(1);
    expect(scored.scores.rubric?.mean).toBe(3.8); // (4 × 7 + 2) / 8 = 3.75 → 3.8
    expect(scored.scores.rubric?.dimensions.imageFit).toBe(2);
    expect(Object.keys(scored.rubricRationales ?? {})).toEqual([...RUBRIC_DIMENSIONS]);
    for (const r of Object.values(scored.rubricRationales ?? {})) expect(r).toBe(SENTINEL);
    // The scores object the tables read never carries a rationale.
    expect(JSON.stringify(scored.scores)).not.toContain(SENTINEL);
  });

  test("imageFit null (no placed photo): the mean is over the other seven", async () => {
    const ai = createFakeAi({ script: [rubricJson(3, { depth: 5 })] });
    const scored = await scoreLesson("fixture", { lesson: generatedLesson() }, judgeOn(ai));
    expect(scored.scores.rubric?.dimensions.imageFit).toBeNull();
    expect(scored.scores.rubric?.mean).toBe(3.3); // (3 × 6 + 5) / 7 = 3.29 → 3.3
  });

  test("an invalid answer twice: rubric null, the other scores set, no throw, two calls paid", async () => {
    const ai = createFakeAi({ script: ["not json", "{}"] });
    const budget = createBudget({ capUsd: 5, capTokens: 1e6 });
    const scored = await scoreLesson("fixture", { lesson: generatedLesson() }, judgeOn(ai, budget));
    expect(ai.calls).toHaveLength(2);
    expect(scored.scores).toEqual({ schema: 1, modelFindings: 0.75, rubric: null });
    expect(scored.rubricRationales).toBeUndefined();
    expect(budget.totals().calls).toBe(2);
  });

  test("a null score on any dimension but imageFit is a schema miss: retried, then rubric null", async () => {
    const ai = createFakeAi({
      script: [rubricJson(4, { depth: null }), rubricJson(4, { notes: null })],
    });
    const scored = await scoreLesson("fixture", { lesson: generatedLesson() }, judgeOn(ai));
    expect(ai.calls).toHaveLength(2);
    expect(scored.scores.rubric).toBeNull();
  });

  test("a budget already exceeded: rubric null and no call", async () => {
    const ai = createFakeAi({ script: [rubricJson(5)] });
    const budget = createBudget({ capUsd: 0.000001, capTokens: 1e6 });
    budget.charge("us.openai.gpt-5.6-sol", { inputTokens: 100000, outputTokens: 10000 });
    expect(budget.exceeded()).not.toBeNull();
    const scored = await scoreLesson("fixture", { lesson: generatedLesson() }, judgeOn(ai, budget));
    expect(ai.calls).toHaveLength(0);
    expect(scored.scores.rubric).toBeNull();
  });

  test("the judge input is the plain-text projection: audience, topic, facts, slides with notes, blocks", () => {
    const lesson = generatedLesson();
    const input = rubricJudgeInput({ lesson, worksheet: generatedWorksheet() });
    expect(input.topic).toBe("The water cycle");
    expect(input.slides).toHaveLength(lesson.slides.length);
    expect(input.slides[0]?.index).toBe(1);
    expect(input.blocks.length).toBeGreaterThan(0);
    expect(input.hasPlacedPhoto).toBe(false);
  });

  test("hasPlacedPhoto is true only for an image-text slide whose image is not the placeholder", () => {
    const lesson = generatedLesson();
    expect(hasPlacedPhoto(lesson)).toBe(false);
    const slide = lesson.slides[0];
    if (!slide) throw new Error("fixture");
    slide.kind = "image-text";
    slide.elements.push({
      id: "img",
      type: "image",
      src: PLACEHOLDER_IMAGE,
      fit: "cover",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
    });
    expect(hasPlacedPhoto(lesson)).toBe(false);
    const image = slide.elements.at(-1);
    if (image?.type !== "image") throw new Error("fixture");
    image.src = "https://example.test/photo.jpg";
    expect(hasPlacedPhoto(lesson)).toBe(true);
  });

  test("rubricMean: one decimal over the non-null scores, null when none", () => {
    const all = Object.fromEntries(RUBRIC_DIMENSIONS.map((d) => [d, null])) as Record<
      RubricDimension,
      number | null
    >;
    expect(rubricMean(all)).toBeNull();
    expect(rubricMean({ ...all, depth: 2, pitch: 5 })).toBe(3.5);
  });
});
