import {
  getDocument,
  handOffLock,
  putDocumentAsJob,
  setContinueWhenPlanned,
  type WorkspaceDb,
} from "@tj/db";
import { type JobId, newId, safeError } from "@tj/domain";
import { type Lesson, parseLesson } from "@tj/domain/documents";
import type { PipelineState } from "@tj/generation";
import { defineJob, enqueue, type JobContext } from "@tj/jobs";
import type { WorkerDeps } from "../deps";
import { runLessonJob } from "./lesson-pipeline";

/**
 * `lesson.plan` — check-input and Plan for one plan revision (ADR 0029 items 1–2), under the
 * lesson's generating lock (`runLessonJob`). With `stopAfter: "planned"` the run ends at the
 * `planned` checkpoint — Verify awaited, the facts the teacher confirms are verified — and the
 * lock is released for `POST /lessons/:id/generate`. Without it (skip planning, or a pinned
 * re-plan after the teacher confirmed) it is the whole pipeline. `pinObjectives` keeps the
 * objectives already on the row (item 8).
 *
 * Auto-continue (item 10, TDD T10): when the row's `continue_when_planned` is set, a stopped run
 * confirms its own plan and hands the lock straight to a `lesson.generate` job — never leaving
 * the row unlocked in between, so no request can slip into the gap.
 */
export const lessonPlanJob = defineJob<"lesson.plan", WorkerDeps>("lesson.plan", (ctx) => {
  const { stopAfter, pinObjectives } = ctx.payload;
  return runLessonJob(ctx, {
    input: (lesson) => ({ lesson, ...(pinObjectives ? { pinObjectives: true } : {}) }),
    options: stopAfter !== undefined ? { stopAfter } : {},
    ...(stopAfter !== undefined
      ? { after: (ws: WorkspaceDb, final: PipelineState) => continueToGenerate(ctx, ws, final) }
      : {}),
  });
});

/**
 * The hand-off, in the only order that never leaves the lock null: confirm the plan with this
 * job's lock, move the lock to a freshly minted id, enqueue `lesson.generate` under that id, and
 * only then clear the flag. `true` when the lock now belongs to the generate job.
 *
 * Any miss stops quietly and the handler releases its lock as usual: a `lost_lock` or a `false`
 * from `handOffLock` means a concurrent `/plan` took the row. A failed enqueue takes the lock back
 * and puts the proposal back, so the lesson sits at `planned` and Generate can still be pressed.
 */
async function continueToGenerate(
  ctx: JobContext<"lesson.plan", WorkerDeps>,
  ws: WorkspaceDb,
  final: PipelineState,
): Promise<boolean> {
  const { payload, workspaceId, jobId, deps, logger } = ctx;
  const lessonId = payload.lessonId;
  if (final.lesson.generation?.stage !== "planned") return false;
  const row = await getDocument(ws, lessonId);
  if (row === null || !row.continueWhenPlanned || row.generatingJobId !== jobId) return false;
  if (deps.jobs === undefined) {
    logger.warn({ lessonId }, "auto-continue skipped: no job runtime");
    return false;
  }
  const proposal = parseLesson(row.body);
  const plan = proposal.plan;
  if (plan === undefined || plan.revision !== payload.revision) return false;

  const confirmed: Lesson = {
    ...proposal,
    plan: { ...plan, state: "confirmed", confirmedAt: new Date().toISOString() },
  };
  if ((await putDocumentAsJob(ws, lessonId, confirmed, jobId)).status !== "ok") return false;
  const nextJobId = newId<JobId>();
  if (!(await handOffLock(ws, lessonId, jobId, nextJobId))) return false;

  let queued: JobId | null = null;
  try {
    queued = await enqueue(
      deps.jobs,
      "lesson.generate",
      { lessonId, revision: plan.revision },
      { workspaceId, id: nextJobId },
    );
  } catch (error) {
    logger.warn({ lessonId, nextJobId, err: safeError(error) }, "auto-continue enqueue failed");
  }
  if (queued === null) {
    if (await handOffLock(ws, lessonId, nextJobId, jobId)) {
      await putDocumentAsJob(ws, lessonId, proposal, jobId);
    }
    return false;
  }
  // The generate job owns the row now; a failure to clear the flag must not unlock it.
  await setContinueWhenPlanned(ws, lessonId, false).catch((error: unknown) =>
    logger.warn({ lessonId, err: safeError(error) }, "could not clear continue_when_planned"),
  );
  logger.info(
    { lessonId, nextJobId, revision: plan.revision },
    "plan confirmed automatically; lesson.generate queued",
  );
  return true;
}
