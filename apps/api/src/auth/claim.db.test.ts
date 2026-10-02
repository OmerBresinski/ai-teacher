/**
 * TEACH-224 at function level against the real test database: `claimAnonymousWorkspace` hands the
 * anonymous Workspace over or declines (ruling 112), rolls back whole on a fault, and serialises
 * two claims for one visitor; the pending claim is replaced, consumed once and ignored when
 * expired. The sign-in flows that reach these are in `auth.db.test.ts`.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createDocument, createSource, forWorkspace } from "@tj/db";
import { createTestUserWithWorkspace, withTestDb } from "@tj/db/testing";
import { newId, storageKey, type WorkspaceId } from "@tj/domain";
import { generatedLesson } from "@tj/domain/documents/fixtures";
import { captureLogger, withFailingWorkspaceHandover } from "../test-helpers";
import {
  claimAnonymousWorkspace,
  claimOnLink,
  claimPending,
  pendingClaimIdentifier,
  writePendingClaim,
} from "./claim";

const t = await withTestDb({ max: 4 });
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping claim db tests: ${t.reason}`);

describeDb("claimAnonymousWorkspace and the pending claim (TEACH-224)", () => {
  if (!t.ok) return;
  const db = t.db;

  afterAll(() => db.close());
  beforeEach(() => db.truncateTenantTables());

  /** An anonymous user whose Workspace holds one lesson (the signed-out visitor). */
  async function visitor() {
    const u = await createTestUserWithWorkspace(db.unsafeDb);
    await db.sql`update users set is_anonymous = true where id = ${u.userId}`;
    const lesson = await createDocument(
      forWorkspace(db.unsafeDb, u.workspaceId),
      "lesson",
      generatedLesson(),
    );
    return { ...u, lessonId: lesson.id };
  }
  /** A just-created account with its empty personal Workspace (what a first sign-in makes). */
  const newAccount = (email?: string) =>
    createTestUserWithWorkspace(db.unsafeDb, email ? { email } : {});

  async function ownerOf(workspaceId: string) {
    const rows = await db.sql<{ owner: string }[]>`
      select owner_user_id as owner from workspaces where id = ${workspaceId}`;
    return rows[0]?.owner;
  }
  async function workspacesOf(userId: string) {
    const rows = await db.sql<{ id: string }[]>`
      select id from workspaces where owner_user_id = ${userId}`;
    return rows.map((r) => r.id);
  }
  async function isAnonymous(userId: string) {
    const rows = await db.sql<{ a: boolean }[]>`
      select is_anonymous as a from users where id = ${userId}`;
    return rows[0]?.a;
  }
  async function claimRows() {
    return db.sql<{ identifier: string; value: string }[]>`
      select identifier, value from verifications where identifier like 'claim:%'`;
  }

  test("row 1: a new account takes the anonymous Workspace; its empty one is deleted", async () => {
    const a = await visitor();
    const n = await newAccount();

    const ids = { anonymousUserId: a.userId, userId: n.userId };
    expect(await claimAnonymousWorkspace(db, ids)).toBe("claimed");

    expect(await ownerOf(a.workspaceId)).toBe(n.userId);
    expect(await workspacesOf(n.userId)).toEqual([a.workspaceId]);
    expect(await ownerOf(n.workspaceId)).toBeUndefined();
    expect(await workspacesOf(a.userId)).toEqual([]);
    // The anonymous user stays for the cleanup job (disableDeleteAnonymousUser).
    expect(await isAnonymous(a.userId)).toBe(true);
    const lesson = await db.sql`select id from documents where id = ${a.lessonId}
      and workspace_id = ${a.workspaceId}`;
    expect(lesson).toHaveLength(1);

    // Claimed once: the anonymous user owns nothing now.
    expect(await claimAnonymousWorkspace(db, ids)).toBe("nothing-to-claim");
  });

  test("a new account whose Workspace went missing still claims", async () => {
    const a = await visitor();
    const n = await newAccount();
    await db.sql`delete from workspaces where id = ${n.workspaceId}`;
    const ids = { anonymousUserId: a.userId, userId: n.userId };
    expect(await claimAnonymousWorkspace(db, ids)).toBe("claimed");
    expect(await workspacesOf(n.userId)).toEqual([a.workspaceId]);
  });

  describe("row 4: an existing account declines (ruling 112)", () => {
    async function expectDeclined(e: { userId: string; workspaceId: string }) {
      const a = await visitor();
      const ids = { anonymousUserId: a.userId, userId: e.userId };
      expect(await claimAnonymousWorkspace(db, ids)).toBe("declined-existing");
      expect(await workspacesOf(e.userId)).toEqual([e.workspaceId]);
      expect(await workspacesOf(a.userId)).toEqual([a.workspaceId]);
    }

    test("created more than 10 minutes ago, even with an empty Workspace", async () => {
      const e = await newAccount();
      await db.sql`update users set created_at = now() - interval '11 minutes'
        where id = ${e.userId}`;
      await expectDeclined(e);
    });

    test("a fresh account that already holds a lesson", async () => {
      const e = await newAccount();
      await createDocument(forWorkspace(db.unsafeDb, e.workspaceId), "lesson", generatedLesson());
      await expectDeclined(e);
    });

    test("a fresh account whose lesson is soft-deleted still counts as used", async () => {
      const e = await newAccount();
      const doc = await createDocument(
        forWorkspace(db.unsafeDb, e.workspaceId),
        "lesson",
        generatedLesson(),
      );
      await db.sql`update documents set deleted_at = now() where id = ${doc.id}`;
      await expectDeclined(e);
    });

    test("a fresh account that holds only an uploaded source", async () => {
      const e = await newAccount();
      const id = newId();
      await createSource(forWorkspace(db.unsafeDb, e.workspaceId), {
        id,
        kind: "file",
        name: "plants.pdf",
        mime: "application/pdf",
        byteSize: 10,
        storageKey: storageKey(e.workspaceId, "sources", id, "original.pdf"),
        pages: 2,
        lowText: false,
      });
      await expectDeclined(e);
    });
  });

  test("nothing to claim: a signed-in source, an anonymous or missing target, the same user", async () => {
    const a = await visitor();
    const teacher = await newAccount();
    const other = await newAccount();
    const anonTarget = await visitor();

    // The source is not anonymous: a teacher's Workspace is never handed to anyone.
    expect(
      await claimAnonymousWorkspace(db, { anonymousUserId: teacher.userId, userId: other.userId }),
    ).toBe("nothing-to-claim");
    expect(
      await claimAnonymousWorkspace(db, { anonymousUserId: a.userId, userId: anonTarget.userId }),
    ).toBe("nothing-to-claim");
    expect(
      await claimAnonymousWorkspace(db, { anonymousUserId: a.userId, userId: "no-such-user" }),
    ).toBe("nothing-to-claim");
    expect(await claimAnonymousWorkspace(db, { anonymousUserId: a.userId, userId: a.userId })).toBe(
      "nothing-to-claim",
    );

    expect(await workspacesOf(teacher.userId)).toEqual([teacher.workspaceId]);
    expect(await workspacesOf(a.userId)).toEqual([a.workspaceId]);
    expect(await workspacesOf(anonTarget.userId)).toEqual([anonTarget.workspaceId]);
  });

  test("two claims for one visitor at once: exactly one wins", async () => {
    const a = await visitor();
    const n1 = await newAccount();
    const n2 = await newAccount();
    const results = await Promise.all([
      claimAnonymousWorkspace(db, { anonymousUserId: a.userId, userId: n1.userId }),
      claimAnonymousWorkspace(db, { anonymousUserId: a.userId, userId: n2.userId }),
    ]);
    expect([...results].sort()).toEqual(["claimed", "nothing-to-claim"]);
    const winner = results[0] === "claimed" ? n1 : n2;
    const loser = results[0] === "claimed" ? n2 : n1;
    expect(await workspacesOf(winner.userId)).toEqual([a.workspaceId]);
    // The loser keeps its own empty Workspace: its delete never ran.
    expect(await workspacesOf(loser.userId)).toEqual([loser.workspaceId]);
  });

  describe("row 7: a fault mid-claim", () => {
    test("the transaction rolls back whole: both Workspaces stay where they were", async () => {
      const a = await visitor();
      const n = await newAccount();
      await withFailingWorkspaceHandover(db, async () => {
        await expect(
          claimAnonymousWorkspace(db, { anonymousUserId: a.userId, userId: n.userId }),
        ).rejects.toThrow();
      });
      expect(await workspacesOf(n.userId)).toEqual([n.workspaceId]);
      expect(await workspacesOf(a.userId)).toEqual([a.workspaceId]);
    });

    test("claimOnLink logs the failure with ids only and resolves", async () => {
      const a = await visitor();
      const n = await newAccount("private@example.test");
      const { logger, lines } = captureLogger();
      await withFailingWorkspaceHandover(db, async () => {
        await claimOnLink(db, logger, { anonymousUserId: a.userId, userId: n.userId });
      });
      const logged = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({
        level: 50,
        msg: "anonymous workspace claim failed",
        via: "link",
        anonymousUserId: a.userId,
        userId: n.userId,
      });
      expect(lines.join("\n")).not.toContain("private@example.test");
      expect(lines.join("\n")).not.toContain("injected claim fault");
      expect(await workspacesOf(n.userId)).toEqual([n.workspaceId]);
    });
  });

  test("claimOnLink logs one info line with the result and both ids", async () => {
    const a = await visitor();
    const n = await newAccount();
    const { logger, lines } = captureLogger();
    await claimOnLink(db, logger, { anonymousUserId: a.userId, userId: n.userId });
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      expect.objectContaining({
        level: 30,
        claim: "claimed",
        via: "link",
        anonymousUserId: a.userId,
        userId: n.userId,
      }),
    ]);
  });

  describe("pending claim", () => {
    test("a newer request for the same address replaces the older row", async () => {
      const first = await visitor();
      const second = await visitor();
      await writePendingClaim(db, { email: "Teacher@Example.test", anonymousUserId: first.userId });
      await writePendingClaim(db, {
        email: "teacher@example.test",
        anonymousUserId: second.userId,
      });
      expect([...(await claimRows())]).toEqual([
        { identifier: pendingClaimIdentifier("teacher@example.test"), value: second.userId },
      ]);
      const ttl = await db.sql<{ minutes: number }[]>`
        select round(extract(epoch from expires_at - now()) / 60)::int as minutes
        from verifications where identifier like 'claim:%'`;
      expect(ttl[0]?.minutes).toBe(60);
    });

    test("claimPending consumes the row and claims; a second session finds nothing", async () => {
      const a = await visitor();
      const n = await newAccount("Pending@Example.test");
      await writePendingClaim(db, { email: "pending@example.test", anonymousUserId: a.userId });
      const { logger, lines } = captureLogger();

      await claimPending(db, logger, n.userId);
      expect(await workspacesOf(n.userId)).toEqual([a.workspaceId]);
      expect(await claimRows()).toHaveLength(0);
      expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ claim: "claimed", via: "pending" });

      await claimPending(db, logger, n.userId);
      expect(lines).toHaveLength(1);
    });

    test("an expired row is removed and ignored", async () => {
      const a = await visitor();
      const n = await newAccount("late@example.test");
      await writePendingClaim(db, { email: "late@example.test", anonymousUserId: a.userId });
      await db.sql`update verifications set expires_at = now() - interval '1 second'
        where identifier = ${pendingClaimIdentifier("late@example.test")}`;
      const { logger, lines } = captureLogger();
      await claimPending(db, logger, n.userId);
      expect(lines).toEqual([]);
      expect(await claimRows()).toHaveLength(0);
      expect(await workspacesOf(n.userId)).toEqual([n.workspaceId]);
      expect(await workspacesOf(a.userId)).toEqual([a.workspaceId]);
    });

    test("two rows for one address (racing sends): the newest live one counts", async () => {
      const older = await visitor();
      const newer = await visitor();
      const n = await newAccount("race@example.test");
      const identifier = pendingClaimIdentifier("race@example.test");
      await db.sql`
        insert into verifications (id, identifier, value, expires_at, created_at, updated_at)
        values (${newId()}, ${identifier}, ${older.userId}, now() + interval '1 hour',
                now() - interval '1 minute', now()),
               (${newId()}, ${identifier}, ${newer.userId}, now() + interval '1 hour', now(), now())`;
      await claimPending(db, captureLogger().logger, n.userId);
      expect(await workspacesOf(n.userId)).toEqual([newer.workspaceId as WorkspaceId]);
      expect(await workspacesOf(older.userId)).toEqual([older.workspaceId]);
      expect(await claimRows()).toHaveLength(0);
    });

    test("a failing lookup is logged and swallowed", async () => {
      const broken = {
        sql: (() => Promise.reject(new Error("connection refused"))) as unknown as typeof db.sql,
      };
      const { logger, lines } = captureLogger();
      await claimPending(broken, logger, "user-1");
      expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
        level: 50,
        msg: "pending claim lookup failed",
        userId: "user-1",
      });
    });
  });
});
