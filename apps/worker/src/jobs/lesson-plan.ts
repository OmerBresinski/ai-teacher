import { createBudget, isAiError } from "@tj/ai";
import {
  clearGenerating,
  createDocument,
  forWorkspace,
  getDocument,
  putDocumentAsJob,
  type WorkspaceDb,
} from "@tj/db";
import { type JobId, type LessonId, newId } from "@tj/domain";
import {
  type Lesson,
  parseLesson,
  parseStoredWorksheet,
  type Worksheet,
} from "@tj/domain/documents";
import { type PipelineDeps, type PipelineInput, runLessonPipeline } from "@tj/generation";
import { defineJob, NonRetryableError } from "@tj/jobs";
import { uid } from "@tj/slides";
import type { WorkerDeps } from "../deps";

/**
 * `lesson.plan` — the F06 pipeline under the generating lock (ADR 0025 §4–§7, §12, §15, §24).
 *
 * `POST /lessons` created the `documents` row with `generating_job_id = jobId` and enqueued this
 * job. The handler reads the locked lesson, mints the worksheet row under the same lock, runs
 * Plan → Generate → Evaluate → Repair through `runLessonPipeline`, and persists after every stage
 * (and every slide) with `putDocumentAsJob`, whose predicate is the lock itself. Each `progress`
 * event carries the lesson's new `updatedAt` so the read-only editor refetches (§7).
 *
 * Retry and resume: `Lesson.generation.stage` is the checkpoint. A second attempt reads the row
 * as it stands and the pipeline skips the stages already done (`resumeFrom`); the worksheet row,
 * when it exists, is passed back in so Evaluate and Repair see both halves. For that to work the
 * retry must find the row still locked by this job, so the locks are **kept** when the attempt
 * ends in a way pg-boss retries (a retryable error, a shutdown abort) and released on every other
 * exit. Should the last attempt fail too, `releaseStaleLock` on `GET /documents/:id` clears a lock
 * whose job has a terminal event (§24). TEACH-82's guard in `runJob` keeps a settled job from
 * running again at all.
 *
 * `clearGenerating` only clears a lock still held by **this** job, so a late finisher never
 * unlocks a lesson a newer job has since locked.
 */
export const lessonPlanJob = defineJob<"lesson.plan", WorkerDeps>("lesson.plan", async (ctx) => {
  const { payload, workspaceId, jobId, signal, deps, logger } = ctx;
  const ws = forWorkspace(deps.db, workspaceId);
  const lessonId = payload.lessonId;
  let worksheetId: string | undefined;
  let keepLocksForRetry = false;
  try {
    if (signal.aborted) {
      keepLocksForRetry = signal.reason === "shutdown";
      return;
    }
    const loaded = await loadLockedLesson(ws, lessonId, jobId);
    worksheetId = loaded.worksheetId;
    if (deps.ai.kind === "unconfigured") {
      throw new NonRetryableError("AI provider is not configured (AWS_BEARER_TOKEN_BEDROCK unset)");
    }
    const pipelineDeps: PipelineDeps = {
      ai: deps.ai,
      budget: createBudget(deps.caps),
      signal,
      logger,
      now: () => new Date(),
      ids: uid,
      sources: deps.sources,
      persist: makePersist(ws, lessonId, jobId, loaded),
      onProgress: (percent, message, documentUpdatedAt) =>
        ctx.progress(percent, message, { documentUpdatedAt }),
      context: { lessonId, jobId },
    };
    try {
      await runLessonPipeline(loaded.input, pipelineDeps);
    } catch (error) {
      // What was persisted stays (§5). A cancel is terminal (`runJob` records `cancelled`); a
      // shutdown is retried by pg-boss, so the next attempt needs the lock.
      if (signal.aborted) {
        keepLocksForRetry = signal.reason === "shutdown";
        return;
      }
      if (isAiError(error, "unconfigured") || isAiError(error, "invalid_model")) {
        throw new NonRetryableError(error.message);
      }
      if (!(error instanceof NonRetryableError)) keepLocksForRetry = true;
      throw error;
    }
  } finally {
    if (keepLocksForRetry) {
      logger.info({ lessonId, worksheetId }, "generating locks kept for the retry");
    } else {
      await clearGenerating(ws, lessonId, jobId);
      if (worksheetId) await clearGenerating(ws, worksheetId, jobId);
      logger.debug({ lessonId, worksheetId }, "generating locks released");
    }
  }
});

interface LoadedLockedLesson {
  input: PipelineInput;
  worksheetId: string;
  /** Whether the worksheet `documents` row already exists (a resumed run after `generated`). */
  worksheetRowExists: boolean;
}

/**
 * The lesson row this job owns, or a `NonRetryableError`: `lesson missing` when the API's failure
 * path hard-deleted it (§6), `lock lost` when it is unlocked or a newer job holds it — nothing is
 * written in either case. On a resume the stored worksheet (if any) rides along as state.
 */
async function loadLockedLesson(
  ws: WorkspaceDb,
  lessonId: LessonId,
  jobId: JobId,
): Promise<LoadedLockedLesson> {
  const row = await getDocument(ws, lessonId);
  if (row === null || row.kind !== "lesson") throw new NonRetryableError("lesson missing");
  if (row.generatingJobId !== jobId) throw new NonRetryableError("lock lost");
  const lesson = parseLesson(row.body);
  if (!lesson.brief) throw new NonRetryableError("lesson has no brief to plan from");
  const worksheetId = lesson.artefacts?.worksheetId ?? newId();
  let worksheet: Worksheet | undefined;
  let worksheetRowExists = false;
  if (lesson.artefacts?.worksheetId) {
    const worksheetRow = await getDocument(ws, worksheetId);
    if (worksheetRow !== null && worksheetRow.kind === "worksheet") {
      worksheetRowExists = true;
      worksheet = parseStoredWorksheet(worksheetRow.body);
    }
  }
  return { input: { lesson, worksheetId, worksheet }, worksheetId, worksheetRowExists };
}

/**
 * `PipelineDeps.persist`: the lesson through `putDocumentAsJob` (the lock is the predicate); the
 * worksheet row is created under the same lock the first time a stage hands one over and updated
 * through `putDocumentAsJob` after that. A `lost_lock` / `missing` answer stops the job for good.
 */
function makePersist(
  ws: WorkspaceDb,
  lessonId: LessonId,
  jobId: JobId,
  loaded: Pick<LoadedLockedLesson, "worksheetId" | "worksheetRowExists">,
): PipelineDeps["persist"] {
  let worksheetCreated = loaded.worksheetRowExists;
  return async (lesson: Lesson, worksheet?: Worksheet) => {
    const result = await putDocumentAsJob(ws, lessonId, lesson, jobId);
    if (result.status !== "ok") throw new NonRetryableError(`lesson ${result.status}`);
    if (worksheet) {
      if (worksheetCreated) {
        const ws2 = await putDocumentAsJob(ws, loaded.worksheetId, worksheet, jobId);
        if (ws2.status !== "ok") throw new NonRetryableError(`worksheet ${ws2.status}`);
      } else {
        await createDocument(ws, "worksheet", worksheet, {
          id: loaded.worksheetId,
          generatingJobId: jobId,
        });
        worksheetCreated = true;
      }
    }
    return { updatedAt: result.row.updatedAt.toISOString() };
  };
}
