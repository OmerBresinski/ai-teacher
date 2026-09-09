#!/usr/bin/env bun
// bun run db:backfill-summaries [--dry-run] [--kind lesson|worksheet|series] [--force]  (packages/db)
//
// Rewrites the promoted list columns (`summarise(body)`: title, subject, year group, theme, item
// count, marks, cover) of the `documents` rows in DATABASE_URL, deleted rows included. The
// repository recomputes them only on save, so a change to `summarise()` (TEACH-193: worksheet
// covers) leaves existing rows behind until this runs.
//
// - DATABASE_URL must be set explicitly; nothing is derived. A non-local URL runs as a dry run
//   unless `--force` is given.
// - `--dry-run` computes the columns, compares them with the row's, and prints the count of rows
//   that would change (and the first few ids) without writing.
// - `--kind` limits the run to one document kind.
// - Rows are read 200 at a time by id, and each update is predicated on the `updated_at` the row
//   was read with: a row saved under the backfill is skipped and reported, never overwritten
//   with columns from an older body. Rows held by a generation job are skipped too.

import { parseArgs } from "node:util";
import { DOCUMENT_KINDS, type DocumentKind } from "@tj/domain/documents";
import { and, asc, eq, gt, type SQL } from "drizzle-orm";
import { createDb } from "./client";
import { parseDocumentBody, promotedColumns } from "./documents";
import { documents } from "./schema/documents";

const PAGE = 200;
const USAGE = "usage: bun run db:backfill-summaries [--dry-run] [--kind <kind>] [--force]";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "dry-run": { type: "boolean", default: false },
    kind: { type: "string" },
    force: { type: "boolean", default: false },
  },
  strict: true,
});

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(`db:backfill-summaries: DATABASE_URL is not set. Export it explicitly.\n${USAGE}`);
  process.exit(1);
}
const kind = values.kind as DocumentKind | undefined;
if (kind !== undefined && !DOCUMENT_KINDS.includes(kind)) {
  console.error(`db:backfill-summaries: --kind must be one of ${DOCUMENT_KINDS.join(", ")}.`);
  process.exit(1);
}
const host = (() => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
})();
const local = ["localhost", "127.0.0.1", "::1"].includes(host);
let dryRun = values["dry-run"];
if (!local && !dryRun && !values.force) {
  console.error(
    `db:backfill-summaries: ${host || "that host"} is not local; running as a dry run. Pass --force to write.`,
  );
  dryRun = true;
}

/**
 * Whether the row already holds these columns. jsonb hands keys back sorted and never stores an
 * `undefined`, so both sides are canonicalised (keys sorted, undefined dropped) before comparing.
 */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonical(v);
    }
    return out;
  }
  return value;
};
const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const { unsafeDb, close } = createDb(url, { max: 2 });
const started = performance.now();
let seen = 0;
let written = 0;
let unchanged = 0;
const changed: string[] = [];
const skipped: string[] = [];
try {
  let after: string | null = null;
  for (;;) {
    const where: SQL[] = [];
    if (after !== null) where.push(gt(documents.id, after));
    if (kind !== undefined) where.push(eq(documents.kind, kind));
    const rows = await unsafeDb
      .select({
        id: documents.id,
        kind: documents.kind,
        body: documents.body,
        updatedAt: documents.updatedAt,
        generatingJobId: documents.generatingJobId,
        title: documents.title,
        subject: documents.subject,
        yearGroup: documents.yearGroup,
        themeId: documents.themeId,
        itemCount: documents.itemCount,
        marks: documents.marks,
        cover: documents.cover,
      })
      .from(documents)
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(documents.id))
      .limit(PAGE);
    for (const row of rows) {
      seen += 1;
      after = row.id;
      if (row.generatingJobId !== null) {
        skipped.push(`${row.id}: held by job ${row.generatingJobId}`);
        continue;
      }
      let columns: ReturnType<typeof promotedColumns>;
      try {
        columns = promotedColumns(parseDocumentBody(row.kind, row.body));
      } catch (err) {
        skipped.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      const current = {
        title: row.title,
        subject: row.subject,
        yearGroup: row.yearGroup,
        themeId: row.themeId,
        itemCount: row.itemCount,
        marks: row.marks,
        cover: row.cover ?? null,
      };
      if (same(current, columns)) {
        unchanged += 1;
        continue;
      }
      changed.push(row.id);
      if (dryRun) continue;
      const done = await unsafeDb
        .update(documents)
        .set(columns)
        .where(and(eq(documents.id, row.id), eq(documents.updatedAt, row.updatedAt)))
        .returning({ id: documents.id });
      if (done.length === 0) skipped.push(`${row.id}: saved under the backfill; run again`);
      else written += 1;
    }
    if (rows.length < PAGE) break;
  }
} finally {
  await close();
}
const ms = Math.round(performance.now() - started);
const scope = kind ? ` (${kind})` : "";
if (dryRun) {
  console.log(
    `db:backfill-summaries (dry run)${scope}: ${changed.length} of ${seen} rows would change, ${unchanged} already current (${ms} ms)`,
  );
  if (changed.length > 0) console.log(`  first ids: ${changed.slice(0, 5).join(", ")}`);
} else {
  console.log(
    `db:backfill-summaries${scope}: ${written} of ${seen} rows rewritten, ${unchanged} already current (${ms} ms)`,
  );
}
for (const line of skipped) console.error(`db:backfill-summaries: skipped ${line}`);
if (skipped.length > 0) process.exit(1);
