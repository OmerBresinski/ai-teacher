import { z } from "zod";
import { WorkspaceId } from "./ids";
import { err, ok, type Result } from "./result";

// ---------------------------------------------------------------------------------------------
// StorageAdapter (ADR 0011): implemented by @tj/storage (local disk, Vercel Blob)
// ---------------------------------------------------------------------------------------------

/** One stored object as returned by `StorageAdapter.list`. */
export interface StorageObject {
  key: string;
  /** Size in bytes. */
  size: number;
  updatedAt: Date;
}

export interface StoragePutOptions {
  /** MIME type stored with the object and sent on download. */
  contentType: string;
}

export interface StorageSignedUrlOptions {
  /** Lifetime of the returned URL. */
  expiresInSeconds: number;
}

/**
 * Minimal object-storage boundary. Keys **must** be built with {@link storageKey} so every object
 * is prefixed by its workspace id — that prefix is what makes export/delete-all (F15-R02)
 * enumerable per tenant.
 */
export interface StorageAdapter {
  put(
    key: string,
    body: ReadableStream<Uint8Array> | Uint8Array,
    opts: StoragePutOptions,
  ): Promise<{ key: string }>;
  getSignedUrl(key: string, opts: StorageSignedUrlOptions): Promise<string>;
  delete(key: string): Promise<void>;
  list(prefix: string): AsyncIterable<StorageObject>;
}

/** Body + metadata of one stored object, as returned by {@link ReadableStorageAdapter.get}. */
export interface StorageObjectBody {
  key: string;
  /** Streams the object bytes; never buffered by the adapter. */
  body: ReadableStream<Uint8Array>;
  /** MIME type recorded at `put` time (`application/octet-stream` when unknown). */
  contentType: string;
  /** Size in bytes. */
  size: number;
  updatedAt: Date;
}

/**
 * `StorageAdapter` plus a server-side read (ADR 0011 amendment 2026-09-04). Private objects have
 * no browser-reachable URL; the API's `GET /files/:key` proxy authorises the caller and streams
 * `get(key)`. Both `@tj/storage` adapters implement this.
 */
export interface ReadableStorageAdapter extends StorageAdapter {
  /** Rejects with a `not_found` storage error when the object does not exist. */
  get(key: string): Promise<StorageObjectBody>;
}

// ---------------------------------------------------------------------------------------------
// Storage keys: `<workspaceId>/<part>/<part>/...`
// ---------------------------------------------------------------------------------------------

/** Thrown by {@link storageKey} when a key cannot be built safely. */
export class StorageKeyError extends Error {
  override readonly name = "StorageKeyError";
  /** The offending segment, when the error is about one. */
  readonly part: string | undefined;

  constructor(message: string, part?: string) {
    super(message);
    this.part = part;
  }
}

/**
 * Returns a reason a single key segment is unsafe, or `undefined` when it is fine.
 * Segments must be non-empty and must not contain `/`, `\`, `..` or NUL, nor be `.`.
 */
function keyPartProblem(part: string): string | undefined {
  if (part.length === 0) return "empty segment";
  if (part === ".") return 'segment "." is not allowed';
  if (part.includes("..")) return 'segment must not contain ".."';
  if (part.includes("/")) return 'segment must not contain "/"';
  if (part.includes("\\")) return 'segment must not contain "\\"';
  if (part.includes("\0")) return "segment must not contain NUL";
  return undefined;
}

/**
 * Build a storage key: `${workspaceId}/${parts.join("/")}`.
 *
 * Throws {@link StorageKeyError} when `workspaceId` is not a UUID, when no parts are given, or when
 * any part is empty / contains `/`, `\`, `..` or NUL. Use {@link parseStorageKey} for the
 * non-throwing inverse.
 *
 * @example storageKey(ws, "sources", "abc.pdf") // "<ws>/sources/abc.pdf"
 */
export function storageKey(workspaceId: WorkspaceId, ...parts: string[]): string {
  const ws = WorkspaceId.safeParse(workspaceId);
  if (!ws.success) {
    throw new StorageKeyError("storageKey: workspaceId must be a UUID", workspaceId);
  }
  if (parts.length === 0) {
    throw new StorageKeyError("storageKey: at least one key segment is required");
  }
  for (const part of parts) {
    const problem = keyPartProblem(part);
    if (problem) throw new StorageKeyError(`storageKey: ${problem}`, part);
  }
  return `${ws.data}/${parts.join("/")}`;
}

export interface ParsedStorageKey {
  workspaceId: WorkspaceId;
  /** Segments after the workspace prefix; always at least one. */
  parts: string[];
}

/** Non-throwing inverse of {@link storageKey}. The error is a human-readable reason. */
export function parseStorageKey(key: string): Result<ParsedStorageKey, string> {
  const [prefix, ...parts] = key.split("/");
  const ws = WorkspaceId.safeParse(prefix);
  if (!ws.success) return err("key must start with a workspace id (UUID)");
  if (parts.length === 0) return err("key must have at least one segment after the workspace id");
  for (const part of parts) {
    const problem = keyPartProblem(part);
    if (problem) return err(problem);
  }
  return ok({ workspaceId: ws.data, parts });
}

/** Coarse shape: UUID, `/`, then one or more non-empty segments without `/`, `\` or NUL. */
const STORAGE_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\/[^/\\\0]+)+$/i;

/** Validates a full storage key (regex for the shape, then the same segment rules as `storageKey`). */
export const StorageKeySchema = z
  .string()
  .regex(STORAGE_KEY_PATTERN, { error: "Invalid storage key: expected <uuid>/<path>" })
  .refine((key) => parseStorageKey(key).ok, { error: "Invalid storage key segment" });
export type StorageKey = z.infer<typeof StorageKeySchema>;
