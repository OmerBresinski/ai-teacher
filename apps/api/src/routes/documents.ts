/**
 * `/documents/*` — the document API (ADR 0024 §4, §5, §7, §8, §11, §17, §18): paginated,
 * sortable, searchable summaries; create (Import, Make a copy); read; whole-document save with
 * optimistic concurrency and the generating lock; soft delete with restore; a series with its
 * lessons. `POST /lessons` lives in `lessons.ts`.
 *
 * - `requireSession` (mounted in `app.ts` on `/documents` and `/documents/*`) supplies the
 *   caller's Workspace; every query goes through `forWorkspace(unsafeDb, workspaceId)` and the
 *   `@tj/db` repository, so another Workspace's id reads as `404` — never `403`.
 * - Bodies are validated twice: the shape here (`zValidator`), the document itself in the
 *   repository (`migrate()` + the kind's parser), whose `DocumentParseError` becomes a `422` with
 *   the parser's message so an Import dialog can show what is wrong.
 * - `PUT` answers `409` with `reason: "stale"` (the `expectedUpdatedAt` is behind the row) or
 *   `reason: "generating"` (a job holds the lock); the client refetches and shows the message.
 * - Request bodies are capped at `DOCUMENT_BODY_LIMIT_BYTES` (§8) while images are data URLs.
 * - Drizzle rows carry `Date`s; `toDocumentJson` / `toSummaryJson` turn them into ISO strings so
 *   `AppType` shows strings and `null`s become absent optionals as `DocumentSummarySchema` expects.
 */
import { zValidator } from "@hono/zod-validator";
import {
  createDocument,
  type DocumentRow,
  type DocumentSummaryRow,
  forWorkspace,
  getDocument,
  getSeriesWithLessons,
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
  listSummaries,
  MalformedCursorError,
  putDocument,
  restore,
  type ScopableDb,
  softDelete,
} from "@tj/db";
import { DocumentKindSchema, DocumentParseError } from "@tj/domain/documents";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "../context";
import { ConflictError } from "../errors";
import { requireJsonBody, validationHook } from "../validation";
import { getWorkspaceId } from "../workspace";

/** ADR 0024 §8: a downscaled deck is 1–3 MB; anything past this fails loudly rather than slowly. */
export const DOCUMENT_BODY_LIMIT_BYTES = 10 * 1024 * 1024;

export const NOT_FOUND_MESSAGE = "That document does not exist.";
export const STALE_MESSAGE = "This document changed elsewhere. Reload to continue.";
export const GENERATING_MESSAGE = "This lesson is still being generated.";
export const TOO_LARGE_MESSAGE = "This document is too large to save (10 MB limit).";

const documentParam = z.object({ id: z.uuid() });

const listQuery = z.object({
  kind: DocumentKindSchema,
  sort: z.enum(["updated", "title", "created"]).default("updated"),
  q: z.string().max(100).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(LIST_MAX_LIMIT).default(LIST_DEFAULT_LIMIT),
});

const createBody = z.object({ kind: DocumentKindSchema, body: z.unknown() });

const putBody = z.object({ document: z.unknown(), expectedUpdatedAt: z.iso.datetime() });

/** The 10 MB cap, shared with `POST /lessons`. */
export const documentBodyLimit = () =>
  bodyLimit({
    maxSize: DOCUMENT_BODY_LIMIT_BYTES,
    onError: () => {
      throw new HTTPException(413, { message: TOO_LARGE_MESSAGE });
    },
  });

// --- serialisation --------------------------------------------------------------------------------

/** The list-row shape: the promoted columns as `DocumentSummary` plus the two state columns. */
export function toSummaryJson(row: DocumentSummaryRow) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    subject: row.subject ?? undefined,
    yearGroup: row.yearGroup ?? undefined,
    themeId: row.themeId ?? undefined,
    itemCount: row.itemCount,
    cover: row.cover ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
    generatingJobId: row.generatingJobId ?? null,
  };
}

/** The summary plus the stored body. */
export function toDocumentJson(row: DocumentRow) {
  const { body, ...summary } = row;
  return { ...toSummaryJson(summary), body };
}

