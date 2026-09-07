import type { JobEvent, JobEventType } from "@tj/domain";
import { sql } from "drizzle-orm";
import {
  bigserial,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

/** Name of the partial unique index that allows one terminal row per job (TEACH-82). */
export const JOB_EVENTS_ONE_TERMINAL_PER_JOB_INDEX = "job_events_one_terminal_per_job_uidx";

/**
 * `job_events` — one row per job event emitted by the worker (ADR 0012). It is both the audit log
 * of a job and the **replay buffer** for SSE: `id` is the SSE event id, so a client reconnecting
 * with `Last-Event-ID: 42` asks for `id > 42` (`listJobEvents({ afterId: 42 })`).
 *
 * - `id` is a `bigserial` instead of an app-minted UUID because SSE replay needs a total order
 *   that survives clock skew between workers; sequences give that for free.
 * - `payload` is the whole `JobEvent` (validated with `JobEventSchema` at the write boundary,
 *   `insertJobEvent()`); `type`, `job_id`, `workspace_id` and `at` are denormalised copies for
 *   indexing and filtering. The payload is what the API streams to clients.
 * - Rows are immutable: no `updated_at`.
 * - Tenant table: `workspace_id NOT NULL` FK → `workspaces` with `ON DELETE CASCADE`. The
 *   `(workspace_id, at)` index serves the per-workspace firehose (`GET /events`); `(job_id, at)`
 *   serves `GET /jobs/:id/events`. `workspace_id` is the leading column of the first index, which
 *   is what the tenancy invariant test looks for.
 * - **At most one terminal event per job**, enforced by the partial unique index
 *   `job_events_one_terminal_per_job_uidx` on `(job_id) WHERE type IN ('completed', 'failed',
 *   'cancelled')`. `runJob` relies on it: a retry that finds the row already terminal skips the
 *   handler, and a second terminal insert surfaces as a unique violation (`23505`) that is treated
 *   as "already settled" rather than an error (TEACH-82). The literal list mirrors
 *   `JOB_TERMINAL_EVENT_TYPES` in `@tj/domain`; a new terminal type needs a new migration.
 */
export const jobEvents = pgTable(
  "job_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jobId: uuid("job_id").notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    type: text("type").$type<JobEventType>().notNull(),
    payload: jsonb("payload").$type<JobEvent>().notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("job_events_workspace_id_at_idx").on(t.workspaceId, t.at),
    index("job_events_job_id_at_idx").on(t.jobId, t.at),
    uniqueIndex(JOB_EVENTS_ONE_TERMINAL_PER_JOB_INDEX)
      .on(t.jobId)
      .where(sql`${t.type} in ('completed', 'failed', 'cancelled')`),
  ],
);
