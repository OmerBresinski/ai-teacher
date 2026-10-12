import {
  clearGenerating,
  forWorkspace,
  isUniqueViolation,
  JOB_EVENTS_ONE_TERMINAL_PER_JOB_INDEX,
} from "@tj/db";
import { JOB_FAILURE_MESSAGE, type JobId, safeError, type WorkspaceId } from "@tj/domain";
import type { Logger } from "pino";
import type { PgBossSchema } from "./boss";
import { emitJobEvent, nowIso } from "./events";
import type { JobsContext } from "./types";

/** How often the worker sweeps for generating locks held by a job that will never run again. */
export const REAP_INTERVAL_MS = 60_000;

/**
 * TEACH-202 part g: a generating lock whose job pg-boss has settled for good (`failed` with no
 * retry left, or `cancelled`) but which has no terminal `job_events` row. That happens when the
 * process died on the last attempt (crash, OOM, a kill past the shutdown grace): `runJob`'s
 * `finally` and the handler's lock release never ran, and pg-boss marked the job `failed` once
 * its lease (`expireInSeconds`) ran out. Nothing else releases that lock, and the teacher's page
 * waits on a terminal event that is never written.
 *
 * For each such row: write the terminal event the dead attempt could not (`failed` or
 * `cancelled`, so the open page's stream settles and shows the failed state), then clear the lock
 * (only while that job still holds it). A lock whose job already has a terminal event is cleared
 * too. A job pg-boss still holds (`created`, `retry`, `active`) is never touched: its next
 * attempt keeps the lock. Returns how many locks were released.
 */
export async function reapOrphanedLocks(
  ctx: Pick<JobsContext, "db" | "sql">,
  opts: { logger: Logger; schema?: PgBossSchema; limit?: number },
): Promise<number> {
  const schema = opts.schema ?? "pgboss";
  const rows = await ctx.sql<
    {
      documentId: string;
      workspaceId: string;
      jobId: string;
      state: string | null;
      done: boolean;
    }[]
  >`
    select d.id as "documentId", d.workspace_id as "workspaceId",
           d.generating_job_id as "jobId", j.state::text as state,
           exists (
             select 1 from job_events e
             where e.job_id = d.generating_job_id
               and e.type in ('completed', 'failed', 'cancelled')
           ) as done
    from documents d
    left join ${ctx.sql(schema)}.job j on j.id = d.generating_job_id
    where d.generating_job_id is not null
      and (
        j.state in ('failed', 'cancelled')
        or exists (
          select 1 from job_events e
          where e.job_id = d.generating_job_id
            and e.type in ('completed', 'failed', 'cancelled')
        )
      )
    limit ${opts.limit ?? 100}
  `;
  let released = 0;
  for (const row of rows) {
    const jobId = row.jobId as JobId;
    const workspaceId = row.workspaceId as WorkspaceId;
    const log = opts.logger.child({ jobId, workspaceId, documentId: row.documentId });
    try {
      if (!row.done) {
        const base = { jobId, workspaceId, at: nowIso() } as const;
        await emitJobEvent(
          ctx,
          row.state === "cancelled"
            ? { type: "cancelled", ...base }
            : {
                type: "failed",
                ...base,
                error: { message: JOB_FAILURE_MESSAGE, retryable: true },
              },
        ).then(undefined, (err: unknown) => {
          // Another writer recorded the terminal event first: keep theirs.
          if (!isUniqueViolation(err, JOB_EVENTS_ONE_TERMINAL_PER_JOB_INDEX)) throw err;
        });
      }
      await clearGenerating(forWorkspace(ctx.db, workspaceId), row.documentId, jobId);
      released += 1;
      log.warn({ state: row.state }, "released the generating lock of a job that died");
    } catch (err) {
      log.error({ err: safeError(err) }, "could not release an orphaned generating lock");
    }
  }
  return released;
}
