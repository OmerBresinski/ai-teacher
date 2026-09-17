/**
 * Integration: `POST /lessons` against TEST_DATABASE_URL with a real pg-boss (schema
 * `pgboss_test_lessons`) and an in-test worker loop running a `lesson.plan` stand-in that mirrors
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
  putDocumentAsJob,
} from "@tj/db";
import { createTestUserWithWorkspace, withTestDb } from "@tj/db/testing";
import { type JobId, type LessonId, newId, storageKey, type WorkspaceId } from "@tj/domain";
import type { Lesson, LessonFacts } from "@tj/domain/documents";
import { generatedLesson, generatedWorksheet, lessonFacts } from "@tj/domain/documents/fixtures";
import {
  type BossJob,
  createBoss,
  defineJob,
  ensureQueues,
  type JobData,
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
  /** Lessons whose plan job this loop runs without releasing the lock ("still planning"). */
  const holding = new Set<string>();

  /** Same contract as `apps/worker/src/jobs/lesson-plan.ts` (apps may not import apps). */
  const lessonPlanJob = defineJob<"lesson.plan", { db: typeof unsafeDb }>(
    "lesson.plan",
    async ({ payload, workspaceId, jobId, progress, deps }) => {
      if (holding.has(payload.lessonId)) return;
      try {
        await progress(100, "planned (stub)", { stage: "plan" });
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
    "lesson.generate": defineJob("lesson.generate", async () => {}),
    "lesson.worksheet": defineJob("lesson.worksheet", async () => {}),
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
    // Its own pg-boss schema: the worker's integration suite runs `lesson.plan` jobs in
    // `pgboss_test` at the same time, and this suite's stub loop must not take them.
    boss = createBoss(url, {
      schema: "pgboss_test_lessons",
      max: 2,
      applicationName: "tj-api-lessons",
    });
    boss.on("error", (err) => console.error("pg-boss error", err));
    await boss.start();
    await ensureQueues(boss);
    // Jobs an earlier run left queued would be worked first and hold up the lock assertions.
    for (const name of ["lesson.plan", "lesson.generate"] as const) await boss.deleteAllJobs(name);
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

  const jobData = async (name: "lesson.plan" | "lesson.generate", id: string) => {
    const [row] = await boss.findJobs<JobData>(name, { id });
    return row?.data;
  };

  test("202 { lessonId, jobId, revision: 1 }: the row carries the brief, defaults, plan and lock; the job clears it", async () => {
    const res = await postLesson(wsA, {
      brief: { topic: "Fractions of amounts" },
      yearGroup: "Year 5",
    });
    expect(res.status).toBe(202);
    const created = (await res.json()) as { lessonId: LessonId; jobId: JobId; revision: number };
    const { lessonId, jobId } = created;
    expect(lessonId).toMatch(/^[0-9a-f-]{36}$/);
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.revision).toBe(1);
    // ADR 0029: revision 1 belongs to this job, and the job stops at the plan screen.
    expect(
      ((await getDocument(forWorkspace(unsafeDb, wsA), lessonId))?.body as Lesson | undefined)
        ?.plan,
    ).toEqual({ revision: 1, state: "proposed", jobId });
    expect((await jobData("lesson.plan", jobId))?.payload).toEqual({
      lessonId,
      revision: 1,
      stopAfter: "planned",
    });

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
    expect(row?.continueWhenPlanned).toBe(false);
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

  test("skipPlanning: one job to the end, confirmed up front, continue_when_planned set", async () => {
    const res = await postLesson(wsA, { brief: { topic: "Volcanoes" }, skipPlanning: true });
    expect(res.status).toBe(202);
    const { lessonId, jobId } = (await res.json()) as { lessonId: LessonId; jobId: JobId };
    expect((await jobData("lesson.plan", jobId))?.payload).toEqual({ lessonId, revision: 1 });
    const row = await getDocument(forWorkspace(unsafeDb, wsA), lessonId);
    expect(row?.continueWhenPlanned).toBe(true);
    expect((row?.body as Lesson | undefined)?.plan).toMatchObject({
      revision: 1,
      state: "confirmed",
      jobId,
    });
  });

  test("the same requestId twice answers the first lesson; one row, one job", async () => {
    const requestId = newId();
    const body = { brief: { topic: "Magnets" }, requestId };
    const first = (await (await postLesson(wsA, body)).json()) as { lessonId: string };
    const again = await postLesson(wsA, body);
    expect(again.status).toBe(202);
    const second = (await again.json()) as { lessonId: string; jobId: string; revision: number };
    expect(second.lessonId).toBe(first.lessonId);
    // The first job may have finished: the answer names the plan's job then.
    expect(second).toMatchObject(first);
    expect(second.revision).toBe(1);
    const [{ n }] =
      (await sql`select count(*)::int as n from documents where workspace_id = ${wsA}`) as [
        { n: number },
      ];
    expect(n).toBe(1);
    // Another Workspace may use the same key for its own lesson.
    const foreign = (await (await postLesson(wsB, body)).json()) as { lessonId: string };
    expect(foreign.lessonId).not.toBe(first.lessonId);
  });

  test("two concurrent requests with one requestId create one lesson", async () => {
    const body = { brief: { topic: "Light" }, requestId: newId() };
    const [a, b] = await Promise.all([postLesson(wsA, body), postLesson(wsA, body)]);
    expect([a.status, b.status]).toEqual([202, 202]);
    const [ja, jb] = (await Promise.all([a.json(), b.json()])) as { lessonId: string }[];
    expect(ja?.lessonId).toBe(jb?.lessonId as string);
    const [{ n }] =
      (await sql`select count(*)::int as n from documents where workspace_id = ${wsA}`) as [
        { n: number },
      ];
    expect(n).toBe(1);
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
      slideCount: 10,
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
      for (const path of ["plan", "generate"]) {
        const res = await postJson(wsA, `/lessons/${lessonId}/${path}`, {
          expectedRevision: 1,
          ...(path === "plan" ? { brief: { topic: "x" } } : { objectives: [{ text: "x" }] }),
        });
        expect(res.status).toBe(429);
      }
    });
  });

  describe("POST /lessons/:id/plan and /generate (ADR 0029)", () => {
    const postJson = (ws: WorkspaceId, path: string, body: unknown) =>
      app.request(path, {
        method: "POST",
        headers: headers(ws, { "content-type": "application/json" }),
        body: JSON.stringify(body),
      });
    const bodyOf = async (ws: WorkspaceId, id: string) =>
      (await getDocument(forWorkspace(unsafeDb, ws), id))?.body as Lesson;
    const objectivesOf = (lesson: Lesson) =>
      (lesson.facts?.objectives ?? []).map(({ id, text }) => ({ id, text }));

    /** Vocabulary v1 serves o1 only and v2 serves o2 only. */
    const facts = (): LessonFacts => {
      const base = lessonFacts();
      return {
        ...base,
        vocabulary: base.vocabulary.map((v, i) => ({ ...v, objectiveRefs: [`o${i + 1}`] })),
      };
    };

    /**
     * A lesson at `planned`, as the plan job leaves it. `lockedBy` keeps the row locked (the plan
     * job still running); `state`/`revision` set the plan.
     */
    async function seedPlanned(
      opts: {
        ws?: WorkspaceId;
        revision?: number;
        state?: "proposed" | "confirmed";
        lockedBy?: JobId;
        stage?: "planned" | "repaired";
        sources?: Lesson["sources"];
      } = {},
    ) {
      const { artefacts: _artefacts, ...base } = generatedLesson();
      const planJobId = opts.lockedBy ?? newId<JobId>();
      const lesson: Lesson = {
        ...base,
        brief: { topic: "The water cycle", durationMin: 60, slideCount: 10 },
        facts: facts(),
        generation: {
          ...(base.generation as NonNullable<Lesson["generation"]>),
          stage: opts.stage ?? "planned",
        },
        plan: { revision: opts.revision ?? 1, state: opts.state ?? "proposed", jobId: planJobId },
        ...(opts.sources ? { sources: opts.sources } : {}),
      };
      const row = await createDocument(forWorkspace(unsafeDb, opts.ws ?? wsA), "lesson", lesson, {
        generatingJobId: opts.lockedBy,
      });
      return { lessonId: row.id as LessonId, planJobId, row };
    }

    async function source(ws: WorkspaceId, lessonId?: string) {
      const id = newId();
      const scoped = forWorkspace(unsafeDb, ws);
      await createSource(scoped, {
        id,
        kind: "file",
        name: "rocks.pdf",
        mime: "application/pdf",
        byteSize: 10,
        storageKey: storageKey(ws, "sources", id, "original.pdf"),
        pages: 2,
        lowText: false,
      });
      if (lessonId) await sql`update sources set lesson_id = ${lessonId} where id = ${id}`;
      return id;
    }

    test("a running plan job is superseded: revision 2, new lock, facts cleared, old job cancelled", async () => {
      const oldJobId = newId<JobId>();
      const { lessonId } = await seedPlanned({ lockedBy: oldJobId });
      // The old job is queued but held back, so the cancel finds it waiting.
      await boss.send(
        "lesson.plan",
        { jobId: oldJobId, workspaceId: wsA, payload: { lessonId, revision: 1 } },
        { id: oldJobId, startAfter: 3600 },
      );
      holding.add(lessonId);

      const res = await postJson(wsA, `/lessons/${lessonId}/plan`, {
        expectedRevision: 1,
        brief: { topic: "Volcanoes" },
      });
      expect(res.status).toBe(202);
      const { jobId, revision } = (await res.json()) as { jobId: JobId; revision: number };
      expect(revision).toBe(2);

      const ws = forWorkspace(unsafeDb, wsA);
      const row = await getDocument(ws, lessonId);
      expect(row?.generatingJobId).toBe(jobId);
      const body = row?.body as Lesson;
      expect(body.plan).toEqual({ revision: 2, state: "proposed", jobId });
      expect(body.facts).toBeUndefined();
      expect(body.generation).toBeUndefined();
      expect(body.title).toBe("Volcanoes");
      expect((await jobData("lesson.plan", jobId))?.payload).toEqual({
        lessonId,
        revision: 2,
        stopAfter: "planned",
      });
      // The superseded job: cancelled in pg-boss, and its next write is refused.
      const [old] = await boss.findJobs("lesson.plan", { id: oldJobId });
      expect(old?.state).toBe("cancelled");
      expect(await putDocumentAsJob(ws, lessonId, { ...body, title: "late" }, oldJobId)).toEqual({
        status: "lost_lock",
      });
      expect((await getDocument(ws, lessonId))?.body).toEqual(row?.body);
    });

    test("the same topic keeps the objectives: pinned re-plan", async () => {
      const { lessonId } = await seedPlanned();
      holding.add(lessonId);
      const res = await postJson(wsA, `/lessons/${lessonId}/plan`, {
        expectedRevision: 1,
        brief: { topic: "The water cycle", level: "harder" },
      });
      expect(res.status).toBe(202);
      const { jobId } = (await res.json()) as { jobId: JobId };
      expect((await jobData("lesson.plan", jobId))?.payload).toEqual({
        lessonId,
        revision: 2,
        stopAfter: "planned",
        pinObjectives: true,
      });
      const body = await bodyOf(wsA, lessonId);
      expect(body.facts?.objectives).toEqual(facts().objectives);
      expect(body.facts?.outline).toEqual([]);
      expect(body.brief?.level).toBe("harder");
    });

    test("a new Source list binds the added ones and releases the dropped ones", async () => {
      const kept = await source(wsA);
      const dropped = await source(wsA);
      const { lessonId } = await seedPlanned({
        sources: [
          { id: kept, kind: "file", name: "rocks.pdf", pages: 2 },
          { id: dropped, kind: "file", name: "rocks.pdf", pages: 2 },
        ],
      });
      await sql`update sources set lesson_id = ${lessonId} where id in ${sql([kept, dropped])}`;
      const added = await source(wsA);
      holding.add(lessonId);

      const res = await postJson(wsA, `/lessons/${lessonId}/plan`, {
        expectedRevision: 1,
        brief: { topic: "The water cycle" },
        sourceIds: [kept, added],
      });
      expect(res.status).toBe(202);
      const ws = forWorkspace(unsafeDb, wsA);
      const body = await bodyOf(wsA, lessonId);
      expect(body.sources?.map((s) => s.id)).toEqual([kept, added]);
      expect(body.facts).toBeUndefined();
      expect((await getSource(ws, added))?.lessonId).toBe(lessonId);
      expect((await getSource(ws, kept))?.lessonId).toBe(lessonId);
      expect((await getSource(ws, dropped))?.lessonId).toBeNull();
    });

    test("an unavailable Source is 422 and nothing changes", async () => {
      const { lessonId, row } = await seedPlanned();
      const other = await source(wsA, newId());
      const res = await postJson(wsA, `/lessons/${lessonId}/plan`, {
        expectedRevision: 1,
        brief: { topic: "The water cycle" },
        sourceIds: [other],
      });
      expect(res.status).toBe(422);
      const after = await getDocument(forWorkspace(unsafeDb, wsA), lessonId);
      expect(after?.body).toEqual(row.body);
      expect(after?.generatingJobId).toBeNull();
    });

    test("a stale expectedRevision is 409 stale with the current revision, on both routes", async () => {
      const { lessonId, row } = await seedPlanned({ revision: 2 });
      const plan = await postJson(wsA, `/lessons/${lessonId}/plan`, {
        expectedRevision: 1,
        brief: { topic: "The water cycle" },
      });
      expect(plan.status).toBe(409);
      expect(await errorOf(plan)).toMatchObject({ reason: "stale", revision: 2 });
      const generate = await postJson(wsA, `/lessons/${lessonId}/generate`, {
        expectedRevision: 1,
        objectives: objectivesOf(row.body as Lesson),
      });
      expect(generate.status).toBe(409);
      expect(await errorOf(generate)).toMatchObject({ reason: "stale", revision: 2 });
      expect((await getDocument(forWorkspace(unsafeDb, wsA), lessonId))?.body).toEqual(row.body);
    });

    test("generate while the plan job holds the lock is 409 planning", async () => {
      const holder = newId<JobId>();
      const { lessonId, row } = await seedPlanned({ lockedBy: holder });
      const res = await postJson(wsA, `/lessons/${lessonId}/generate`, {
        expectedRevision: 1,
        objectives: objectivesOf(row.body as Lesson),
      });
      expect(res.status).toBe(409);
      expect(await errorOf(res)).toMatchObject({
        code: "conflict",
        reason: "planning",
        jobId: holder,
        revision: 1,
      });
    });

    test("a text-only edit confirms the plan and queues lesson.generate; the revision stays", async () => {
      const { lessonId, row } = await seedPlanned();
      const objectives = objectivesOf(row.body as Lesson).map((o, i) =>
        i === 0 ? { ...o, text: "Name the stages of the water cycle" } : o,
      );
      const res = await postJson(wsA, `/lessons/${lessonId}/generate`, {
        expectedRevision: 1,
        objectives,
      });
      expect(res.status).toBe(202);
      const { jobId, revision } = (await res.json()) as { jobId: JobId; revision: number };
      expect(revision).toBe(1);
      const after = await getDocument(forWorkspace(unsafeDb, wsA), lessonId);
      expect(after?.generatingJobId).toBe(jobId);
      const body = after?.body as Lesson;
      expect(body.facts?.objectives[0]?.text).toBe("Name the stages of the water cycle");
      expect(body.plan).toMatchObject({ revision: 1, state: "confirmed", jobId });
      expect(body.plan?.confirmedAt).toBeDefined();
      expect(body.generation?.stage).toBe("planned");
      expect(await jobData("lesson.generate", jobId)).toMatchObject({
        jobId,
        workspaceId: wsA,
        payload: { lessonId, revision: 1 },
      });
      const events = await listJobEvents(unsafeDb, { workspaceId: wsA, jobId, limit: 5 });
      expect(events.map((e) => e.type)).toEqual(["queued"]);

      // Pressing again: the plan is confirmed and a job owns the row.
      const again = await postJson(wsA, `/lessons/${lessonId}/generate`, {
        expectedRevision: 1,
        objectives,
      });
      expect(again.status).toBe(409);
      expect(await errorOf(again)).toMatchObject({ reason: "generating", jobId });
    });

    test("a removed objective re-plans pinned with no stopAfter; facts serving only it are gone", async () => {
      const { lessonId, row } = await seedPlanned();
      holding.add(lessonId);
      const res = await postJson(wsA, `/lessons/${lessonId}/generate`, {
        expectedRevision: 1,
        objectives: objectivesOf(row.body as Lesson).slice(0, 1),
      });
      expect(res.status).toBe(202);
      const { jobId, revision } = (await res.json()) as { jobId: JobId; revision: number };
      expect(revision).toBe(2);
      expect((await jobData("lesson.plan", jobId))?.payload).toEqual({
        lessonId,
        revision: 2,
        pinObjectives: true,
      });
      const body = await bodyOf(wsA, lessonId);
      expect(body.facts?.objectives.map((o) => o.id)).toEqual(["o1"]);
      expect(body.facts?.vocabulary.map((v) => v.id)).toEqual(["v1"]);
      expect(body.facts?.outline).toEqual([]);
      expect(body.generation).toBeUndefined();
      expect(body.plan).toMatchObject({ revision: 2, state: "confirmed", jobId });
    });

    test("a new slide count takes the same pinned re-plan and updates the brief", async () => {
      const { lessonId, row } = await seedPlanned();
      holding.add(lessonId);
      const res = await postJson(wsA, `/lessons/${lessonId}/generate`, {
        expectedRevision: 1,
        objectives: objectivesOf(row.body as Lesson),
        slideCount: 8,
      });
      expect(res.status).toBe(202);
      const { jobId } = (await res.json()) as { jobId: JobId };
      expect((await jobData("lesson.plan", jobId))?.payload).toEqual({
        lessonId,
        revision: 2,
        pinObjectives: true,
      });
      const body = await bodyOf(wsA, lessonId);
      expect(body.brief?.slideCount).toBe(8);
      expect(body.facts?.objectives).toEqual(facts().objectives);
    });

    test("a confirmed plan cannot be re-planned: 409 generating", async () => {
      const { lessonId } = await seedPlanned({ state: "confirmed", stage: "repaired" });
      const res = await postJson(wsA, `/lessons/${lessonId}/plan`, {
        expectedRevision: 1,
        brief: { topic: "The water cycle" },
      });
      expect(res.status).toBe(409);
      expect(await errorOf(res)).toMatchObject({ reason: "generating", revision: 1 });
      expect(
        (await getDocument(forWorkspace(unsafeDb, wsA), lessonId))?.generatingJobId,
      ).toBeNull();
    });

    test("generate before the plan reached planned is 422; with no objectives it is 422", async () => {
      const { lessonId, row } = await seedPlanned();
      await sql`update documents set body = body - 'generation' where id = ${lessonId}`;
      const res = await postJson(wsA, `/lessons/${lessonId}/generate`, {
        expectedRevision: 1,
        objectives: objectivesOf(row.body as Lesson),
      });
      expect(res.status).toBe(422);
      const empty = await postJson(wsA, `/lessons/${lessonId}/generate`, {
        expectedRevision: 1,
        objectives: [],
      });
      expect(empty.status).toBe(422);
      expect(
        (await getDocument(forWorkspace(unsafeDb, wsA), lessonId))?.generatingJobId,
      ).toBeNull();
    });

    test("404 for an unknown id, a worksheet and another Workspace's lesson", async () => {
      const { lessonId } = await seedPlanned();
      const sheet = await createDocument(
        forWorkspace(unsafeDb, wsA),
        "worksheet",
        generatedWorksheet(),
      );
      // Nine requests: more than the suite's limit of three.
      const roomy = createApp({
        env: TEST_ENV,
        db: t.db,
        logger: silentLogger,
        jobs: jobsCtx,
        events: runtime,
      });
      const request = (ws: WorkspaceId, path: string, body: unknown) =>
        roomy.request(path, {
          method: "POST",
          headers: headers(ws, { "content-type": "application/json" }),
          body: JSON.stringify(body),
        });
      const plan = { expectedRevision: 1, brief: { topic: "x" } };
      const generate = { expectedRevision: 1, objectives: [{ id: "o1", text: "x" }] };
      for (const [ws, id] of [
        [wsA, newId()],
        [wsA, sheet.id],
        [wsB, lessonId],
      ] as const) {
        expect((await request(ws, `/lessons/${id}/plan`, plan)).status).toBe(404);
        expect((await request(ws, `/lessons/${id}/generate`, generate)).status).toBe(404);
      }
    });

    test("an enqueue that fails puts the plan back and releases the lock: 503", async () => {
      const { lessonId, row } = await seedPlanned();
      const down = Object.create(boss) as PgBoss;
      down.send = (async () => {
        throw new Error("pg-boss down");
      }) as PgBoss["send"];
      const failing = createApp({
        env: TEST_ENV,
        db: t.db,
        logger: silentLogger,
        jobs: { ...jobsCtx, boss: down },
      });
      const res = await failing.request(`/lessons/${lessonId}/generate`, {
        method: "POST",
        headers: headers(wsA, { "content-type": "application/json" }),
        body: JSON.stringify({ expectedRevision: 1, objectives: objectivesOf(row.body as Lesson) }),
      });
      expect(res.status).toBe(503);
      const after = await getDocument(forWorkspace(unsafeDb, wsA), lessonId);
      expect(after?.generatingJobId).toBeNull();
      expect((after?.body as Lesson | undefined)?.plan).toEqual((row.body as Lesson).plan);
      expect((after?.body as Lesson | undefined)?.facts).toEqual((row.body as Lesson).facts);
    });

    test("31 calls a minute to /generate hit the default model-call limit", async () => {
      const limited = createApp({ env: TEST_ENV, db: t.db, logger: silentLogger, jobs: jobsCtx });
      const path = `/lessons/${newId()}/generate`;
      const call = () =>
        limited.request(path, {
          method: "POST",
          headers: headers(wsA, { "content-type": "application/json" }),
          body: JSON.stringify({ expectedRevision: 1, objectives: [{ text: "x" }] }),
        });
      for (let i = 0; i < 30; i++) expect((await call()).status).toBe(404);
      const over = await call();
      expect(over.status).toBe(429);
      expect(await errorOf(over)).toMatchObject({ code: "rate_limited" });
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
