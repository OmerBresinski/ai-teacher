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
    // TEACH-224's claim: the Workspace now belongs to a signed-in teacher. These are the two
    // statements `claimAnonymousWorkspace` (apps/api/src/auth/claim.ts) runs; an app cannot import
    // another, so the api's `claim.db.test.ts` checks the function leaves exactly this state.
    const teacher = await createTestUserWithWorkspace(db.unsafeDb);
    await db.sql`delete from workspaces where owner_user_id = ${teacher.userId}`;
    await db.sql`
      update workspaces set owner_user_id = ${teacher.userId} where id = ${claimed.workspaceId}`;
    await db.sql`
      insert into anonymous_signins (ip, day, count)
      values ('203.0.113.1', (now() at time zone 'utc')::date - 5, 3),
             ('203.0.113.2', (now() at time zone 'utc')::date, 1)`;
    await db.sql`
      insert into magic_link_sends (recipient, sent_at)
      values ('old-key', now() - interval '3 days'), ('recent-key', now() - interval '1 hour')`;

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
    const sends = await db.sql<{ recipient: string }[]>`select recipient from magic_link_sends`;
    expect(sends.map((r) => r.recipient)).toEqual(["recent-key"]);
  });

  test("a claim that lands between the select and the delete keeps the Workspace and its objects", async () => {
    const raced = await anonymousUser(15);
    const teacher = await createTestUserWithWorkspace(db.unsafeDb);
    await db.sql`delete from workspaces where owner_user_id = ${teacher.userId}`;
    // Stand-in for TEACH-224's claim committing after the job's select: the moment the job deletes
    // the anonymous user, the Workspace is handed over first, as `claimAnonymousWorkspace` does.
    await db.sql.unsafe(`
      create or replace function tj_test_claim_race() returns trigger language plpgsql as $$
      begin
        update workspaces set owner_user_id = '${teacher.userId}' where owner_user_id = old.id;
        return old;
      end $$`);
    await db.sql.unsafe(`
      create trigger tj_test_claim_race before delete on users
      for each row when (old.id = '${raced.userId}') execute function tj_test_claim_race()`);
    try {
      const result = await runAnonymousCleanup({ sql: db.sql, storage, ttlDays: 14, logger });
      expect(result).toEqual({ users: 1, workspaces: 0, objects: 0, objectFailures: 0 });
    } finally {
      await db.sql`drop trigger if exists tj_test_claim_race on users`;
      await db.sql`drop function if exists tj_test_claim_race()`;
    }
    expect(await count("users", raced.userId)).toBe(0);
    expect(await count("workspaces", raced.workspaceId)).toBe(1);
    expect(await count("documents", raced.workspaceId)).toBe(1);
    expect(await exists(raced.key)).toBe(true);
  });

  test("expired pending claims are swept; live ones and other verifications stay", async () => {
    await db.sql`
      insert into verifications (id, identifier, value, expires_at, created_at, updated_at)
      values ('v1', 'claim:old@example.test', 'a1', now() - interval '1 minute', now(), now()),
             ('v2', 'claim:live@example.test', 'a2', now() + interval '1 hour', now(), now()),
             ('v3', 'magic-token', '{}', now() - interval '1 minute', now(), now())`;
    await runAnonymousCleanup({ sql: db.sql, storage, ttlDays: 14, logger });
    const left = await db.sql<{ id: string }[]>`select id from verifications order by id`;
    expect(left.map((r) => r.id)).toEqual(["v2", "v3"]);
  });

  test("a signed-in user is never deleted, however old", async () => {
    const teacher = await createTestUserWithWorkspace(db.unsafeDb);
    await db.sql`update users set created_at = now() - interval '400 days' where id = ${teacher.userId}`;
    const result = await runAnonymousCleanup({ sql: db.sql, storage, ttlDays: 14, logger });
    expect(result.users).toBe(0);
    expect(await count("users", teacher.userId)).toBe(1);
  });
});
