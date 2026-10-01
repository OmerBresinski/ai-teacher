/**
 * TEACH-222 row 10: the daily cleanup deletes expired, unclaimed anonymous users with their
 * Workspace, lessons and stored objects, and leaves a claimed Workspace and fresh users alone.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocument, forWorkspace } from "@tj/db";
import { createTestUserWithWorkspace, withTestDb } from "@tj/db/testing";
import { storageKey, type WorkspaceId } from "@tj/domain";
import { generatedLesson } from "@tj/domain/documents/fixtures";
import { LocalDiskStorage } from "@tj/storage";
import pino from "pino";
import { runAnonymousCleanup } from "./anonymous-cleanup";

const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping anonymous cleanup tests: ${t.reason}`);

describeDb("auth.anonymous-cleanup", () => {
  if (!t.ok) return;
  const db = t.db;
  const root = mkdtempSync(join(tmpdir(), "tj-222-cleanup-"));
  const storage = new LocalDiskStorage(root);
  const logger = pino({ level: "silent" });

  afterAll(async () => {
    await db.close();
    rmSync(root, { recursive: true, force: true });
  });
  beforeEach(() => db.truncateTenantTables());

  async function anonymousUser(ageDays: number) {
    const u = await createTestUserWithWorkspace(db.unsafeDb);
    await db.sql`
      update users set is_anonymous = true, created_at = now() - make_interval(days => ${ageDays})
      where id = ${u.userId}`;
    const ws = forWorkspace(db.unsafeDb, u.workspaceId as WorkspaceId);
    await createDocument(ws, "lesson", generatedLesson());
    const key = storageKey(u.workspaceId as WorkspaceId, "images", "a.png");
    await storage.put(key, new Uint8Array([1]), { contentType: "image/png" });
    return { ...u, key };
  }
  const exists = (key: string) =>
    storage.get(key).then(
      () => true,
      () => false,
    );
  const count = async (table: "users" | "workspaces" | "documents", id: string) => {
    const col = table === "users" ? "id" : table === "workspaces" ? "id" : "workspace_id";
    const rows = await db.sql<{ n: number }[]>`
      select count(*)::int as n from ${db.sql(table)} where ${db.sql(col)} = ${id}`;
    return rows[0]?.n ?? 0;
  };

  test("row 10: expired unclaimed user gone with its data; claimed and fresh untouched", async () => {
    const expired = await anonymousUser(15);
    const claimed = await anonymousUser(15);
    const fresh = await anonymousUser(1);
    // TEACH-224's claim: the Workspace now belongs to a signed-in teacher.
    const teacher = await createTestUserWithWorkspace(db.unsafeDb);
    await db.sql`delete from workspaces where owner_user_id = ${teacher.userId}`;
    await db.sql`
      update workspaces set owner_user_id = ${teacher.userId} where id = ${claimed.workspaceId}`;
    await db.sql`
      insert into anonymous_signins (ip, day, count)
      values ('203.0.113.1', (now() at time zone 'utc')::date - 5, 3),
             ('203.0.113.2', (now() at time zone 'utc')::date, 1)`;

    const result = await runAnonymousCleanup({ sql: db.sql, storage, ttlDays: 14, logger });

    expect(result).toEqual({ users: 2, workspaces: 1, objects: 1, objectFailures: 0 });
    expect(await count("users", expired.userId)).toBe(0);
    expect(await count("workspaces", expired.workspaceId)).toBe(0);
    expect(await count("documents", expired.workspaceId)).toBe(0);
    expect(await exists(expired.key)).toBe(false);

    // The claimed anonymous user is gone too, but its Workspace moved and is untouched.
    expect(await count("users", claimed.userId)).toBe(0);
    expect(await count("workspaces", claimed.workspaceId)).toBe(1);
    expect(await count("documents", claimed.workspaceId)).toBe(1);
    expect(await exists(claimed.key)).toBe(true);

    expect(await count("users", fresh.userId)).toBe(1);
    expect(await count("documents", fresh.workspaceId)).toBe(1);
    expect(await exists(fresh.key)).toBe(true);

    const counters = await db.sql<{ ip: string }[]>`select ip from anonymous_signins`;
    expect(counters.map((r) => r.ip)).toEqual(["203.0.113.2"]);
  });

  test("a signed-in user is never deleted, however old", async () => {
    const teacher = await createTestUserWithWorkspace(db.unsafeDb);
    await db.sql`update users set created_at = now() - interval '400 days' where id = ${teacher.userId}`;
    const result = await runAnonymousCleanup({ sql: db.sql, storage, ttlDays: 14, logger });
    expect(result.users).toBe(0);
    expect(await count("users", teacher.userId)).toBe(1);
  });
});
