import type { JobId } from "@tj/domain";
import type { DocumentKind, Series } from "@tj/domain/documents";
import { eq } from "drizzle-orm";
import { createDocument, type DocumentRow } from "./documents";
import { documents } from "./schema/documents";
import type { WorkspaceDb } from "./tenant";

/**
 * One document to seed: a stable `key` the caller addresses it by, its kind and body. Series
 * bodies name their lessons by **key** in `lessonIds`; ids are minted on insert (ADR 0024 §11), so
 * the seeder rewrites them once the lessons exist. Structurally `@tj/editor/starter`'s
 * `DemoDocument`, declared here so `@tj/db` does not depend on the editor.
 */
export interface SeedDocument {
  key: string;
  kind: DocumentKind;
  body: { id: string; title: string; createdAt: string; updatedAt: string; lessonIds?: string[] };
  /** Insert the row locked by this job (ADR 0024 §18), for tests of the generating state. */
  generatingJobId?: string;
}

export interface SeedResult {
  /** `key` → the row id each document was given. Skipped keys are absent. */
  ids: Map<string, string>;
  inserted: DocumentRow[];
  skipped: string[];
}

/**
 * Insert `items` into one Workspace through the repository (ADR 0024 §16): `bun run db:seed` and
 * the e2e `POST /__test/seed-library` share this so both compute the promoted columns the way the
 * API does. Items are inserted in order; a series' `lessonIds` are mapped from keys to the ids
 * assigned above it, and keys that were not inserted drop out. Row timestamps are set from the
 * body's — the fixtures are dated hours to weeks in the past so the library's Recent / Earlier
 * split and the sort orders have something to show — and `body.updatedAt` is aligned to the row
 * so `expectedUpdatedAt` round-trips. `skipTitles` makes a re-run idempotent by title. One
 * transaction: a body the parser refuses leaves nothing behind.
 */
export function seedDocuments(
  ws: WorkspaceDb,
  items: readonly SeedDocument[],
  opts: { skipTitles?: ReadonlySet<string> } = {},
): Promise<SeedResult> {
  return ws.tx((scoped) => seedInto(scoped, items, opts));
}

async function seedInto(
  ws: WorkspaceDb,
  items: readonly SeedDocument[],
  opts: { skipTitles?: ReadonlySet<string> },
): Promise<SeedResult> {
  const ids = new Map<string, string>();
  const inserted: DocumentRow[] = [];
  const skipped: string[] = [];
  for (const item of items) {
    if (opts.skipTitles?.has(item.body.title)) {
      skipped.push(item.key);
      continue;
    }
    const body =
      item.kind === "series"
        ? {
            ...(item.body as Series),
            lessonIds: (item.body as Series).lessonIds.flatMap((key) => ids.get(key) ?? []),
          }
        : item.body;
    const row = await createDocument(ws, item.kind, body, {
      generatingJobId: item.generatingJobId as JobId | undefined,
    });
    const createdAt = new Date(item.body.createdAt);
    const updatedAt = new Date(item.body.updatedAt);
    const dated = await ws
      .update(documents, eq(documents.id, row.id))
      .set({ createdAt, updatedAt, body: { ...row.body, updatedAt: updatedAt.toISOString() } })
      .returning();
    const final = dated[0] ?? row;
    ids.set(item.key, final.id);
    inserted.push(final);
  }
  return { ids, inserted, skipped };
}
