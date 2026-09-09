#!/usr/bin/env bun
// bun run db:backfill-summaries  (packages/db)
//
// Rewrites the promoted list columns (`summarise(body)`: title, subject, year group, theme, item
// count, marks, cover) of every `documents` row in DATABASE_URL, deleted rows included. The
// repository recomputes them only on save, so a change to `summarise()` (TEACH-193: worksheet
// covers) leaves existing rows behind until this runs. Bodies are parsed the way a read parses
// them, so a row that will not parse is reported and skipped, never rewritten.

import { eq } from "drizzle-orm";
import { createDb } from "./client";
import { parseDocumentBody, promotedColumns } from "./documents";
import { documents } from "./schema/documents";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("db:backfill-summaries: DATABASE_URL is not set.");
  process.exit(1);
}

const { unsafeDb, close } = createDb(url, { max: 2 });
const started = performance.now();
let written = 0;
const skipped: string[] = [];
try {
  const rows = await unsafeDb
    .select({ id: documents.id, kind: documents.kind, body: documents.body })
    .from(documents);
  for (const row of rows) {
    let columns: ReturnType<typeof promotedColumns>;
    try {
      columns = promotedColumns(parseDocumentBody(row.kind, row.body));
    } catch (err) {
      skipped.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    await unsafeDb.update(documents).set(columns).where(eq(documents.id, row.id));
    written += 1;
  }
} finally {
  await close();
}
const ms = Math.round(performance.now() - started);
console.log(
  `db:backfill-summaries: ${written} of ${written + skipped.length} rows rewritten (${ms} ms)`,
);
for (const line of skipped) console.error(`db:backfill-summaries: skipped ${line}`);
if (skipped.length > 0) process.exit(1);
