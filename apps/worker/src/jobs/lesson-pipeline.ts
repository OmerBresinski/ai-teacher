import { createBudget, isAiError } from "@tj/ai";
import {
  clearGenerating,
  forWorkspace,
  getDocument,
  putDocumentAsJob,
  type WorkspaceDb,
} from "@tj/db";
import type { JobId, LessonId, WorkspaceId } from "@tj/domain";
import { type Lesson, parseLesson } from "@tj/domain/documents";
import {
  BudgetExceeded,
  InputRejected,
  type PipelineDeps,
  type PipelineInput,
  type PipelineOptions,
  type PipelineState,
  runLessonPipeline,
} from "@tj/generation";
import { storePhoto } from "@tj/images";
import { type JobContext, NonRetryableError } from "@tj/jobs";
import { uid } from "@tj/slides";
import type { WorkerDeps } from "../deps";
import { effortOverride } from "../effort";
import { SourceUnavailable, storageSourceLoader } from "../sources";

/**
 * The two jobs that run `runLessonPipeline` under the lesson's generating lock (ADR 0025 §4–§7,
 * §12, §15, §24; ADR 0029): `lesson.plan` and `lesson.generate`. One lesson row, one lock.
 *
 * The API wrote the row with `generating_job_id = jobId` and `plan.revision = payload.revision`
 * in the statement that enqueued this job. The handler refuses a row it does not own — missing,
 * locked by another job, or at another plan revision (a newer re-plan superseded it) — with
 * `NonRetryableError` before any model call, then runs the pipeline and persists after every
 * stage (and every slide) with `putDocumentAsJob`, whose predicate is the lock itself. Each
 * `progress` event carries the lesson's new `updatedAt` and the pipeline stage (ADR 0029 item 14).
 *
 * Retry and resume: `Lesson.generation.stage` is the checkpoint. A second attempt reads the row as
 * it stands and the pipeline skips the stages already done (`resumeFrom`), with the budget seeded
 * from the usage already recorded. For that the retry must find the row still locked by this job,
 * so the lock is **kept** when the attempt ends in a way pg-boss retries (a retryable error, a
 * shutdown abort) and released on every other exit — unless `after` handed it to the next job.
 * Should the last attempt fail too, `releaseStaleLock` on `GET /documents/:id` clears a lock whose
 * job has a terminal event (§24). TEACH-82's guard in `runJob` keeps a settled job from running
 * again at all. `clearGenerating` only clears a lock still held by **this** job, so a late
 * finisher never unlocks a lesson a newer job has since locked.
 */

export type LessonPipelineJob = "lesson.plan" | "lesson.generate";

export interface LessonJobSpec {
  /** A further precondition on the owned lesson; throw `NonRetryableError` to refuse it. */
  check?: (lesson: Lesson) => void;
  /** The pipeline input from the owned lesson. */
  input: (lesson: Lesson, deps: PipelineDeps) => PipelineInput;
  options?: PipelineOptions;
  /**
   * After a run that finished. `true` when the lock now belongs to another job (auto-continue,
   * ADR 0029 item 10): the handler must not release it.
   */
  after?: (ws: WorkspaceDb, final: PipelineState) => Promise<boolean>;
}

/**
 * The pipeline's image collaborator (Images project): Pexels search plus bucket store, closed
 * over the job's Workspace. Absent without a Pexels key — illustrate then skips placements.
 */
function imagePlacer(deps: WorkerDeps, workspaceId: WorkspaceId): PipelineDeps["images"] {
  const images = deps.images;
  if (!images) return undefined;
  return {
    search: (query, opts) =>
      images.client.search({ query, ...opts, locale: "en-GB" }).then((page) => page.photos),
    store: (photo, target) =>
      storePhoto({
        photo,
        target,
        storage: images.storage,
        workspaceId,
      }),
  };
}

