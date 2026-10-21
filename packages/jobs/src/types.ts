import type { Db, Sql } from "@tj/db";
import type {
  JobId,
  JobName,
  JobPayloads,
  JobProgress,
  JobResult,
  SlideDraftPayload,
  WorkspaceId,
} from "@tj/domain";
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

/** Handed to a job handler by `runJob()`. `D` is owned by the consuming worker application. */
export interface JobContext<K extends JobName, D = unknown> {
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
   * coalesced field by field and the result is emitted when the window closes (never dropped
   * silently). `extra.documentUpdatedAt` (ADR 0025 §7) tells the read-only editor the document
   * changed; `extra.stage` (ADR 0029 item 14) names the pipeline step. No content travels in an
   * event.
   */
  progress: (percent?: number, message?: string, extra?: ProgressExtra) => Promise<void>;
  /**
   * Live writing (ADR 0039): stream a `slide-draft` event, the slide being written as it stands.
   * Fire and forget: throttled to one burst per 200 ms (the newest draft per slide wins, a
   * `final` draft is never replaced by a words draft), best effort, and every draft of the job
   * is pruned from `job_events` when the handler settles. Optional so test contexts may omit it.
   */
  draft?: (draft: SlideDraftPayload) => void;
  /** Child logger with `jobId`, `workspaceId`, `job` bound. Never log payload/content bodies. */
  logger: Logger;
  /** App-owned dependencies supplied at worker boot; never import app modules from `@tj/jobs`. */
  deps: D;
  /**
   * Whether pg-boss will run this job again if this attempt throws a retryable error
   * (`retryCount < retryLimit`). `runJob` always sets it; a handler that keeps a lock for the
   * retry must check it, because on the last attempt the failure is terminal and nothing else
   * releases the lock. Hand-built test contexts may leave it out: `undefined` reads as `true`.
   */
  attemptsLeft?: boolean;
  /** This attempt's number, from 0 (pg-boss `retryCount`). `runJob` always sets it. */
  attempt?: number;
  /**
   * Runs `hook` once this attempt is settled: after its terminal event (or its retry notice) is
   * written, or after the attempt failed to write one. A handler releases its generating lock
   * here (TEACH-202 part j), so a client that sees the lock gone can always find the terminal
   * event; releasing it first let a page read an unlocked row while it still waited for the
   * outcome. `runJob` always sets it; hand-built test contexts may leave it out, and a handler then
   * runs the work itself.
   */
  afterSettle?: (hook: () => Promise<void>) => void;
}

/** The optional fields of a `progress` event beyond `percent` and `message`. */
export type ProgressExtra = Pick<JobProgress, "documentUpdatedAt" | "stage">;

/**
 * The result a handler for `K` may return (ADR 0025 §19): its member of `JobResultSchema`, or
 * nothing for jobs that return none (`never | void` is `void`, so those handlers stay `async () =>
 * {}`). `runJob` writes it onto the `completed` event.
 */
export type JobResultFor<K extends JobName> = Extract<JobResult, { job: K }>;

/**
 * `void` (not `undefined`) keeps every `async () => {}` handler valid; `undefined` would force
 * each result-less job to `return undefined` explicitly.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: see above
export type HandlerReturn<K extends JobName> = Promise<void | JobResultFor<K>>;

export type JobHandler<K extends JobName, D = unknown> = (
  ctx: JobContext<K, D>,
) => HandlerReturn<K>;

/**
 * One handler per `JobName`. A mapped type, so adding a name to `@tj/domain` without registering
 * a handler here is a compile error in the worker.
 */
export type JobRegistry<D = unknown> = { [K in JobName]: JobHandler<K, D> };

/** Identity helper that pins `K` so the handler's `ctx.payload` is typed. */
export function defineJob<K extends JobName, D = unknown>(
  name: K,
  handler: JobHandler<K, D>,
): JobHandler<K, D> {
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
