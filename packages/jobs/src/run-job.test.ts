import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  insertJobEvent,
  JOB_EVENTS_CHANNEL,
  type JobEventNotification,
  JobEventNotificationSchema,
  type JobEventRow,
  listJobEvents,
  notifyJobEvent,
} from "@tj/db";
import { createTestUserWithWorkspace, withTestDb } from "@tj/db/testing";
import {
  type JobEvent,
  JobEventSchema,
  type JobId,
  type JobResult,
  newId,
  type WorkspaceId,
} from "@tj/domain";
import pino from "pino";
import { cancel } from "./enqueue";
import type { emitJobEvent } from "./events";
import type { BossJob } from "./run-job";
import { dispositionForTerminal, runJob } from "./run-job";
import { defineJob, type JobRegistry, type JobsContext } from "./types";

const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping runJob dependency injection test: ${t.reason}`);

describeDb("runJob dependencies", () => {
  if (!t.ok) return;
  const { unsafeDb, sql, close } = t.db;
  let workspaceId: WorkspaceId;

  beforeEach(async () => {
    await t.db.truncateTenantTables();
    workspaceId = newId<WorkspaceId>();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId, workspaceName: "run job test" });
  });

  afterAll(async () => {
    await close();
  });

  test("passes RunJobOptions.deps to the selected handler", async () => {
    const deps = { marker: "injected" };
    let received: typeof deps | undefined;
    const registry: JobRegistry<typeof deps> = {
      ping: defineJob("ping", async () => {}),
      "ai.ping": defineJob<"ai.ping", typeof deps>("ai.ping", async ({ deps: injected }) => {
        received = injected;
      }),
      "lesson.plan": defineJob("lesson.plan", async () => {}),
      "lesson.cascade": defineJob("lesson.cascade", async () => {}),
      "lesson.regenerate": defineJob("lesson.regenerate", async () => {}),
    };
    const jobId = newId<JobId>();
    const boss = {
      findJobs: async () => [],
    } as unknown as JobsContext["boss"];
    const ctx: JobsContext = { boss, db: unsafeDb, sql };
    const job = {
      id: jobId,
      name: "ai.ping",
      data: {
        jobId,
        workspaceId,
        payload: { class: "small", prompt: "Reply with the single word: pong." },
      },
      retryCount: 0,
      retryLimit: 1,
      state: "active",
    } as unknown as BossJob<"ai.ping">;

    const outcome = await runJob(ctx, "ai.ping", registry, job, {
      deps,
      logger: pino({ level: "silent" }),
    });

    expect(received).toBe(deps);
    expect(outcome).toMatchObject({ status: "completed", event: "completed" });
  });

  const lessonId = "0192f7a0-0000-7000-8000-000000000042";
  const boss = { findJobs: async () => [] } as unknown as JobsContext["boss"];
  const quiet = pino({ level: "silent" });
  const stubs = {
    ping: defineJob("ping", async () => {}),
    "ai.ping": defineJob("ai.ping", async () => {}),
    "lesson.plan": defineJob("lesson.plan", async () => {}),
    "lesson.cascade": defineJob("lesson.cascade", async () => {}),
    "lesson.regenerate": defineJob("lesson.regenerate", async () => {}),
  } satisfies JobRegistry;
  const cascadeJob = (jobId: JobId) =>
    ({
      id: jobId,
      name: "lesson.cascade",
      data: { jobId, workspaceId, payload: { lessonId, changedFactIds: ["o1"] } },
      retryCount: 0,
      retryLimit: 1,
      state: "active",
    }) as unknown as BossJob<"lesson.cascade">;

  test("a handler's return value rides on the completed event as `result` (ADR 0025 §19)", async () => {
    const result: JobResult = { job: "lesson.cascade", proposals: [], flagged: [] };
    const registry: JobRegistry = {
      ...stubs,
      "lesson.cascade": defineJob("lesson.cascade", async () => result),
    };
    const jobId = newId<JobId>();
    const ctx: JobsContext = { boss, db: unsafeDb, sql };
    const outcome = await runJob(ctx, "lesson.cascade", registry, cascadeJob(jobId), {
      deps: undefined,
      logger: quiet,
    });
    expect(outcome).toMatchObject({ status: "completed", event: "completed" });
    const events = await listJobEvents(unsafeDb, { workspaceId, jobId, limit: 10 });
    const completed = events.find((e) => e.type === "completed");
    expect(completed).toBeDefined();
    const parsed = JobEventSchema.parse(completed?.payload);
    expect(parsed.type === "completed" && parsed.result).toEqual(result);
  });

  test("a handler that returns nothing yields a completed event without a result key", async () => {
    const jobId = newId<JobId>();
    const ctx: JobsContext = { boss, db: unsafeDb, sql };
    await runJob(ctx, "lesson.cascade", stubs, cascadeJob(jobId), {
      deps: undefined,
      logger: quiet,
    });
    const events = await listJobEvents(unsafeDb, { workspaceId, jobId, limit: 10 });
    const completed = events.find((e) => e.type === "completed");
    expect(completed?.payload).not.toHaveProperty("result");
    expect(JobEventSchema.safeParse(completed?.payload).success).toBe(true);
  });

  test("progress(percent, message, { documentUpdatedAt }) lands in the coalesced event", async () => {
    const iso = "2026-09-06T10:00:00.000Z";
    const registry: JobRegistry = {
      ...stubs,
      "lesson.cascade": defineJob("lesson.cascade", async ({ progress }) => {
        await progress(10, "first");
        void progress(30, "slide 3", { documentUpdatedAt: iso });
        void progress(40);
      }),
    };
    const jobId = newId<JobId>();
    const ctx: JobsContext = { boss, db: unsafeDb, sql };
    await runJob(ctx, "lesson.cascade", registry, cascadeJob(jobId), {
      deps: undefined,
      logger: quiet,
      progressMinIntervalMs: 60_000,
    });
    const events = await listJobEvents(unsafeDb, { workspaceId, jobId, limit: 10 });
    const progress = events.filter((e) => e.type === "progress").map((e) => e.payload);
    expect(progress).toHaveLength(2);
    expect(progress[1]).toMatchObject({
      progress: { percent: 40, message: "slide 3", documentUpdatedAt: iso },
    });
    expect(events.map((e) => e.type)).toEqual(["started", "progress", "progress", "completed"]);
  });

  // ---- TEACH-82: terminal-event guard, one terminal row per job, cancel/complete race ----

  test("AC1: a retry after the terminal notify failed skips the handler and re-notifies", async () => {
    const jobId = newId<JobId>();
    let handlerRuns = 0;
    const registry: JobRegistry = {
      ...stubs,
      "lesson.cascade": defineJob("lesson.cascade", async () => {
        handlerRuns++;
      }),
    };
    // Persist every event but fail *after* the `completed` row is committed (a notify failure).
    const flakyEmit: typeof emitJobEvent = async (c, event) => {
      const { id } = await insertJobEvent(c.db, event);
      if (event.type === "completed") throw new Error("simulated notify failure");
      await notifyJobEvent(c.sql, { id, jobId: event.jobId, workspaceId: event.workspaceId });
      return { id };
    };
    const ctx: JobsContext = { boss, db: unsafeDb, sql };
    const first = runJob(ctx, "lesson.cascade", registry, cascadeJob(jobId), {
      deps: undefined,
      logger: quiet,
      emit: flakyEmit,
    });
    await expect(first).rejects.toThrow("simulated notify failure");
    expect(handlerRuns).toBe(1);

    // Second delivery (pg-boss retry): observe the re-issued NOTIFY for the stored terminal row.
    // LISTEN is established before the run so the notify cannot slip past it.
    let onNotification: (n: JobEventNotification) => void = () => {};
    const notified = new Promise<JobEventNotification>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no NOTIFY within 2s")), 2_000);
      onNotification = (n) => {
        clearTimeout(timer);
        resolve(n);
      };
    });
    const listener = await sql.listen(JOB_EVENTS_CHANNEL, (payload) => {
      const n = JobEventNotificationSchema.parse(JSON.parse(payload));
      if (n.jobId === jobId) onNotification(n);
    });
    try {
      const second = await runJob(ctx, "lesson.cascade", registry, cascadeJob(jobId), {
        deps: undefined,
        logger: quiet,
      });
      expect(handlerRuns).toBe(1);
      expect(second).toMatchObject({ id: jobId, status: "completed", event: "completed" });
      const events = await listJobEvents(unsafeDb, { workspaceId, jobId, limit: 10 });
      expect(events.map((e) => e.type)).toEqual(["started", "completed"]);
      const completedId = events.find((e) => e.type === "completed")?.id;
      expect(completedId).toBeDefined();
      expect(await notified).toEqual({ id: completedId ?? -1, jobId, workspaceId });
    } finally {
      await listener.unlisten();
    }
  });

  test("AC2: a stored `failed { retryable: false }` dead-letters without running the handler", async () => {
    const jobId = newId<JobId>();
    let handlerRuns = 0;
    const registry: JobRegistry = {
      ...stubs,
      "lesson.cascade": defineJob("lesson.cascade", async () => {
        handlerRuns++;
      }),
    };
    const error = { message: "bad input", retryable: false };
    await insertJobEvent(unsafeDb, {
      type: "failed",
      jobId,
      workspaceId,
      at: new Date().toISOString(),
      error,
    });
    const ctx: JobsContext = { boss, db: unsafeDb, sql };
    const outcome = await runJob(ctx, "lesson.cascade", registry, cascadeJob(jobId), {
      deps: undefined,
      logger: quiet,
    });
    expect(handlerRuns).toBe(0);
    expect(outcome).toEqual({ id: jobId, status: "deadletter", output: error, event: "failed" });
    const events = await listJobEvents(unsafeDb, { workspaceId, jobId, limit: 10 });
    expect(events.map((e) => e.type)).toEqual(["failed"]);
  });

  test("AC4: a cancel that lands after the last poll is recorded as `cancelled`, not `completed`", async () => {
    const jobId = newId<JobId>();
    let reads = 0;
    // `active` on every read the poll could make; `cancelled` on the final re-read. The poll
    // interval is 60 s so the only reads are the final one (and none from the poll).
    const racingBoss = {
      findJobs: async () => {
        reads++;
        return [{ id: jobId, state: "cancelled" }];
      },
    } as unknown as JobsContext["boss"];
    const ctx: JobsContext = { boss: racingBoss, db: unsafeDb, sql };
    const outcome = await runJob(ctx, "lesson.cascade", stubs, cascadeJob(jobId), {
      deps: undefined,
      logger: quiet,
      cancelPollIntervalMs: 60_000,
    });
    expect(reads).toBe(1);
    expect(outcome).toMatchObject({ id: jobId, status: "completed", event: "cancelled" });
    const events = await listJobEvents(unsafeDb, { workspaceId, jobId, limit: 10 });
    expect(events.map((e) => e.type)).toEqual(["started", "cancelled"]);
  });

  test("a terminal insert that loses to the one-terminal index returns the stored disposition", async () => {
    const jobId = newId<JobId>();
    // The handler itself settles the job as `cancelled` (as `cancel()` would from the API while
    // the worker is between its last poll and the terminal write).
    const registry: JobRegistry = {
      ...stubs,
      "lesson.cascade": defineJob("lesson.cascade", async () => {
        await insertJobEvent(unsafeDb, {
          type: "cancelled",
          jobId,
          workspaceId,
          at: new Date().toISOString(),
        });
      }),
    };
    const ctx: JobsContext = { boss, db: unsafeDb, sql };
    const outcome = await runJob(ctx, "lesson.cascade", registry, cascadeJob(jobId), {
      deps: undefined,
      logger: quiet,
    });
    expect(outcome).toMatchObject({ id: jobId, status: "completed", event: "cancelled" });
    const events = await listJobEvents(unsafeDb, { workspaceId, jobId, limit: 10 });
    expect(events.map((e) => e.type)).toEqual(["started", "cancelled"]);
  });

  test("a failed final re-read falls through to `completed`", async () => {
    const jobId = newId<JobId>();
    const brokenBoss = {
      findJobs: async () => {
        throw new Error("pg-boss unreachable");
      },
    } as unknown as JobsContext["boss"];
    const ctx: JobsContext = { boss: brokenBoss, db: unsafeDb, sql };
    const outcome = await runJob(ctx, "lesson.cascade", stubs, cascadeJob(jobId), {
      deps: undefined,
      logger: quiet,
      cancelPollIntervalMs: 60_000,
    });
    expect(outcome).toMatchObject({ id: jobId, status: "completed", event: "completed" });
  });

  test("cancel() of a waiting retry whose previous attempt already settled reports already_finished", async () => {
    // X1 aftermath: attempt 1 committed `completed` but its notify failed, so pg-boss shows the
    // job as `retry`. The API's cancel must not surface the unique violation as a 5xx.
    const jobId = newId<JobId>();
    const at = new Date().toISOString();
    await insertJobEvent(unsafeDb, { type: "started", jobId, workspaceId, at });
    await insertJobEvent(unsafeDb, { type: "completed", jobId, workspaceId, at });
    const row = {
      id: jobId,
      state: "retry",
      startedOn: new Date(0),
      data: { jobId, workspaceId, payload: { lessonId, changedFactIds: ["o1"] } },
    };
    let cancelled = 0;
    const waitingBoss = {
      findJobs: async () => [cancelled > 0 ? { ...row, state: "cancelled" } : row],
      cancel: async () => {
        cancelled++;
      },
    } as unknown as JobsContext["boss"];
    const ctx: JobsContext = { boss: waitingBoss, db: unsafeDb, sql };
    const result = await cancel(ctx, jobId, { name: "lesson.cascade" });
    expect(result).toEqual({ status: "already_finished", state: "completed" });
    const events = await listJobEvents(unsafeDb, { workspaceId, jobId, limit: 10 });
    expect(events.map((e) => e.type)).toEqual(["started", "completed"]);
  });
});

describe("dispositionForTerminal", () => {
  const row = (payload: JobEvent): JobEventRow =>
    ({
      id: 1,
      jobId: payload.jobId,
      workspaceId: payload.workspaceId,
      type: payload.type,
      payload,
      at: new Date(payload.at),
    }) as JobEventRow;
  const jobId = newId<JobId>();
  const base = { jobId, workspaceId: newId<WorkspaceId>(), at: "2026-09-07T00:00:00.000Z" };

  test("completed → completed/completed", () => {
    expect(dispositionForTerminal(jobId, row({ type: "completed", ...base }))).toEqual({
      id: jobId,
      status: "completed",
      event: "completed",
    });
  });

  test("cancelled → completed/cancelled (the pg-boss row is already cancelled)", () => {
    expect(dispositionForTerminal(jobId, row({ type: "cancelled", ...base }))).toEqual({
      id: jobId,
      status: "completed",
      event: "cancelled",
    });
  });

  test("failed maps retryable to `failed` and non-retryable to `deadletter`, carrying the error", () => {
    const soft = { message: "flaky", retryable: true };
    const hard = { message: "bad", retryable: false };
    expect(dispositionForTerminal(jobId, row({ type: "failed", ...base, error: soft }))).toEqual({
      id: jobId,
      status: "failed",
      output: soft,
      event: "failed",
    });
    expect(dispositionForTerminal(jobId, row({ type: "failed", ...base, error: hard }))).toEqual({
      id: jobId,
      status: "deadletter",
      output: hard,
      event: "failed",
    });
  });

  test("a non-terminal row is a programming error", () => {
    expect(() => dispositionForTerminal(jobId, row({ type: "started", ...base }))).toThrow(
      "not a terminal event type",
    );
  });
});
