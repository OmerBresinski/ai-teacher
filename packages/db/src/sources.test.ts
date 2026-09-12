import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { newId, storageKey, type WorkspaceId } from "@tj/domain";
import {
  bindSourcesToLesson,
  createSource,
  getSource,
  listSourcesOfLesson,
  type NewSource,
  softDeleteSource,
  toSourceRef,
  unbindSourcesFromLesson,
} from "./sources";
import { forWorkspace, type WorkspaceDb } from "./tenant";
import { createTestUserWithWorkspace, withTestDb } from "./testing";

const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping sources tests: ${t.reason}`);

describeDb("sources repository", () => {
  if (!t.ok) return;
  const { unsafeDb, truncateTenantTables, close } = t.db;
  afterAll(() => close());

  const wsAId = newId<WorkspaceId>();
  const wsBId = newId<WorkspaceId>();
  let wsA: WorkspaceDb;
  let wsB: WorkspaceDb;

  const newSource = (ws: WorkspaceId, name = "plan.pdf"): NewSource => {
    const id = newId();
    return {
      id,
      kind: "file",
      name,
      mime: "application/pdf",
      byteSize: 1234,
      storageKey: storageKey(ws, "sources", id, "original.pdf"),
      pages: 3,
      lowText: false,
    };
  };

  beforeEach(async () => {
    await truncateTenantTables();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: wsAId, workspaceName: "A" });
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: wsBId, workspaceName: "B" });
    wsA = forWorkspace(unsafeDb, wsAId);
    wsB = forWorkspace(unsafeDb, wsBId);
  });

  test("createSource writes an unbound live row and getSource reads it back", async () => {
    const input = newSource(wsAId);
    const row = await createSource(wsA, input);
    expect(row).toMatchObject({ ...input, workspaceId: wsAId, lessonId: null, deletedAt: null });
    expect(await getSource(wsA, input.id)).toEqual(row);
    expect(toSourceRef(row)).toEqual({
      id: input.id,
      kind: "file",
      name: "plan.pdf",
      storageKey: input.storageKey,
      pages: 3,
    });
  });

  test("another Workspace reads the row as missing (ADR 0007)", async () => {
    const input = newSource(wsAId);
    await createSource(wsA, input);
    expect(await getSource(wsB, input.id)).toBeNull();
    expect(await bindSourcesToLesson(wsB, [input.id], newId())).toEqual([]);
    expect(await softDeleteSource(wsB, input.id)).toBe("missing");
    expect(await getSource(wsA, input.id)).not.toBeNull();
  });

  describe("bindSourcesToLesson", () => {
    test("claims only live unbound rows, in the order of ids", async () => {
      const a = newSource(wsAId, "a.pdf");
      const b = newSource(wsAId, "b.pdf");
      const c = newSource(wsAId, "c.pdf");
      for (const s of [a, b, c]) await createSource(wsA, s);
      const other = newId();
      expect(await bindSourcesToLesson(wsA, [c.id], other)).toHaveLength(1);

      const lessonId = newId();
      const rows = await bindSourcesToLesson(wsA, [b.id, a.id, c.id], lessonId);
      expect(rows.map((r) => r.id)).toEqual([b.id, a.id]);
      expect(rows.every((r) => r.lessonId === lessonId)).toBe(true);
      expect((await getSource(wsA, c.id))?.lessonId).toBe(other);
    });

    test("a bound row cannot be claimed again; an empty list is a no-op", async () => {
      const a = newSource(wsAId);
      await createSource(wsA, a);
      expect(await bindSourcesToLesson(wsA, [a.id], newId())).toHaveLength(1);
      expect(await bindSourcesToLesson(wsA, [a.id], newId())).toEqual([]);
      expect(await bindSourcesToLesson(wsA, [], newId())).toEqual([]);
    });

    test("a repeated id is claimed once and returned once", async () => {
      const a = newSource(wsAId);
      await createSource(wsA, a);
      const rows = await bindSourcesToLesson(wsA, [a.id, a.id], newId());
      expect(rows.map((r) => r.id)).toEqual([a.id]);
    });

    test("a soft-deleted or unknown id is not claimed", async () => {
      const a = newSource(wsAId);
      await createSource(wsA, a);
      expect(await softDeleteSource(wsA, a.id)).toBe("ok");
      expect(await bindSourcesToLesson(wsA, [a.id, newId()], newId())).toEqual([]);
    });

    test("inside ws.tx a failed claim rolls back with the transaction", async () => {
      const a = newSource(wsAId);
      await createSource(wsA, a);
      const lessonId = newId();
      await expect(
        wsA.tx(async (scoped) => {
          const rows = await bindSourcesToLesson(scoped, [a.id, newId()], lessonId);
          if (rows.length !== 2) throw new Error("short claim");
        }),
      ).rejects.toThrow("short claim");
      expect((await getSource(wsA, a.id))?.lessonId).toBeNull();
    });
  });

  test("unbindSourcesFromLesson releases every row of that lesson only", async () => {
    const a = newSource(wsAId);
    const b = newSource(wsAId);
    const c = newSource(wsAId);
    for (const s of [a, b, c]) await createSource(wsA, s);
    const l1 = newId();
    const l2 = newId();
    await bindSourcesToLesson(wsA, [a.id, b.id], l1);
    await bindSourcesToLesson(wsA, [c.id], l2);
    expect((await listSourcesOfLesson(wsA, l1)).map((r) => r.id).sort()).toEqual(
      [a.id, b.id].sort(),
    );
    expect(await unbindSourcesFromLesson(wsA, l1)).toBe(2);
    expect((await getSource(wsA, a.id))?.lessonId).toBeNull();
    expect((await getSource(wsA, c.id))?.lessonId).toBe(l2);
    expect(await unbindSourcesFromLesson(wsA, l1)).toBe(0);
  });

  describe("softDeleteSource", () => {
    test("ok for an unbound row, then missing", async () => {
      const a = newSource(wsAId);
      await createSource(wsA, a);
      expect(await softDeleteSource(wsA, a.id)).toBe("ok");
      expect(await getSource(wsA, a.id)).toBeNull();
      expect(await softDeleteSource(wsA, a.id)).toBe("missing");
    });

    test("a claim that lands between the read and the update reports bound", async () => {
      const a = newSource(wsAId);
      await createSource(wsA, a);
      // Simulate the race: the row is unbound when read, bound by the time the update runs.
      const racing = {
        ...wsA,
        update: ((
          table: Parameters<WorkspaceDb["update"]>[0],
          where?: Parameters<WorkspaceDb["update"]>[1],
        ) => ({
          set: (values: Parameters<ReturnType<WorkspaceDb["update"]>["set"]>[0]) => ({
            returning: async () => {
              await bindSourcesToLesson(wsA, [a.id], newId());
              return wsA.update(table, where).set(values).returning();
            },
          }),
        })) as WorkspaceDb["update"],
      } as WorkspaceDb;
      expect(await softDeleteSource(racing, a.id)).toBe("bound");
      expect((await getSource(wsA, a.id))?.deletedAt).toBeNull();
    });

    test("bound for a claimed row, which stays as it is", async () => {
      const a = newSource(wsAId);
      await createSource(wsA, a);
      const lessonId = newId();
      await bindSourcesToLesson(wsA, [a.id], lessonId);
      expect(await softDeleteSource(wsA, a.id)).toBe("bound");
      const row = await getSource(wsA, a.id);
      expect(row?.lessonId).toBe(lessonId);
      expect(row?.deletedAt).toBeNull();
    });
  });
});
