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

  test("the application tables exist", async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name in ('workspaces', 'job_events', 'documents')
      order by table_name`;
    expect(rows.map((r) => r.table_name)).toEqual(["documents", "job_events", "workspaces"]);
  });

  test("documents has the document_kind enum and its four indexes (ADR 0024 §3)", async () => {
    const kinds = await sql<{ enumlabel: string }[]>`
      select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'document_kind' order by e.enumsortorder`;
    expect(kinds.map((k) => k.enumlabel)).toEqual(["lesson", "worksheet", "series"]);
    const indexes = await sql<{ indexname: string }[]>`
      select indexname from pg_indexes where tablename = 'documents' order by indexname`;
    expect(indexes.map((i) => i.indexname)).toEqual([
      "documents_pkey",
      "documents_workspace_id_deleted_at_idx",
      "documents_workspace_id_idx",
      "documents_workspace_id_kind_title_idx",
      "documents_workspace_id_kind_updated_at_idx",
    ]);
  });
});
