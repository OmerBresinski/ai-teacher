import { type JobEvent, JobEventSchema, JobId, WorkspaceId } from "@tj/domain";
import { and, asc, eq, gt, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Sql } from "./client";
import { jobEvents } from "./schema/job-events";
import { forWorkspace, type ScopableDb } from "./tenant";

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
 * `pg_notify('job_events', json)` for a row that has already been committed. Uses the postgres.js
 * client rather than Drizzle so the API's `sql.listen()` and the worker's notify share one code
 * path and one driver.
 */
export async function notifyJobEvent(sql: Sql, notification: JobEventNotification): Promise<void> {
  const payload = JSON.stringify(JobEventNotificationSchema.parse(notification));
  await sql`select pg_notify(${JOB_EVENTS_CHANNEL}, ${payload})`;
}