export async function runLessonJob<K extends LessonPipelineJob>(
  ctx: JobContext<K, WorkerDeps>,
  spec: LessonJobSpec,
): Promise<void> {
  const { payload, workspaceId, jobId, signal, deps, logger } = ctx;
  const ws = forWorkspace(deps.db, workspaceId);
  const lessonId = payload.lessonId;
  let keepLockForRetry = false;
  let handedOff = false;
  try {
    if (signal.aborted) {
      keepLockForRetry = signal.reason === "shutdown";
      return;
    }
    const stored = await loadOwnedLesson(ws, lessonId, jobId, payload.revision);
    spec.check?.(stored);
    if (deps.ai.kind === "unconfigured") {
      throw new NonRetryableError("AI provider is not configured (AWS_BEARER_TOKEN_BEDROCK unset)");
    }
    const priorUsage = stored.generation?.usage;
    const pipelineDeps: PipelineDeps = {
      ai: deps.ai,
      budget: createBudget(deps.caps, { spent: priorUsage }),
      ...(deps.planFrontierFromYear !== undefined
        ? { planFrontierFromYear: deps.planFrontierFromYear }
        : {}),
      ...effortOverride(deps.reasoningEffort),
      signal,
      logger: logger.child({
        resumed: priorUsage !== undefined,
        usagePriorUsd: priorUsage === undefined ? 0 : priorUsage.costUsd,
      }),
      now: () => new Date(),
      ids: uid,
      sources: storageSourceLoader(deps.storage, workspaceId, logger),
      persist: makePersist(ws, lessonId, jobId),
      onProgress: (percent, message, stage, documentUpdatedAt) =>
        ctx.progress(percent, message, { documentUpdatedAt, stage }),
      context: { lessonId, jobId },
      images: imagePlacer(deps, workspaceId),
    };
    let final: PipelineState;
    try {
      final = await runLessonPipeline(spec.input(stored, pipelineDeps), pipelineDeps, spec.options);
    } catch (error) {
      // What was persisted stays (§5). A cancel is terminal (`runJob` records `cancelled`); a
      // shutdown is retried by pg-boss, so the next attempt needs the lock.
      if (signal.aborted) {
        keepLockForRetry = signal.reason === "shutdown";
        return;
      }
      // Before a skeleton exists there is no certified checkpoint to finish as a partial Lesson.
      // Keep the title already persisted, release its lock and avoid repeating an unaffordable call.
      if (error instanceof BudgetExceeded) {
        throw new NonRetryableError(error.message, { cause: error });
      }
      if (isAiError(error, "unconfigured") || isAiError(error, "invalid_model")) {
        throw new NonRetryableError(error.message, { cause: error });
      }
      // The brief itself was refused (TEACH-137): a re-run cannot fix the input. `error.message`
      // is the fixed per-check text from `@tj/generation`, never the model's words, so it can
      // travel into the job's terminal event; the log carries the check codes only.
      if (error instanceof InputRejected) {
        logger.info(
          { lessonId, findings: error.findings.map((f) => f.check) },
          "lesson brief rejected by the input check",
        );
        throw new NonRetryableError(error.message, { cause: error });
      }
      // A Source's `extracted.json` is gone or unreadable (ADR 0027 §6): a re-run cannot bring it
      // back, and planning without the material would silently give the teacher the wrong lesson.
      if (error instanceof SourceUnavailable) {
        logger.warn({ lessonId, sourceId: error.sourceId }, "source unavailable");
        throw new NonRetryableError(error.message, { cause: error });
      }
      if (!(error instanceof NonRetryableError)) keepLockForRetry = true;
      throw error;
    }
    if (spec.after && !signal.aborted) handedOff = await spec.after(ws, final);
  } finally {
    if (keepLockForRetry) {
      logger.info({ lessonId }, "generating lock kept for the retry");
    } else if (handedOff) {
      logger.debug({ lessonId }, "generating lock handed to the next job");
    } else {
      await clearGenerating(ws, lessonId, jobId);
      logger.debug({ lessonId }, "generating lock released");
    }
  }
}

/**
 * The lesson row this job owns, or a `NonRetryableError`: `lesson missing` when the API's failure
 * path hard-deleted it (§6), `lock lost` when it is unlocked or a newer job holds it, `revision
 * moved` when the plan the job was queued for is no longer the row's (ADR 0029 items 4–5; a
 * lesson without `plan` is revision 0) — nothing is written in any case.
 */
async function loadOwnedLesson(
  ws: WorkspaceDb,
  lessonId: LessonId,
  jobId: JobId,
  revision: number,
): Promise<Lesson> {
  const row = await getDocument(ws, lessonId);
  if (row === null || row.kind !== "lesson") throw new NonRetryableError("lesson missing");
  if (row.generatingJobId !== jobId) throw new NonRetryableError("lock lost");
  const stored = parseLesson(row.body);
  if ((stored.plan?.revision ?? 0) !== revision) throw new NonRetryableError("revision moved");
  if (!stored.brief) throw new NonRetryableError("lesson has no brief to plan from");
  return stored;
}

/**
 * `PipelineDeps.persist`: the lesson row only (ADR 0030 item 2 — the lesson pipeline writes no
 * worksheet). A `lost_lock` / `missing` answer stops the job for good.
 */
function makePersist(ws: WorkspaceDb, lessonId: LessonId, jobId: JobId): PipelineDeps["persist"] {
  return async (lesson: Lesson) => {
    const result = await putDocumentAsJob(ws, lessonId, lesson, jobId);
    if (result.status !== "ok") throw new NonRetryableError(`lesson ${result.status}`);
    return { updatedAt: result.row.updatedAt.toISOString() };
  };
}
