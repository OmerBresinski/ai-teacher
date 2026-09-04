import { sql as rawSql } from "drizzle-orm";
import { createDb, type DbHandle } from "./client";
import { migrateDatabase } from "./migrator";

/** Handle returned by `withTestDb()`: a normal `DbHandle` plus a fast reset between tests. */
export interface TestDbHandle extends DbHandle {
  url: string;
  /** `TRUNCATE job_events, workspaces RESTART IDENTITY CASCADE` — call in `beforeEach`. */
  truncateTenantTables: () => Promise<void>;
}

export type WithTestDbResult = { ok: true; db: TestDbHandle } | { ok: false; reason: string };

const migrated = new Set<string>();

/**
 * Connect to `TEST_DATABASE_URL` for a `bun test` file. Migrates the database once per process
 * (many files can share it), and returns `{ ok: false, reason }` — instead of throwing — when the
 * URL is unset or the server is unreachable, so tests can skip visibly:
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
 * wipe development data. Truncation covers every table in the schema; add new tenant tables to
 * `truncateTenantTables` when they land (the invariant test in `schema.test.ts` reminds you).
 */
export async function withTestDb(opts: { max?: number } = {}): Promise<WithTestDbResult> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    return { ok: false, reason: "TEST_DATABASE_URL is not set (run `bun run test:db`)" };
  }
  if (!migrated.has(url)) {
    try {
      await migrateDatabase(url);
      migrated.add(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `cannot reach or migrate ${url}: ${message}` };
    }
  }
  const handle = createDb(url, { max: opts.max ?? 4 });
  const db: TestDbHandle = {
    ...handle,
    url,
    truncateTenantTables: async () => {
      await handle.unsafeDb.execute(
        rawSql`truncate table job_events, workspaces restart identity cascade`,
      );
    },
  };
  return { ok: true, db };
}
