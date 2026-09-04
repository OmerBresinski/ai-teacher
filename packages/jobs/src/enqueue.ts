import {
  type JobId,
  JobName,
  JobNameSchema,
  type JobPayloadInputs,
  JobPayloadSchemas,
  type JobPayloads,
  newId,
  type WorkspaceId,
} from "@tj/domain";
import { JOB_RETRY_LIMIT } from "./boss";
import { emitJobEvent, nowIso } from "./events";
import type { JobData, JobsContext } from "./types";

export interface EnqueueOptions {
  workspaceId: WorkspaceId;
  /**
   * pg-boss `singletonKey`: while a job with the same key is queued (created/retry) in this
   * queue, a second `enqueue` is a no-op and returns `null`. Use it to debounce "regenerate".
   */
  singletonKey?: string;
}

/**
 * Validate `payload` with `JobPayloadSchemas[name]` (throws a `ZodError` **before** pg-boss is
 * touched), mint a `JobId`, `send` it to pg-boss with that id, and record the `queued` event.
 *
 * Returns the `JobId` — the pg-boss job id is the same UUID, so `job_events.job_id` and
 * `pgboss.job.id` join directly. Returns `null` only when `singletonKey` deduplicated the send
 * (no event is written in that case).
 */
export async function enqueue<N extends JobName>(
  ctx: JobsContext,
  name: N,
  payload: JobPayloadInputs[N],
  opts: EnqueueOptions,
): Promise<JobId | null> {
  JobNameSchema.parse(name);
  const schema = JobPayloadSchemas[name];
  const parsed = schema.parse(payload) as JobPayloads[N];
  const jobId = newId<JobId>();
  const data: JobData<N> = { jobId, workspaceId: opts.workspaceId, payload: parsed };

  const sent = await ctx.boss.send(name, data, {
    id: jobId,
    singletonKey: opts.singletonKey,
    retryLimit: JOB_RETRY_LIMIT,
  });
  if (sent === null) return null;
  if (sent !== jobId) {
    // pg-boss honours `options.id`; if that ever changes we must not lie to the caller.
    throw new Error(`enqueue: pg-boss returned id ${sent}, expected ${jobId}`);
  }

  await emitJobEvent(ctx, {
    type: "queued",
    jobId,
    workspaceId: opts.workspaceId,
    at: nowIso(),
  });
  return jobId;
}

export type CancelResult =
  /** The job had not started; pg-boss row cancelled and a `cancelled` event written here. */
  | { status: "cancelled" }
  /** The job is running; pg-boss row cancelled, the worker emits `cancelled` within ~250 ms. */
  | { status: "cancelling" }
  /** Already completed / failed / cancelled — nothing changed, no event written. */
  | { status: "already_finished"; state: string }
  /** No pg-boss job with that id in any known queue. */
  | { status: "not_found" };

export interface CancelOptions {
  /** Skip the queue scan when the caller knows the job's name. */
  name?: JobName;
}

/**
 * Cancel a job by id. pg-boss flips the row to `cancelled` when it is queued **or active**; the
 * worker polls that state every 250 ms and aborts the handler's `signal`, so a running job sees
 * the cancel within roughly 250 ms plus whatever the handler is awaiting.
 */
export async function cancel(
  ctx: JobsContext,
  jobId: JobId,
  opts: CancelOptions = {},
): Promise<CancelResult> {
  const names = opts.name ? [opts.name] : Object.values(JobName);
  for (const name of names) {
    const [before] = await ctx.boss.findJobs<JobData>(name, { id: jobId });
    if (!before) continue;
    if (before.state === "completed" || before.state === "failed" || before.state === "cancelled") {
      return { status: "already_finished", state: before.state };
    }
    await ctx.boss.cancel(name, jobId);
    const [after] = await ctx.boss.findJobs<JobData>(name, { id: jobId });
    if (after?.state !== "cancelled") {
      return { status: "already_finished", state: after?.state ?? "unknown" };
    }
    // A job that was `created` or `retry` (waiting for its second attempt) has no worker running
    // it, so nobody else will emit the terminal event. `startedOn` is stamped on every fetch; if
    // it moved between our two reads a worker grabbed the job in the gap and will emit instead.
    const wasWaiting = before.state === "created" || before.state === "retry";
    const fetchedMeanwhile = toMillis(before.startedOn) !== toMillis(after.startedOn);
    if (wasWaiting && !fetchedMeanwhile) {
      await emitJobEvent(ctx, {
        type: "cancelled",
        jobId,
        workspaceId: after.data.workspaceId,
        at: nowIso(),
      });
      return { status: "cancelled" };
    }
    return { status: "cancelling" };
  }
  return { status: "not_found" };
}

function toMillis(d: Date | string | null | undefined): number | null {
  if (d === null || d === undefined) return null;
  return new Date(d).getTime();
}
