import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { listJobEvents } from "@tj/db";
import { createTestUserWithWorkspace, withTestDb } from "@tj/db/testing";
import { JobEventSchema, type JobId, type JobResult, newId, type WorkspaceId } from "@tj/domain";
import pino from "pino";
import type { BossJob } from "./run-job";
import { runJob } from "./run-job";
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
});
