/**
 * Integration: `lesson.plan` on a real pg-boss loop (schema `pgboss_test`) against
 * TEST_DATABASE_URL, with the worker's own registry and a scripted fake provider (ADR 0025 §22).
 * Mirrors `apps/api/src/routes/lessons.integration.test.ts` (apps may not import apps). Skips
 * visibly when the database is unreachable.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createDocument, forWorkspace, getDocument, listJobEvents } from "@tj/db";
import { createTestUserWithWorkspace, withTestDb } from "@tj/db/testing";
import { type JobId, type LessonId, newId, type WorkspaceId } from "@tj/domain";
import { lessonFromBrief, parseLesson, parseStoredWorksheet } from "@tj/domain/documents";
import { noSources } from "@tj/generation";
import { FIXTURES, scriptedPipelineAi } from "@tj/generation/testing";
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
    sources: noSources,
  };

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
    await boss.deleteAllJobs("lesson.plan");
    ctx = { boss, db: unsafeDb, sql };
    await boss.work(
      "lesson.plan",
      { batchSize: 1, includeMetadata: true, perJobResults: true, pollingIntervalSeconds: 0.5 },
      async (jobs) => {
        const results: RunJobOutcome[] = [];
        for (const job of jobs as BossJob[]) {
          const outcome = await runJob(ctx, "lesson.plan", registry, job, {
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
  });

  afterAll(async () => {
    shutdown.abort();
    await boss.offWork("lesson.plan");
    await boss.stop({ graceful: false, close: true });
    await close();
  });

  beforeEach(async () => {
    await truncateTenantTables();
    workspaceId = newId<WorkspaceId>();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId, workspaceName: "plan test" });
    lines.length = 0;
  });

  test("a brief becomes facts, slides, a linked worksheet and ordered events with documentUpdatedAt", async () => {
    const ws = forWorkspace(unsafeDb, workspaceId);
    const jobId = newId<JobId>();
    const lessonId = newId<LessonId>();
    const lesson = lessonFromBrief(
      { brief: { topic: "States of matter" }, subject: "Science", yearGroup: "Year 8" },
      lessonId,
      new Date(),
    );
    await createDocument(ws, "lesson", lesson, { id: lessonId, generatingJobId: jobId });

    const sent = await enqueue(ctx, "lesson.plan", { lessonId }, { workspaceId, id: jobId });
    expect(sent).toBe(jobId);
    const settled = await waitFor(
      async () => (await eventsFor(jobId)).some((e) => e.type === "completed"),
      30_000,
    );
    expect(settled).toBe(true);

    // The lesson row.
    const row = await getDocument(ws, lessonId);
    expect(row?.generatingJobId).toBeNull();
    const stored = parseLesson(row?.body);
    expect(stored.facts).toBeDefined();
    expect(stored.slides).toHaveLength(FIXTURES.planSkeleton.outline.length);
    expect(stored.generation?.stage).toBe("repaired");
    const worksheetId = stored.artefacts?.worksheetId ?? "";
    expect(worksheetId).not.toBe("");

    // The worksheet row, linked both ways.
    const worksheetRow = await getDocument(ws, worksheetId);
    expect(worksheetRow?.kind).toBe("worksheet");
    expect(worksheetRow?.generatingJobId).toBeNull();
    const worksheet = parseStoredWorksheet(worksheetRow?.body);
    expect(worksheet.lessonId).toBe(lessonId);
    expect(worksheet.blocks.length).toBeGreaterThanOrEqual(4);

    // Events: queued, started, progress…, completed; slide progress stamped and monotonic.
    const events = await eventsFor(jobId);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("queued");
    expect(types[1]).toBe("started");
    expect(types.at(-1)).toBe("completed");
    expect(types.slice(2, -1).every((x) => x === "progress")).toBe(true);
    const stamps = events
      .map((e) =>
        e.payload.type === "progress" ? e.payload.progress.documentUpdatedAt : undefined,
      )
      .filter((x): x is string => x !== undefined);
    expect(stamps.length).toBeGreaterThanOrEqual(9);
    const ms = stamps.map((s) => Date.parse(s));
    expect([...ms].sort((a, b) => a - b)).toEqual(ms);
    expect(stamps.at(-1)).toBe(row?.updatedAt.toISOString());
    expect(outcomes.at(-1)).toMatchObject({ id: jobId, status: "completed", event: "completed" });

    // Logs: one summary line for the job, and no lesson content anywhere (ADR 0015).
    const summaries = lines.filter((l) => {
      const generation = l.generation as { jobId?: string } | undefined;
      return l.msg === "generation summary" && generation?.jobId === jobId;
    });
    expect(summaries).toHaveLength(1);
    const all = JSON.stringify(lines);
    const content = [
      ...FIXTURES.planSkeleton.objectives.map((o) => o.text),
      ...Object.values(FIXTURES.slides)
        .map((s) => ("stem" in s ? s.stem : undefined))
        .filter((x): x is string => typeof x === "string"),
    ];
    expect(content.length).toBeGreaterThan(3);
    for (const text of content) expect(all).not.toContain(text);
  }, 60_000);
});
