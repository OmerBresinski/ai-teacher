import { createBudget, isAiError } from "@tj/ai";
import {
  clearGenerating,
  type DocumentRow,
  forWorkspace,
  getDocument,
  putDocumentAsJob,
  type WorkspaceDb,
} from "@tj/db";
import type { JobId, LessonId } from "@tj/domain";
import {
  type Lesson,
  type LessonFacts,
  parseLesson,
  parseWorksheet,
  type Worksheet,
  type WorksheetGeneration,
} from "@tj/domain/documents";
import {
  BudgetExceeded,
  buildFrame,
  checkWorksheet,
  type FillDeps,
  fillFrame,
  generateWorksheetFillPrompt,
  repairPrompt,
  StageFailure,
} from "@tj/generation";
import { defineJob, NonRetryableError } from "@tj/jobs";
import { RECIPE_PROMPT_VERSION, resolveRecipe, uid } from "@tj/slides";
import type { WorkerDeps } from "../deps";
import { effortOverride } from "../effort";

/**
 * `lesson.worksheet` — one worksheet beside a confirmed lesson, on its own row, lock and budget
 * (ADR 0030 items 1, 3, 9; TDD §7, T7). The API wrote (or re-locked) the worksheet row with
 * `generating_job_id = jobId` and enqueued this job with the resolved recipe and practice time.
 *
 * The handler owns the **worksheet** row through that lock and reads the **lesson** with a plain
 * `getDocument`: no lesson lock is taken and the lesson row is never written, so the slides job
 * may hold it at the same time and neither cancels the other. It refuses a row it does not own,
 * a lesson at another plan revision or one that never reached `planned`, with
 * `NonRetryableError` before any model call.
 *
 * Then, with a progress event carrying the worksheet's own `updatedAt` and `stage: "worksheet"`
 * (ADR 0029 item 14) at each step: `5 "Framing"` → the recipe frame persisted as `framed` →
 * `20 "Writing the questions"` → the one `small` fill call, persisted as `filled` →
 * `80 "Checking"` → the deterministic checks and at most one repair, persisted as `checked` with
 * usage, findings and `completedAt` → `100 "Worksheet ready"`.
 *
 * Budget: `AI_WORKSHEET_COST_CAP_USD`, seeded from the row's own `generation.usage` when the job
 * reuses a frame an earlier fill left (item 9); the lesson's spend is never read. A fill that
 * misses its schema twice (`StageFailure`) fails the job without retry: the `framed` document
 * stays for the next request to reuse. The same shape as `runLessonJob` (try / classify /
 * release in `finally`), not the function: that one locks and budgets the lesson.
 */
