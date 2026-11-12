import { type Budget, type BudgetTotals, createBudget, isAiError } from "@tj/ai";
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
  isSlideSheetRecipe,
  type Lesson,
  type LessonFacts,
  parseLesson,
  parseWorksheet,
  WORKSHEET_FAILURE_MESSAGES,
  type Worksheet,
  type WorksheetFailureCode,
  type WorksheetGeneration,
} from "@tj/domain/documents";
import {
  type BuiltSheet,
  buildFrame,
  buildSheet,
  checkWorksheet,
  type FillDeps,
  fillFrame,
  generateWorksheetFillPrompt,
  isBudgetRefusal,
  isModelSheetRecipe,
  repairPrompt,
  SheetBuildFailure,
  StageFailure,
  writeModelSheet,
} from "@tj/generation";
import { defineJob, NonRetryableError } from "@tj/jobs";
import { RECIPE_PROMPT_VERSION, resolveRecipe, uid } from "@tj/slides";
import { SLIDE_SHEET_VERSION } from "@tj/slides/worksheet/exit-sheet";
import type { WorkerDeps } from "../deps";
import { effortOverride } from "../effort";
import { captureCalls, createDebugRecorder, type DebugRecorder } from "../generation-debug";
import { budgetFailure } from "../job-errors";

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
 * The launch types (`isSlideSheetRecipe`, worksheets plan v2 T6) take a shorter path: the
 * lesson's slides as they stand (`lessonDigest`) → `buildSheet` → `gateSheet`, then **one** save,
 * `checked` and complete (D8). No frame is saved first, so there is never a half sheet that looks
 * finished; no repair pass runs (D7). A lesson that cannot carry the type fails
 * `not-enough-lesson`, too few items after the gate `too-few-checked` (`SheetBuildFailure`).
 * Exit ticket makes no model call, so it does not need the AI configured. Practice and Exam
 * practice (T7) make one `small` call (`writeModelSheet`) on a fresh worksheet budget, between
 * `20 "Writing the questions"` and the one save; its usage and prompt version are recorded.
 *
 * Budget: `AI_WORKSHEET_COST_CAP_USD`, seeded from the row's own `generation.usage` when the job
 * reuses a frame an earlier fill left (item 9); the lesson's spend is never read. A fill that
 * misses its schema twice (`StageFailure`) fails the job without retry.
 *
 * A job that ends for good (no pg-boss retry left, not cancelled) saves the row at
 * `stage: "failed"` with `failure { code, message }` while it still holds the lock (T2): the
 * blocks it had written stay, the reason is the teacher's words (`WORKSHEET_FAILURE_MESSAGES`),
 * and the next request reuses the row. A reused `failed` row starts a fresh budget: Try again is
 * a new, capped attempt, where a reused `framed` row is seeded with what it spent (item 9). The
 * same shape as `runLessonJob` (try / classify / release in `finally`), not the function: that
 * one locks and budgets the lesson.
 */
/**
 * R4 review (12 Nov): one $0.10 budget per sheet request, not per attempt. A retryable failure
 * after a billed call (429, timeout) used to start the retry on a fresh budget, so one request
 * could spend twice the cap. What an attempt spent is kept here under the job id (pg-boss keeps
 * the id across its retries) and seeds the next attempt; the last attempt clears it. In memory:
 * a worker restart between attempts starts the retry fresh (at most one more capped call).
 */
const spentByJob = new Map<string, BudgetTotals>();
export const sheetAttemptSpend = {
  seed: (jobId: string): { spent?: BudgetTotals } => {
    const spent = spentByJob.get(jobId);
    return spent ? { spent } : {};
  },
  keep: (jobId: string, budget: Budget | undefined) => {
    if (budget) spentByJob.set(jobId, budget.totals());
  },
  clear: (jobId: string) => {
    spentByJob.delete(jobId);
  },
};

