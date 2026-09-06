import { type JobId, newId } from "@tj/domain";
import {
  type DocumentKind,
  type Lesson,
  migrate,
  parseLesson,
  parseSeries,
  parseWorksheet,
  type Series,
  summarise,
  type Worksheet,
} from "@tj/domain/documents";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";
import { documents } from "./schema/documents";
import type { WorkspaceDb } from "./tenant";

/**
 * Documents repository (ADR 0024 §10): every query over the `documents` table, for the API
 * routes and the worker alike. Each function takes the `WorkspaceDb` from `forWorkspace()`, so
 * the tenant predicate is on every statement and an id from another Workspace reads as missing.
 *
 * Write path (§3, §4, §11): a body is `migrate()`d and parsed by its kind, `body.id` is forced to
 * the row id, and the promoted list columns are recomputed from `summarise()` on every insert and
 * update — the list endpoint never reads `body`. Row timestamps are written by this module with
 * **millisecond** precision (`new Date()`), never `now()`, so the `updated_at` a client saw and
 * sends back for optimistic concurrency compares equal, and the keyset cursor round-trips exactly.
 */

export type DocumentRow = typeof documents.$inferSelect;
export type DocumentSummaryRow = Omit<DocumentRow, "body">;
export type DocumentBody = Lesson | Worksheet | Series;

export type ListSort = "updated" | "title" | "created";

export interface ListSummariesOptions {
  kind: DocumentKind;
  /** `updated` → `updated_at DESC`, `title` → `title ASC`, `created` → `created_at DESC`. */
  sort?: ListSort;
  /** Case-insensitive substring match on `title` or `subject`. */
  q?: string;
  /** Opaque `nextCursor` from a previous page. */
  cursor?: string;
  /** Page size, clamped to 1–200. Default 100. */
  limit?: number;
}

export interface ListSummariesResult {
  items: DocumentSummaryRow[];
  nextCursor: string | null;
}

export type PutDocumentResult =
  | { status: "ok"; row: DocumentRow }
  | { status: "conflict"; row: DocumentRow }
  | { status: "generating"; jobId: JobId }
  | { status: "missing" };

export const LIST_DEFAULT_LIMIT = 100;
export const LIST_MAX_LIMIT = 200;

// Every column but `body`: what a list row is.
const { body: _body, ...summaryColumns } = getTableColumns(documents);

/**
 * The next `updated_at` for a row: now, but strictly later than the value it replaces, so two
 * writes inside one millisecond still produce distinct timestamps and a client echoing the older
 * one is told `conflict` rather than let through.
 */
function nextUpdatedAt(previous: Date): Date {
  return new Date(Math.max(Date.now(), previous.getTime() + 1));
}

/** Parse `input` as a document of `kind`: `migrate()` first, then the kind's parser. */
export function parseDocumentBody(kind: DocumentKind, input: unknown): DocumentBody {
  const upgraded = migrate(input);
  switch (kind) {
    case "lesson":
      return parseLesson(upgraded);
    case "worksheet":
      return parseWorksheet(upgraded);
    case "series":
      return parseSeries(upgraded);
  }
}

function promoted(body: DocumentBody) {
  const s = summarise(body);
  return {
    title: s.title,
    subject: s.subject ?? null,
    yearGroup: s.yearGroup ?? null,
    themeId: s.themeId ?? null,
    itemCount: s.itemCount,
    cover: s.cover,
  };
}

// --- cursor ------------------------------------------------------------------------------------

/**
 * Keyset cursor (ADR 0024 §17): the sort it belongs to, the last row's sort value and its id.
 * Validated with Zod on the way back in so a hand-edited or cross-sort cursor is a
 * `MalformedCursorError`, never a malformed SQL comparison or a `500`.
 */
const CursorSchema = z.discriminatedUnion("s", [
  z.strictObject({ s: z.enum(["updated", "created"]), v: z.iso.datetime(), id: z.uuid() }),
  z.strictObject({ s: z.literal("title"), v: z.string(), id: z.uuid() }),
]);
type Cursor = z.infer<typeof CursorSchema>;