export const lessonWorksheetJob = defineJob<"lesson.worksheet", WorkerDeps>(
  "lesson.worksheet",
  async (ctx) => {
    const { payload, workspaceId, jobId, signal, deps, logger } = ctx;
    const { lessonId, worksheetId, revision, recipeId, practiceMinutes } = payload;
    const ws = forWorkspace(deps.db, workspaceId);
    let keepLockForRetry = false;
    try {
      if (signal.aborted) {
        keepLockForRetry = signal.reason === "shutdown";
        return;
      }
      const row = await loadOwnedWorksheet(ws, worksheetId, jobId);
      const { lesson, facts } = await loadPlannedLesson(ws, lessonId, revision);
      if (deps.ai.kind === "unconfigured") {
        throw new NonRetryableError(
          "AI provider is not configured (AWS_BEARER_TOKEN_BEDROCK unset)",
        );
      }
      const stored = parseWorksheet(row.body);
      const prior = stored.generation;
      const budget = createBudget(
        { capUsd: deps.worksheetCapUsd, capTokens: deps.caps.capTokens },
        { spent: prior?.usage },
      );
      const recipe = resolveRecipe(recipeId, facts);
      const stage = "worksheet" as const;
      const pipelineDeps: FillDeps = {
        ai: deps.ai,
        budget,
        signal,
        logger: logger.child({
          lessonId,
          worksheetId,
          recipeId: recipe.id,
          practiceMinutes,
          reused: prior !== undefined,
          usagePriorUsd: prior?.usage.costUsd ?? 0,
        }),
        now: () => new Date(),
        ids: uid,
        context: { lessonId, jobId },
        ...effortOverride(deps.reasoningEffort),
      };
      const persist = async (worksheet: Worksheet): Promise<string> => {
        const result = await putDocumentAsJob(ws, worksheetId, worksheet, jobId);
        if (result.status !== "ok") throw new NonRetryableError(`worksheet ${result.status}`);
        return result.row.updatedAt.toISOString();
      };

      await ctx.progress(5, "Framing", { stage, documentUpdatedAt: row.updatedAt.toISOString() });
      const startedAt = pipelineDeps.now().toISOString();
      const frame = buildFrame(
        { recipe, facts, lesson, worksheetId, practiceMinutes },
        pipelineDeps,
      );
      const generation: WorksheetGeneration = {
        jobId,
        stage: "framed",
        startedAt,
        promptVersions: { frame: RECIPE_PROMPT_VERSION },
        usage: budget.totals(),
        findings: [],
        recipeId: recipe.id,
        practiceMinutes,
      };
      // A reused row keeps the date it was made; everything else is the new frame's.
      const framed: Worksheet = { ...frame.worksheet, createdAt: stored.createdAt, generation };
      const framedAt = await persist(framed);
      logger.info(
        {
          lessonId,
          worksheetId,
          recipeId: recipe.id,
          blocks: framed.blocks.length,
          slots: frame.fillSlots.length,
        },
        "worksheet framed",
      );

      await ctx.progress(20, "Writing the questions", { stage, documentUpdatedAt: framedAt });
      const filled = await fillFrame(
        { ...frame, recipe, lesson, facts, practiceMinutes },
        pipelineDeps,
      );
      const filledGeneration: WorksheetGeneration = {
        ...generation,
        stage: "filled",
        promptVersions: {
          ...generation.promptVersions,
          ...(filled.modelId !== undefined ? { fill: generateWorksheetFillPrompt.version } : {}),
        },
        usage: budget.totals(),
        findings: filled.findings,
      };
      const filledSheet: Worksheet = {
        ...framed,
        blocks: filled.worksheet.blocks,
        generation: filledGeneration,
      };
      const filledAt = await persist(filledSheet);

      await ctx.progress(80, "Checking", { stage, documentUpdatedAt: filledAt });
      const checked = await checkWorksheet(
        { lesson, worksheet: filledSheet, practiceMinutes, findings: filled.findings },
        pipelineDeps,
      );
      const checkedGeneration: WorksheetGeneration = {
        ...filledGeneration,
        stage: "checked",
        completedAt: pipelineDeps.now().toISOString(),
        promptVersions: {
          ...filledGeneration.promptVersions,
          ...(checked.repaired > 0 ? { repair: repairPrompt.version } : {}),
        },
        usage: budget.totals(),
        findings: checked.findings,
      };
      const checkedSheet: Worksheet = {
        ...filledSheet,
        blocks: checked.worksheet.blocks,
        generation: checkedGeneration,
      };
      const checkedAt = await persist(checkedSheet);
      await ctx.progress(100, "Worksheet ready", { stage, documentUpdatedAt: checkedAt });
      logger.info(
        {
          lessonId,
          worksheetId,
          recipeId: recipe.id,
          blocks: checkedSheet.blocks.length,
          findings: checked.findings.length,
          repaired: checked.repaired,
          reservedStems: filled.reservedStems.length,
          costUsd: checkedGeneration.usage.costUsd,
          calls: checkedGeneration.usage.calls,
        },
        "worksheet ready",
      );
    } catch (error) {
      // What was persisted stays (item 9). A cancel is terminal (`runJob` records `cancelled`);
      // a shutdown is retried by pg-boss, so the next attempt needs the lock.
      if (signal.aborted) {
        keepLockForRetry = signal.reason === "shutdown";
        return;
      }
      if (error instanceof BudgetExceeded) {
        throw new NonRetryableError(error.message, { cause: error });
      }
      if (isAiError(error, "unconfigured") || isAiError(error, "invalid_model")) {
        throw new NonRetryableError(error.message, { cause: error });
      }
      // The fill missed its schema twice: the frame is kept for the next request (item 9).
      if (error instanceof StageFailure) {
        throw new NonRetryableError(error.message, { cause: error });
      }
      if (!(error instanceof NonRetryableError)) keepLockForRetry = true;
      throw error;
    } finally {
      if (keepLockForRetry) {
        logger.info({ worksheetId }, "worksheet generating lock kept for the retry");
      } else {
        await clearGenerating(ws, worksheetId, jobId);
        logger.debug({ worksheetId }, "worksheet generating lock released");
      }
    }
  },
);

/**
 * The worksheet row this job owns, or a `NonRetryableError`: `worksheet missing` when the API's
 * failure path deleted it, `lock lost` when it is unlocked or a newer job holds it.
 */
async function loadOwnedWorksheet(
  ws: WorkspaceDb,
  worksheetId: string,
  jobId: JobId,
): Promise<DocumentRow> {
  const row = await getDocument(ws, worksheetId);
  if (row === null || row.kind !== "worksheet") throw new NonRetryableError("worksheet missing");
  if (row.generatingJobId !== jobId) throw new NonRetryableError("lock lost");
  return row;
}

/**
 * The lesson the sheet is for, read without a lock: it must have reached `planned` (its facts
 * are verified, ADR 0029 item 2) at the plan revision this job was queued for.
 */
async function loadPlannedLesson(
  ws: WorkspaceDb,
  lessonId: LessonId,
  revision: number,
): Promise<{ lesson: Lesson; facts: LessonFacts }> {
  const row = await getDocument(ws, lessonId);
  if (row === null || row.kind !== "lesson") throw new NonRetryableError("lesson missing");
  const lesson = parseLesson(row.body);
  if ((lesson.plan?.revision ?? 0) !== revision) throw new NonRetryableError("revision moved");
  const facts = lesson.facts;
  if (lesson.generation?.stage === undefined || facts === undefined) {
    throw new NonRetryableError("lesson is not planned");
  }
  return { lesson, facts };
}
