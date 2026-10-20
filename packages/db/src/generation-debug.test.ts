import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { type JobId, type LessonId, newId, type WorkspaceId } from "@tj/domain";
import { lesson as lessonFixture } from "@tj/domain/documents/fixtures";
import { createDocument } from "./documents";
import {
  deleteExpiredGenerationDebug,
  insertGenerationDebug,
  listGenerationDebug,
} from "./generation-debug";
import { forWorkspace } from "./tenant";
import { createTestUserWithWorkspace, withTestDb } from "./testing";

const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping generation-debug tests: ${t.reason}`);

const DAY = 86_400_000;

describeDb("generation debug rows", () => {
  if (!t.ok) return;
  const { unsafeDb, sql, truncateTenantTables, close } = t.db;
  afterAll(() => close());

  const wsA = newId<WorkspaceId>();
  const wsB = newId<WorkspaceId>();
  let lessonA: LessonId;
  let lessonB: LessonId;
  const jobId = newId<JobId>();

  beforeEach(async () => {
    await truncateTenantTables();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: wsA, workspaceName: "A" });
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: wsB, workspaceName: "B" });
    lessonA = (await createDocument(forWorkspace(unsafeDb, wsA), "lesson", lessonFixture()))
      .id as LessonId;
    lessonB = (await createDocument(forWorkspace(unsafeDb, wsB), "lesson", lessonFixture()))
      .id as LessonId;
  });

  const row = (lessonId: LessonId, seq: number, createdAt?: Date) => ({
    lessonId,
    jobId,
    attempt: 0,
    seq,
    kind: "event",
    payload: { ev: "x", seq },
    ...(createdAt ? { createdAt } : {}),
  });

  test("insert then list returns a lesson's rows in order, scoped to its workspace", async () => {
    await insertGenerationDebug(unsafeDb, wsA, [row(lessonA, 0), row(lessonA, 1)]);
    await insertGenerationDebug(unsafeDb, wsB, [row(lessonB, 0)]);
    const rows = await listGenerationDebug(unsafeDb, wsA, lessonA);
    expect(rows.map((r) => r.seq)).toEqual([0, 1]);
    expect(rows[0]?.workspaceId).toBe(wsA);
    expect(rows[0]?.slideIndex).toBeNull();
    expect(await listGenerationDebug(unsafeDb, wsA, lessonB)).toEqual([]);
  });

  test("the TTL cleanup deletes rows older than the TTL and keeps the rest", async () => {
    const now = Date.now();
    await insertGenerationDebug(unsafeDb, wsA, [
      row(lessonA, 0, new Date(now - 31 * DAY)),
      row(lessonA, 1, new Date(now - 29 * DAY)),
      row(lessonA, 2),
    ]);
    await insertGenerationDebug(unsafeDb, wsB, [row(lessonB, 0, new Date(now - 40 * DAY))]);
    expect(await deleteExpiredGenerationDebug(sql, 30, { batch: 1 })).toBe(2);
    expect((await listGenerationDebug(unsafeDb, wsA, lessonA)).map((r) => r.seq)).toEqual([1, 2]);
    expect(await listGenerationDebug(unsafeDb, wsB, lessonB)).toEqual([]);
  });

  test("hard-deleting the lesson removes its rows", async () => {
    await insertGenerationDebug(unsafeDb, wsA, [row(lessonA, 0)]);
    await sql`delete from documents where id = ${lessonA}`;
    const [{ n } = { n: -1 }] = await sql<{ n: number }[]>`
      select count(*)::int as n from generation_debug`;
    expect(n).toBe(0);
  });
});