export const lessonWorksheetJob = defineJob<"lesson.worksheet", WorkerDeps>(
  "lesson.worksheet",
  async (ctx) => {
    const { payload, workspaceId, jobId, signal, deps, logger } = ctx;
    const { lessonId, worksheetId, revision, recipeId, practiceMinutes } = payload;
    const ws = forWorkspace(deps.db, workspaceId);
    // Kept only for a retry pg-boss will run (TEACH-202 part g); the last attempt releases it.
    const attemptsLeft = ctx.attemptsLeft !== false;
    let keepLockForRetry = false;
    let recorder: DebugRecorder | undefined;
    let budget: Budget | undefined;
    try {
      if (signal.aborted) {
        keepLockForRetry = signal.reason === "shutdown" && attemptsLeft;
        return;
      }
      // The worksheet's model requests and failure go to its lesson's debug record (Greg, 20 Oct),
      // made before the loads so a failed load is recorded too.
      recorder = deps.generationDebug
        ? createDebugRecorder({
            store: deps.generationDebug,
            workspaceId,
            lessonId,
            jobId,
            attempt: ctx.attempt ?? 0,
            logger,
          })
        : undefined;
      const row = await loadOwnedWorksheet(ws, worksheetId, jobId);
      const { lesson, facts } = await loadPlannedLesson(ws, lessonId, revision);
      if (isSlideSheetRecipe(recipeId)) {
        // The new path (plan v2 T6): digest → build → gate → one save, finished or failed (D8).
        await ctx.progress(5, "Reading the lesson", {
          stage: "worksheet",
          documentUpdatedAt: row.updatedAt.toISOString(),
        });
        const stored = parseWorksheet(row.body);
        const startedAt = new Date().toISOString();
        let built: BuiltSheet;
        let promptVersions: WorksheetGeneration["promptVersions"] = { build: SLIDE_SHEET_VERSION };
        let usage: WorksheetGeneration["usage"] = {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
        };
        if (isModelSheetRecipe(recipeId)) {
          // Practice and Exam practice (T7): one small call on a fresh, capped budget.
          if (deps.ai.kind === "unconfigured") {
            throw new NonRetryableError(
              "AI provider is not configured (AWS_BEARER_TOKEN_BEDROCK unset)",
            );
          }
          const jobBudget = createBudget(
            { capUsd: deps.worksheetCapUsd, capTokens: deps.caps.capTokens },
            sheetAttemptSpend.seed(jobId),
          );
          budget = jobBudget;
          await ctx.progress(20, "Writing the questions", {
            stage: "worksheet",
            documentUpdatedAt: row.updatedAt.toISOString(),
          });
          const written = await writeModelSheet(
            { recipeId, lesson, worksheetId, now: () => new Date(), ids: uid, practiceMinutes },
            {
              ai: captureCalls(deps.ai, recorder),
              budget: jobBudget,
              signal,
              logger: logger.child({ lessonId, worksheetId, recipeId, practiceMinutes }),
              now: () => new Date(),
              ids: uid,
              context: { lessonId, jobId },
              ...effortOverride(deps.reasoningEffort),
            },
          );
          built = written;
          promptVersions = { build: SLIDE_SHEET_VERSION, write: written.promptVersion };
          usage = jobBudget.totals();
        } else {
          built = buildSheet({
            recipeId,
            lesson,
            worksheetId,
            now: () => new Date(),
            ids: uid,
          });
        }
        // R5: a shipped sheet keeps each dropped item in full, in its record and the log.
        const dropped = droppedItems(built);
        if (dropped.length)
          logger.info({ lessonId, worksheetId, recipeId, dropped }, "worksheet items dropped");
        const generation: WorksheetGeneration = {
          jobId,
          stage: "checked",
          startedAt,
          completedAt: new Date().toISOString(),
          promptVersions,
          // Exit ticket makes no model call (zero); Practice and Exam practice record the call's.
          usage,
          findings: built.findings,
          recipeId,
          practiceMinutes,
          ...(dropped.length ? { dropped } : {}),
        };
        const sheet: Worksheet = { ...built.worksheet, createdAt: stored.createdAt, generation };
        const result = await putDocumentAsJob(ws, worksheetId, sheet, jobId);
        if (result.status !== "ok") throw new NonRetryableError(`worksheet ${result.status}`);
        await ctx.progress(100, "Worksheet ready", {
          stage: "worksheet",
          documentUpdatedAt: result.row.updatedAt.toISOString(),
        });
        logger.info(
          {
            lessonId,
            worksheetId,
            recipeId,
            blocks: sheet.blocks.length,
            dropped: built.findings.length,
          },
          "worksheet ready",
        );
        return;
      }
      if (deps.ai.kind === "unconfigured") {
        throw new NonRetryableError(
          "AI provider is not configured (AWS_BEARER_TOKEN_BEDROCK unset)",
        );
      }
      const stored = parseWorksheet(row.body);
      const prior = stored.generation;
      const jobBudget = createBudget(
        { capUsd: deps.worksheetCapUsd, capTokens: deps.caps.capTokens },
        { spent: prior?.stage === "failed" ? undefined : prior?.usage },
      );
      budget = jobBudget;
      const recipe = resolveRecipe(recipeId, facts);
      const stage = "worksheet" as const;
      const pipelineDeps: FillDeps = {
        ai: captureCalls(deps.ai, recorder),
        budget: jobBudget,
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
        usage: jobBudget.totals(),
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
        usage: jobBudget.totals(),
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
        usage: jobBudget.totals(),
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
      recorder?.recordError(error, signal.aborted ? { aborted: String(signal.reason) } : undefined);
      // What was persisted stays (item 9). A cancel is terminal (`runJob` records `cancelled`);
      // a shutdown is retried by pg-boss, so the next attempt needs the lock.
      if (signal.aborted) {
        keepLockForRetry = signal.reason === "shutdown" && attemptsLeft;
        return;
      }
      let thrown: unknown = error;
      if (isBudgetRefusal(error)) {
        thrown = budgetFailure(error);
      } else if (isAiError(error, "unconfigured") || isAiError(error, "invalid_model")) {
        thrown = new NonRetryableError(error.message, { cause: error });
      } else if (error instanceof SheetBuildFailure) {
        // The lesson cannot carry this type, or too few items passed the gate: no retry helps.
        // The dropped items' reasons (generated text, no pupil data) go to the log so a failed
        // sheet says whether the model or a check was wrong (y5 fractions, 12 Nov).
        if (error.detail) {
          logger.warn(
            {
              worksheetId,
              code: error.code,
              written: error.detail.written,
              kept: error.detail.kept,
              dropped: error.detail.verdicts
                .filter((v) => v.faults.length > 0)
                .map((v) => ({ where: v.where, faults: v.faults })),
            },
            "worksheet items failed the checks",
          );
        }
        thrown = new NonRetryableError(error.message, { cause: error });
      } else if (error instanceof StageFailure) {
        // The fill missed its schema twice: what it had written stays for the next request.
        thrown = new NonRetryableError(error.message, { cause: error });
      } else if (!(error instanceof NonRetryableError)) {
        keepLockForRetry = attemptsLeft;
      }
      const code = keepLockForRetry ? null : worksheetFailureCode(error);
      if (code !== null) {
        await saveFailed(ws, { worksheetId, jobId, payload, code, budget }).catch((saveError) =>
          logger.warn({ worksheetId, err: saveError }, "worksheet failed state not saved"),
        );
      }
      throw thrown;
    } finally {
      if (recorder) {
        const debug = recorder;
        if (ctx.afterSettle) ctx.afterSettle(() => debug.close());
        else await debug.close();
      }
      if (keepLockForRetry) {
        sheetAttemptSpend.keep(jobId, budget);
        logger.info({ worksheetId }, "worksheet generating lock kept for the retry");
      } else {
        sheetAttemptSpend.clear(jobId);
        // Released after `runJob` writes the terminal event (TEACH-202 part j).
        const release = async () => {
          await clearGenerating(ws, worksheetId, jobId);
          logger.debug({ worksheetId }, "worksheet generating lock released");
        };
        if (ctx.afterSettle) ctx.afterSettle(release);
        else await release();
      }
    }
  },
);

/**
 * Why the job stopped, for the teacher (`generation.failure.code`), or `null` when nothing should
 * be saved: the row is gone or another job holds it, so this job may not write it.
 */
export function worksheetFailureCode(error: unknown): WorksheetFailureCode | null {
  if (isBudgetRefusal(error)) return "spend-limit";
  if (error instanceof SheetBuildFailure) return error.code;
  if (error instanceof NonRetryableError) {
    if (error.message === "worksheet missing" || error.message === "lock lost") return null;
    if (
      error.message === "revision moved" ||
      error.message === "lesson changed" ||
      error.message === "lesson missing" ||
      error.message === "lesson is not planned"
    ) {
      return "lesson-changed";
    }
  }
  return "could-not-write";
}

/**
 * Save the row this job still holds at `stage: "failed"`, keeping its blocks and any usage it
 * recorded. A row with no `generation` yet (the job stopped before the frame) gets one here.
 */
async function saveFailed(
  ws: WorkspaceDb,
  input: {
    worksheetId: string;
    jobId: JobId;
    payload: { recipeId: WorksheetGeneration["recipeId"]; practiceMinutes: number };
    code: WorksheetFailureCode;
    budget: Budget | undefined;
  },
): Promise<void> {
  const row = await getDocument(ws, input.worksheetId);
  if (row === null || row.kind !== "worksheet" || row.generatingJobId !== input.jobId) return;
  const stored = parseWorksheet(row.body);
  const prior = stored.generation;
  const { completedAt: _completedAt, ...kept } =
    prior?.jobId === input.jobId
      ? prior
      : {
          jobId: input.jobId,
          startedAt: new Date().toISOString(),
          promptVersions: {},
          usage: input.budget?.totals() ?? {
            calls: 0,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
          },
          findings: [],
          recipeId: input.payload.recipeId,
          practiceMinutes: input.payload.practiceMinutes,
          completedAt: undefined,
        };
  const generation: WorksheetGeneration = {
    ...kept,
    stage: "failed",
    ...(input.budget ? { usage: input.budget.totals() } : {}),
    failure: { code: input.code, message: WORKSHEET_FAILURE_MESSAGES[input.code] },
  };
  await putDocumentAsJob(ws, input.worksheetId, { ...stored, generation }, input.jobId);
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
  // R4 review (12 Nov): a lesson job holding the lesson is still writing, checking or repairing
  // its slides; a sheet read now would miss what it changes.
  if (row.generatingJobId) throw new NonRetryableError("lesson changed");
  const lesson = parseLesson(row.body);
  if ((lesson.plan?.revision ?? 0) !== revision) throw new NonRetryableError("revision moved");
  const facts = lesson.facts;
  // Stage `planned` means no slides yet; no stage at all is a lesson made before stages were
  // recorded, which the API lets through only with a confirmed plan, facts and slides.
  if (lesson.generation?.stage === "planned" || facts === undefined) {
    throw new NonRetryableError("lesson is not planned");
  }
  return { lesson, facts };
}

/** The items a shipped sheet's gate dropped, in full (`WrittenBuiltSheet.verdicts`); none for a slide-built sheet. */
export function droppedItems(built: object): NonNullable<WorksheetGeneration["dropped"]> {
  const verdicts = (built as { verdicts?: { faults: string[] }[] }).verdicts ?? [];
  return verdicts
    .filter((v) => v.faults.length > 0)
    .map((v) => {
      const { where, question, working, answer, faults } = v as {
        where: string;
        question: string;
        working: string | null;
        answer: string;
        faults: string[];
      };
      return { where, question, working, answer, faults };
    });
}
