import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { type JobEvent, type JobId, newId, type WorkspaceId } from "@tj/domain";
import { eq } from "drizzle-orm";
import { jobEvents, workspaces } from "./schema";
import { forWorkspace } from "./tenant";
import { createTestUserWithWorkspace, withTestDb } from "./testing";

const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping forWorkspace tests: ${t.reason}`);

function progress(workspaceId: WorkspaceId, jobId: JobId = newId<JobId>()): JobEvent {
  return {
    type: "progress",
    jobId,
    workspaceId,
    at: new Date().toISOString(),
    progress: { percent: 10 },
  };
}

function row(event: JobEvent) {
  return { jobId: event.jobId, type: event.type, payload: event, at: new Date(event.at) };
}

describeDb("forWorkspace", () => {
  if (!t.ok) return;
  const { unsafeDb, truncateTenantTables, close } = t.db;
  afterAll(() => close());

  const wsA = newId<WorkspaceId>();
  const wsB = newId<WorkspaceId>();

  beforeEach(async () => {
    await truncateTenantTables();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: wsA, workspaceName: "A" });
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: wsB, workspaceName: "B" });
  });

  test("select only returns the scoped workspace's rows", async () => {
    await forWorkspace(unsafeDb, wsA)
      .insert(jobEvents)
      .values(row(progress(wsA)));
    await forWorkspace(unsafeDb, wsB)
      .insert(jobEvents)
      .values([row(progress(wsB)), row(progress(wsB))]);

    const a = await forWorkspace(unsafeDb, wsA).select(jobEvents);
    const b = await forWorkspace(unsafeDb, wsB).select(jobEvents);
    expect(a.length).toBe(1);
    expect(b.length).toBe(2);
    expect(a.every((r) => r.workspaceId === wsA)).toBe(true);
    expect(b.every((r) => r.workspaceId === wsB)).toBe(true);
  });

  test("insert stamps workspaceId on objects and arrays", async () => {
    const db = forWorkspace(unsafeDb, wsA);
    const one = await db
      .insert(jobEvents)
      .values(row(progress(wsA)))
      .returning();
    const many = await db
      .insert(jobEvents)
      .values([row(progress(wsA)), row(progress(wsA))])
      .returning();
    expect(one[0]?.workspaceId).toBe(wsA);
    expect(many.map((r) => r.workspaceId)).toEqual([wsA, wsA]);
  });

  test("extraWhere is ANDed with the tenant predicate, never replaces it", async () => {
    const jobId = newId<JobId>();
    await forWorkspace(unsafeDb, wsA)
      .insert(jobEvents)
      .values(row(progress(wsA, jobId)));
    await forWorkspace(unsafeDb, wsB)
      .insert(jobEvents)
      .values(row(progress(wsB, jobId)));

    const fromA = await forWorkspace(unsafeDb, wsA).select(jobEvents, eq(jobEvents.jobId, jobId));
    expect(fromA.length).toBe(1);
    expect(fromA[0]?.workspaceId).toBe(wsA);
  });

  test("update and delete cannot touch another workspace's rows", async () => {
    const jobId = newId<JobId>();
    await forWorkspace(unsafeDb, wsA)
      .insert(jobEvents)
      .values(row(progress(wsA, jobId)));
    await forWorkspace(unsafeDb, wsB)
      .insert(jobEvents)
      .values(row(progress(wsB, jobId)));

    const updated = await forWorkspace(unsafeDb, wsA)
      .update(jobEvents, eq(jobEvents.jobId, jobId))
      .set({ type: "started" })
      .returning();
    expect(updated.length).toBe(1);
    expect(updated[0]?.workspaceId).toBe(wsA);

    const deleted = await forWorkspace(unsafeDb, wsA).delete(jobEvents).returning();
    expect(deleted.length).toBe(1);

    const remaining = await unsafeDb.select().from(jobEvents);
    expect(remaining.length).toBe(1);
    expect(remaining[0]?.workspaceId).toBe(wsB);
    expect(remaining[0]?.type).toBe("progress");
  });

  test("tx passes a helper scoped to the same workspace and rolls back on error", async () => {
    const db = forWorkspace(unsafeDb, wsA);
    await expect(
      db.tx(async (scoped) => {
        expect(scoped.workspaceId).toBe(wsA);
        await scoped.insert(jobEvents).values(row(progress(wsA)));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await db.select(jobEvents)).length).toBe(0);

    const inserted = await db.tx(async (scoped) => {
      await scoped.insert(jobEvents).values(row(progress(wsA)));
      return scoped.select(jobEvents);
    });
    expect(inserted.length).toBe(1);
  });

  test("tables without workspaceId are rejected at compile time", () => {
    const db = forWorkspace(unsafeDb, wsA);
    // @ts-expect-error workspaces is a NON_TENANT_TABLE: it has no workspaceId column
    const query = () => db.select(workspaces);
    // @ts-expect-error callers cannot supply their own workspaceId
    const insert = () => db.insert(jobEvents).values({ ...row(progress(wsA)), workspaceId: wsB });
    expect(typeof query).toBe("function");
    expect(typeof insert).toBe("function");
  });
});
