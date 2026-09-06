import {
  JOB_TERMINAL_EVENT_TYPES,
  type JobEvent,
  JobEventSchema,
  JobId,
  WorkspaceId,
} from "@tj/domain";
import { and, asc, eq, gt, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Sql } from "./client";
import { jobEvents } from "./schema/job-events";
import { forWorkspace, type ScopableDb, type WorkspaceDb } from "./tenant";

/**
 * Job events: the write path used by `apps/worker` (TEACH-17) and the read path used by the SSE
 * endpoints in `apps/api` (TEACH-19). ADR 0012.
 *
 * Contract between the two:
 * 1. The worker calls `insertJobEvent()` then `notifyJobEvent()` with the returned `id`
 *    (in that order; the row must be committed before the notification goes out).
 * 2. The API keeps one `sql.listen(JOB_EVENTS_CHANNEL, …)` per process, parses each payload with
 *    `JobEventNotificationSchema`, and for every connected client of that `workspaceId` (and
 *    optionally `jobId`) loads the rows it has not sent yet with
 *    `listJobEvents({ workspaceId, jobId, afterId: lastSentId })`.
 * 3. The SSE `id:` field is the row `id`. On reconnect the client sends `Last-Event-ID`, the API
 *    replays with `afterId` — no event is lost and none is duplicated.
 * 4. The notification carries **ids only**, never the event payload: `NOTIFY` payloads are capped
 *    at 8000 bytes and the row is the source of truth.
 */
export const JOB_EVENTS_CHANNEL = "job_events";

/** What `notifyJobEvent()` puts on the channel (JSON) and the API parses off it. */
export const JobEventNotificationSchema = z.strictObject({
  /** `job_events.id` — also the SSE event id. */
  id: z.number().int().positive(),
  jobId: JobId,
  workspaceId: WorkspaceId,
});
export type JobEventNotification = z.infer<typeof JobEventNotificationSchema>;

/**
 * Validate `event` with `JobEventSchema` (strict: unknown fields and unknown `type`s throw a
 * `ZodError`) and insert it, scoped to `event.workspaceId`. The whole event is stored as
 * `payload`; `type`, `jobId` and `at` are denormalised for indexing.
 */
export async function insertJobEvent(db: ScopableDb, event: JobEvent): Promise<{ id: number }> {
  const parsed = JobEventSchema.parse(event);
  const rows = await forWorkspace(db, parsed.workspaceId)
    .insert(jobEvents)
    .values({
      jobId: parsed.jobId,
      type: parsed.type,
      payload: parsed,
      at: new Date(parsed.at),
    })
    .returning({ id: jobEvents.id });
  const row = rows[0];
  if (!row) throw new Error("insertJobEvent: insert returned no row");
  return { id: row.id };
}

export interface ListJobEventsOptions {
  workspaceId: WorkspaceId;
  /** Restrict to one job (`GET /jobs/:id/events`); omit for the workspace firehose. */
  jobId?: JobId;
  /** Only rows with `id > afterId` — the `Last-Event-ID` replay cursor. */
  afterId?: number;
  /** Page size; the caller loops while `rows.length === limit`. */
  limit: number;
}

export type JobEventRow = typeof jobEvents.$inferSelect;

/** Events for a workspace (optionally one job), ordered by `id` ascending. */
export async function listJobEvents(
  db: ScopableDb,
  { workspaceId, jobId, afterId, limit }: ListJobEventsOptions,
): Promise<JobEventRow[]> {
  const filters: SQL[] = [];
  if (jobId !== undefined) filters.push(eq(jobEvents.jobId, jobId));
  if (afterId !== undefined) filters.push(gt(jobEvents.id, afterId));
  const extra = filters.length > 0 ? and(...filters) : undefined;
  return forWorkspace(db, workspaceId)
    .select(jobEvents, extra)
    .orderBy(asc(jobEvents.id))
    .limit(limit);
}

/**
 * The terminal event (`completed` / `failed` / `cancelled`) recorded for `jobId` in `ws`, or
 * `undefined` while the job is still running or was never queued. Not a page over
 * `listJobEvents`: the terminal row may be older than any page. TEACH-82's pre-run guard and
 * `releaseStaleLock` (ADR 0025 §24) both read this.
 */
export async function terminalJobEventFor(
  ws: WorkspaceDb,
  jobId: JobId,
): Promise<JobEventRow | undefined> {
  const rows = await ws
    .select(
      jobEvents,
      and(eq(jobEvents.jobId, jobId), inArray(jobEvents.type, [...JOB_TERMINAL_EVENT_TYPES])),
    )
    .limit(1);
  return rows[0];
}

/** `terminalJobEventFor` from a raw client, in the shape TEACH-82 FR 2 specifies. */
export function getTerminalJobEvent(
  db: ScopableDb,
  { workspaceId, jobId }: { workspaceId: WorkspaceId; jobId: JobId },
): Promise<JobEventRow | undefined> {
  return terminalJobEventFor(forWorkspace(db, workspaceId), jobId);
}

/** Whether any event at all — `queued` included — was ever written for `jobId` in `ws`. */
export async function hasAnyJobEvent(ws: WorkspaceDb, jobId: JobId): Promise<boolean> {
  const rows = await ws
    .project({ id: jobEvents.id }, jobEvents, eq(jobEvents.jobId, jobId))
    .limit(1);
  return rows.length > 0;
}

/**
 * `pg_notify('job_events', json)` for a row that has already been committed. Uses the postgres.js
 * client rather than Drizzle so the API's `sql.listen()` and the worker's notify share one code
 * path and one driver.
 */
export async function notifyJobEvent(sql: Sql, notification: JobEventNotification): Promise<void> {
  const payload = JSON.stringify(JobEventNotificationSchema.parse(notification));
  await sql`select pg_notify(${JOB_EVENTS_CHANNEL}, ${payload})`;
}
