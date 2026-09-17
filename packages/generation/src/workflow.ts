import { RequestContext } from "@mastra/core/request-context";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { safeError } from "@tj/domain";
import type { Lesson } from "@tj/domain/documents";
import { z } from "zod";
import { checkInput } from "./stages/check-input";
import { evaluate } from "./stages/evaluate";
import { generate } from "./stages/generate";
import { illustrate } from "./stages/illustrate";
import { plan } from "./stages/plan";
import { repair } from "./stages/repair";
import {
  emptyImageCounts,
  type PipelineDeps,
  type PipelineStageName,
  type PipelineState,
  STAGE_CHECKPOINT,
  STAGE_ORDER,
  StageFailure,
} from "./types";

/*
 * The in-process Mastra workflow (ADR 0025 §5, §21): five thin steps around the pure stage
 * functions — the input check (TEACH-137) and the four checkpointed stages. The state — the lesson
 * and the run's options — travels as step IO. Mastra
 * validates step IO against Standard JSON Schema; `z.custom<PipelineState>()` declares the type
 * without re-validating a document of up to 1 MB on every hop (`parseLesson` already ran when the
 * row was read, and `persist` validates on write). `deps` ride on the `RequestContext`; they hold
 * functions and an `AbortSignal`, which step IO cannot carry. No `Mastra` instance, no storage,
 * no step retries: `callStructured` owns the one retry (§14) and pg-boss owns the job retry.
 */

export const StateSchema = z.custom<PipelineState>(() => true, { message: "pipeline state" });

const DEPS_KEY = "deps";
const FAILURE_KEY = "failure";
const RESUME_KEY = "resumeFrom";
/**
 * The stage after which the run stops (ADR 0029 item 1): `lesson.plan` with `stopAfter:
 * "planned"` runs the input check and Plan, and every later step returns its input untouched —
 * read per step like `RESUME_KEY`, so the split is a flag, not a second workflow.
 */
const STOP_KEY = "stopAfter";
/** Stages whose `execute` actually ran (not skipped), for the summary line. */
const ENTERED_KEY = "entered";
/** The last state a stage returned — the last persisted checkpoint — for the summary on failure. */
const CHECKPOINT_KEY = "checkpoint";

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

/**
 * The first stage that still has to run for this lesson (ADR 0025 §5 checkpoint resume). No
 * checkpoint means nothing is certified yet, so the run starts from the input check; a lesson at
 * `planned` or later has had its brief checked and resumes after its checkpoint. A checkpoint
 * over facts with no outline is stale, not a resume point: a re-plan (ADR 0029 item 8, TDD §4.4)
 * empties the outline and leaves the previous revision's `generation` on the row until Plan
 * rewrites it, and nothing after Plan can run without an outline.
 */
export function resumeFrom(lesson: Lesson): PipelineStageName | null {
  const done = lesson.generation?.stage;
  if (!done || (lesson.facts?.outline.length ?? 0) === 0) return STAGE_ORDER[0] ?? null;
  const index = STAGE_ORDER.findIndex((stage) => STAGE_CHECKPOINT[stage] === done);
  return STAGE_ORDER[index + 1] ?? null;
}

/** Whether `stage` runs for a lesson resuming at `from` and stopping after `stopAfter`. */
function shouldRun(
  stage: PipelineStageName,
  from: PipelineStageName | null,
  stopAfter: PipelineStageName | undefined,
): boolean {
  if (from === null) return false;
  const at = STAGE_ORDER.indexOf(stage);
  if (stopAfter !== undefined && at > STAGE_ORDER.indexOf(stopAfter)) return false;
  return at >= STAGE_ORDER.indexOf(from);
}

/**
 * A step: skip when the checkpoint says this stage is done or the run stops before it, otherwise
 * run the stage. A thrown
 * error stays in-process on the request context so `runLessonPipeline` can rethrow it to the
 * worker's retry classifier. Mastra receives only a safe sentinel: it logs step errors itself.
 */
function stageStep(
  stage: PipelineStageName,
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
        ? (requestContext.getRaw(RESUME_KEY) as PipelineStageName | null)
        : resumeFrom(inputData.lesson);
      const stopAfter = requestContext.getRaw(STOP_KEY) as PipelineStageName | undefined;
      if (!shouldRun(stage, from, stopAfter)) return inputData;
      const entered = (requestContext.getRaw(ENTERED_KEY) as PipelineStageName[] | undefined) ?? [];
      requestContext.setRaw(ENTERED_KEY, [...entered, stage]);
      try {
        const next = await run(inputData, deps);
        requestContext.setRaw(CHECKPOINT_KEY, next);
        return next;
      } catch (error) {
        requestContext.setRaw(FAILURE_KEY, error);
        deps.logger.error({ stage, err: safeError(error) }, "generation stage failed");
        const failure = new Error("Pipeline stage failed.");
        delete failure.stack;
        throw failure;
      }
    },
  });
}

