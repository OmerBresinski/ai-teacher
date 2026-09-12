import type { SourceRef } from "@tj/domain/documents";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { sources } from "./schema/sources";
import type { WorkspaceDb } from "./tenant";

/**
 * Sources repository (ADR 0027 §4, §5): every query over the `sources` registry table, for
 * `POST /sources`, `DELETE /sources/:id` and `POST /lessons`. Each function takes the
 * `WorkspaceDb` from `forWorkspace()`, so an id from another Workspace reads as missing
 * (ADR 0007). To run a function inside a transaction, call it with the scoped handle `ws.tx()`
 * passes to its callback.
 */

export type SourceRow = typeof sources.$inferSelect;

export interface NewSource {
  id: string;
  kind: SourceRow["kind"];
  name: string;
  mime: string;
  byteSize: number;
  storageKey: string;
  pages: number;
  lowText: boolean;
}

export type SoftDeleteSourceResult = "ok" | "missing" | "bound";

/** Insert the registry row. `POST /sources` does this **before** writing any object (§5). */
export async function createSource(ws: WorkspaceDb, row: NewSource): Promise<SourceRow> {
  const now = new Date();
  const rows = await ws
    .insert(sources)
    .values({ ...row, lessonId: null, deletedAt: null, createdAt: now, updatedAt: now })
    .returning();
  const created = rows[0];
  if (!created) throw new Error("createSource: insert returned no row");
  return created;
}

/** The live row, or `null` when missing, soft-deleted or another Workspace's. */
export async function getSource(ws: WorkspaceDb, id: string): Promise<SourceRow | null> {
  const rows = await ws
    .select(sources, and(eq(sources.id, id), isNull(sources.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Claim `ids` for `lessonId` in one conditional `UPDATE … RETURNING` (§5): only live, unbound rows
 * of this Workspace are touched, so two concurrent lessons cannot claim the same Source. Returns
 * the claimed rows in the order of `ids` (duplicates collapsed, so a repeated id yields one row
 * and one `SourceRef`); **fewer rows than distinct ids means the claim failed** and the caller
 * rolls its transaction back — a missing, foreign, deleted or already-bound id all read the same.
 * An empty `ids` returns `[]` without a query.
 */
export async function bindSourcesToLesson(
  ws: WorkspaceDb,
  ids: readonly string[],
  lessonId: string,
): Promise<SourceRow[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await ws
    .update(
      sources,
      and(inArray(sources.id, unique), isNull(sources.lessonId), isNull(sources.deletedAt)),
    )
    .set({ lessonId, updatedAt: new Date() })
    .returning();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered: SourceRow[] = [];
  for (const id of unique) {
    const row = byId.get(id);
    if (row !== undefined) ordered.push(row);
  }
  return ordered;
}

/** Release every Source bound to `lessonId` (the enqueue-failure compensation, §5). */
export async function unbindSourcesFromLesson(ws: WorkspaceDb, lessonId: string): Promise<number> {
  const rows = await ws
    .update(sources, eq(sources.lessonId, lessonId))
    .set({ lessonId: null, updatedAt: new Date() })
    .returning({ id: sources.id });
  return rows.length;
}

/**
 * Set `deleted_at` on an **unbound** Source. `bound` when a lesson holds it (the row is left as
 * is), `missing` when there is no live row for this Workspace.
 */
export async function softDeleteSource(
  ws: WorkspaceDb,
  id: string,
): Promise<SoftDeleteSourceResult> {
  const current = await getSource(ws, id);
  if (current === null) return "missing";
  if (current.lessonId !== null) return "bound";
  const now = new Date();
  const rows = await ws
    .update(sources, and(eq(sources.id, id), isNull(sources.lessonId), isNull(sources.deletedAt)))
    .set({ deletedAt: now, updatedAt: now })
    .returning({ id: sources.id });
  if (rows.length > 0) return "ok";
  // Lost a race between the read and the update: a lesson claimed it, or it was deleted meanwhile.
  const after = await getSource(ws, id);
  return after !== null && after.lessonId !== null ? "bound" : "missing";
}

/** The `SourceRef` a row becomes in `Lesson.sources` (ADR 0025 §20). */
export function toSourceRef(row: SourceRow): SourceRef {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    storageKey: row.storageKey,
    pages: row.pages,
  };
}

/** Rows bound to `lessonId`, for tests and the future "sources of this lesson" read. */
export async function listSourcesOfLesson(ws: WorkspaceDb, lessonId: string): Promise<SourceRow[]> {
  return ws.select(sources, and(eq(sources.lessonId, lessonId), isNotNull(sources.lessonId)));
}
