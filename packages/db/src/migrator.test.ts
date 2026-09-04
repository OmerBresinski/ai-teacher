import { afterAll, describe, expect, test } from "bun:test";
import { migrateDatabase } from "./migrator";
import { withTestDb } from "./testing";

const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping migrator tests: ${t.reason}`);

describeDb("migrations", () => {
  if (!t.ok) return;
  const { sql, url, close } = t.db;
  afterAll(() => close());

  test("running the migrator again is a no-op", async () => {
    const before = await sql<{ count: string }[]>`
      select count(*)::text as count from drizzle.__drizzle_migrations`;
    await migrateDatabase(url);
    await migrateDatabase(url);
    const after = await sql<{ count: string }[]>`
      select count(*)::text as count from drizzle.__drizzle_migrations`;
    expect(after[0]?.count).toBe(before[0]?.count);
    expect(Number(after[0]?.count)).toBeGreaterThan(0);
  });

  test("pgvector is installed", async () => {
    const rows = await sql`select extname from pg_extension where extname = 'vector'`;
    expect(rows.length).toBe(1);
  });

  test("both application tables exist", async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name in ('workspaces', 'job_events')
      order by table_name`;
    expect(rows.map((r) => r.table_name)).toEqual(["job_events", "workspaces"]);
  });
});