export const checkInputStep = stageStep("check-input", checkInput);
export const planStep = stageStep("plan", plan);
export const generateStep = stageStep("generate", generate);
export const illustrateStep = stageStep("illustrate", illustrate);
export const evaluateStep = stageStep("evaluate", evaluate);
export const repairStep = stageStep("repair", repair);

export const lessonWorkflow = createWorkflow({
  id: "lesson-plan",
  description:
    "Check input → Plan → Generate → Illustrate → Evaluate → Repair for one lesson (ADR 0025)",
  inputSchema: StateSchema,
  outputSchema: StateSchema,
})
  .then(checkInputStep)
  .then(planStep)
  .then(generateStep)
  .then(illustrateStep)
  .then(evaluateStep)
  .then(repairStep)
  .commit();

export interface PipelineInput {
  lesson: Lesson;
  /** Legacy (ADR 0025 §4): the worksheet row id the worker minted; unread since ADR 0030. */
  worksheetId?: string;
  /** Legacy: the worksheet of a lesson generated before ADR 0030, when resuming after `generated`. */
  worksheet?: PipelineState["worksheet"];
  /** A re-plan with the teacher's objectives pinned (ADR 0029 item 8). */
  pinObjectives?: boolean;
}

export interface PipelineOptions {
  /**
   * Stop after the `planned` checkpoint (ADR 0029 items 1–2): the `lesson.plan` job's run. Plan
   * awaits Verify before writing the checkpoint; nothing after it runs. `lesson.generate` runs the
   * same function without the option and resumes at Generate from the checkpoint.
   */
  stopAfter?: "planned";
}

/**
 * Run the workflow for one job. Resolves with the final state; rejects with the stage's own
 * error (`StageFailure`, `AbortError`, …). Writes the one `generation summary` line (§16).
 */
export async function runLessonPipeline(
  input: PipelineInput,
  deps: PipelineDeps,
  options: PipelineOptions = {},
): Promise<PipelineState> {
  const startedAt = Date.now();
  const from = resumeFrom(input.lesson);
  const requestContext = new RequestContext();
  requestContext.setRaw(DEPS_KEY, deps);
  requestContext.setRaw(RESUME_KEY, from);
  // The option names a checkpoint; the steps compare stages, so the key holds the stage that
  // writes it.
  const stopStage = STAGE_ORDER.find((stage) => STAGE_CHECKPOINT[stage] === options.stopAfter);
  if (stopStage !== undefined) requestContext.setRaw(STOP_KEY, stopStage);
  const state: PipelineState = {
    lesson: input.lesson,
    worksheetId: input.worksheetId,
    worksheet: input.worksheet,
    ...(input.pinObjectives ? { pinObjectives: true } : {}),
    ...(options.stopAfter !== undefined ? { stopAfter: options.stopAfter } : {}),
  };
  let outcome: "success" | "failed" = "failed";
  let final: PipelineState | undefined;

  try {
    const run = await lessonWorkflow.createRun({ runId: deps.context.jobId });
    const result = await run.start({ inputData: state, requestContext });
    if (result.status !== "success") {
      const stashed = requestContext.getRaw(FAILURE_KEY);
      if (requestContext.hasRaw(FAILURE_KEY)) throw stashed;
      throw new StageFailure(from ?? "check-input", "The lesson workflow could not finish.");
    }
    final = result.result;
    outcome = "success";
    return final;
  } finally {
    // One `generation summary` line per job whatever the outcome (ADR 0025 §16): counts, cost
    // and duration — never content. `stages` are the stages that actually ran; on failure the
    // findings are those of the last checkpoint a stage persisted (none when Plan itself failed).
    const checkpoint =
      final ?? (requestContext.getRaw(CHECKPOINT_KEY) as PipelineState | undefined);
    const findings = { error: 0, warning: 0 };
    for (const f of checkpoint?.lesson.generation?.findings ?? []) findings[f.severity] += 1;
    deps.logger.info(
      {
        generation: {
          lessonId: deps.context.lessonId,
          jobId: deps.context.jobId,
          outcome,
          stages: (requestContext.getRaw(ENTERED_KEY) as PipelineStageName[] | undefined) ?? [],
          ...deps.budget.totals(),
          findings,
          images: deps.imageCounts ?? emptyImageCounts(),
          durationMs: Date.now() - startedAt,
        },
      },
      "generation summary",
    );
  }
}
