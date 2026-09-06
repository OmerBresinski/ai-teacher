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
}

/** What `runJob` decided; also the pg-boss `perJobResults` disposition for the job. */
export type RunJobOutcome = JobResult & {
  status: "completed" | "failed" | "deadletter";
  /** The terminal (or last) event type written for this attempt. */
  event: "completed" | "failed" | "cancelled" | "progress";
};

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
 * is written for a `jobId` no further event follows.
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
  const emit = (event: JobEvent) => emitJobEvent(ctx, event);

  const payloadResult = JobPayloadSchemas[name].safeParse(envelope.data.payload);
  if (!payloadResult.success) {
    const error: JobError = {
      message: `invalid ${name} payload: ${payloadResult.error.issues.map((i) => i.message).join("; ")}`,
      retryable: false,
    };
    await emit({ type: "failed", ...base, at: nowIso(), error });
    logger.warn({ issues: payloadResult.error.issues }, "payload failed validation");
    return { id: bossJob.id, status: "deadletter", output: error, event: "failed" };
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
    const returned = await (registry[name] as JobHandler<N, D>)(jobCtx);
    if (returned !== undefined) result = returned as JobResultPayload;
  } catch (err) {
    threw = true;
    thrown = err;
  } finally {
    clearInterval(cancelPoll);
    opts.shutdown?.removeEventListener("abort", onShutdown);
  }

  // Flush any coalesced progress before the terminal event so ordering is preserved.
  await progress.flush();

  if (abort.signal.aborted && abort.signal.reason === "cancelled") {
    await emit({ type: "cancelled", ...base, at: nowIso() });
    logger.info("job cancelled");
    // The pg-boss row is already `cancelled`; a `completed` disposition is a no-op on it.
    return { id: bossJob.id, status: "completed", event: "cancelled" };
  }

  if (!threw && !abort.signal.aborted) {
    // `JobCompletedEventSchema` is strict: the key is present only when there is a result.
    await emit({ type: "completed", ...base, at: nowIso(), ...(result ? { result } : {}) });
    logger.info({ hasResult: result !== undefined }, "job completed");
    return { id: bossJob.id, status: "completed", event: "completed" };
  }

  const shutdown = abort.signal.aborted && abort.signal.reason === "shutdown";
  const message = shutdown
    ? "worker shut down while the job was running"
    : thrown instanceof Error
      ? thrown.message
      : String(thrown);

  if (thrown instanceof NonRetryableError) {
    const error: JobError = { message, retryable: false };
    await emit({ type: "failed", ...base, at: nowIso(), error });
    logger.warn({ err: thrown }, "job failed (non-retryable)");
    return { id: bossJob.id, status: "deadletter", output: error, event: "failed" };
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
  await emit({ type: "failed", ...base, at: nowIso(), error });
  logger.error({ err: thrown, shutdown }, "job failed; no attempts left");
  return { id: bossJob.id, status: "failed", output: error, event: "failed" };
}

function truncate(s: string, max = 200): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Narrow a pg-boss job to the envelope type without trusting it (use `runJob` for validation). */
export type BossJob<N extends JobName = JobName> = JobWithMetadata<JobData<N>>;
