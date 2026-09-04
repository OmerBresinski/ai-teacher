/**
 * `@tj/jobs` — typed pg-boss job registry, enqueue/cancel helpers and the `runJob` runtime that
 * turns handler activity into job events (ADR 0006, 0012). Consumed by `apps/worker` (run) and
 * `apps/api` (enqueue/cancel, TEACH-19).
 */
export {
  type CreateBossOptions,
  createBoss,
  ensureQueues,
  JOB_DELETE_AFTER_SECONDS,
  JOB_EXPIRE_IN_SECONDS,
  JOB_RETENTION_SECONDS,
  JOB_RETRY_DELAY_SECONDS,
  JOB_RETRY_LIMIT,
  type PgBossSchema,
} from "./boss";
export {
  type CancelOptions,
  type CancelResult,
  cancel,
  type EnqueueOptions,
  enqueue,
} from "./enqueue";
export { emitJobEvent, nowIso } from "./events";
export {
  createProgressEmitter,
  PROGRESS_MIN_INTERVAL_MS,
  type ProgressEmitter,
  type ProgressEmitterOptions,
} from "./progress";
export {
  type BossJob,
  CANCEL_POLL_INTERVAL_MS,
  type RunJobOptions,
  type RunJobOutcome,
  runJob,
} from "./run-job";
export {
  type AbortReason,
  defineJob,
  type JobContext,
  type JobData,
  type JobHandler,
  type JobRegistry,
  type JobsContext,
  NonRetryableError,
} from "./types";
