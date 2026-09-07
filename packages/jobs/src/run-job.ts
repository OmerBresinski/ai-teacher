import {
  getTerminalJobEvent,
  isUniqueViolation,
  JOB_EVENTS_ONE_TERMINAL_PER_JOB_INDEX,
  type JobEventRow,
  notifyJobEvent,
} from "@tj/db";
import {
  type JobError,
  type JobEvent,
  JobId,
  type JobName,
  JobPayloadSchemas,
  type JobPayloads,
  type JobResult as JobResultPayload,
  WorkspaceId,
} from "@tj/domain";
import type { JobResult, JobWithMetadata } from "pg-boss";
import type { Logger } from "pino";
import { z } from "zod";
import { emitJobEvent, nowIso } from "./events";
import { createProgressEmitter, PROGRESS_MIN_INTERVAL_MS } from "./progress";
import {
  type AbortReason,
  type JobContext,
  type JobData,
  type JobHandler,
  type JobRegistry,
  type JobsContext,
  NonRetryableError,
} from "./types";

/** How often the worker checks pg-boss for a `cancelled` state while a handler runs. */
export const CANCEL_POLL_INTERVAL_MS = 250;

const JobDataEnvelope = z.object({
  jobId: JobId,
  workspaceId: WorkspaceId,
  payload: z.unknown(),
});

export interface RunJobOptions<D = unknown> {
  /** Aborted by the worker on SIGTERM/SIGINT; handlers see `signal.reason === "shutdown"`. */
  shutdown?: AbortSignal;
  logger: Logger;
  /** App-owned dependencies passed through to the selected job handler. */
  deps: D;
  /** Test seam. */
  cancelPollIntervalMs?: number;
  /** Test seam. */
  progressMinIntervalMs?: number;
  /** Test seam: replaces `emitJobEvent` (e.g. to persist a terminal row and then fail the notify). */
  emit?: typeof emitJobEvent;
}

/** What `runJob` decided; also the pg-boss `perJobResults` disposition for the job. */
export type RunJobOutcome = JobResult & {
  status: "completed" | "failed" | "deadletter";
  /** The terminal (or last) event type written for this attempt. */
  event: "completed" | "failed" | "cancelled" | "progress";
};

/**
 * The pg-boss disposition that matches a terminal `job_events` row already on record — used when
 * a retry finds the job settled (pre-run guard) and when a terminal insert loses to the
 * one-terminal-per-job index. Mirrors the dispositions `runJob` returns when it writes the row
 * itself: `completed` and `cancelled` are done; `failed` is `deadletter` when the stored error is
 * `retryable: false` (nothing should run again) and `failed` otherwise.
 */
export function dispositionForTerminal(bossJobId: string, row: JobEventRow): RunJobOutcome {
  const stored = row.payload;
  switch (stored.type) {
    case "completed":
      return { id: bossJobId, status: "completed", event: "completed" };
    case "cancelled":
      return { id: bossJobId, status: "completed", event: "cancelled" };
    case "failed":
      return {
        id: bossJobId,
        status: stored.error.retryable ? "failed" : "deadletter",
        output: stored.error,
        event: "failed",
      };
    default:
      throw new Error(`dispositionForTerminal: ${stored.type} is not a terminal event type`);
  }
}

/**
 * Run one pg-boss job through the registry, emitting job events (ADR 0012):
 *
 * - `started` before the handler runs (after the payload is re-validated);
 * - `progress` from `ctx.progress()` (rate-limited, see `progress.ts`);
 * - `completed` when the handler returns — carrying the handler's return value as `result` when
 *   it returned one (ADR 0025 §19; proposal jobs), nothing otherwise;
 * - `cancelled` when `cancel()` flipped the pg-boss row while the handler ran (polled every
 *   250 ms) and the handler returned or threw after `signal.aborted`;
 * - `failed { retryable: false }` when the handler threw `NonRetryableError` (or the stored
 *   payload no longer validates) — the job is settled terminally, no retry;
 * - on any other error, or a shutdown abort: if pg-boss still has an attempt left
 *   (`retryCount < retryLimit`) a `progress` event announces the retry and pg-boss re-queues the
 *   job (a fresh `started` follows), otherwise `failed { retryable: true }` — the API may offer a
 *   manual retry (F13-R03).
 *
 * The three terminal types therefore stay terminal (`JOB_TERMINAL_EVENT_TYPES`): once one of them
 * is written for a `jobId` no further event follows. Two mechanisms hold that line (TEACH-82):
 *
 * - **Pre-run guard.** Before `started`, `job_events` is checked for a terminal row. A retry that
 *   pg-boss issued because the *previous attempt's terminal write* threw after the insert (e.g.
 *   the `NOTIFY` failed) finds the row, re-issues the notify so no SSE subscriber is left waiting,
 *   skips the handler and returns the disposition the stored row implies.
 * - **Unique-violation as idempotent.** The partial unique index
 *   `job_events_one_terminal_per_job_uidx` allows one terminal row per job. A terminal insert that
 *   loses to it is not an error: the winning row is loaded and its disposition returned.
 *
 * Residual (needs an outbox or side-effect idempotency key, out of scope here): if the terminal
 * **insert** itself fails after the handler did external work, pg-boss retries and the handler
 * runs again. Cancellation is re-read from pg-boss once more after the handler settles, so a
 * cancel that lands between the last poll and the terminal decision is recorded as `cancelled`;
 * a cancel that lands after that read and before pg-boss stores the disposition still surfaces as
 * `completed` in `job_events`.
 *
 * Returns the pg-boss disposition; the worker registers with `perJobResults: true` and returns
 * `[outcome]` so pg-boss can distinguish "retry" (`failed`) from "never again" (`deadletter`).
 */