/** Thrown by `listSummaries` when `cursor` is not one it produced; the API maps it to a 400. */
export class MalformedCursorError extends Error {
  override readonly name = "MalformedCursorError";
  constructor() {
    super("The page cursor is not valid.");
  }
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** Decode a cursor for `sort`; anything that is not one `listSummaries` produced for it throws. */
function decodeCursor(text: string, sort: ListSort): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
  } catch {
    throw new MalformedCursorError();
  }
  const result = CursorSchema.safeParse(parsed);
  if (!result.success || result.data.s !== sort) throw new MalformedCursorError();
  return result.data;
}

/** Sort key per `ListSort`: the column, its direction, and how its value is carried in a cursor. */
const SORTS = {
  updated: { column: documents.updatedAt, direction: "desc" },
  created: { column: documents.createdAt, direction: "desc" },
  title: { column: documents.title, direction: "asc" },
} as const;

function cursorValue(row: DocumentSummaryRow, sort: ListSort): string {
  switch (sort) {
    case "updated":
      return row.updatedAt.toISOString();
    case "created":
      return row.createdAt.toISOString();
    case "title":
      return row.title;
  }
}

function keysetWhere(sort: ListSort, cursor: Cursor): SQL {
  const { column, direction } = SORTS[sort];
  const value = cursor.s === "title" ? cursor.v : new Date(cursor.v);
  const before = direction === "desc" ? lt : gt;
  const idBefore = direction === "desc" ? lt : gt;
  return or(
    before(column, value),
    and(eq(column, value), idBefore(documents.id, cursor.id)),
  ) as SQL;
}

/** Escape `%`, `_` and `\` so a search term matches literally inside an `ILIKE` pattern. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// --- reads -------------------------------------------------------------------------------------

/**
 * One page of summaries for `kind`, excluding soft-deleted rows, in the requested order with a
 * keyset cursor (ADR 0024 §17). `body` is never selected.
 */
export async function listSummaries(
  ws: WorkspaceDb,
  { kind, sort = "updated", q, cursor, limit = LIST_DEFAULT_LIMIT }: ListSummariesOptions,
): Promise<ListSummariesResult> {
  const pageSize = Math.min(LIST_MAX_LIMIT, Math.max(1, Math.trunc(limit)));
  const filters: SQL[] = [eq(documents.kind, kind), isNull(documents.deletedAt)];
  if (q !== undefined && q.trim() !== "") {
    const pattern = `%${escapeLike(q.trim())}%`;
    filters.push(or(ilike(documents.title, pattern), ilike(documents.subject, pattern)) as SQL);
  }
  if (cursor !== undefined) filters.push(keysetWhere(sort, decodeCursor(cursor, sort)));
  const { column, direction } = SORTS[sort];
  const order = direction === "desc" ? desc : asc;
  const rows = await ws
    .project(summaryColumns, documents, and(...filters))
    .orderBy(order(column), order(documents.id))
    .limit(pageSize + 1);
  const items = rows.slice(0, pageSize);
  const last = items[items.length - 1];
  const nextCursor =
    rows.length > pageSize && last !== undefined
      ? encodeCursor({ s: sort, v: cursorValue(last, sort), id: last.id } as Cursor)
      : null;
  return { items, nextCursor };
}

