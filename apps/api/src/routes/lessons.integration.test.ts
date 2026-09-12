/**
 * Integration: `POST /lessons` against TEST_DATABASE_URL with a real pg-boss (schema
 * `pgboss_test`) and an in-test worker loop running a `lesson.plan` stand-in that mirrors
 * `apps/worker` (progress, then `clearGenerating`). Skips visibly when the database is unreachable.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  clearGenerating,
  createDocument,
  createSource,
  forWorkspace,
  getDocument,
  getSource,
  listJobEvents,
} from "@tj/db";
import { createTestUserWithWorkspace, withTestDb } from "@tj/db/testing";
import { type JobId, type LessonId, newId, storageKey, type WorkspaceId } from "@tj/domain";
import type { Lesson } from "@tj/domain/documents";
import { generatedLesson, generatedWorksheet } from "@tj/domain/documents/fixtures";
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
  let wsB: WorkspaceId;
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
    "lesson.cascade": defineJob("lesson.cascade", async () => {}),
    "lesson.regenerate": defineJob("lesson.regenerate", async () => {}),
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
    wsB = newId<WorkspaceId>();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: wsA, workspaceName: "A" });
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: wsB, workspaceName: "B" });
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

    // The job runs to completion and releases the lock. Wait for the terminal event, not the
    // lock: the handler clears the lock in its `finally`, and `runJob` writes `completed` only
    // after that (progress flush, cancel re-read, insert) — polling the lock alone raced it.
    const eventsFor = () => listJobEvents(unsafeDb, { workspaceId: wsA, jobId, limit: 20 });
    expect(await waitFor(async () => (await eventsFor()).some((e) => e.type === "completed"))).toBe(
      true,
    );
    expect((await getDocument(ws, lessonId))?.generatingJobId).toBeNull();
    expect(released).toContain(lessonId);
    expect((await eventsFor()).map((e) => e.type)).toEqual([
      "queued",
      "started",
      "progress",
      "completed",
    ]);
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

  describe("sourceIds (ADR 0027 §5)", () => {
    async function source(ws: WorkspaceId) {
      const id = newId();
      await createSource(forWorkspace(unsafeDb, ws), {
        id,
        kind: "file",
        name: "plants.pdf",
        mime: "application/pdf",
        byteSize: 10,
        storageKey: storageKey(ws, "sources", id, "original.pdf"),
        pages: 2,
        lowText: false,
      });
      return id;
    }

    test("claims the Sources in the same transaction and writes them as lesson.sources", async () => {
      const a = await source(wsA);
      const b = await source(wsA);
      const res = await postLesson(wsA, { brief: { topic: "Plants" }, sourceIds: [a, b] });
      expect(res.status).toBe(202);
      const { lessonId } = (await res.json()) as { lessonId: LessonId };
      const ws = forWorkspace(unsafeDb, wsA);
      const body = (await getDocument(ws, lessonId))?.body as Lesson;
      expect(body.sources?.map((s) => s.id)).toEqual([a, b]);
      expect(body.sources?.[0]).toMatchObject({ kind: "file", name: "plants.pdf", pages: 2 });
      expect((await getSource(ws, a))?.lessonId).toBe(lessonId);
      expect((await getSource(ws, b))?.lessonId).toBe(lessonId);
    });

    test.each([
      [
        "already bound",
        async () => {
          const a = await source(wsA);
          await postLesson(wsA, { brief: { topic: "First" }, sourceIds: [a] });
          return a;
        },
      ],
      ["another Workspace's", () => source(wsB)],
      ["unknown", async () => newId()],
    ])("a %s id is 422 and nothing is written", async (_label, make) => {
      const id = await make();
      const ok = await source(wsA);
      const before = (
        await sql`select count(*)::int as n from documents where workspace_id = ${wsA}`
      )[0]?.n;
      const res = await postLesson(wsA, { brief: { topic: "Plants" }, sourceIds: [ok, id] });
      expect(res.status).toBe(422);
      expect((await errorOf(res)).message).toBe(
        "One of the uploaded files is no longer available.",
      );
      const after = (
        await sql`select count(*)::int as n from documents where workspace_id = ${wsA}`
      )[0]?.n;
      expect(after).toBe(before);
      // The good Source was not claimed either: the transaction rolled back.
      expect((await getSource(forWorkspace(unsafeDb, wsA), ok))?.lessonId).toBeNull();
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

  describe("POST /lessons/:id/cascade and /regenerate (ADR 0025 §18)", () => {
    const postJson = (ws: WorkspaceId, path: string, body: unknown) =>
      app.request(path, {
        method: "POST",
        headers: headers(ws, { "content-type": "application/json" }),
        body: JSON.stringify(body),
      });

    /** A generated lesson row, unlocked, in `wsA`. */
    async function seedGenerated() {
      const ws = forWorkspace(unsafeDb, wsA);
      const row = await createDocument(ws, "lesson", generatedLesson());
      return row.id as LessonId;
    }

    test("202 { jobId }: a queued event exists; the same job again while queued is 409", async () => {
      const lessonId = await seedGenerated();
      const res = await postJson(wsA, `/lessons/${lessonId}/cascade`, { changedFactIds: ["o2"] });
      expect(res.status).toBe(202);
      const { jobId } = (await res.json()) as { jobId: JobId };
      expect(jobId).toMatch(/^[0-9a-f-]{36}$/);
      const events = await listJobEvents(unsafeDb, { workspaceId: wsA, jobId, limit: 5 });
      expect(events.map((e) => e.type)).toEqual(["queued"]);
      // Inside the debounce slot the same job for the same lesson is refused.
      const again = await postJson(wsA, `/lessons/${lessonId}/cascade`, { changedFactIds: ["o1"] });
      expect(again.status).toBe(409);
      // A different job for the same lesson is not deduplicated against it.
      const regen = await postJson(wsA, `/lessons/${lessonId}/regenerate`, {
        targets: [{ slideId: "s-mc" }],
      });
      expect(regen.status).toBe(202);
      // The lesson row was not locked or written.
      const row = await getDocument(forWorkspace(unsafeDb, wsA), lessonId);
      expect(row?.generatingJobId).toBeNull();
    });

    test("404 for an unknown id, a worksheet id and another Workspace's lesson", async () => {
      const ws = forWorkspace(unsafeDb, wsA);
      expect(
        (await postJson(wsA, `/lessons/${newId()}/cascade`, { changedFactIds: ["o1"] })).status,
      ).toBe(404);
      const sheet = await createDocument(ws, "worksheet", generatedWorksheet());
      expect(
        (await postJson(wsA, `/lessons/${sheet.id}/cascade`, { changedFactIds: ["o1"] })).status,
      ).toBe(404);
      const lessonId = await seedGenerated();
      const wsB = newId<WorkspaceId>();
      await createTestUserWithWorkspace(unsafeDb, { workspaceId: wsB });
      expect(
        (await postJson(wsB, `/lessons/${lessonId}/cascade`, { changedFactIds: ["o1"] })).status,
      ).toBe(404);
    });

    test("409 generating while a pipeline holds the lock", async () => {
      const ws = forWorkspace(unsafeDb, wsA);
      const row = await createDocument(ws, "lesson", generatedLesson(), {
        generatingJobId: newId<JobId>(),
      });
      const res = await postJson(wsA, `/lessons/${row.id}/regenerate`, {
        targets: [{ slideId: "s-mc" }],
      });
      expect(res.status).toBe(409);
      expect(await errorOf(res)).toMatchObject({ code: "conflict", reason: "generating" });
    });

    test("the model-call limiter covers the sub-paths", async () => {
      const lessonId = await seedGenerated();
      for (let i = 0; i < 3; i++) {
        expect((await postLesson(wsA, { brief: { topic: `Topic ${i}` } })).status).toBe(202);
      }
      const limited = await postJson(wsA, `/lessons/${lessonId}/cascade`, {
        changedFactIds: ["o1"],
      });
      expect(limited.status).toBe(429);
    });
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
