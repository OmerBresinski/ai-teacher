/**
 * TEACH-224 at function level against the real test database: `claimAnonymousWorkspace` hands the
 * anonymous Workspace over or moves its lessons into an existing account (ruling 127, TEACH-245),
 * signing the anonymous user out, sees a lesson that lands while it waits for its lock, rolls back whole on a fault, and serialises two claims
 * for one visitor; the pending claim is replaced, consumed once, kept when its claim fails and
 * ignored when expired. The sign-in flows that reach these are in `auth.db.test.ts`.
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

const SECRET = "test-secret-test-secret-test-secret-0123456789";

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
  /** A live session row for `userId`, as better-auth stores one. */
  async function sessionFor(userId: string) {
    await db.sql`
      insert into sessions (id, token, user_id, expires_at, created_at, updated_at)
      values (${newId()}, ${newId()}, ${userId}, now() + interval '7 days', now(), now())`;
  }
  async function sessionCount(userId: string) {
    const rows = await db.sql<{ n: number }[]>`
      select count(*)::int as n from sessions where user_id = ${userId}`;
    return rows[0]?.n ?? 0;
  }
  const pending = (userId: string) =>
    claimPending(db, captureLogger().logger, {
      secret: SECRET,
      userId,
      ctx: null,
    });

  test("row 1: a new account takes the anonymous Workspace; its empty one is deleted", async () => {
    const a = await visitor();
    const n = await newAccount();
    await sessionFor(a.userId);
    await sessionFor(n.userId);

    const ids = { anonymousUserId: a.userId, userId: n.userId };
    expect(await claimAnonymousWorkspace(db, ids)).toBe("claimed");

    expect(await ownerOf(a.workspaceId)).toBe(n.userId);
    expect(await workspacesOf(n.userId)).toEqual([a.workspaceId]);
    expect(await ownerOf(n.workspaceId)).toBeUndefined();
    expect(await workspacesOf(a.userId)).toEqual([]);
    // The anonymous user stays for the cleanup job (disableDeleteAnonymousUser), signed out
    // everywhere; the new account's own session is untouched.
    expect(await isAnonymous(a.userId)).toBe(true);
    expect(await sessionCount(a.userId)).toBe(0);
    expect(await sessionCount(n.userId)).toBe(1);
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

  /** An in-memory object store with `<workspaceId>/…` keys, as `@tj/storage` lists them. */
  function memoryStorage(failOn?: string) {
    const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
    return {
      objects,
      async put(
        key: string,
        body: ReadableStream<Uint8Array> | Uint8Array,
        opts: { contentType: string },
      ) {
        const bytes =
          body instanceof Uint8Array
            ? body
            : new Uint8Array(await new Response(body).arrayBuffer());
        objects.set(key, { bytes, contentType: opts.contentType });
        return { key };
      },
      async get(key: string) {
        if (key === failOn) throw new Error("injected storage fault");
        const o = objects.get(key);
        if (!o) throw new Error("not_found");
        return {
          key,
          body: new Response(o.bytes).body as ReadableStream<Uint8Array>,
          contentType: o.contentType,
          size: o.bytes.length,
          updatedAt: new Date(),
        };
      },
      async *list(prefix: string) {
        for (const [key, o] of objects) {
          if (key.startsWith(prefix)) yield { key, size: o.bytes.length, updatedAt: new Date() };
        }
      },
    };
  }

  /** Points the visitor's lesson at a picture under its Workspace, as a generated lesson does. */
  async function withPicture(a: { workspaceId: string; lessonId: string }) {
    const src = `/files/${a.workspaceId}/images/pic.jpg`;
    // Any string in the body will do: the move rewrites the whole body's text.
    await db.sql`update documents set body = jsonb_set(body, '{title}', to_jsonb(${src}::text)),
      cover = jsonb_build_object('src', ${src}::text) where id = ${a.lessonId}`;
    return src;
  }

  describe("row 4: an existing account takes the lesson (ruling 127)", () => {
    async function expectMoved(e: { userId: string; workspaceId: string }) {
      const a = await visitor();
      await sessionFor(a.userId);
      const src = await withPicture(a);
      const storage = memoryStorage();
      await storage.put(`${a.workspaceId}/images/pic.jpg`, new Uint8Array([1, 2, 3]), {
        contentType: "image/jpeg",
      });
      const ids = { anonymousUserId: a.userId, userId: e.userId };
      expect(await claimAnonymousWorkspace(db, ids, storage)).toBe("moved");
      // The account keeps its own Workspace; the lesson moved into it under the same id.
      expect(await workspacesOf(e.userId)).toEqual([e.workspaceId]);
      const [moved] = await db.sql<{ workspace: string; title: string; cover: { src: string } }[]>`
        select workspace_id as workspace, body->>'title' as title, cover from documents
        where id = ${a.lessonId}`;
      const to = src.replace(a.workspaceId, e.workspaceId);
      expect(moved).toEqual({ workspace: e.workspaceId, title: to, cover: { src: to } });
      // The picture is copied under the account's prefix, bytes and type intact.
      const copy = storage.objects.get(`${e.workspaceId}/images/pic.jpg`);
      expect(copy?.contentType).toBe("image/jpeg");
      expect([...(copy?.bytes ?? [])]).toEqual([1, 2, 3]);
      // The anonymous user is signed out and its emptied Workspace is left for the cleanup job.
      expect(await sessionCount(a.userId)).toBe(0);
      expect(await workspacesOf(a.userId)).toEqual([a.workspaceId]);
      // Moved once: nothing is left to claim.
      expect(await claimAnonymousWorkspace(db, ids, storage)).toBe("nothing-to-claim");
      return a;
    }

    test("an older account with an empty Workspace takes the Workspace whole", async () => {
      const e = await newAccount();
      await db.sql`update users set created_at = now() - interval '11 minutes'
        where id = ${e.userId}`;
      const a = await visitor();
      expect(
        await claimAnonymousWorkspace(db, { anonymousUserId: a.userId, userId: e.userId }),
      ).toBe("claimed");
      expect(await workspacesOf(e.userId)).toEqual([a.workspaceId]);
    });

    test("an account that already holds a lesson: both lessons are in it, its own untouched", async () => {
      const e = await newAccount();
      await db.sql`update users set created_at = now() - interval '1 day' where id = ${e.userId}`;
      const own = await createDocument(
        forWorkspace(db.unsafeDb, e.workspaceId),
        "lesson",
        generatedLesson(),
      );
      await expectMoved(e);
      const [kept] = await db.sql<{ workspace: string }[]>`
        select workspace_id as workspace from documents where id = ${own.id}`;
      expect(kept?.workspace).toBe(e.workspaceId);
    });

    test("an account whose only lesson is soft-deleted", async () => {
      const e = await newAccount();
      const doc = await createDocument(
        forWorkspace(db.unsafeDb, e.workspaceId),
        "lesson",
        generatedLesson(),
      );
      await db.sql`update documents set deleted_at = now() where id = ${doc.id}`;
      await expectMoved(e);
    });

    test("an account that holds only an uploaded source", async () => {
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
      await expectMoved(e);
    });

    test("a picture that cannot be copied rolls the move back: the lesson stays put", async () => {
      const e = await newAccount();
      await createDocument(forWorkspace(db.unsafeDb, e.workspaceId), "lesson", generatedLesson());
      const a = await visitor();
      await sessionFor(a.userId);
      await withPicture(a);
      const key = `${a.workspaceId}/images/pic.jpg`;
      const storage = memoryStorage(key);
      await storage.put(key, new Uint8Array([1]), { contentType: "image/jpeg" });
      await expect(
        claimAnonymousWorkspace(db, { anonymousUserId: a.userId, userId: e.userId }, storage),
      ).rejects.toThrow("injected storage fault");
      const [row] = await db.sql<{ workspace: string }[]>`
        select workspace_id as workspace from documents where id = ${a.lessonId}`;
      expect(row?.workspace).toBe(a.workspaceId);
      expect(await sessionCount(a.userId)).toBe(1);
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

  test("a lesson that lands while the claim waits for its lock is seen: moved beside it, not deleted", async () => {
    const a = await visitor();
    const n = await newAccount();
    const sourceId = newId();
    let commitInsert = () => {};
    const held = new Promise<void>((resolve) => {
      commitInsert = resolve;
    });
    let inserted = () => {};
    const insertedOnce = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    // The new account's first upload, mid-transaction: its foreign key holds a key-share lock on
    // the Workspace row, so the claim's `for update` waits for it to commit.
    const insert = db.sql.begin(async (tx) => {
      await tx`
        insert into sources (id, workspace_id, kind, name, mime, byte_size, storage_key, pages,
                             low_text, created_at, updated_at)
        values (${sourceId}, ${n.workspaceId}, 'file', 'held.pdf', 'application/pdf', 1,
                ${storageKey(n.workspaceId, "sources", sourceId, "original.pdf")}, 1, false,
                now(), now())`;
      inserted();
      await held;
    });
    await insertedOnce;
    const claim = claimAnonymousWorkspace(db, { anonymousUserId: a.userId, userId: n.userId });
    // Commit the insert only once the claim is blocked on it; a claim that never blocked would
    // not exercise the lock at all, so that fails the test.
    let waited = false;
    for (let i = 0; i < 400 && !waited; i++) {
      const [waiting] = await db.sql<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
          and wait_event = 'transactionid' and query like '%for update%'`;
      waited = (waiting?.n ?? 0) > 0;
      if (!waited) await Bun.sleep(5);
    }
    commitInsert();
    await insert;
    expect(waited).toBe(true);

    expect(await claim).toBe("moved");
    expect(await workspacesOf(n.userId)).toEqual([n.workspaceId]);
    const [lesson] = await db.sql<{ workspace: string }[]>`
      select workspace_id as workspace from documents where id = ${a.lessonId}`;
    expect(lesson?.workspace).toBe(n.workspaceId);
    const kept = await db.sql`select id from sources where id = ${sourceId}`;
    expect(kept).toHaveLength(1);
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
    const write = (email: string, anonymousUserId: string) =>
      writePendingClaim(db, { secret: SECRET, email, anonymousUserId });

    test("the identifier is a keyed hash: no address in the table, and not guessable", () => {
      const id = pendingClaimIdentifier(SECRET, "Teacher@Example.test");
      expect(id).toBe(pendingClaimIdentifier(SECRET, "teacher@example.test"));
      expect(id.startsWith("claim:")).toBe(true);
      expect(id.toLowerCase()).not.toContain("teacher");
      expect(id).not.toBe(pendingClaimIdentifier(`${SECRET}-other`, "teacher@example.test"));
    });

    test("a newer request for the same address replaces the older row", async () => {
      const first = await visitor();
      const second = await visitor();
      await write("Teacher@Example.test", first.userId);
      await write("teacher@example.test", second.userId);
      expect([...(await claimRows())]).toEqual([
        {
          identifier: pendingClaimIdentifier(SECRET, "teacher@example.test"),
          value: second.userId,
        },
      ]);
      const ttl = await db.sql<{ minutes: number }[]>`
        select round(extract(epoch from expires_at - now()) / 60)::int as minutes
        from verifications where identifier like 'claim:%'`;
      expect(ttl[0]?.minutes).toBe(60);
    });

    test("claimPending consumes the row and claims; a second session finds nothing", async () => {
      const a = await visitor();
      const n = await newAccount("Pending@Example.test");
      await write("pending@example.test", a.userId);
      const { logger, lines } = captureLogger();
      const run = () => claimPending(db, logger, { secret: SECRET, userId: n.userId, ctx: null });

      await run();
      expect(await workspacesOf(n.userId)).toEqual([a.workspaceId]);
      expect(await claimRows()).toHaveLength(0);
      expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
        level: 30,
        msg: "anonymous workspace claim",
        claim: "claimed",
        via: "pending",
        anonymousUserId: a.userId,
        userId: n.userId,
      });

      await run();
      expect(lines).toHaveLength(1);
    });

    test("a claim that fails keeps the row for the next sign-in within the hour", async () => {
      const a = await visitor();
      const n = await newAccount("retry@example.test");
      await write("retry@example.test", a.userId);
      const { logger, lines } = captureLogger();
      const run = () => claimPending(db, logger, { secret: SECRET, userId: n.userId, ctx: null });

      await withFailingWorkspaceHandover(db, run);
      expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
        level: 50,
        msg: "anonymous workspace claim failed",
        via: "pending",
        anonymousUserId: a.userId,
        userId: n.userId,
      });
      expect(await claimRows()).toHaveLength(1);
      expect(await workspacesOf(n.userId)).toEqual([n.workspaceId]);

      await run();
      expect(await workspacesOf(n.userId)).toEqual([a.workspaceId]);
      expect(await claimRows()).toHaveLength(0);
    });

    test("an expired row is removed and ignored", async () => {
      const a = await visitor();
      const n = await newAccount("late@example.test");
      await write("late@example.test", a.userId);
      await db.sql`update verifications set expires_at = now() - interval '1 second'
        where identifier like 'claim:%'`;
      const { logger, lines } = captureLogger();
      await claimPending(db, logger, { secret: SECRET, userId: n.userId, ctx: null });
      expect(lines).toEqual([]);
      expect(await claimRows()).toHaveLength(0);
      expect(await workspacesOf(n.userId)).toEqual([n.workspaceId]);
      expect(await workspacesOf(a.userId)).toEqual([a.workspaceId]);
    });

    test("two rows for one address (racing sends): the newest live one counts", async () => {
      const older = await visitor();
      const newer = await visitor();
      const n = await newAccount("race@example.test");
      const identifier = pendingClaimIdentifier(SECRET, "race@example.test");
      await db.sql`
        insert into verifications (id, identifier, value, expires_at, created_at, updated_at)
        values (${newId()}, ${identifier}, ${older.userId}, now() + interval '1 hour',
                now() - interval '1 minute', now()),
               (${newId()}, ${identifier}, ${newer.userId}, now() + interval '1 hour', now(), now())`;
      await pending(n.userId);
      expect(await workspacesOf(n.userId)).toEqual([newer.workspaceId as WorkspaceId]);
      expect(await workspacesOf(older.userId)).toEqual([older.workspaceId]);
      expect(await claimRows()).toHaveLength(0);
    });

    test("a failing lookup is logged and swallowed", async () => {
      const broken = {
        sql: (() => Promise.reject(new Error("connection refused"))) as unknown as typeof db.sql,
      };
      const { logger, lines } = captureLogger();
      await claimPending(broken, logger, { secret: SECRET, userId: "user-1", ctx: null });
      expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
        level: 50,
        msg: "anonymous workspace claim failed",
        userId: "user-1",
      });
    });
  });
});
