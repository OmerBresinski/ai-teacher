import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { listJobEvents } from "@tj/db";
import { createTestUserWithWorkspace, withTestDb } from "@tj/db/testing";
import { type JobEvent, type JobId, newId, type WorkspaceId } from "@tj/domain";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import { createBoss, ensureQueues } from "./boss";
import { cancel, enqueue } from "./enqueue";
import { type BossJob, type RunJobOutcome, runJob } from "./run-job";
import {
  defineJob,
  type JobData,
  type JobRegistry,
  type JobsContext,
  NonRetryableError,
} from "./types";

/**
 * Integration tests against TEST_DATABASE_URL: a real pg-boss (schema `pgboss_test`, so the
 * development `pgboss` schema is never touched) plus a small in-test worker loop identical to
 * `apps/worker` (`batchSize: 1`, `includeMetadata`, `perJobResults`).
 */
const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping @tj/jobs integration tests: ${t.reason}`);

const STEP_MS = 300;

/** Same shape (and 300 ms steps, above the 250 ms progress window) as `apps/worker/src/jobs/ping.ts`. */
const pingJob = defineJob("ping", async ({ payload, signal, progress }) => {
  for (let i = 1; i <= payload.steps; i++) {
    if (signal.aborted) return;
    await Bun.sleep(STEP_MS);
    if (signal.aborted) return;
    if (payload.failAt !== undefined && i === payload.failAt) {
      throw new NonRetryableError(`ping asked to fail at step ${i}/${payload.steps}`);
    }
    await progress(Math.round((i / payload.steps) * 100), `step ${i}/${payload.steps}`);
  }
});
const aiPingJob = defineJob("ai.ping", async () => {});
const lessonPlanJob = defineJob("lesson.plan", async () => {});
const lessonCascadeJob = defineJob("lesson.cascade", async () => {});
const lessonRegenerateJob = defineJob("lesson.regenerate", async () => {});

const logger = pino({ level: "silent" });

describeDb("@tj/jobs against Postgres + pg-boss", () => {
  if (!t.ok) return;
  const { unsafeDb, sql, truncateTenantTables, close, url } = t.db;
  let boss: PgBoss;
  let ctx: JobsContext;
  let workspaceId: WorkspaceId;
  const outcomes: RunJobOutcome[] = [];
  const shutdown = new AbortController();

  const registry: JobRegistry = {
    ping: pingJob,
    "ai.ping": aiPingJob,
    "lesson.plan": lessonPlanJob,
    "lesson.cascade": lessonCascadeJob,
    "lesson.regenerate": lessonRegenerateJob,
  };

  async function eventsFor(jobId: JobId): Promise<JobEvent[]> {
    const rows = await listJobEvents(unsafeDb, { workspaceId, jobId, limit: 100 });
    return rows.map((r) => r.payload as JobEvent);
  }
  async function waitFor(pred: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await pred()) return true;
      await Bun.sleep(25);
    }
    return pred();
  }
  async function bossState(jobId: JobId) {
    const [row] = await boss.findJobs<JobData>("ping", { id: jobId });
    return row;
  }

  beforeAll(async () => {
    boss = createBoss(url, { schema: "pgboss_test", max: 2, applicationName: "tj-jobs-test" });
    boss.on("error", (err) => console.error("pg-boss error", err));
    await boss.start();
    await ensureQueues(boss);
    // Rows left by a previous run belong to workspaces that were truncated away; drop them.
    await boss.deleteAllJobs("ping");
    ctx = { boss, db: unsafeDb, sql };
  });

  afterAll(async () => {
    await boss.stop({ graceful: false, close: true });
    await close();
  });

  beforeEach(async () => {
    await truncateTenantTables();
    workspaceId = newId<WorkspaceId>();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId, workspaceName: "jobs test" });
    outcomes.length = 0;
  });

  describe("before any worker is registered", () => {
    test("cancel of a queued (never started) job writes `cancelled` immediately", async () => {
      const jobId = await enqueue(ctx, "ping", { message: "hi", steps: 2 }, { workspaceId });
      if (!jobId) throw new Error("enqueue returned null");
      expect(await cancel(ctx, jobId)).toEqual({ status: "cancelled" });
      expect((await eventsFor(jobId)).map((e) => e.type)).toEqual(["queued", "cancelled"]);
      expect((await bossState(jobId))?.state).toBe("cancelled");
      // A second cancel is a no-op and writes nothing.
      expect(await cancel(ctx, jobId)).toEqual({ status: "already_finished", state: "cancelled" });
      expect(await eventsFor(jobId)).toHaveLength(2);
    });

    test("cancel of an unknown id is `not_found`", async () => {
      expect(await cancel(ctx, newId<JobId>())).toEqual({ status: "not_found" });
    });

    test("the pg-boss job id equals the JobId and carries the parsed payload", async () => {
      const jobId = await enqueue(ctx, "ping", { message: "hi" }, { workspaceId });
      if (!jobId) throw new Error("enqueue returned null");
      const row = await bossState(jobId);
      expect(row?.id).toBe(jobId);
      expect(row?.data).toEqual({ jobId, workspaceId, payload: { message: "hi", steps: 5 } });
      expect(row?.retryLimit).toBe(1);
      await boss.deleteJob("ping", jobId);
    });
  });

  describe("with a worker loop", () => {
    beforeAll(async () => {
      await boss.work(
        "ping",
        {
          batchSize: 1,
          includeMetadata: true,
          perJobResults: true,
          pollingIntervalSeconds: 0.5,
        },
        async (jobs) => {
          const results: RunJobOutcome[] = [];
          for (const job of jobs as BossJob[]) {
            const outcome = await runJob(ctx, "ping", registry, job, {
              shutdown: shutdown.signal,
              logger,
              deps: undefined,
            });
            outcomes.push(outcome);
            results.push(outcome);
          }
          return results;
        },
      );
    });

    afterAll(async () => {
      await boss.offWork("ping");
    });

    test("ping with 3 steps emits exactly queued, started, progress x3, completed", async () => {
      const jobId = await enqueue(ctx, "ping", { message: "hi", steps: 3 }, { workspaceId });
      if (!jobId) throw new Error("enqueue returned null");
      const done = await waitFor(
        async () => (await eventsFor(jobId)).some((e) => e.type === "completed"),
        5_000,
      );
      expect(done).toBe(true);
      const events = await eventsFor(jobId);
      expect(events.map((e) => e.type)).toEqual([
        "queued",
        "started",
        "progress",
        "progress",
        "progress",
        "completed",
      ]);
      const progress = events.filter((e) => e.type === "progress");
      expect(progress.map((e) => e.progress)).toEqual([
        { percent: 33, message: "step 1/3" },
        { percent: 67, message: "step 2/3" },
        { percent: 100, message: "step 3/3" },
      ]);
      // `at` is monotonic and every event carries the same ids.
      const ats = events.map((e) => Date.parse(e.at));
      expect([...ats].sort((a, b) => a - b)).toEqual(ats);
      for (const e of events) {
        expect(e.jobId).toBe(jobId);
        expect(e.workspaceId).toBe(workspaceId);
      }
      // The `completed` event is emitted inside the handler; pg-boss flips the row to `completed`
      // only after the handler returns, so poll instead of asserting once (flaked on slow CI).
      const settled = await waitFor(
        async () => (await bossState(jobId))?.state === "completed",
        2_000,
      );
      expect(settled).toBe(true);
      expect(outcomes.at(-1)).toMatchObject({ id: jobId, status: "completed", event: "completed" });
    });

    test("NonRetryableError ends in `failed { retryable: false }` with no second attempt", async () => {
      const jobId = await enqueue(
        ctx,
        "ping",
        { message: "boom", steps: 3, failAt: 2 },
        { workspaceId },
      );
      if (!jobId) throw new Error("enqueue returned null");
      const done = await waitFor(
        async () => (await eventsFor(jobId)).some((e) => e.type === "failed"),
        5_000,
      );
      expect(done).toBe(true);
      const events = await eventsFor(jobId);
      expect(events.map((e) => e.type)).toEqual(["queued", "started", "progress", "failed"]);
      const failed = events.at(-1);
      expect(failed?.type === "failed" && failed.error).toEqual({
        message: "ping asked to fail at step 2/3",
        retryable: false,
      });
      // pg-boss: terminal failure, retry_count still 0, so no second `started` ever appears.
      // The `failed` event is written inside the handler, *before* pg-boss records the result, so
      // give the row a moment to reach its terminal state instead of reading it immediately.
      const settled = await waitFor(
        async () => (await bossState(jobId))?.state === "failed",
        2_000,
      );
      expect(settled).toBe(true);
      const row = await bossState(jobId);
      expect(row?.state).toBe("failed");
      expect(row?.retryCount).toBe(0);
      await Bun.sleep(1_500); // longer than retryDelay + polling interval
      expect((await eventsFor(jobId)).map((e) => e.type)).toEqual([
        "queued",
        "started",
        "progress",
        "failed",
      ]);
      expect(outcomes.at(-1)).toMatchObject({ id: jobId, status: "deadletter", event: "failed" });
    });

    test("cancel after `started` emits `cancelled` within 600 ms and never `completed`", async () => {
      const jobId = await enqueue(ctx, "ping", { message: "slow", steps: 20 }, { workspaceId });
      if (!jobId) throw new Error("enqueue returned null");
      const started = await waitFor(
        async () => (await eventsFor(jobId)).some((e) => e.type === "started"),
        5_000,
      );
      expect(started).toBe(true);
      const t0 = Date.now();
      expect(await cancel(ctx, jobId)).toEqual({ status: "cancelling" });
      const cancelled = await waitFor(
        async () => (await eventsFor(jobId)).some((e) => e.type === "cancelled"),
        600,
      );
      const elapsed = Date.now() - t0;
      expect(cancelled).toBe(true);
      expect(elapsed).toBeLessThanOrEqual(600);
      await Bun.sleep(400);
      const types = (await eventsFor(jobId)).map((e) => e.type);
      expect(types.at(-1)).toBe("cancelled");
      expect(types).not.toContain("completed");
      expect(types.filter((x) => x === "cancelled")).toHaveLength(1);
      expect((await bossState(jobId))?.state).toBe("cancelled");
      expect(outcomes.at(-1)).toMatchObject({ id: jobId, event: "cancelled" });
    });
  });

  describe("runJob attempt semantics (direct calls, fake pg-boss rows)", () => {
    const fakeJob = (jobId: JobId, retryCount: number, retryLimit = 1): BossJob =>
      ({
        id: jobId,
        name: "ping",
        data: { jobId, workspaceId, payload: { message: "x", steps: 1 } },
        retryCount,
        retryLimit,
        state: "active",
      }) as unknown as BossJob;

    test("a retryable error with attempts left announces the retry as `progress`", async () => {
      const jobId = newId<JobId>();
      const reg: JobRegistry = {
        ping: async () => {
          throw new Error("flaky");
        },
        "ai.ping": aiPingJob,
        "lesson.plan": lessonPlanJob,
        "lesson.cascade": lessonCascadeJob,
        "lesson.regenerate": lessonRegenerateJob,
      };
      const outcome = await runJob(ctx, "ping", reg, fakeJob(jobId, 0), {
        logger,
        deps: undefined,
      });
      expect(outcome).toMatchObject({ status: "failed", event: "progress" });
      const events = await eventsFor(jobId);
      expect(events.map((e) => e.type)).toEqual(["started", "progress"]);
      const last = events.at(-1);
      expect(last?.type === "progress" && last.progress.message).toContain("retrying");
    });

    test("a retryable error on the last attempt ends in `failed { retryable: true }`", async () => {
      const jobId = newId<JobId>();
      const reg: JobRegistry = {
        ping: async () => {
          throw new Error("still flaky");
        },
        "ai.ping": aiPingJob,
        "lesson.plan": lessonPlanJob,
        "lesson.cascade": lessonCascadeJob,
        "lesson.regenerate": lessonRegenerateJob,
      };
      const outcome = await runJob(ctx, "ping", reg, fakeJob(jobId, 1), {
        logger,
        deps: undefined,
      });
      expect(outcome).toMatchObject({ status: "failed", event: "failed" });
      const events = await eventsFor(jobId);
      expect(events.map((e) => e.type)).toEqual(["started", "failed"]);
      const last = events.at(-1);
      expect(last?.type === "failed" && last.error).toEqual({
        message: "still flaky",
        retryable: true,
      });
    });

    test("a shutdown abort is a retryable failure", async () => {
      const jobId = newId<JobId>();
      const ac = new AbortController();
      const reg: JobRegistry = {
        ping: async ({ signal }) => {
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
        },
        "ai.ping": aiPingJob,
        "lesson.plan": lessonPlanJob,
        "lesson.cascade": lessonCascadeJob,
        "lesson.regenerate": lessonRegenerateJob,
      };
      const run = runJob(ctx, "ping", reg, fakeJob(jobId, 1), {
        logger,
        shutdown: ac.signal,
        deps: undefined,
      });
      await Bun.sleep(50);
      ac.abort("shutdown");
      const outcome = await run;
      expect(outcome).toMatchObject({ status: "failed", event: "failed" });
      const last = (await eventsFor(jobId)).at(-1);
      expect(last?.type === "failed" && last.error).toEqual({
        message: "worker shut down while the job was running",
        retryable: true,
      });
    });

    test("a stored payload that no longer validates is dead-lettered as non-retryable", async () => {
      const jobId = newId<JobId>();
      const job = fakeJob(jobId, 0);
      (job.data as { payload: unknown }).payload = { message: 42 };
      const outcome = await runJob(ctx, "ping", registry, job, { logger, deps: undefined });
      expect(outcome).toMatchObject({ status: "deadletter", event: "failed" });
      const events = await eventsFor(jobId);
      expect(events.map((e) => e.type)).toEqual(["failed"]);
      const last = events.at(-1);
      expect(last?.type === "failed" && last.error.retryable).toBe(false);
    });
  });
});
