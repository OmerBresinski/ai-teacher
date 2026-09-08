import { createScorer } from "@mastra/core/evals";
import { checkLesson, type Finding, type Lesson, type Worksheet } from "@tj/domain/documents";

/*
 * The eval's scorers (ADR 0025 §23), built with Mastra's `createScorer` from `@mastra/core/evals`
 * (the installed docs: `node_modules/@mastra/core/dist/docs/references/docs-evals-custom-scorers.md`;
 * no `@mastra/evals` package is needed for function-only scorers). Function steps only — no judge
 * model, so a scorer never spends. They run in the eval scripts, never in the production pipeline.
 *
 * Both scores are `1 − problems / slides` clamped to `[0, 1]`, so a clean eight-slide lesson is
 * `1` and one problem on it is `0.875`. Reasons carry counts only, never content (ADR 0015).
 */

export interface ScorerOutput {
  lesson: Lesson;
  worksheet?: Worksheet;
}

export interface EvalScores {
  /** `checkLesson` re-run over the final documents: `error` findings per slide. */
  schema: number;
  /** The model checks left on `generation.findings` (Evaluate's residuals) per slide. */
  modelFindings: number;
}

/** `checkLesson`'s own check names; everything else on `generation.findings` is a model check. */
const SCHEMA_CHECKS = new Set([
  "question-answer",
  "objective-coverage",
  "vocabulary-in-facts",
  "timing",
]);

const perSlide = (problems: number, slides: number) =>
  slides === 0 ? 0 : Math.max(0, Math.min(1, 1 - problems / slides));

/** Schema checks as a scorer: identical to the editor's badge and the worker's Evaluate. */
export const schemaScorer = createScorer<string, ScorerOutput>({
  id: "schema-checks",
  description: "checkLesson error findings over the generated lesson and worksheet, per slide",
})
  .analyze(({ run }) => {
    const findings = checkLesson(run.output.lesson, run.output.worksheet);
    return {
      errors: findings.filter((f) => f.severity === "error").length,
      warnings: findings.filter((f) => f.severity === "warning").length,
      slides: run.output.lesson.slides.length,
    };
  })
  .generateScore(({ results }) => {
    const { errors, slides } = results.analyzeStepResult;
    return perSlide(errors, slides);
  })
  .generateReason(({ results, score }) => {
    const { errors, warnings, slides } = results.analyzeStepResult;
    return `${errors} error and ${warnings} warning schema findings over ${slides} slides; score ${score}.`;
  });

/** The model checks Evaluate recorded (age fit, terminology, …) that Repair did not clear. */
export const modelFindingsScorer = createScorer<string, ScorerOutput>({
  id: "model-findings",
  description: "residual model-check findings on Lesson.generation.findings, per slide",
})
  .analyze(({ run }) => {
    const findings: Finding[] = run.output.lesson.generation?.findings ?? [];
    const model = findings.filter((f) => !SCHEMA_CHECKS.has(f.check) && f.check !== "budget");
    return { model: model.length, slides: run.output.lesson.slides.length };
  })
  .generateScore(({ results }) =>
    perSlide(results.analyzeStepResult.model, results.analyzeStepResult.slides),
  )
  .generateReason(
    ({ results, score }) =>
      `${results.analyzeStepResult.model} model findings over ${results.analyzeStepResult.slides} slides; score ${score}.`,
  );

/** Both scores for one generated lesson, keyed for the results file. */
export async function scoreLesson(briefId: string, output: ScorerOutput): Promise<EvalScores> {
  const [schema, model] = await Promise.all([
    schemaScorer.run({ input: briefId, output }),
    modelFindingsScorer.run({ input: briefId, output }),
  ]);
  return { schema: schema.score, modelFindings: model.score };
}
