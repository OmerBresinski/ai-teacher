import { zValidator } from "@hono/zod-validator";
import {
  createSource,
  forWorkspace,
  type ScopableDb,
  type SourceRow,
  softDeleteSource,
  toSourceRef,
} from "@tj/db";
import {
  newId,
  type ReadableStorageAdapter,
  type StorageAdapter,
  storageKey,
  type WorkspaceId,
} from "@tj/domain";
import {
  type ExtractedSource,
  ExtractedSourceSchema,
  type SourceLocator,
} from "@tj/domain/documents";
import {
  ExtractError,
  type Extraction,
  type ExtractionKind,
  extract,
  isLowText,
  LIMITS,
  MIME,
  type Refusal,
  type SourceMime,
  screen,
  sniffMime,
} from "@tj/extract";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { Logger } from "pino";
import { z } from "zod";
import type { AppEnv } from "../context";
import { SourceRefusedError } from "../errors";
import { type RateLimiter, rateLimitByWorkspace } from "../rate-limit";
import { validationHook } from "../validation";
import { getWorkspaceId } from "../workspace";
import { NOT_FOUND_MESSAGE } from "./documents";

/*
 * Sources (ADR 0027 §5; F03): `POST /sources` takes one file or one paste, extracts and screens it
 * **inside the request** (§1) so a roster is refused before the teacher writes the brief, then
 * writes the registry row and the objects; `DELETE /sources/:id` removes an unbound Source. The
 * lesson binds Sources in `POST /lessons` (`lessons.ts`). This module imports only types from
 * `@tj/domain` for storage — never `@tj/storage` values (Bun globals would leak into `AppType`).
 *
 * Nothing from the document is ever logged (ADR 0015): ids, kind, counts and the refusal reason.
 */

/** 25 MB of file plus the multipart framing and the small text fields. */
export const SOURCE_BODY_LIMIT_BYTES = 26 * 1024 * 1024;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_PASTE_CHARS = 200_000;
export const SOURCE_NAME_MAX = 120;

export const STORAGE_UNAVAILABLE_MESSAGE = "Uploads are not available right now.";
export const TOO_LARGE_MESSAGE = "That file is over 25 MB.";
export const SOURCE_BOUND_MESSAGE = "This file is already part of a lesson.";
export const SOURCE_RATE_LIMIT_MESSAGE =
  "Too many uploads for this workspace. Try again in a moment.";
export const PASTE_NAME = "Pasted text";

export const REFUSAL_MESSAGES = {
  roster: (where: string) =>
    `This looks like a class list (${where}). We don't take documents with pupil names. Upload only the non-personal parts.`,
  identifiers: (where: string) =>
    `This document contains a pupil identifier (${where}). Remove it and upload again.`,
  unreadable: () =>
    "We couldn't read text in this file — it may be scanned. Paste the text instead or start from a topic.",
  tooLong: (pages: number) => `This file has ${pages} pages; the limit is ${LIMITS.maxPages}.`,
  unsupported: () => "Upload a PDF, PowerPoint (.pptx) or Word (.docx) file, or paste text.",
} as const;

/** The location in a refusal message, by the kind of document. */
export function describeLocator(ref: SourceLocator, kind: ExtractionKind): string {
  if (kind === "paste") return "the pasted text";
  if (ref.page !== undefined) return `page ${ref.page}`;
  if (ref.slide !== undefined) return `slide ${ref.slide}`;
  if (ref.section !== undefined) return `the section "${ref.section}"`;
  return "the document";
}

export function refusalError(refusal: Refusal, kind: ExtractionKind): SourceRefusedError {
  switch (refusal.reason) {
    case "roster":
      return new SourceRefusedError(
        "roster",
        REFUSAL_MESSAGES.roster(describeLocator(refusal.ref, kind)),
      );
    case "identifiers":
      return new SourceRefusedError(
        "identifiers",
        REFUSAL_MESSAGES.identifiers(describeLocator(refusal.ref, kind)),
      );
    case "unreadable":
      return new SourceRefusedError("unreadable", REFUSAL_MESSAGES.unreadable());
    case "too-long":
      return new SourceRefusedError("too-long", REFUSAL_MESSAGES.tooLong(refusal.pages));
  }
}

