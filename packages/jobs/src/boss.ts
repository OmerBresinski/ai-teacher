import { JobName } from "@tj/domain";
import { PgBoss } from "pg-boss";

/** Where pg-boss keeps its tables. `pgboss` in dev/prod, `pgboss_test` in integration tests. */
export type PgBossSchema = "pgboss" | "pgboss_test";

export interface CreateBossOptions {
  /** Defaults to `"pgboss"`. Tests pass `"pgboss_test"` so they never touch real queues. */
  schema?: PgBossSchema;
  /** Connections in pg-boss's own pool (on top of `@tj/db`'s). Default 4. */
  max?: number;
  /** `application_name` reported to Postgres. Default `"tj-worker"`. */
  applicationName?: string;
  /**
   * `"worker"` (default) runs pg-boss maintenance (`supervise`) and the cron scheduler
   * (`schedule`). `"enqueue-only"` turns both off — for `apps/api`, which only `send`s/`cancel`s
   * (ADR 0006) and must not compete with the worker for maintenance or duplicate cron ticks.
   */
  role?: "worker" | "enqueue-only";
}

/** Retry policy applied to every queue by `ensureQueues()` and to every job by `enqueue()`. */
export const JOB_RETRY_LIMIT = 1;
/** Seconds between the first attempt and the single retry. */
export const JOB_RETRY_DELAY_SECONDS = 1;
/** Completed / failed / cancelled rows are deleted after 7 days. */
export const JOB_DELETE_AFTER_SECONDS = 7 * 86_400;
/** Queued rows nobody ever picked up are deleted after 14 days (pg-boss default). */
export const JOB_RETENTION_SECONDS = 14 * 86_400;
/** A handler may run for at most 15 minutes before pg-boss expires the attempt. */
export const JOB_EXPIRE_IN_SECONDS = 15 * 60;

/**
 * Build a `PgBoss` instance for `databaseUrl`, **not started** — the caller calls
 * `await boss.start()` (which installs/migrates the pg-boss schema on first use, see the README
 * "pg-boss schema" note) and then `await ensureQueues(boss)`.
 *
 * pg-boss ≥ 10 has no `archiveCompletedAfterSeconds` / `deleteAfterDays`: retention and retry
 * policy live on the queue (`createQueue`) and per job (`send`). Both are set by this package,
 * so `ensureQueues()` + `enqueue()` is the whole configuration surface.
 */
export function createBoss(databaseUrl: string, opts: CreateBossOptions = {}): PgBoss {
  return new PgBoss(bossOptions(databaseUrl, opts));
}

/** The `PgBoss` constructor options `createBoss` uses — exported so tests can assert on them. */
export function bossOptions(
  databaseUrl: string,
  opts: CreateBossOptions = {},
): ConstructorParameters<typeof PgBoss>[0] {
  if (!databaseUrl) throw new Error("createBoss: a Postgres connection URL is required");
  const worker = (opts.role ?? "worker") === "worker";
  return {
    connectionString: databaseUrl,
    schema: opts.schema ?? "pgboss",
    max: opts.max ?? 4,
    application_name: opts.applicationName ?? "tj-worker",
    // Job rows are pruned by pg-boss maintenance; the worker is the only process that supervises
    // (and the only one that would run cron schedules). The api is enqueue-only (ADR 0006).
    supervise: worker,
    schedule: worker,
    // Our queues are tiny; poll a little faster than the 2 s default so a `ping` from the demo
    // feels immediate. Workers set their own interval in `work()`.
    monitorIntervalSeconds: 60,
  };
}

/**
 * Create every queue named in `JobName` with the shared retry/retention policy. Idempotent
 * (`ON CONFLICT DO NOTHING` inside pg-boss), so call it on every boot after `boss.start()`.
 * `send()` to a queue that was never created throws in pg-boss ≥ 10.
 */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const name of Object.values(JobName)) {
    await boss.createQueue(name, {
      policy: "standard",
      retryLimit: JOB_RETRY_LIMIT,
      retryDelay: JOB_RETRY_DELAY_SECONDS,
      deleteAfterSeconds: JOB_DELETE_AFTER_SECONDS,
      retentionSeconds: JOB_RETENTION_SECONDS,
      expireInSeconds: JOB_EXPIRE_IN_SECONDS,
    });
  }
}
