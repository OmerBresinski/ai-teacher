import { RequestContext } from "@mastra/core/request-context";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import type { Lesson } from "@tj/domain/documents";
import { z } from "zod";
import { evaluate } from "./stages/evaluate";
import { generate } from "./stages/generate";
import { plan } from "./stages/plan";
import { repair } from "./stages/repair";
import {
  type PipelineDeps,
  type PipelineState,
  STAGE_CHECKPOINT,
  STAGE_ORDER,
  StageFailure,
  type StageName,
} from "./types";

/*
 * The in-process Mastra workflow (ADR 0025 §5, §21): four thin steps around the pure stage
 * functions. The state — the documents plus the worksheet row id — travels as step IO. Mastra
 * validates step IO against Standard JSON Schema; `z.custom<PipelineState>()` declares the type
 * without re-validating a document of up to 1 MB on every hop (`parseLesson` already ran when the
 * row was read, and `persist` validates on write). `deps` ride on the `RequestContext`; they hold
 * functions and an `AbortSignal`, which step IO cannot carry. No `Mastra` instance, no storage,
 * no step retries: `callStructured` owns the one retry (§14) and pg-boss owns the job retry.
 */

const StateSchema = z.custom<PipelineState>(() => true, { message: "pipeline state" });

const DEPS_KEY = "deps";
const FAILURE_KEY = "failure";
const RESUME_KEY = "resumeFrom";

type Ctx = { requestContext: RequestContext; runId: string };

/**
 * Studio (`mastra.dev.ts`) starts runs from a JSON form, which cannot carry functions or an
 * `AbortSignal`, so it registers a factory here. Production never sets one: `runLessonPipeline`
 * always puts real deps on the request context, and a missing entry is a programming error.
 */
let devDepsFactory: ((runId: string) => PipelineDeps) | null = null;
export function registerDevDeps(factory: ((runId: string) => PipelineDeps) | null): void {
  devDepsFactory = factory;
}

function depsOf({ requestContext, runId }: Ctx): PipelineDeps {
  const deps = requestContext.getRaw(DEPS_KEY) as PipelineDeps | undefined;
  if (deps) return deps;
  if (devDepsFactory) {
    const made = devDepsFactory(runId);
    requestContext.setRaw(DEPS_KEY, made);
    return made;
  }
  throw new Error("pipeline deps missing from the request context");
}

/** The first stage that still has to run for this lesson (ADR 0025 §5 checkpoint resume). */
export function resumeFrom(lesson: Lesson): StageName | null {
  const done = lesson.generation?.stage;
  if (!done) return "plan";
  const index = STAGE_ORDER.findIndex((stage) => STAGE_CHECKPOINT[stage] === done);
  return STAGE_ORDER[index + 1] ?? null;
}

/** Whether `stage` runs for a lesson resuming at `from`. */
function shouldRun(stage: StageName, from: StageName | null): boolean {
  if (from === null) return false;
  return STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf(from);
}

/**
 * A step: skip when the checkpoint says this stage is done, otherwise run the stage. A thrown
 * error is stashed on the request context before it propagates so `runLessonPipeline` can
 * rethrow the original instance — Mastra serialises step errors to `{ name, message }`.
 */
function stageStep(
  stage: StageName,
  run: (state: PipelineState, deps: PipelineDeps) => Promise<PipelineState>,
) {
  return createStep({
    id: stage,
    description: `The ${stage} stage of the lesson pipeline (ADR 0025)`,
    inputSchema: StateSchema,
    outputSchema: StateSchema,
    execute: async ({ inputData, requestContext, runId }) => {
      const deps = depsOf({ requestContext, runId });
      // `runLessonPipeline` sets `resumeFrom`; a Studio run has none and resumes from the lesson.
      const from = requestContext.hasRaw(RESUME_KEY)
        ? (requestContext.getRaw(RESUME_KEY) as StageName | null)
        : resumeFrom(inputData.lesson);
      if (!shouldRun(stage, from)) return inputData;
      try {
        return await run(inputData, deps);
      } catch (error) {
        requestContext.setRaw(FAILURE_KEY, error);
        throw error;
      }
    },
  });
}

export const planStep = stageStep("plan", plan);
export const generateStep = stageStep("generate", generate);
export const evaluateStep = stageStep("evaluate", evaluate);
export const repairStep = stageStep("repair", repair);

export const lessonWorkflow = createWorkflow({
  id: "lesson-plan",
  description: "Plan → Generate → Evaluate → Repair for one lesson (ADR 0025)",
  inputSchema: StateSchema,
  outputSchema: StateSchema,
})
  .then(planStep)
  .then(generateStep)
  .then(evaluateStep)
  .then(repairStep)
  .commit();

export interface PipelineInput {
  lesson: Lesson;
  /** The `documents` row id the worker minted for the worksheet (ADR 0025 §4). */
  worksheetId: string;
  /** The worksheet as already written, when resuming after `generated`. */
  worksheet?: PipelineState["worksheet"];
}

/**
 * Run the workflow for one job. Resolves with the final state; rejects with the stage's own
 * error (`StageFailure`, `AbortError`, …). Writes the one `generation summary` line (§16).
 */
export async function runLessonPipeline(
  input: PipelineInput,
  deps: PipelineDeps,
): Promise<PipelineState> {
  const startedAt = Date.now();
  const from = resumeFrom(input.lesson);
  const requestContext = new RequestContext();
  requestContext.setRaw(DEPS_KEY, deps);
  requestContext.setRaw(RESUME_KEY, from);
  const state: PipelineState = {
    lesson: input.lesson,
    worksheetId: input.worksheetId,
    worksheet: input.worksheet,
  };

  const run = await lessonWorkflow.createRun({ runId: deps.context.jobId });
  const result = await run.start({ inputData: state, requestContext });

  if (result.status !== "success") {
    const stashed = requestContext.getRaw(FAILURE_KEY);
    if (stashed instanceof Error) throw stashed;
    const message =
      result.status === "failed"
        ? describe(result.error)
        : `workflow ended with status ${result.status}`;
    throw new StageFailure(from ?? "plan", message, {
      cause: result.status === "failed" ? result.error : undefined,
    });
  }

  const final = result.result;
  const generation = final.lesson.generation;
  const stagesRun = from ? STAGE_ORDER.slice(STAGE_ORDER.indexOf(from)) : [];
  const findings = { error: 0, warning: 0 };
  for (const f of generation?.findings ?? []) findings[f.severity] += 1;
  deps.logger.info(
    {
      generation: {
        lessonId: deps.context.lessonId,
        jobId: deps.context.jobId,
        stages: stagesRun,
        ...deps.budget.totals(),
        findings,
        durationMs: Date.now() - startedAt,
      },
    },
    "generation summary",
  );
  return final;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error)
    return String((error as { message: unknown }).message);
  return String(error);
}
