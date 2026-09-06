import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import { createDocument, forWorkspace, getDocument } from "@tj/db";
import { createTestUserWithWorkspace, withTestDb } from "@tj/db/testing";
import { type JobId, type LessonId, newId, type WorkspaceId } from "@tj/domain";
import { lesson as lessonFixture } from "@tj/domain/documents/fixtures";
import pino from "pino";
import type { WorkerDeps } from "../deps";
import { lessonPlanJob } from "./lesson-plan";

// Integration test against the compose Postgres (ADR 0014): the lock release is an UPDATE on the
// `documents` row, so the handler is exercised with the real repository rather than a module
// mock — `mock.module("@tj/db")` would leak into every other test file in the process.
const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping lesson.plan tests: ${t.reason}`);

describeDb("lesson.plan job (stub)", () => {
  if (!t.ok) return;
  const { unsafeDb, truncateTenantTables, close } = t.db;
  afterAll(() => close());

  const workspaceId = newId<WorkspaceId>();
  const deps: WorkerDeps = { ai: createFakeAi(), db: unsafeDb };

  beforeEach(async () => {
    await truncateTenantTables();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId });
  });

  /** A lesson row locked by `jobId`, plus a second row locked by a different job. */
  async function lockedLessons(jobId: JobId) {
    const ws = forWorkspace(unsafeDb, workspaceId);
    const mine = await createDocument(ws, "lesson", lessonFixture(), { generatingJobId: jobId });
    const otherJobId = newId<JobId>();
    const other = await createDocument(ws, "lesson", lessonFixture(), {
      generatingJobId: otherJobId,
    });
    return { ws, mine, other, otherJobId };
  }

  function ctx(
    jobId: JobId,
    lessonId: LessonId,
    options: { ac?: AbortController; progress?: () => Promise<void> } = {},
  ) {
    const ac = options.ac ?? new AbortController();
    const calls: Array<[number | undefined, string | undefined]> = [];
    return {
      calls,
      ctx: {
        jobId,
        workspaceId,
        payload: { lessonId },
        signal: ac.signal,
        progress:
          options.progress ??
          (async (percent?: number, message?: string) => {
            calls.push([percent, message]);
          }),
        logger: pino({ level: "silent" }),
        deps,
      },
    };
  }

  test("reports one content-free progress line and releases only its own lock", async () => {
    const jobId = newId<JobId>();
    const { ws, mine, other, otherJobId } = await lockedLessons(jobId);
    const h = ctx(jobId, mine.id as LessonId);

    await lessonPlanJob(h.ctx);

    expect(h.calls).toEqual([[100, "planned (stub)"]]);
    expect((await getDocument(ws, mine.id))?.generatingJobId).toBeNull();
    expect((await getDocument(ws, other.id))?.generatingJobId).toBe(otherJobId);
  });

  test("still releases the lock when progress throws, and rethrows", async () => {
    const jobId = newId<JobId>();
    const { ws, mine } = await lockedLessons(jobId);
    const h = ctx(jobId, mine.id as LessonId, {
      progress: async () => {
        throw new Error("event store down");
      },
    });

    await expect(lessonPlanJob(h.ctx)).rejects.toThrow("event store down");
    expect((await getDocument(ws, mine.id))?.generatingJobId).toBeNull();
  });

  test("does nothing but release the lock when already aborted", async () => {
    const jobId = newId<JobId>();
    const { ws, mine } = await lockedLessons(jobId);
    const ac = new AbortController();
    ac.abort("cancelled");
    const h = ctx(jobId, mine.id as LessonId, { ac });

    await lessonPlanJob(h.ctx);

    expect(h.calls).toEqual([]);
    expect((await getDocument(ws, mine.id))?.generatingJobId).toBeNull();
  });

  test("never releases a lock held by a newer job", async () => {
    const staleJobId = newId<JobId>();
    const { ws, other, otherJobId } = await lockedLessons(staleJobId);
    const h = ctx(staleJobId, other.id as LessonId);

    await lessonPlanJob(h.ctx);

    expect((await getDocument(ws, other.id))?.generatingJobId).toBe(otherJobId);
  });

  test("another Workspace's lesson is untouched", async () => {
    const jobId = newId<JobId>();
    const { mine } = await lockedLessons(jobId);
    const foreign = newId<WorkspaceId>();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: foreign });
    const h = ctx(jobId, mine.id as LessonId);
    h.ctx.workspaceId = foreign;

    await lessonPlanJob(h.ctx);

    const row = await getDocument(forWorkspace(unsafeDb, workspaceId), mine.id);
    expect(row?.generatingJobId).toBe(jobId);
  });
});
