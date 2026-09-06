import { clearGenerating, forWorkspace } from "@tj/db";
import { defineJob } from "@tj/jobs";
import type { WorkerDeps } from "../deps";

/**
 * `lesson.plan` — the F06 Plan stage (ADR 0024 §14). Until F06 lands this is a stub: no model
 * call, one `progress` line, and `runJob` emits `started` → `completed` around it. What F06 keeps
 * is the contract around the body:
 *
 * - `POST /lessons` created the `documents` row with `generating_job_id = jobId` in the same
 *   transaction that enqueued this job (§6, §18); the row is read-only to the editor until the
 *   lock clears.
 * - The lock is cleared in `finally`, through `clearGenerating(ws, lessonId, jobId)`, which only
 *   releases a lock still held by **this** job, so a job that finishes late never unlocks a lesson
 *   a newer job has since locked.
 *
 * Accepted gap until TEACH-82 (job durability): pg-boss retries a failed attempt once
 * (`JOB_RETRY_LIMIT`), and because the lock is released here on the first failure, the retry runs
 * with the lesson unlocked. A single terminal-event hook in `runJob` is the durable fix; do not
 * work around it in this handler.
 */
export const lessonPlanJob = defineJob<"lesson.plan", WorkerDeps>(
  "lesson.plan",
  async ({ payload, workspaceId, jobId, signal, progress, deps, logger }) => {
    try {
      if (signal.aborted) return;
      await progress(100, "planned (stub)");
    } finally {
      await clearGenerating(forWorkspace(deps.db, workspaceId), payload.lessonId, jobId);
      logger.debug({ lessonId: payload.lessonId }, "generating lock released");
    }
  },
);
