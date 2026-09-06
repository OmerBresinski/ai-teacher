#!/usr/bin/env bun
// bun run db:seed -- fill one Workspace with the TeachDeck starter content (ADR 0024 §16):
//   the two demo lessons (`demoLibrary()`) and the demo worksheet (`demoWorksheet()`) from
//   `@tj/editor`, inserted through the `@tj/db` documents repository so every promoted column is
//   computed the same way the API computes it.
//
//   bun run db:seed --workspace <uuid>        # a Workspace id
//   bun run db:seed --email teacher@x.test    # the personal Workspace of that user
//   bun run db:seed --email … --database-url postgres://…   # another database (e2e uses the
//                                                          # test database)
//
// Idempotent: a document whose title already exists in the Workspace (deleted or not) is skipped,
// so running it twice inserts nothing the second time. New Workspaces are empty in production; this
// is for development and e2e only, and it refuses to run unless DATABASE_URL points at localhost.

import { parseArgs } from "node:util";
import { createDb, createDocument, documents, forWorkspace } from "@tj/db";
import { type WorkspaceId, WorkspaceId as WorkspaceIdSchema } from "@tj/domain";
import type { DocumentKind } from "@tj/domain/documents";
import { demoLibrary, demoWorksheet } from "@tj/editor/starter";
import { databaseUrl, parseDatabaseUrl } from "./lib/env";
import { ExitCode, runMain, UserFacingError } from "./lib/exit";
import { log } from "./lib/log";

const USAGE =
  "usage: bun run db:seed (--workspace <uuid> | --email <address>) [--database-url <url>]";

/** The documents the seed owns: kind + body. Titles are the idempotency key. */
export function seedDocuments(): { kind: DocumentKind; body: { title: string } }[] {
  return [
    ...demoLibrary().map((body) => ({ kind: "lesson" as const, body })),
    { kind: "worksheet" as const, body: demoWorksheet() },
  ];
}

await runMain(async () => {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      workspace: { type: "string" },
      email: { type: "string" },
      "database-url": { type: "string" },
    },
    strict: true,
  });
  if ((values.workspace === undefined) === (values.email === undefined)) {
    throw new UserFacingError(USAGE, ExitCode.Usage);
  }

  const url = values["database-url"] ?? (await databaseUrl());
  const target = parseDatabaseUrl(url);
  if (target === null || !["localhost", "127.0.0.1", "::1"].includes(target.host)) {
    throw new UserFacingError(
      "db:seed only runs against a local database (ADR 0024 §16: production Workspaces start empty).",
    );
  }

  const { unsafeDb, sql, close } = createDb(url, { max: 2 });
  try {
    let workspaceId: WorkspaceId;
    if (values.workspace !== undefined) {
      const parsed = WorkspaceIdSchema.safeParse(values.workspace);
      if (!parsed.success)
        throw new UserFacingError(`--workspace is not a UUID.\n${USAGE}`, ExitCode.Usage);
      workspaceId = parsed.data;
      const rows = await sql<{ id: string }[]>`select id from workspaces where id = ${workspaceId}`;
      if (rows.length === 0)
        throw new UserFacingError(`No Workspace ${workspaceId} in ${target.database}.`);
    } else {
      const email = values.email ?? "";
      const rows = await sql<{ id: string }[]>`
        select w.id from workspaces w join users u on u.id = w.owner_user_id
        where u.email = ${email} limit 1`;
      const row = rows[0];
      if (row === undefined) {
        throw new UserFacingError(
          `No user ${email} with a personal Workspace in ${target.database}.`,
        );
      }
      workspaceId = row.id as WorkspaceId;
    }

    log.step(`Seeding Workspace ${workspaceId} in ${target.database}`);
    const ws = forWorkspace(unsafeDb, workspaceId);
    const existing = new Set(
      (await ws.project({ title: documents.title }, documents)).map((row) => row.title),
    );
    let inserted = 0;
    for (const { kind, body } of seedDocuments()) {
      if (existing.has(body.title)) {
        log.info(`skip   ${kind.padEnd(9)} "${body.title}" (already present)`);
        continue;
      }
      const row = await createDocument(ws, kind, body);
      inserted++;
      log.ok(`insert ${kind.padEnd(9)} "${row.title}" -> ${row.id}`);
    }
    log.ok(`${inserted} document(s) inserted, ${seedDocuments().length - inserted} skipped`);
  } finally {
    await close();
  }
});