/** The full row including `body`, or `null`. Soft-deleted rows are returned; the caller decides. */
export async function getDocument(ws: WorkspaceDb, id: string): Promise<DocumentRow | null> {
  const rows = await ws.select(documents, eq(documents.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * A series row with the summaries of its lessons in `body.lessonIds` order (ADR 0024 §12). Ids
 * that are not lessons of this Workspace, or are soft-deleted, drop out silently.
 */
export async function getSeriesWithLessons(
  ws: WorkspaceDb,
  id: string,
): Promise<{ series: DocumentRow; lessons: DocumentSummaryRow[] } | null> {
  const series = await getDocument(ws, id);
  if (series === null || series.kind !== "series") return null;
  const lessonIds = (series.body as Series).lessonIds;
  if (lessonIds.length === 0) return { series, lessons: [] };
  const rows = await ws.project(
    summaryColumns,
    documents,
    and(
      inArray(documents.id, lessonIds),
      eq(documents.kind, "lesson"),
      isNull(documents.deletedAt),
    ),
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const lessons: DocumentSummaryRow[] = [];
  for (const lessonId of lessonIds) {
    const row = byId.get(lessonId);
    if (row !== undefined) lessons.push(row);
  }
  return { series, lessons };
}

// --- writes ------------------------------------------------------------------------------------

/**
 * Insert a new document. The row id is minted here — or supplied by a caller that had to know it
 * first, as `POST /lessons` does to enqueue `lesson.plan { lessonId }` before the insert — and is
 * written into `body.id` (ADR 0024 §11), so Import and Make a copy get a fresh identity. Throws
 * the parser's message when `body` is not a valid document of `kind`; nothing is written then.
 */
export async function createDocument(
  ws: WorkspaceDb,
  kind: DocumentKind,
  body: unknown,
  opts: { id?: string; generatingJobId?: JobId } = {},
): Promise<DocumentRow> {
  const id = opts.id ?? newId();
  const parsed = { ...parseDocumentBody(kind, body), id } as DocumentBody;
  const now = new Date();
  const rows = await ws
    .insert(documents)
    .values({
      id,
      kind,
      body: parsed,
      ...promoted(parsed),
      createdAt: now,
      updatedAt: now,
      generatingJobId: opts.generatingJobId ?? null,
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("createDocument: insert returned no row");
  return row;
}

/**
 * Replace a document's body with optimistic concurrency (ADR 0024 §4) under the generating lock
 * (§18): one `UPDATE … WHERE id AND updated_at = :expected AND generating_job_id IS NULL`. When no
 * row matches, the current row is read to say why: `missing`, `generating` or `conflict`.
 * `body.id` must equal `id`; a mismatch is a programming error and throws.
 */
export async function putDocument(
  ws: WorkspaceDb,
  id: string,
  body: unknown,
  expectedUpdatedAt: Date,
): Promise<PutDocumentResult> {
  const current = await getDocument(ws, id);
  if (current === null) return { status: "missing" };
  const parsed = parseDocumentBody(current.kind, body);
  if (parsed.id !== id) {
    throw new Error(`putDocument: body.id ${parsed.id} does not match document ${id}`);
  }
  const rows = await ws
    .update(
      documents,
      and(
        eq(documents.id, id),
        eq(documents.updatedAt, expectedUpdatedAt),
        isNull(documents.generatingJobId),
      ),
    )
    .set({ body: parsed, ...promoted(parsed), updatedAt: nextUpdatedAt(current.updatedAt) })
    .returning();
  const row = rows[0];
  if (row) return { status: "ok", row };
  const after = await getDocument(ws, id);
  if (after === null) return { status: "missing" };
  if (after.generatingJobId !== null) {
    return { status: "generating", jobId: after.generatingJobId as JobId };
  }
  return { status: "conflict", row: after };
}

/**
 * Set `deleted_at` (ADR 0024 §5) and advance `updated_at`, as the mock store did: a deletion is
 * a change the row's clock records, so an editor holding a pre-delete snapshot is told `conflict`
 * after a restore rather than silently overwriting it. `false` when missing or already deleted.
 */
export async function softDelete(ws: WorkspaceDb, id: string): Promise<boolean> {
  const current = await getDocument(ws, id);
  if (current === null || current.deletedAt !== null) return false;
  const now = nextUpdatedAt(current.updatedAt);
  const rows = await ws
    .update(documents, and(eq(documents.id, id), isNull(documents.deletedAt)))
    .set({ deletedAt: now, updatedAt: now })
    .returning({ id: documents.id });
  return rows.length > 0;
}

/**
 * Clear `deleted_at` and advance `updated_at`, so a restored document returns to the top of the
 * "recently updated" order (the library's Undo). `false` when missing or not deleted.
 */
export async function restore(ws: WorkspaceDb, id: string): Promise<boolean> {
  const current = await getDocument(ws, id);
  if (current === null || current.deletedAt === null) return false;
  const rows = await ws
    .update(documents, and(eq(documents.id, id), isNotNull(documents.deletedAt)))
    .set({ deletedAt: null, updatedAt: nextUpdatedAt(current.updatedAt) })
    .returning({ id: documents.id });
  return rows.length > 0;
}

/**
 * Release the generating lock (ADR 0024 §18) — only when it is still held by `jobId`, so a job
 * that finishes late never unlocks a lesson a newer job has since locked.
 */
export async function clearGenerating(ws: WorkspaceDb, id: string, jobId: JobId): Promise<void> {
  await ws
    .update(documents, and(eq(documents.id, id), eq(documents.generatingJobId, jobId)))
    .set({ generatingJobId: null });
}
