/**
 * `GET /files/:key` — the private-file proxy (ADR 0011 amendment 2026-09-04). Vercel Blob has no
 * time-limited signed URLs for private blobs, so every Artefact/Source download is authorised here
 * per request and streamed from the `StorageAdapter`.
 *
 * - `requireSession` (mounted in `app.ts`) supplies the caller's Workspace.
 * - The key is validated as `<workspaceId>/<segment>/…`; a key under **another** Workspace is a
 *   `404` — never `403`, so the existence of other tenants' objects is not leaked.
 * - The body is streamed (never buffered) with the stored `content-type`, `content-length` and
 *   `cache-control: private, no-store`.
 */
import { zValidator } from "@hono/zod-validator";
import {
  parseStorageKey,
  type ReadableStorageAdapter,
  StorageKeyError,
  StorageKeySchema,
} from "@tj/domain";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "../context";
import { validationHook } from "../validation";
import { getWorkspaceId } from "../workspace";

const fileParam = z.object({ key: StorageKeySchema });

const NOT_FOUND = "That file does not exist.";

/**
 * `@tj/storage`'s `StorageError` with `code: "not_found"`, matched structurally: this module must
 * not import `@tj/storage` (it uses Bun globals, which would leak into `AppType` and break the
 * browser type-check of `@tj/api-client` / `apps/web`).
 */
function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "StorageError" &&
    (error as { code?: unknown }).code === "not_found"
  );
}

export function fileRoutes(storage: ReadableStorageAdapter | undefined) {
  return new Hono<AppEnv>().get(
    "/files/:key{.+}",
    zValidator("param", fileParam, validationHook),
    async (c) => {
      const workspaceId = getWorkspaceId(c);
      if (!storage) {
        throw new HTTPException(503, { message: "File downloads are not available right now." });
      }
      const { key } = c.req.valid("param");
      const parsed = parseStorageKey(key);
      if (!parsed.ok || parsed.value.workspaceId !== workspaceId) {
        throw new HTTPException(404, { message: NOT_FOUND });
      }
      try {
        const object = await storage.get(key);
        return c.body(object.body, 200, {
          "content-type": object.contentType,
          "content-length": String(object.size),
          "cache-control": "private, no-store",
          "last-modified": object.updatedAt.toUTCString(),
        });
      } catch (error) {
        if (isNotFound(error) || error instanceof StorageKeyError) {
          throw new HTTPException(404, { message: NOT_FOUND });
        }
        throw error;
      }
    },
  );
}
