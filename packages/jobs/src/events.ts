import { insertJobEvent, notifyJobEvent } from "@tj/db";
import type { JobEvent } from "@tj/domain";
import type { JobsContext } from "./types";

/**
 * Persist a job event and notify listeners, in that order (the row must be committed before the
 * API's `LISTEN job_events` handler goes looking for it — `packages/db/src/job-events.ts`).
 * Returns the `job_events.id`, which doubles as the SSE event id.
 */
export async function emitJobEvent(
  ctx: Pick<JobsContext, "db" | "sql">,
  event: JobEvent,
): Promise<{ id: number }> {
  const { id } = await insertJobEvent(ctx.db, event);
  await notifyJobEvent(ctx.sql, { id, jobId: event.jobId, workspaceId: event.workspaceId });
  return { id };
}

/** `Date#toISOString()` — the `IsoDateTime` format `JobEventSchema` expects. */
export function nowIso(): string {
  return new Date().toISOString();
}
