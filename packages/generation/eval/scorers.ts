import { createScorer } from "@mastra/core/evals";
import type { Budget, CreatedAi } from "@tj/ai";
import {
  checkLesson,
  SCHEMA_CHECKS as DOMAIN_SCHEMA_CHECKS,
  type Finding,
  type Lesson,
  type Worksheet,
} from "@tj/domain/documents";
import pino from "pino";
import { callStructured } from "../src/call";
import { audienceOf, blockText, photoThumbnails, slideText } from "../src/stages/shared";
import { BudgetExceeded, type PipelineContext, StageFailure } from "../src/types";
import {
  RUBRIC_DIMENSIONS,
  type RubricDimension,
  type RubricJudgeInput,
  type RubricOutput,
  RubricOutputSchema,
  rubricJudgePrompt,
} from "./rubric-prompt";

/*
 * The eval's scorers (ADR 0025 §23), built with Mastra's `createScorer` from `@mastra/core/evals`
 * (the installed docs: `node_modules/@mastra/core/dist/docs/references/docs-evals-custom-scorers.md`;
 * no `@mastra/evals` package is needed). They run in the eval scripts, never in the production
 * pipeline.
 *
 * Two are function-only and never spend: their scores are `1 − problems / slides` clamped to
 * `[0, 1]`, so a clean eight-slide lesson is `1` and one problem on it is `0.875`. The third,
 * `rubric-judge`, makes one structured call on the `frontier` class through `callStructured` and
 * is built only when the caller hands over judge deps (the paid half); the schema half never does.
 * Reasons carry counts only, never content (ADR 0015).
 */

export interface ScorerOutput {
  lesson: Lesson;
  worksheet?: Worksheet;
}

/** The rubric as it is written to the results file: one mean and one score per dimension. */
export interface RubricScores {
  /** Mean of the non-null dimensions; `null` when none was scored. */
  mean: number | null;
  dimensions: Record<RubricDimension, number | null>;
}

export interface EvalScores {
  /** `checkLesson` re-run over the final documents: `error` findings per slide. */
  schema: number;
  /** The model checks left on `generation.findings` (Evaluate's residuals) per slide. */
  modelFindings: number;
  /** The judge's scores; `null` without judge deps, at the cap, or when the judge's answer failed. */
  rubric: RubricScores | null;
}

/** What the rubric judge needs to make its one call: the run's own client, budget and signal. */
export interface JudgeDeps {
  ai: CreatedAi;
  budget: Budget;
  signal: AbortSignal;
  context: PipelineContext;
}

/** `scoreLesson`'s result: the keyed scores plus, kept apart, the judge's rationales. */
export interface ScoredLesson {
  scores: EvalScores;
  /** Present only when the judge answered; written to the gitignored results file and nowhere else. */
  rubricRationales?: Record<RubricDimension, string>;
}

/** `checkLesson`'s own check names; everything else on `generation.findings` is a model check. */
const SCHEMA_CHECKS: ReadonlySet<string> = DOMAIN_SCHEMA_CHECKS;

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

/**
 * The photographs the judge is shown (TEACH-220): each placed `image-text` slide's thumbnail — the
 * picture the pipeline's judge chose — as an image part, numbered in slide order.
 */
export const judgeImages = photoThumbnails;

/**
 * True when the judge can see at least one photograph: `imageFit` is scored only then. A placement
 * without a thumbnail on its evidence (judged from captions, before TEACH-220) is not scored — the
 * judge cannot look at it.
 */
export function hasPlacedPhoto(lesson: Lesson): boolean {
  return judgeImages(lesson).length > 0;
}

/** What the judge reads: the same plain-text projections Evaluate uses (ADR 0025 §11). */
export function rubricJudgeInput(output: ScorerOutput): RubricJudgeInput {
  const { lesson, worksheet } = output;
  if (!lesson.facts) throw new Error("rubric judge: the lesson has no facts; Plan has not run");
  const photos = judgeImages(lesson).map((i) => i.id);
  return {
    audience: audienceOf(lesson),
    topic: lesson.brief?.topic ?? lesson.title,
    facts: lesson.facts,
    slides: lesson.slides.map((slide, index) => ({
      index: index + 1,
      kind: slide.kind,
      text: slideText(slide),
      notes: slide.notes ?? "",
      ...(photos.indexOf(slide.id) === -1 ? {} : { photo: photos.indexOf(slide.id) + 1 }),
    })),
    blocks: (worksheet?.blocks ?? []).map((block) => ({
      type: block.type,
      text: blockText(block),
    })),
    hasPlacedPhoto: hasPlacedPhoto(lesson),
  };
}

