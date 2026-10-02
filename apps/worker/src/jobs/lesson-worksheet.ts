import { createBudget, isAiError } from "@tj/ai";
import {
  clearGenerating,
  type DocumentRow,
  deleteDocument,
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
import {
  RECIPE_PROMPT_VERSION,
  type RecipeId,
  recipeForFacts,
  resolveRecipe,
  uid,
  type WorksheetRecipe,
} from "@tj/slides";
import type { Logger } from "pino";
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
    // "Follows the lesson" saves nothing until its sheet is written (TEACH-86): its frame is only
    // an instruction to the model, so a failed or over-budget fill must not leave it as a sheet.
    // A row the API created for this job (no earlier generation) is deleted on failure instead.
    let deleteOnFailure = false;
    let succeeded = false;
    try {
      if (signal.aborted) {
        keepLockForRetry = signal.reason === "shutdown";
        return;
      }
      const row = await loadOwnedWorksheet(ws, worksheetId, jobId);
      let { lesson, facts } = await loadPlannedLesson(ws, lessonId, revision);
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
      const { recipe, exitTicket } = chooseRecipe(recipeId, facts, logger, {
        lessonId,
        worksheetId,
      });
      const lessonSheet = recipe.id === "lesson";
      if (lessonSheet) {
        // The creation flow asks for the sheet as the slides start; "Follows the lesson" reads
        // the finished slides, so it waits for the lesson's own job to let go (outline after that).
        const waited = await waitWhileLessonGenerates(
          async () => (await getDocument(ws, lessonId))?.generatingJobId != null,
          signal,
        );
        if (waited.waitedMs > 0) {
          logger.info({ lessonId, worksheetId, ...waited }, "worksheet waited for the slides");
          ({ lesson, facts } = await loadPlannedLesson(ws, lessonId, revision));
        }
      }
      deleteOnFailure = lessonSheet && prior === undefined;
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
      const framedAt = lessonSheet ? row.updatedAt.toISOString() : await persist(framed);
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
        { ...frame, recipe, lesson, facts, practiceMinutes, exitTicket },
        pipelineDeps,
      );
      const filledGeneration: WorksheetGeneration = {
        ...generation,
        stage: "filled",
        promptVersions: {
          ...generation.promptVersions,
          ...(filled.modelId !== undefined
            ? { fill: filled.promptVersion ?? generateWorksheetFillPrompt.version }
            : {}),
        },
        usage: budget.totals(),
        findings: filled.findings,
      };
      // The lesson sheet decides `showMarks` itself (marked items at KS4 and post-16, ruling 146).
      const { showMarks: _framedMarks, ...unmarked } = framed;
      const filledSheet: Worksheet = {
        ...(recipe.id === "lesson" ? unmarked : framed),
        ...(recipe.id === "lesson" && filled.worksheet.showMarks ? { showMarks: true } : {}),
        blocks: filled.worksheet.blocks,
        generation: filledGeneration,
      };
      const filledAt = await persist(filledSheet);
      deleteOnFailure = false;

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
      succeeded = true;
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
      } else if (!succeeded && deleteOnFailure) {
        await deleteDocument(ws, worksheetId);
        logger.info(
          { worksheetId },
          "worksheet removed: the lesson sheet was not written, so no half-made sheet is kept",
        );
      } else {
        await clearGenerating(ws, worksheetId, jobId);
        logger.debug({ worksheetId }, "worksheet generating lock released");
      }
    }
  },
);

/**
 * The recipe this run builds (TEACH-86). FR 6: a recipe whose frame would print an empty block
 * from these facts (no vocabulary, too few questions, too few claims) is swapped for "Follows the
 * lesson", and the job log says which and why. Rulings 141 and 108: asking for the Exit ticket
 * recipe is the teacher's yes to an exit ticket; otherwise no choice is recorded yet (`undefined`)
 * and `fillLessonSheet` keeps today's default. TEACH-22, the remembered per-teacher preference,
 * supplies `true` or `false` here when it lands.
 */
export function chooseRecipe(
  recipeId: RecipeId | "auto",
  facts: LessonFacts,
  logger: Pick<Logger, "info">,
  ids: { lessonId: string; worksheetId: string },
): { recipe: WorksheetRecipe; exitTicket: boolean | undefined } {
  const requested = resolveRecipe(recipeId, facts);
  const { recipe, fellBackFrom } = recipeForFacts(requested, facts);
  if (fellBackFrom) {
    logger.info(
      { ...ids, requested: fellBackFrom.recipeId, reasons: fellBackFrom.reasons },
      "worksheet recipe fell back to lesson: the facts would leave a block empty",
    );
  }
  return { recipe, exitTicket: requested.id === "exit-ticket" ? true : undefined };
}

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

/** How long "Follows the lesson" waits for the lesson's slides before it uses the outline. */
export const SLIDES_WAIT = { timeoutMs: 240_000, pollMs: 2_000 };

/**
 * Polls `generating` until it is false, the signal aborts, or the timeout passes. Returns how long
 * it waited and whether the slides finished (`false` means the sheet falls back to the outline).
 */
export async function waitWhileLessonGenerates(
  generating: () => Promise<boolean>,
  signal: AbortSignal,
  options: { timeoutMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ waitedMs: number; finished: boolean }> {
  const { timeoutMs = SLIDES_WAIT.timeoutMs, pollMs = SLIDES_WAIT.pollMs } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let waitedMs = 0;
  while (await generating()) {
    if (signal.aborted || waitedMs >= timeoutMs) return { waitedMs, finished: false };
    await sleep(pollMs);
    waitedMs += pollMs;
  }
  return { waitedMs, finished: true };
}
