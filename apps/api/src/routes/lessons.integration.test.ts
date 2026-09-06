/**
 * Integration: `POST /lessons` against TEST_DATABASE_URL with a real pg-boss (schema
 * `pgboss_test`) and an in-test worker loop running a `lesson.plan` stand-in that mirrors
 * `apps/worker` (progress, then `clearGenerating`). Skips visibly when the database is unreachable.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { clearGenerating, forWorkspace, getDocument, listJobEvents } from "@tj/db";
import { createTestUserWithWorkspace, withTestDb } from "@tj/db/testing";
import { type JobId, type LessonId, newId, type WorkspaceId } from "@tj/domain";
import type { Lesson } from "@tj/domain/documents";
import {
  type BossJob,
  createBoss,
  defineJob,
  ensureQueues,
  type JobRegistry,
  type JobsContext,
  type RunJobOutcome,
  runJob,
} from "@tj/jobs";
import type { PgBoss } from "pg-boss";
import { createApp } from "../app";
import type { ErrorEnvelope } from "../errors";
import { createEventsRuntime, type EventsRuntime } from "../events/runtime";
import { silentLogger, TEST_ENV } from "../test-helpers";
import { WORKSPACE_HEADER } from "../workspace";

const t = await withTestDb({ max: 4 });
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping POST /lessons integration tests: ${t.reason}`);

describeDb("POST /lessons against Postgres + pg-boss", () => {
  if (!t.ok) return;
  const { unsafeDb, sql, close, url } = t.db;
  let boss: PgBoss;
  let jobsCtx: JobsContext;
  let runtime: EventsRuntime;
  let app: ReturnType<typeof createApp>;
  let wsA: WorkspaceId;
  const shutdown = new AbortController();
  const released: LessonId[] = [];

  /** Same contract as `apps/worker/src/jobs/lesson-plan.ts` (apps may not import apps). */
  const lessonPlanJob = defineJob<"lesson.plan", { db: typeof unsafeDb }>(
    "lesson.plan",
    async ({ payload, workspaceId, jobId, progress, deps }) => {
      try {
        await progress(100, "planned (stub)");
      } finally {
        await clearGenerating(forWorkspace(deps.db, workspaceId), payload.lessonId, jobId);
        released.push(payload.lessonId);
      }
    },
  );
  const registry: JobRegistry<{ db: typeof unsafeDb }> = {
    ping: defineJob("ping", async () => {}),
    "ai.ping": defineJob("ai.ping", async () => {}),
    "lesson.plan": lessonPlanJob,
  };

  const headers = (ws: WorkspaceId, extra: Record<string, string> = {}) => ({
    [WORKSPACE_HEADER]: ws,
    ...extra,
  });
  const postLesson = (ws: WorkspaceId, body: unknown) =>
    app.request("/lessons", {
      method: "POST",
      headers: headers(ws, { "content-type": "application/json" }),
      body: JSON.stringify(body),
    });
  const errorOf = async (res: Response) => ((await res.json()) as ErrorEnvelope).error;
  async function waitFor(pred: () => boolean | Promise<boolean>, timeoutMs = 10_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await pred()) return true;
      await Bun.sleep(25);
    }
    return pred();
  }

  beforeAll(async () => {
    boss = createBoss(url, { schema: "pgboss_test", max: 2, applicationName: "tj-api-lessons" });
    boss.on("error", (err) => console.error("pg-boss error", err));
    await boss.start();
    await ensureQueues(boss);
    jobsCtx = { boss, db: unsafeDb, sql };
    await boss.work(
      "lesson.plan",
      { batchSize: 1, includeMetadata: true, perJobResults: true, pollingIntervalSeconds: 0.5 },
      async (jobs) => {
        const results: RunJobOutcome[] = [];
        for (const job of jobs as BossJob[]) {
          results.push(
            await runJob(jobsCtx, "lesson.plan", registry, job, {
              shutdown: shutdown.signal,
              logger: silentLogger,
              deps: { db: unsafeDb },
            }),
          );
        }
        return results;
      },
    );
  });

  afterAll(async () => {
    shutdown.abort();
    await boss.offWork("lesson.plan");
    await boss.stop({ graceful: false, close: true });
    await close();
  });

  beforeEach(async () => {
    wsA = newId<WorkspaceId>();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: wsA, workspaceName: "A" });
    runtime = createEventsRuntime({
      jobs: jobsCtx,
      databaseUrl: url,
      logger: silentLogger,
      config: { heartbeatMs: 50, pollMs: 200, maxStreamsPerWorkspace: 2 },
    });
    app = createApp({
      env: TEST_ENV,
      db: t.db,
      logger: silentLogger,
      jobs: jobsCtx,
      events: runtime,
      rateLimit: { limit: 3, windowMs: 60_000 },
    });
  });

  afterEach(async () => {
    await runtime.stop();
  });

  test("202 { lessonId, jobId }: the row carries the brief, defaults and the lock; the job clears it", async () => {
    const res = await postLesson(wsA, {
      brief: { topic: "Fractions of amounts" },
      yearGroup: "Year 5",
    });
    expect(res.status).toBe(202);
    const { lessonId, jobId } = (await res.json()) as { lessonId: LessonId; jobId: JobId };
    expect(lessonId).toMatch(/^[0-9a-f-]{36}$/);
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);

    const ws = forWorkspace(unsafeDb, wsA);
    const row = await getDocument(ws, lessonId);
    expect(row).not.toBeNull();
    const body = row?.body as Lesson;
    expect(row).toMatchObject({
      kind: "lesson",
      title: "Fractions of amounts",
      yearGroup: "Year 5",
      itemCount: 0,
      cover: null,
    });
    expect(body).toMatchObject({
      id: lessonId,
      title: "Fractions of amounts",
      slides: [],
      yearGroup: "Year 5",
      ageBand: "ks2",
      language: "en-GB",
      brief: { topic: "Fractions of amounts", durationMin: 60 },
    });
    // The lock is either still held by this job or already released by the worker loop.
    expect([jobId as string, null]).toContain(row?.generatingJobId ?? null);

    // The job runs to completion and releases the lock.
    expect(
      await waitFor(async () => (await getDocument(ws, lessonId))?.generatingJobId === null),
    ).toBe(true);
    expect(released).toContain(lessonId);
    const events = await listJobEvents(unsafeDb, { workspaceId: wsA, jobId, limit: 20 });
    expect(events.map((e) => e.type)).toEqual(["queued", "started", "progress", "completed"]);
  });

  test("explicit duration and class context are kept; no year group means no age band", async () => {
    const res = await postLesson(wsA, {
      brief: { topic: "Phonics warm-up", durationMin: 45, classContext: { sizeBand: "25to30" } },
    });
    expect(res.status).toBe(202);
    const { lessonId } = (await res.json()) as { lessonId: LessonId };
    const body = (await getDocument(forWorkspace(unsafeDb, wsA), lessonId))?.body as Lesson;
    expect(body.ageBand).toBeUndefined();
    expect(body.brief).toEqual({
      topic: "Phonics warm-up",
      durationMin: 45,
      classContext: { sizeBand: "25to30" },
    });
  });

  test("a PUT while the lock is held is 409 generating", async () => {
    // Hold the worker off by locking manually: create through the route, then re-lock the row with
    // a job id the loop never runs, so the check is deterministic regardless of timing.
    const res = await postLesson(wsA, { brief: { topic: "Roman Britain" }, yearGroup: "Year 4" });
    const { lessonId } = (await res.json()) as { lessonId: LessonId };
    const ws = forWorkspace(unsafeDb, wsA);
    await waitFor(async () => (await getDocument(ws, lessonId))?.generatingJobId === null);
    const holder = newId<JobId>();
    await sql`update documents set generating_job_id = ${holder} where id = ${lessonId}`;
    const row = await getDocument(ws, lessonId);
    if (!row) throw new Error("row vanished");

    const put = await app.request(`/documents/${lessonId}`, {
      method: "PUT",
      headers: headers(wsA, { "content-type": "application/json" }),
      body: JSON.stringify({
        document: { ...row.body, title: "Edited" },
        expectedUpdatedAt: row.updatedAt.toISOString(),
      }),
    });
    expect(put.status).toBe(409);
    expect(await errorOf(put)).toMatchObject({ code: "conflict", reason: "generating" });
  });

  test("the model-call limiter answers 429 after the allowance", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await postLesson(wsA, { brief: { topic: `Topic ${i}` } })).status).toBe(202);
    }
    const limited = await postLesson(wsA, { brief: { topic: "One too many" } });
    expect(limited.status).toBe(429);
    expect(await errorOf(limited)).toMatchObject({ code: "rate_limited", retryable: true });
  });

  test("the lesson is listed for its Workspace and invisible to another", async () => {
    const res = await postLesson(wsA, { brief: { topic: "Listed" } });
    const { lessonId } = (await res.json()) as { lessonId: LessonId };
    const list = (await (
      await app.request("/documents?kind=lesson", { headers: headers(wsA) })
    ).json()) as { items: { id: string }[] };
    expect(list.items.map((i) => i.id)).toEqual([lessonId]);
    const wsB = newId<WorkspaceId>();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: wsB });
    const foreign = await app.request(`/documents/${lessonId}`, { headers: headers(wsB) });
    expect(foreign.status).toBe(404);
  });
});