/** Repository parse failures become a 422 with the parser's message; anything else propagates. */
function unprocessableOnParseError(error: unknown): never {
  if (error instanceof DocumentParseError) {
    throw new HTTPException(422, { message: error.message });
  }
  throw error;
}

function notFound(): never {
  throw new HTTPException(404, { message: NOT_FOUND_MESSAGE });
}

/** The document id inside a body, when there is one; `undefined` for anything else. */
function bodyId(document: unknown): string | undefined {
  if (typeof document !== "object" || document === null) return undefined;
  const id = (document as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

export function documentRoutes(unsafeDb: ScopableDb) {
  const scoped = (c: Context<AppEnv>) =>
    forWorkspace(unsafeDb, getWorkspaceId(c, { allowHeaderShim: false }));

  return new Hono<AppEnv>()
    .get("/documents", zValidator("query", listQuery, validationHook), async (c) => {
      const ws = scoped(c);
      const { items, nextCursor } = await listSummaries(ws, c.req.valid("query")).catch(
        (error: unknown) => {
          if (error instanceof MalformedCursorError) {
            throw new HTTPException(400, { message: error.message });
          }
          throw error;
        },
      );
      return c.json({ items: items.map(toSummaryJson), nextCursor }, 200);
    })
    .post(
      "/documents",
      documentBodyLimit(),
      requireJsonBody(),
      zValidator("json", createBody, validationHook),
      async (c) => {
        const ws = scoped(c);
        const { kind, body } = c.req.valid("json");
        const row = await createDocument(ws, kind, body).catch(unprocessableOnParseError);
        return c.json({ document: toDocumentJson(row) }, 201);
      },
    )
    .get("/documents/:id", zValidator("param", documentParam, validationHook), async (c) => {
      const ws = scoped(c);
      const row = await getDocument(ws, c.req.valid("param").id);
      if (row === null) notFound();
      return c.json({ document: toDocumentJson(row) }, 200);
    })
    .put(
      "/documents/:id",
      documentBodyLimit(),
      requireJsonBody(),
      zValidator("param", documentParam, validationHook),
      zValidator("json", putBody, validationHook),
      async (c) => {
        const ws = scoped(c);
        const { id } = c.req.valid("param");
        const { document, expectedUpdatedAt } = c.req.valid("json");
        if (bodyId(document) !== id) {
          throw new HTTPException(422, { message: "The document id does not match the URL." });
        }
        const result = await putDocument(ws, id, document, new Date(expectedUpdatedAt)).catch(
          unprocessableOnParseError,
        );
        switch (result.status) {
          case "ok":
            return c.json({ document: toDocumentJson(result.row) }, 200);
          case "conflict":
            throw new ConflictError("stale", STALE_MESSAGE);
          case "generating":
            throw new ConflictError("generating", GENERATING_MESSAGE);
          case "missing":
            return notFound();
        }
      },
    )
    .delete("/documents/:id", zValidator("param", documentParam, validationHook), async (c) => {
      const ws = scoped(c);
      const { id } = c.req.valid("param");
      if (!(await softDelete(ws, id))) {
        // Already deleted is idempotent; unknown is 404.
        const row = await getDocument(ws, id);
        if (row === null) notFound();
      }
      return c.body(null, 204);
    })
    .post(
      "/documents/:id/restore",
      zValidator("param", documentParam, validationHook),
      async (c) => {
        const ws = scoped(c);
        const { id } = c.req.valid("param");
        await restore(ws, id);
        const row = await getDocument(ws, id);
        if (row === null) notFound();
        return c.json({ document: toDocumentJson(row) }, 200);
      },
    )
    .get(
      "/documents/:id/lessons",
      zValidator("param", documentParam, validationHook),
      async (c) => {
        const ws = scoped(c);
        const result = await getSeriesWithLessons(ws, c.req.valid("param").id);
        if (result === null) notFound();
        return c.json(
          { series: toDocumentJson(result.series), lessons: result.lessons.map(toSummaryJson) },
          200,
        );
      },
    );
}
