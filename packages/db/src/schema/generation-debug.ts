import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { workspaceColumn } from "./_columns";
import { documents } from "./documents";

/**
 * `generation_debug` — the per-lesson debug record of a generation (Greg, 20 Oct 2026; ADR 0015
 * amendment of that date). One row per thing the pipeline did that a root cause needs and the
 * logs do not carry: the writer's raw output, the objectives, each check, repair, split, picture
 * decision, fact-check change, model call, the call that tripped the budget stop and a failed
 * job's full error. Written fire-and-forget by the worker (`apps/worker/src/generation-debug.ts`)
 * and read by `tools/lesson-debug`; deleted after `GENERATION_DEBUG_TTL_DAYS` (default 30) by the
 * daily `generation.debug-cleanup` cron.
 *
 * - `id` is a `bigserial`: rows are append-only and the tool orders by `(created_at, id)`.
 * - `(job_id, attempt, seq)` orders the rows of one attempt; `seq` restarts at 0 per attempt.
 * - `slide_index` is 0-based and null for a deck-wide row.
 * - `payload` is capped per row by the writer (`DEBUG_PAYLOAD_MAX_BYTES`), never here.
 * - Tenant table (ADR 0007): `workspace_id` cascades a deleted Workspace's rows away; `lesson_id`
 *   cascades a deleted lesson's rows away. No `updated_at`: rows are immutable.
 */
export const generationDebug = pgTable(
  "generation_debug",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ...workspaceColumn(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").notNull(),
    attempt: integer("attempt").notNull(),
    seq: integer("seq").notNull(),
    kind: text("kind").notNull(),
    slideIndex: integer("slide_index"),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("generation_debug_workspace_id_idx").on(t.workspaceId),
    index("generation_debug_lesson_id_created_at_idx").on(t.lessonId, t.createdAt),
    // The daily TTL delete reads by age alone.
    index("generation_debug_created_at_idx").on(t.createdAt),
  ],
);
