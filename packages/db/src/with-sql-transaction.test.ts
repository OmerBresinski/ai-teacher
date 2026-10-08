import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { newId, type WorkspaceId } from "@tj/domain";
import { eq } from "drizzle-orm";
import { withSqlTransaction } from "./client";
import { workspaces } from "./schema/index";
import { createTestUserWithWorkspace, withTestDb } from "./testing";

/*
 * `withSqlTransaction` (TEACH-135 part b): one transaction seen as Drizzle (`tx.db`) and as a raw
 * `executeSql`, as `enqueue` uses it with pg-boss. Both kinds of write commit together or not at
 * all, and nothing is visible to another session before the commit.
 */
const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping withSqlTransaction tests: ${t.reason}`);

describeDb("withSqlTransaction", () => {
  if (!t.ok) return;
  const { unsafeDb, sql, truncateTenantTables, close } = t.db;
  beforeEach(() => truncateTenantTables());
  afterAll(() => close());

  const nameOf = async (id: WorkspaceId) =>
    (await unsafeDb.select().from(workspaces).where(eq(workspaces.id, id)))[0]?.name;

  test("writes through tx.db and tx.executeSql commit together and return fn's value", async () => {
    const workspaceId = newId<WorkspaceId>();
    const result = await withSqlTransaction(sql, async (tx) => {
      await createTestUserWithWorkspace(tx.db, { workspaceId, workspaceName: "first" });
      const { rows } = await tx.executeSql(
        "update workspaces set name = $1 where id = $2 returning name",
        ["renamed", workspaceId],
      );
      // Not visible outside the transaction yet.
      expect(await nameOf(workspaceId)).toBeUndefined();
      return rows;
    });
    expect(result).toEqual([{ name: "renamed" }]);
    expect(await nameOf(workspaceId)).toBe("renamed");
  });

  test("a throw rolls back both kinds of write and rethrows", async () => {
    const workspaceId = newId<WorkspaceId>();
    await expect(
      withSqlTransaction(sql, async (tx) => {
        await createTestUserWithWorkspace(tx.db, { workspaceId });
        await tx.executeSql("update workspaces set name = $1 where id = $2", ["gone", workspaceId]);
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(await nameOf(workspaceId)).toBeUndefined();
  });
});