/** Mean of the non-null scores, to one decimal; `null` when none. */
export function rubricMean(dimensions: Record<RubricDimension, number | null>): number | null {
  const scored = Object.values(dimensions).filter((s): s is number => s !== null);
  if (scored.length === 0) return null;
  return Math.round((scored.reduce((sum, s) => sum + s, 0) / scored.length) * 10) / 10;
}

type RubricAnalysis =
  | { ok: true; output: RubricOutput }
  | { ok: false; reason: "no-judge" | "budget" | "failed" };

/**
 * The judge as a Mastra scorer: one `frontier` call through `callStructured`, charged to the run's
 * budget so it counts against `AI_EVAL_RUN_COST_CAP_USD`. Built per run because the deps are
 * captured here and never travel through the scorer's `run` input (a Mastra span would otherwise
 * serialise them). Never throws: a cap stop, a schema miss on both attempts or any other failure
 * scores `null` so the eval still finishes and writes its file.
 */
export function rubricJudgeScorer(judge: JudgeDeps) {
  return createScorer<string, ScorerOutput>({
    id: "rubric-judge",
    description: "eight-dimension rubric scored 1–5 by the frontier model over the whole lesson",
  })
    .analyze(async ({ run }): Promise<RubricAnalysis> => {
      if (judge.budget.exceeded()) return { ok: false, reason: "budget" };
      try {
        const result = await callStructured({
          deps: {
            ai: judge.ai,
            budget: judge.budget,
            signal: judge.signal,
            logger: pino({ level: "silent" }),
            context: judge.context,
          },
          stage: "evaluate",
          cls: "frontier",
          // Judging is thinking work; `medium` rather than `high` keeps Sol's wall time bounded.
          effort: "medium",
          prompt: rubricJudgePrompt,
          input: rubricJudgeInput(run.output),
          schema: RubricOutputSchema,
          maxOutputTokens: 1500,
          images: judgeImages(run.output.lesson),
        });
        return { ok: true, output: result.output };
      } catch (error) {
        if (error instanceof BudgetExceeded) return { ok: false, reason: "budget" };
        if (error instanceof StageFailure) return { ok: false, reason: "failed" };
        return { ok: false, reason: "failed" };
      }
    })
    .generateScore(({ results }) => {
      const analysis = results.analyzeStepResult;
      if (!analysis.ok) return 0;
      return rubricMean(scoresOf(analysis.output)) ?? 0;
    })
    .generateReason(({ results }) => {
      const analysis = results.analyzeStepResult;
      if (!analysis.ok) return `rubric not scored (${analysis.reason}).`;
      const scores = scoresOf(analysis.output);
      const scored = Object.values(scores).filter((s) => s !== null).length;
      return `${scored} dimensions scored, mean ${rubricMean(scores) ?? "-"}.`;
    });
}

function scoresOf(output: RubricOutput): Record<RubricDimension, number | null> {
  const scores = {} as Record<RubricDimension, number | null>;
  for (const d of RUBRIC_DIMENSIONS) scores[d] = output.dimensions[d].score;
  return scores;
}

function rationalesOf(output: RubricOutput): Record<RubricDimension, string> {
  const rationales = {} as Record<RubricDimension, string>;
  for (const d of RUBRIC_DIMENSIONS) rationales[d] = output.dimensions[d].rationale;
  return rationales;
}

/**
 * Every score for one generated lesson, keyed for the results file. With `judge` the rubric judge
 * runs too (one paid call); without it — the schema half — the rubric is `null` and nothing spends.
 */
export async function scoreLesson(
  briefId: string,
  output: ScorerOutput,
  judge?: JudgeDeps,
): Promise<ScoredLesson> {
  const [schema, model, rubric] = await Promise.all([
    schemaScorer.run({ input: briefId, output }),
    modelFindingsScorer.run({ input: briefId, output }),
    judge ? rubricJudgeScorer(judge).run({ input: briefId, output }) : undefined,
  ]);
  const analysis = rubric?.analyzeStepResult;
  if (!analysis?.ok) {
    return { scores: { schema: schema.score, modelFindings: model.score, rubric: null } };
  }
  const dimensions = scoresOf(analysis.output);
  return {
    scores: {
      schema: schema.score,
      modelFindings: model.score,
      rubric: { mean: rubricMean(dimensions), dimensions },
    },
    rubricRationales: rationalesOf(analysis.output),
  };
}