const EXT: Record<SourceMime, string> = {
  [MIME.pdf]: "pdf",
  [MIME.pptx]: "pptx",
  [MIME.docx]: "docx",
  [MIME.paste]: "txt",
};
const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const uploadForm = z
  .object({
    file: z.instanceof(File).optional(),
    text: z.string().max(MAX_PASTE_CHARS).optional(),
    name: z.string().trim().max(SOURCE_NAME_MAX).optional(),
  })
  .refine((v) => (v.file === undefined) !== (v.text === undefined), {
    message: "Send either a file or text.",
    path: ["file"],
  });

const sourceParam = z.object({ id: z.uuid() });

const sourceBodyLimit = () =>
  bodyLimit({
    maxSize: SOURCE_BODY_LIMIT_BYTES,
    onError: () => {
      throw new HTTPException(413, { message: TOO_LARGE_MESSAGE });
    },
  });

/** What the request resolved to before extraction: bytes plus how they are described. */
interface Upload {
  bytes: Uint8Array;
  mime: SourceMime;
  kind: SourceRow["kind"];
  name: string;
}

async function readUpload(form: z.infer<typeof uploadForm>): Promise<Upload> {
  if (form.file !== undefined) {
    if (form.file.size > MAX_FILE_BYTES)
      throw new HTTPException(413, { message: TOO_LARGE_MESSAGE });
    const bytes = new Uint8Array(await form.file.arrayBuffer());
    const mime = await sniffMime(bytes).catch(() => null);
    if (mime === null) {
      throw new SourceRefusedError("unsupported", REFUSAL_MESSAGES.unsupported());
    }
    const name = (form.name || form.file.name || `upload.${EXT[mime]}`).slice(0, SOURCE_NAME_MAX);
    return { bytes, mime, kind: "file", name };
  }
  return {
    bytes: new TextEncoder().encode(form.text ?? ""),
    mime: MIME.paste,
    kind: "paste",
    name: form.name || PASTE_NAME,
  };
}

/** Extract, mapping every failure to the `unreadable` refusal (the cause class is logged, not the text). */
async function extractOrRefuse(upload: Upload, log: Logger | undefined, sourceId: string) {
  try {
    return await extract({ bytes: upload.bytes, mime: upload.mime, name: upload.name });
  } catch (error) {
    const code = error instanceof ExtractError ? error.code : "unknown";
    log?.warn({ sourceId, kind: upload.kind, extractError: code }, "source extraction failed");
    throw new SourceRefusedError("unreadable", REFUSAL_MESSAGES.unreadable());
  }
}

/**
 * Write the objects in the order that keeps a half-written Source unreadable: the original, then
 * the images, then `extracted.json` last. Returns every key written so a failure can clean up.
 */
async function writeObjects(
  storage: StorageAdapter,
  workspaceId: WorkspaceId,
  sourceId: string,
  upload: Upload,
  extraction: Extraction,
  lowText: boolean,
): Promise<string[]> {
  const written: string[] = [];
  const put = async (key: string, body: Uint8Array, contentType: string) => {
    await storage.put(key, body, { contentType });
    written.push(key);
  };
  await put(
    storageKey(workspaceId, "sources", sourceId, `original.${EXT[upload.mime]}`),
    upload.bytes,
    upload.mime,
  );
  const images: ExtractedSource["images"] = [];
  for (const [i, image] of extraction.images.entries()) {
    const key = storageKey(
      workspaceId,
      "sources",
      sourceId,
      "img",
      `${i + 1}.${IMAGE_EXT[image.mime] ?? "bin"}`,
    );
    await put(key, image.bytes, image.mime);
    images.push({ ref: image.ref, storageKey: key, mime: image.mime });
  }
  const extracted = ExtractedSourceSchema.parse({
    version: 1,
    sourceId,
    kind: extraction.kind,
    pages: extraction.pages,
    lowText,
    chunks: extraction.chunks,
    images,
  } satisfies ExtractedSource);
  await put(
    storageKey(workspaceId, "sources", sourceId, "extracted.json"),
    new TextEncoder().encode(JSON.stringify(extracted)),
    "application/json",
  );
  return written;
}

