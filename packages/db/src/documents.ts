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
import { hasAnyJobEvent, terminalJobEventFor } from "./job-events";
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

export type PutDocumentAsJobResult =
  | { status: "ok"; row: DocumentRow }
  /** The row is unlocked or locked by another job: a newer job owns it. Write nothing further. */
  | { status: "lost_lock" }
  | { status: "missing" };

/** How long a locked row may sit with no job event at all before the lock is presumed dead. */
export const STALE_LOCK_AFTER_MS = 10 * 60 * 1000;

export interface ReleaseStaleLockOptions {
  /** Test seam; defaults to `new Date()`. */
  now?: Date;
  /** Defaults to `STALE_LOCK_AFTER_MS`. */
  staleAfterMs?: number;
  /** Receives one `info` line per release: ids and the reason, never the body. */
  logger?: ReleaseLogger;
}

/** The slice of a pino logger this module needs; `@tj/db` does not depend on pino. */
export interface ReleaseLogger {
  info(fields: { lessonId: string; jobId: string; reason: string }, message: string): void;
}

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
 * The part of a whole-document write both `putDocument` and `putDocumentAsJob` share: parse the
 * body by the row's kind, refuse a body that names another document, and issue one `UPDATE` whose
 * predicate the caller adds to `id`. Returns the written row, or `undefined` when nothing matched.
 */
async function replaceBody(
  ws: WorkspaceDb,
  current: DocumentRow,
  body: unknown,
  predicate: SQL,
  caller: string,
): Promise<DocumentRow | undefined> {
  const parsed = parseDocumentBody(current.kind, body);
  if (parsed.id !== current.id) {
    throw new Error(`${caller}: body.id ${parsed.id} does not match document ${current.id}`);
  }
  const rows = await ws
    .update(documents, and(eq(documents.id, current.id), predicate))
    .set({ body: parsed, ...promoted(parsed), updatedAt: nextUpdatedAt(current.updatedAt) })
    .returning();
  return rows[0];
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
  const row = await replaceBody(
    ws,
    current,
    body,
    and(eq(documents.updatedAt, expectedUpdatedAt), isNull(documents.generatingJobId)) as SQL,
    "putDocument",
  );
  if (row) return { status: "ok", row };
  const after = await getDocument(ws, id);
  if (after === null) return { status: "missing" };
  if (after.generatingJobId !== null) {
    return { status: "generating", jobId: after.generatingJobId as JobId };
  }
  return { status: "conflict", row: after };
}

/**
 * The worker's write path under the generating lock (ADR 0025 §6, amending ADR 0024 §18): one
 * `UPDATE … WHERE id AND generating_job_id = :jobId`. The lock is the concurrency token — no
 * `expectedUpdatedAt` — so the job holding it may write the row as often as it likes (after every
 * slide, §7). A soft-deleted row under the lock is still the job's to finish, so `deleted_at` is
 * not in the predicate. When nothing matches the row is re-read to say why: `missing` (hard-deleted
 * by `POST /lessons`' failure path) or `lost_lock` (unlocked, or a newer job owns it); the handler
 * stops with `NonRetryableError` on either. `body.id` must equal `id`; a mismatch throws.
 */
export async function putDocumentAsJob(
  ws: WorkspaceDb,
  id: string,
  body: unknown,
  jobId: JobId,
): Promise<PutDocumentAsJobResult> {
  const current = await getDocument(ws, id);
  if (current === null) return { status: "missing" };
  const row = await replaceBody(
    ws,
    current,
    body,
    eq(documents.generatingJobId, jobId),
    "putDocumentAsJob",
  );
  if (row) return { status: "ok", row };
  const after = await getDocument(ws, id);
  return after === null ? { status: "missing" } : { status: "lost_lock" };
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
 * Hard-delete a row — **not** the soft delete teachers see (§5). For the one case where a row was
 * written and its job could not be queued (`POST /lessons`): the lesson never existed as far as
 * the Library is concerned, so it must not linger as a locked, soft-deleted ghost.
 */
export async function deleteDocument(ws: WorkspaceDb, id: string): Promise<boolean> {
  const rows = await ws.delete(documents, eq(documents.id, id)).returning({ id: documents.id });
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

/**
 * Self-heal for the PR #110 residual (ADR 0025 §24): a row whose `generating_job_id` names a job
 * that has already written a terminal event, or that never wrote any event and has not been
 * touched for `staleAfterMs`, is locked by nothing. `GET /documents/:id` calls this before
 * answering so a teacher is never shown a lesson locked by a dead job for more than ten minutes.
 * Returns the row as it stands afterwards; untouched rows come back as given.
 */
export async function releaseStaleLock(
  ws: WorkspaceDb,
  row: DocumentRow,
  opts: ReleaseStaleLockOptions = {},
): Promise<DocumentRow> {
  const jobId = row.generatingJobId as JobId | null;
  if (jobId === null) return row;
  const reason = await staleLockReason(ws, row, jobId, opts);
  if (reason === null) return row;
  await clearGenerating(ws, row.id, jobId);
  opts.logger?.info({ lessonId: row.id, jobId, reason }, "released a stale generating lock");
  return (await getDocument(ws, row.id)) ?? { ...row, generatingJobId: null };
}

async function staleLockReason(
  ws: WorkspaceDb,
  row: DocumentRow,
  jobId: JobId,
  opts: ReleaseStaleLockOptions,
): Promise<"terminal" | "never_queued" | null> {
  if ((await terminalJobEventFor(ws, jobId)) !== undefined) return "terminal";
  if (await hasAnyJobEvent(ws, jobId)) return null;
  const now = opts.now ?? new Date();
  const staleAfterMs = opts.staleAfterMs ?? STALE_LOCK_AFTER_MS;
  return now.getTime() - row.updatedAt.getTime() > staleAfterMs ? "never_queued" : null;
}
