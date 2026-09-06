import { newId, type UserId, type WorkspaceId } from "@tj/domain";
import { sql as rawSql } from "drizzle-orm";
import postgres from "postgres";
import { createDb, type Db, type DbHandle } from "./client";
import { migrateDatabase } from "./migrator";
import { users, workspaces } from "./schema/index";

/** Handle returned by `withTestDb()`: a normal `DbHandle` plus a fast reset between tests. */
export interface TestDbHandle extends DbHandle {
  url: string;
  /**
   * `TRUNCATE job_events, documents, workspaces, sessions, accounts, verifications, users RESTART
   * IDENTITY CASCADE` — every application table, identity included — call in `beforeEach`.
   */
  truncateTenantTables: () => Promise<void>;
}

export type WithTestDbResult = { ok: true; db: TestDbHandle } | { ok: false; reason: string };

const migrated = new Set<string>();

/**
 * Connect to `TEST_DATABASE_URL` for a `bun test` file. Migrates the database once per process
 * (many files can share it), and returns `{ ok: false, reason }` — instead of throwing — when the
 * URL is unset or the server is unreachable, so tests can skip visibly (unless `REQUIRE_TEST_DB=1`,
 * in which case it throws so the skip becomes a failure — see `REQUIRE_TEST_DB_MESSAGE`):
 *
 * ```ts
 * const t = await withTestDb();
 * const describeDb = t.ok ? describe : describe.skip;
 * if (!t.ok) console.warn(`skipping db tests: ${t.reason}`);
 *
 * describeDb("job events", () => {
 *   if (!t.ok) return;
 *   const { unsafeDb, sql, truncateTenantTables, close } = t.db;
 *   beforeEach(() => truncateTenantTables());
 *   afterAll(() => close());
 *   …
 * });
 * ```
 *
 * The connection targets `TEST_DATABASE_URL` only, never `DATABASE_URL`, so a test run cannot
 * wipe development data. Concurrent test processes (turbo runs packages in parallel) are
 * serialised with an advisory lock held until `close()` — **always call `close()` in `afterAll`**. Truncation covers every table in the schema; add new tenant tables to
 * `truncateTenantTables` when they land (the invariant test in `schema.test.ts` reminds you).
 */
export async function withTestDb(opts: { max?: number } = {}): Promise<WithTestDbResult> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    return unavailable("TEST_DATABASE_URL is not set (run `bun run test:db`)");
  }
  let lock: postgres.Sql;
  try {
    lock = await acquireTestDbLock(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return unavailable(`cannot reach ${url}: ${message}`);
  }
  if (!migrated.has(url)) {
    try {
      await migrateDatabase(url);
      migrated.add(url);
    } catch (err) {
      await releaseTestDbLock(lock);
      const message = err instanceof Error ? err.message : String(err);
      return unavailable(`cannot reach or migrate ${url}: ${message}`);
    }
  }
  const handle = createDb(url, { max: opts.max ?? 4 });
  const db: TestDbHandle = {
    ...handle,
    url,
    truncateTenantTables: async () => {
      await handle.unsafeDb.execute(
        rawSql`truncate table job_events, documents, workspaces, sessions, accounts, verifications, users restart identity cascade`,
      );
    },
    close: async () => {
      await handle.close();
      await releaseTestDbLock(lock);
    },
  };
  return { ok: true, db };
}

/**
 * `REQUIRE_TEST_DB=1` (set by `bun run test:db` and CI) turns "skip with a reason" into a hard
 * failure, so a green run can never be an all-skipped run: the file-level `await withTestDb()`
 * throws and `bun test` reports the file as failed with the reason in the message.
 */
export const REQUIRE_TEST_DB_MESSAGE =
  "REQUIRE_TEST_DB=1 but the test database is unavailable — the DB suites would have been skipped";

function unavailable(reason: string): WithTestDbResult {
  if (process.env.REQUIRE_TEST_DB === "1") {
    throw new Error(`${REQUIRE_TEST_DB_MESSAGE}: ${reason}`);
  }
  return { ok: false, reason };
}

/**
 * Cross-process serialisation of the test database. `turbo run test` runs `@tj/db`, `@tj/jobs`
 * and `@tj/api` in parallel and they all `TRUNCATE … CASCADE` the same `TEST_DATABASE_URL`, so
 * without coordination one package wipes the rows another one just inserted. Every
 * `withTestDb()` holds a Postgres **session-level advisory lock** (on a dedicated connection)
 * from here until `close()`; other processes block in `pg_advisory_lock` until it is released.
 * A process that dies without calling `close()` releases the lock when its connection drops.
 */