/** Best-effort removal of everything under `<ws>/sources/<id>/`; failures are logged, never thrown. */
async function deleteSourceObjects(
  storage: ReadableStorageAdapter,
  workspaceId: WorkspaceId,
  sourceId: string,
  log: Logger | undefined,
): Promise<void> {
  const prefix = `${storageKey(workspaceId, "sources", sourceId)}/`;
  try {
    for await (const object of storage.list(prefix)) {
      await storage.delete(object.key).catch((error: unknown) => {
        log?.warn({ sourceId, err: error }, "source object delete failed");
      });
    }
  } catch (error) {
    log?.warn({ sourceId, err: error }, "source object listing failed");
  }
}

export function sourceRoutes(
  unsafeDb: ScopableDb,
  storage: ReadableStorageAdapter | undefined,
  limiter: RateLimiter,
) {
  const requireStorage = (): ReadableStorageAdapter => {
    if (!storage) throw new HTTPException(503, { message: STORAGE_UNAVAILABLE_MESSAGE });
    return storage;
  };

  return new Hono<AppEnv>()
    .post(
      "/sources",
      rateLimitByWorkspace(limiter, SOURCE_RATE_LIMIT_MESSAGE),
      sourceBodyLimit(),
      zValidator("form", uploadForm, validationHook),
      async (c) => {
        const workspaceId = getWorkspaceId(c, { allowHeaderShim: false });
        const store = requireStorage();
        const log = c.get("logger");
        const ws = forWorkspace(unsafeDb, workspaceId);
        const sourceId = newId();

        const upload = await readUpload(c.req.valid("form"));
        const extraction = await extractOrRefuse(upload, log, sourceId);
        const refusal = screen(extraction);
        if (refusal !== null) {
          log?.info({ sourceId, kind: extraction.kind, refused: refusal.reason }, "source refused");
          throw refusalError(refusal, extraction.kind);
        }

        const lowText = isLowText(extraction);
        const row = await createSource(ws, {
          id: sourceId,
          kind: upload.kind,
          name: upload.name,
          mime: upload.mime,
          byteSize: upload.bytes.byteLength,
          storageKey: storageKey(workspaceId, "sources", sourceId, `original.${EXT[upload.mime]}`),
          pages: extraction.pages,
          lowText,
        });
        try {
          await writeObjects(store, workspaceId, sourceId, upload, extraction, lowText);
        } catch (error) {
          log?.error({ sourceId, err: error }, "source objects could not be written");
          await deleteSourceObjects(store, workspaceId, sourceId, log);
          await softDeleteSource(ws, sourceId).catch(() => undefined);
          throw new HTTPException(503, { message: STORAGE_UNAVAILABLE_MESSAGE });
        }
        log?.info(
          {
            sourceId,
            kind: extraction.kind,
            pages: extraction.pages,
            chunks: extraction.chunks.length,
            images: extraction.images.length,
            lowText,
            bytes: upload.bytes.byteLength,
          },
          "source stored",
        );
        return c.json({ source: toSourceRef(row) }, 201);
      },
    )
    .delete("/sources/:id", zValidator("param", sourceParam, validationHook), async (c) => {
      const workspaceId = getWorkspaceId(c, { allowHeaderShim: false });
      const store = requireStorage();
      const ws = forWorkspace(unsafeDb, workspaceId);
      const { id } = c.req.valid("param");
      const result = await softDeleteSource(ws, id);
      if (result === "missing") throw new HTTPException(404, { message: NOT_FOUND_MESSAGE });
      if (result === "bound") throw new HTTPException(409, { message: SOURCE_BOUND_MESSAGE });
      await deleteSourceObjects(store, workspaceId, id, c.get("logger"));
      c.get("logger")?.info({ sourceId: id }, "source deleted");
      return c.body(null, 204);
    });
}