export async function runJob<N extends JobName, D = unknown>(
  ctx: JobsContext,
  name: N,
  registry: JobRegistry<D>,
  bossJob: JobWithMetadata<unknown>,
  opts: RunJobOptions<D>,
): Promise<RunJobOutcome> {
  const envelope = JobDataEnvelope.safeParse(bossJob.data);
  if (!envelope.success) {
    // Without a workspaceId we cannot even write an event; fail terminally and log.
    opts.logger.error(
      { job: name, bossJobId: bossJob.id, issues: envelope.error.issues },
      "job data is not a JobData envelope; dead-lettering",
    );
    return { id: bossJob.id, status: "deadletter", event: "failed" };
  }
  const { jobId, workspaceId } = envelope.data;
  const logger = opts.logger.child({ job: name, jobId, workspaceId, attempt: bossJob.retryCount });
  const base = { jobId, workspaceId } as const;
  const emit = (event: JobEvent) => (opts.emit ?? emitJobEvent)(ctx, event);

  // Pre-run guard: a job already settled by an earlier attempt never runs (or emits) again.
  const terminal = await getTerminalJobEvent(ctx.db, base);
  if (terminal) {
    logger.info({ type: terminal.type, eventId: terminal.id }, "job already terminal, skipping");
    await notifyJobEvent(ctx.sql, { id: terminal.id, ...base });
    return dispositionForTerminal(bossJob.id, terminal);
  }

  /**
   * Write a terminal event and return `outcome`; when the one-terminal-per-job index rejects the
   * insert, the job was settled concurrently — return the stored row's disposition instead.
   * TODO(TEACH-82): a failure of the insert itself (not a unique violation) still escapes and
   * pg-boss retries the whole handler — see "Residual" in the docblock.
   */
  const settle = async (event: JobEvent, outcome: RunJobOutcome): Promise<RunJobOutcome> => {
    try {
      await emit(event);
      return outcome;
    } catch (err) {
      if (!isUniqueViolation(err, JOB_EVENTS_ONE_TERMINAL_PER_JOB_INDEX)) throw err;
      const winner = await getTerminalJobEvent(ctx.db, base);
      if (!winner) throw err;
      logger.warn(
        { attempted: event.type, stored: winner.type },
        "terminal event already recorded; keeping the stored one",
      );
      return dispositionForTerminal(bossJob.id, winner);
    }
  };

  const payloadResult = JobPayloadSchemas[name].safeParse(envelope.data.payload);
  if (!payloadResult.success) {
    const error: JobError = {
      message: `invalid ${name} payload: ${payloadResult.error.issues.map((i) => i.message).join("; ")}`,
      retryable: false,
    };
    logger.warn({ issues: payloadResult.error.issues }, "payload failed validation");
    return settle(
      { type: "failed", ...base, at: nowIso(), error },
      { id: bossJob.id, status: "deadletter", output: error, event: "failed" },
    );
  }
  const payload = payloadResult.data as JobPayloads[N];

  const abort = new AbortController();
  const abortWith = (reason: AbortReason) => {
    if (!abort.signal.aborted) abort.abort(reason);
  };
  const onShutdown = () => abortWith("shutdown");
  if (opts.shutdown?.aborted) onShutdown();
  opts.shutdown?.addEventListener("abort", onShutdown, { once: true });

  const pollMs = opts.cancelPollIntervalMs ?? CANCEL_POLL_INTERVAL_MS;
  let polling = false;
  const cancelPoll = setInterval(async () => {
    if (polling || abort.signal.aborted) return;
    polling = true;
    try {
      const [row] = await ctx.boss.findJobs(name, { id: bossJob.id });
      if (row?.state === "cancelled") abortWith("cancelled");
    } catch (err) {
      logger.warn({ err }, "cancel poll failed");
    } finally {
      polling = false;
    }
  }, pollMs);

  const progress = createProgressEmitter({
    minIntervalMs: opts.progressMinIntervalMs ?? PROGRESS_MIN_INTERVAL_MS,
    emit: (p) => emit({ type: "progress", ...base, at: nowIso(), progress: p }).then(() => {}),
    onError: (err) => logger.warn({ err }, "progress event failed"),
  });

  const jobCtx: JobContext<N, D> = {
    ...base,
    payload,
    signal: abort.signal,
    progress: progress.emit,
    logger,
    deps: opts.deps,
  };

  await emit({ type: "started", ...base, at: nowIso() });
  logger.info("job started");

  let thrown: unknown;
  let threw = false;
  let result: JobResultPayload | undefined;
  try {
    // A shutdown or cancellation that landed while `started` was being written: the handler has
    // not begun, so do not begin it — the aborted branches below record the outcome.
    if (!abort.signal.aborted) {
      const returned = await (registry[name] as JobHandler<N, D>)(jobCtx);
      if (returned !== undefined) result = returned as JobResultPayload;
    }
  } catch (err) {
    threw = true;
    thrown = err;
  } finally {
    clearInterval(cancelPoll);
    opts.shutdown?.removeEventListener("abort", onShutdown);
  }

  // Flush any coalesced progress before the terminal event so ordering is preserved.
  await progress.flush();

  // The poll is gone; a cancel that landed between its last tick and now would otherwise be
  // recorded as `completed` (or `failed`) while pg-boss says `cancelled`. Read once more.
  if (!abort.signal.aborted) {
    try {
      const [row] = await ctx.boss.findJobs(name, { id: bossJob.id });
      if (row?.state === "cancelled") abortWith("cancelled");
    } catch (err) {
      logger.warn({ err }, "final cancel re-read failed; treating the job as not cancelled");
    }
  }

  if (abort.signal.aborted && abort.signal.reason === "cancelled") {
    logger.info("job cancelled");
    // The pg-boss row is already `cancelled`; a `completed` disposition is a no-op on it.
    return settle(
      { type: "cancelled", ...base, at: nowIso() },
      { id: bossJob.id, status: "completed", event: "cancelled" },
    );
  }

  if (!threw && !abort.signal.aborted) {
    logger.info({ hasResult: result !== undefined }, "job completed");
    // `JobCompletedEventSchema` is strict: the key is present only when there is a result.
    return settle(
      { type: "completed", ...base, at: nowIso(), ...(result ? { result } : {}) },
      { id: bossJob.id, status: "completed", event: "completed" },
    );
  }

  const shutdown = abort.signal.aborted && abort.signal.reason === "shutdown";
  const message = shutdown
    ? "worker shut down while the job was running"
    : thrown instanceof Error
      ? thrown.message
      : String(thrown);

  if (thrown instanceof NonRetryableError) {
    const error: JobError = { message, retryable: false };
    logger.warn({ err: thrown }, "job failed (non-retryable)");
    return settle(
      { type: "failed", ...base, at: nowIso(), error },
      { id: bossJob.id, status: "deadletter", output: error, event: "failed" },
    );
  }

  const attemptsLeft = bossJob.retryCount < bossJob.retryLimit;
  if (attemptsLeft) {
    await emit({
      type: "progress",
      ...base,
      at: nowIso(),
      progress: {
        message: `attempt ${bossJob.retryCount + 1} failed (${truncate(message)}); retrying`,
      },
    });
    logger.warn({ err: thrown, shutdown }, "job failed; pg-boss will retry");
    return { id: bossJob.id, status: "failed", output: { message }, event: "progress" };
  }

  const error: JobError = { message, retryable: true };
  logger.error({ err: thrown, shutdown }, "job failed; no attempts left");
  return settle(
    { type: "failed", ...base, at: nowIso(), error },
    { id: bossJob.id, status: "failed", output: error, event: "failed" },
  );
}

function truncate(s: string, max = 200): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Narrow a pg-boss job to the envelope type without trusting it (use `runJob` for validation). */
export type BossJob<N extends JobName = JobName> = JobWithMetadata<JobData<N>>;