const TEST_DB_LOCK_KEY = 7_324_001;

async function acquireTestDbLock(url: string): Promise<postgres.Sql> {
  const lock = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await lock`select pg_advisory_lock(${TEST_DB_LOCK_KEY})`;
  } catch (err) {
    await lock.end({ timeout: 1 }).catch(() => undefined);
    throw err;
  }
  return lock;
}

async function releaseTestDbLock(lock: postgres.Sql): Promise<void> {
  await lock`select pg_advisory_unlock(${TEST_DB_LOCK_KEY})`.catch(() => undefined);
  await lock.end({ timeout: 5 });
}

// ---------------------------------------------------------------------------------------------
// Factories (TEACH-20). Used by the api/worker tests and by TEACH-22's test routes.
// ---------------------------------------------------------------------------------------------

export interface CreateTestUserOptions {
  userId?: string;
  workspaceId?: WorkspaceId;
  email?: string;
  name?: string;
  workspaceName?: string;
}

export interface TestUserWithWorkspace {
  userId: UserId;
  workspaceId: WorkspaceId;
  email: string;
}

/**
 * Insert a `users` row **directly** (bypassing better-auth) plus its personal `workspaces` row —
 * exactly what `createPersonalWorkspace()` produces after a first sign-in. `workspaces.owner_user_id`
 * has a FK to `users`, so tests can no longer insert a Workspace with a made-up owner; use this.
 */
export async function createTestUserWithWorkspace(
  db: Db,
  opts: CreateTestUserOptions = {},
): Promise<TestUserWithWorkspace> {
  const userId = opts.userId ?? newId();
  const workspaceId = opts.workspaceId ?? newId<WorkspaceId>();
  const email = opts.email ?? `${userId}@test.example`;
  const now = new Date();
  await db.insert(users).values({
    id: userId,
    name: opts.name ?? "Test Teacher",
    email,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db
    .insert(workspaces)
    .values({ id: workspaceId, ownerUserId: userId, name: opts.workspaceName ?? "Personal" });
  return { userId: userId as UserId, workspaceId, email };
}

/**
 * The slice of a better-auth instance `issueSessionCookie()` needs. Typed structurally so
 * `@tj/db` does not depend on `better-auth`; the `Auth` returned by `createAuth()` in `@tj/api`
 * satisfies it.
 */
export interface SessionIssuer {
  handler: (request: Request) => Promise<Response>;
  $context: Promise<{
    baseURL: string;
    internalAdapter: {
      findUserById: (id: string) => Promise<{ email: string } | null | undefined>;
      createVerificationValue: (data: {
        identifier: string;
        value: string;
        expiresAt: Date;
      }) => Promise<unknown>;
    };
  }>;
}

/**
 * Sign `userId` in and return a `Cookie` header value (`tj.session_token=…; …`) that
 * `requireSession` accepts. Implementation: store a magic-link verification value straight
 * through better-auth's internal adapter, then run `GET /magic-link/verify?token=…` through
 * `auth.handler` and collect its `Set-Cookie` headers — the cookies are therefore signed and
 * shaped exactly like a real sign-in, without touching cookie internals.
 */
export async function issueSessionCookie(auth: SessionIssuer, userId: string): Promise<string> {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.findUserById(userId);
  if (!user) throw new Error(`issueSessionCookie: no user with id ${userId}`);
  const token = newId().replaceAll("-", "");
  await ctx.internalAdapter.createVerificationValue({
    identifier: token,
    value: JSON.stringify({ email: user.email }),
    expiresAt: new Date(Date.now() + 60_000),
  });
  const url = `${ctx.baseURL}/magic-link/verify?token=${token}`;
  const res = await auth.handler(new Request(url, { headers: { accept: "application/json" } }));
  if (res.status !== 200) {
    throw new Error(`issueSessionCookie: verify returned ${res.status}: ${await res.text()}`);
  }
  return cookieHeaderFromResponse(res);
}

/** Turn a response's `Set-Cookie` headers into a `Cookie` request header value. */
export function cookieHeaderFromResponse(res: Response): string {
  const pairs = res.headers
    .getSetCookie()
    .map((line) => line.split(";")[0] ?? "")
    .filter((pair) => pair.length > 0 && !pair.endsWith("="));
  return pairs.join("; ");
}
