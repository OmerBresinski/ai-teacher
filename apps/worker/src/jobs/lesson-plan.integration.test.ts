/**
 * Integration: `lesson.plan` and `lesson.generate` on a real pg-boss loop (schema `pgboss_test`)
 * against TEST_DATABASE_URL, with the worker's own registry and a scripted fake provider (ADR 0025
 * §22, ADR 0029).
 * Mirrors `apps/api/src/routes/lessons.integration.test.ts` (apps may not import apps). Skips
 * visibly when the database is unreachable.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import {
  createDocument,
  forWorkspace,
  getDocument,
  listJobEvents,
  setPlanRevisionAndLock,
} from "@tj/db";
import { createTestUserWithWorkspace, withTestDb } from "@tj/db/testing";
import {
  JOB_PROGRESS_STAGES,
  type JobId,
  type JobName,
  type LessonId,
  newId,
  type WorkspaceId,
} from "@tj/domain";
import { type Lesson, lessonFromBrief, parseLesson } from "@tj/domain/documents";
import {
  FIXTURES,
  PLAN_INDEX,
  pipelineScript,
  routed,
  scriptedPipelineAi,
} from "@tj/generation/testing";
import {
  type BossJob,
  createBoss,
  enqueue,
  ensureQueues,
  type JobsContext,
  type RunJobOutcome,
  runJob,
} from "@tj/jobs";
import type { PgBoss } from "pg-boss";
import pino from "pino";
import type { WorkerDeps } from "../deps";
import { memoryStorage } from "../testing/memory-storage";
import { registry } from "./index";

const t = await withTestDb({ max: 4 });
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping lesson.plan integration tests: ${t.reason}`);

describeDb("lesson.plan on pg-boss", () => {
  if (!t.ok) return;
  const { unsafeDb, sql, close, url, truncateTenantTables } = t.db;
  let boss: PgBoss;
  let ctx: JobsContext;
  let workspaceId: WorkspaceId;
  const outcomes: RunJobOutcome[] = [];
  const shutdown = new AbortController();
  /** Every log line the worker wrote, as parsed JSON, for the summary and no-content assertions. */
  const lines: Record<string, unknown>[] = [];
  const logger = pino(
    { level: "debug" },
    {
      write: (chunk: string) => {
        for (const line of chunk.split("\n")) if (line) lines.push(JSON.parse(line));
      },
    },
  );
  const deps: WorkerDeps = {
    ai: scriptedPipelineAi(),
    db: unsafeDb,
    caps: { capUsd: 5, capTokens: 1_000_000 },
    storage: memoryStorage(),
  };
  const QUEUES = ["lesson.plan", "lesson.generate"] as const satisfies readonly JobName[];

  async function waitFor(pred: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await pred()) return true;
      await Bun.sleep(50);
    }
    return pred();
  }
  const eventsFor = (jobId: JobId) => listJobEvents(unsafeDb, { workspaceId, jobId, limit: 100 });

  beforeAll(async () => {
    boss = createBoss(url, { schema: "pgboss_test", max: 2, applicationName: "tj-worker-plan" });
    boss.on("error", (err) => console.error("pg-boss error", err));
    await boss.start();
    await ensureQueues(boss);
    ctx = { boss, db: unsafeDb, sql };
    deps.jobs = ctx;
    for (const name of QUEUES) {
      await boss.deleteAllJobs(name);
      await boss.work(
        name,
        { batchSize: 1, includeMetadata: true, perJobResults: true, pollingIntervalSeconds: 0.5 },
        async (jobs) => {
          const results: RunJobOutcome[] = [];
          for (const job of jobs as BossJob[]) {
            const outcome = await runJob(ctx, name, registry, job, {
              shutdown: shutdown.signal,
              logger,
              deps,
              // The fake answers in microseconds; without this the 250 ms coalescing window folds
              // the per-slide progress events into two. A real slide takes seconds (§7).
              progressMinIntervalMs: 0,
            });
            outcomes.push(outcome);
            results.push(outcome);
          }
          return results;
        },
      );
    }
  });

  afterAll(async () => {
    shutdown.abort();
    for (const name of QUEUES) await boss.offWork(name);
    await boss.stop({ graceful: false, close: true });
    await close();
  });

  beforeEach(async () => {
    await truncateTenantTables();
    workspaceId = newId<WorkspaceId>();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId, workspaceName: "plan test" });
    lines.length = 0;
    // One full fake script per test: the plan job takes its head, the generate job the rest.
    deps.ai = scriptedPipelineAi();
  });

  const settledEvent = async (jobId: JobId) =>
    (await eventsFor(jobId)).find((e) => ["completed", "failed", "cancelled"].includes(e.type));

  /** The row `POST /lessons` writes (plan revision 1, locked), and the job it queues. */
  async function createAndQueue(options: {
    skipPlanning?: boolean;
    continueWhenPlanned?: boolean;
  }) {
    const ws = forWorkspace(unsafeDb, workspaceId);
    const jobId = newId<JobId>();
    const lessonId = newId<LessonId>();
    const lesson: Lesson = {
      ...lessonFromBrief(
        { brief: { topic: "States of matter" }, subject: "Science", yearGroup: "Year 8" },
        lessonId,
        new Date(),
      ),
      plan: {
        revision: 1,
        state: options.skipPlanning ? "confirmed" : "proposed",
        jobId,
      },
    };
    await createDocument(ws, "lesson", lesson, {
      id: lessonId,
      generatingJobId: jobId,
      continueWhenPlanned: options.continueWhenPlanned ?? false,
    });
    const sent = await enqueue(
      ctx,
      "lesson.plan",
      { lessonId, revision: 1, ...(options.skipPlanning ? {} : { stopAfter: "planned" as const }) },
      { workspaceId, id: jobId },
    );
    expect(sent).toBe(jobId);
    return { ws, jobId, lessonId };
  }

  /** Every `progress` event of `jobId` names a valid stage (ADR 0029 item 14). */
  async function expectStagedProgress(jobId: JobId) {
    const progress = (await eventsFor(jobId)).flatMap((e) =>
      e.payload.type === "progress" ? [e.payload.progress] : [],
    );
    expect(progress.length).toBeGreaterThan(0);
    for (const p of progress) expect(JOB_PROGRESS_STAGES).toContain(p.stage as never);
    return progress;
  }

  test("a brief becomes facts and stops at planned; generate completes the slides", async () => {
    const { ws, jobId, lessonId } = await createAndQueue({});
    expect(
      await waitFor(async () => (await settledEvent(jobId))?.type === "completed", 30_000),
    ).toBe(true);
    const planned = await getDocument(ws, lessonId);
    expect(planned?.generatingJobId).toBeNull();
    const proposal = parseLesson(planned?.body);
    expect(proposal.generation?.stage).toBe("planned");
    expect(proposal.plan).toEqual({ revision: 1, state: "proposed", jobId });
    expect(proposal.slides).toHaveLength(2);
    const planStages = new Set((await expectStagedProgress(jobId)).map((p) => p.stage));
    expect(planStages).toEqual(new Set(["plan"]));

    // `POST /lessons/:id/generate`, text unchanged: confirm and lock for the generate job.
    const generateJobId = newId<JobId>();
    const confirmed = await setPlanRevisionAndLock(ws, lessonId, {
      expectedRevision: 1,
      jobId: generateJobId,
      patch: (lesson) => ({
        ...lesson,
        plan: { revision: 1, state: "confirmed", jobId: generateJobId },
      }),
    });
    expect(confirmed.status).toBe("ok");
    await enqueue(
      ctx,
      "lesson.generate",
      { lessonId, revision: 1 },
      {
        workspaceId,
        id: generateJobId,
      },
    );
    expect(
      await waitFor(async () => (await settledEvent(generateJobId))?.type === "completed", 30_000),
    ).toBe(true);

    const row = await getDocument(ws, lessonId);
    expect(row?.generatingJobId).toBeNull();
    const done = parseLesson(row?.body);
    expect(done.slides).toHaveLength(FIXTURES.planSkeleton.outline.length);
    expect(done.generation?.stage).toBe("repaired");
    expect(done.generation?.completedAt).toBeDefined();
    expect(done.artefacts).toBeUndefined();
    expect(await sql`select id from documents where kind = 'worksheet'`).toHaveLength(0);

    // Events: queued, started, progress…, completed; slide progress stamped and monotonic.
    const events = await eventsFor(generateJobId);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("queued");
    expect(types[1]).toBe("started");
    expect(types.at(-1)).toBe("completed");
    expect(types.slice(2, -1).every((x) => x === "progress")).toBe(true);
    const progress = await expectStagedProgress(generateJobId);
    expect(progress.some((p) => p.stage === "plan")).toBe(false);
    const stamps = progress
      .map((p) => p.documentUpdatedAt)
      .filter((x): x is string => x !== undefined);
    expect(stamps.length).toBeGreaterThanOrEqual(8);
    const ms = stamps.map((s) => Date.parse(s));
    expect([...ms].sort((a, b) => a - b)).toEqual(ms);
    expect(stamps.at(-1)).toBe(row?.updatedAt.toISOString());

    // Logs: one summary line per job, and no lesson content anywhere (ADR 0015).
    for (const id of [jobId, generateJobId]) {
      const summaries = lines.filter((l) => {
        const generation = l.generation as { jobId?: string } | undefined;
        return l.msg === "generation summary" && generation?.jobId === id;
      });
      expect(summaries).toHaveLength(1);
    }
    expectNoContentLogged();
  }, 60_000);

  test("continue_when_planned: the lock passes to lesson.generate without ever being null", async () => {
    const { ws, jobId, lessonId } = await createAndQueue({ continueWhenPlanned: true });
    // Watch the lock from the moment the row exists until the generate job has finished. A smoke
    // check, not the proof: polling can miss a short gap. The guarantee is structural — the
    // hand-off is one conditional `UPDATE` (`handOffLock`), never a release and a re-lock.
    const holders: (string | null)[] = [];
    let watching = true;
    const watcher = (async () => {
      while (watching) {
        const row = await getDocument(ws, lessonId);
        holders.push(row?.generatingJobId ?? null);
        if (row?.generatingJobId === null) break;
        await Bun.sleep(5);
      }
    })();

    expect(
      await waitFor(async () => (await settledEvent(jobId))?.type === "completed", 30_000),
    ).toBe(true);
    const handedTo = await waitFor(async () => {
      const row = await getDocument(ws, lessonId);
      return row?.generatingJobId !== jobId;
    }, 5_000);
    expect(handedTo).toBe(true);
    const nextJobId = holders.find((h) => h !== null && h !== jobId) as JobId | undefined;
    expect(nextJobId).toBeDefined();
    if (!nextJobId) return;
    expect(
      await waitFor(async () => (await settledEvent(nextJobId))?.type === "completed", 30_000),
    ).toBe(true);
    watching = false;
    await watcher;

    // The lock went jobId → nextJobId → null (released by the generate job), never null between.
    const distinct = holders.filter((h, i) => i === 0 || h !== holders[i - 1]);
    expect(distinct).toEqual([jobId, nextJobId, null]);
    const row = await getDocument(ws, lessonId);
    expect(row?.continueWhenPlanned).toBe(false);
    const done = parseLesson(row?.body);
    expect(done.plan).toMatchObject({ revision: 1, state: "confirmed", jobId });
    expect(done.plan?.confirmedAt).toBeDefined();
    expect(done.generation?.stage).toBe("repaired");
    const started = (await eventsFor(nextJobId)).map((e) => e.type);
    expect(started.slice(0, 2)).toEqual(["queued", "started"]);
    await expectStagedProgress(nextJobId);
    expectNoContentLogged();
  }, 60_000);

  test("skipPlanning: one job runs the whole pipeline", async () => {
    const { ws, jobId, lessonId } = await createAndQueue({
      skipPlanning: true,
      continueWhenPlanned: true,
    });
    expect(
      await waitFor(async () => (await settledEvent(jobId))?.type === "completed", 30_000),
    ).toBe(true);
    const row = await getDocument(ws, lessonId);
    expect(row?.generatingJobId).toBeNull();
    expect(parseLesson(row?.body).generation?.stage).toBe("repaired");
    const stages = new Set((await expectStagedProgress(jobId)).map((p) => p.stage));
    expect(stages.has("plan") && stages.has("generate")).toBe(true);
  }, 60_000);

  test("a re-plan supersedes the running plan job: its next write is lost_lock and it fails", async () => {
    const ws = forWorkspace(unsafeDb, workspaceId);
    // Hold the plan job inside its skeleton call until the re-plan has taken the row.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const script = pipelineScript();
    const skeleton = script[PLAN_INDEX] as string;
    script[PLAN_INDEX] = async () => {
      await gate;
      return skeleton;
    };
    deps.ai = createFakeAi({ script: routed(script) });
    const { jobId, lessonId } = await createAndQueue({});
    expect(
      await waitFor(
        async () => (await eventsFor(jobId)).some((e) => e.type === "progress"),
        10_000,
      ),
    ).toBe(true);

    const nextJobId = newId<JobId>();
    const replanned = await setPlanRevisionAndLock(ws, lessonId, {
      expectedRevision: 1,
      jobId: nextJobId,
      supersedeProposal: true,
      patch: (lesson) => {
        const { facts: _facts, generation: _generation, ...rest } = lesson;
        return { ...rest, plan: { revision: 2, state: "proposed", jobId: nextJobId } };
      },
    });
    expect(replanned.status).toBe("ok");
    const after = await getDocument(ws, lessonId);
    release();

    expect(await waitFor(async () => (await settledEvent(jobId)) !== undefined, 30_000)).toBe(true);
    const terminal = await settledEvent(jobId);
    expect(terminal?.type).toBe("failed");
    expect(terminal?.payload).toMatchObject({ type: "failed", error: { retryable: false } });
    // Nothing the old job did after the re-lock reached the row.
    const row = await getDocument(ws, lessonId);
    expect(row?.generatingJobId).toBe(nextJobId);
    expect(row?.body).toEqual(after?.body);
  }, 60_000);

  function expectNoContentLogged() {
    const all = JSON.stringify(lines);
    const content = [
      "States of matter",
      ...FIXTURES.planSkeleton.learningObjectives.map((o) => o.text),
      ...Object.values(FIXTURES.slides)
        .map((s) => ("stem" in s ? s.stem : undefined))
        .filter((x): x is string => typeof x === "string"),
    ];
    expect(content.length).toBeGreaterThan(3);
    for (const text of content) expect(all).not.toContain(text);
  }
});
