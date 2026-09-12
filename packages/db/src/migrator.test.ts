import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { newId } from "@tj/domain";
import { migrateDatabase } from "./migrator";
import { createTestUserWithWorkspace, withTestDb } from "./testing";

const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping migrator tests: ${t.reason}`);

describeDb("migrations", () => {
  if (!t.ok) return;
  const { sql, unsafeDb, url, close } = t.db;
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

  test("0006 rewrites absolute /files/ picture URLs to the relative path and nothing else (TEACH-275)", async () => {
    // The migration has already run on this database; run its statement again on a seeded row —
    // it is written to be idempotent, so the file itself is what is tested.
    const statement = readFileSync(
      new URL("../drizzle/0006_relative_file_urls.sql", import.meta.url).pathname,
      "utf8",
    ).replace(/^--.*$/gm, "");
    const { workspaceId } = await createTestUserWithWorkspace(unsafeDb);
    const id = newId();
    const body = {
      id,
      version: 1,
      title: "Pictures",
      slides: [
        {
          id: "s1",
          background: { image: "https://api-production-903f.up.railway.app/files/ws/bg.png" },
          elements: [
            { id: "i1", type: "image", src: "https://api.bresinski.org/files/ws/a.png" },
            { id: "i2", type: "image", src: "https://images.pexels.com/photos/1/a.jpeg" },
            { id: "i3", type: "image", src: "/files/ws/already.png" },
            { id: "i4", type: "image", src: "data:image/png;base64,AAAA" },
          ],
        },
      ],
    };
    await sql`insert into documents (id, workspace_id, kind, body, title, item_count)
      values (${id}, ${workspaceId}, 'lesson', ${JSON.stringify(body)}::jsonb, 'Pictures', 1)`;
    await sql.unsafe(statement);
    const [row] = await sql<{ body: typeof body }[]>`select body from documents where id = ${id}`;
    const slide = row?.body.slides[0];
    expect(slide?.background.image).toBe("/files/ws/bg.png");
    expect(slide?.elements.map((e) => e.src)).toEqual([
      "/files/ws/a.png",
      "https://images.pexels.com/photos/1/a.jpeg",
      "/files/ws/already.png",
      "data:image/png;base64,AAAA",
    ]);
    await sql`delete from documents where id = ${id}`;
  });
});
