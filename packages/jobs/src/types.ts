import type { Db, Sql } from "@tj/db";
import type { JobId, JobName, JobPayloads, WorkspaceId } from "@tj/domain";
import type { PgBoss } from "pg-boss";
import type { Logger } from "pino";

/**
 * Everything `enqueue()`, `cancel()`, `emitJobEvent()` and `runJob()` need. Both the API
 * (TEACH-19: enqueue/cancel) and the worker (run) build one of these at boot:
 *
 * ```ts
 * const { unsafeDb, sql, close } = createDb(env.DATABASE_URL);
 * const boss = createBoss(env.DATABASE_URL);
 * await boss.start();
 * await ensureQueues(boss);
 * const ctx: JobsContext = { boss, db: unsafeDb, sql };
 * ```
 *
 * `db` is the raw Drizzle client: job events are always written through `forWorkspace()` inside
 * `insertJobEvent`, so nothing here reads tenant tables unscoped (ADR 0007).
 */
export interface JobsContext {
  boss: PgBoss;
  db: Db;
  sql: Sql;
}

/** What `enqueue()` stores as the pg-boss job `data`. */
export interface JobData<K extends JobName = JobName> {
  jobId: JobId;
  workspaceId: WorkspaceId;
  /** Already validated with `JobPayloadSchemas[K]` (defaults applied). */
  payload: JobPayloads[K];
}

/** Handed to a job handler by `runJob()`. */
export interface JobContext<K extends JobName> {
  jobId: JobId;
  workspaceId: WorkspaceId;
  payload: JobPayloads[K];
  /**
   * Aborted when the job is cancelled (`cancel()` from the API, observed within ~250 ms) or the
   * worker is shutting down. Check `signal.aborted` between steps and pass it to fetch/AI calls.
   * `signal.reason` is `"cancelled"` or `"shutdown"`.
   */
  signal: AbortSignal;
  /**
   * Emit a `progress` event. Rate-limited to one event per 250 ms: calls inside the window are
   * coalesced and the latest one is emitted when the window closes (never dropped silently).
   */
  progress: (percent?: number, message?: string) => Promise<void>;
  /** Child logger with `jobId`, `workspaceId`, `job` bound. Never log payload/content bodies. */
  logger: Logger;
}

export type JobHandler<K extends JobName> = (ctx: JobContext<K>) => Promise<void>;

/**
 * One handler per `JobName`. A mapped type, so adding a name to `@tj/domain` without registering
 * a handler here is a compile error in the worker.
 */
export type JobRegistry = { [K in JobName]: JobHandler<K> };

/** Identity helper that pins `K` so the handler's `ctx.payload` is typed. */
export function defineJob<K extends JobName>(name: K, handler: JobHandler<K>): JobHandler<K> {
  void name;
  return handler;
}

/**
 * Throw from a handler when retrying cannot help (invalid input, business rule violated, …).
 * `runJob()` emits `failed { retryable: false }` and settles the pg-boss job terminally
 * (`deadletter` disposition: no second attempt regardless of `retryLimit`). Any other error is
 * treated as transient and retried once.
 */
export class NonRetryableError extends Error {
  override readonly name = "NonRetryableError";
}

export type AbortReason = "cancelled" | "shutdown";
