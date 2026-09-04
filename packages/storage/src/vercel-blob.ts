import type { StorageObject, StoragePutOptions, StorageSignedUrlOptions } from "@tj/domain";
import { BlobNotFoundError, del, get, head, list, put } from "@vercel/blob";
import { StorageError, toBackendError } from "./errors";
import { assertObjectKey, assertPrefix, encodeKeyForUrl, keyIsUnderPrefix } from "./keys";
import type { ReadableStorageAdapter, StorageObjectBody } from "./types";

export interface VercelBlobStorageOptions {
  /** Read-write token for the Blob store (`BLOB_READ_WRITE_TOKEN`). */
  token: string;
  /**
   * Key prefixes (`<ws>` or `<ws>/sub`) whose objects are stored with `access: "public"` and
   * whose `getSignedUrl` returns the blob's own CDN URL. Everything else is stored **private**
   * and only reachable through the API proxy (`GET /files/:key`). Defaults to none.
   */
  publicPrefixes?: readonly string[];
  /**
   * Path the API mounts its private-file proxy on. `getSignedUrl` for a private object returns
   * `${proxyBasePath}/${key}`. Default `/files`.
   */
  proxyBasePath?: string;
  /** Page size for `list()`; each page is one Blob API call. Default 1000 (the API maximum). */
  listPageSize?: number;
}

/**
 * `StorageAdapter` backed by Vercel Blob (ADR 0011) via `@vercel/blob` 2.x.
 *
 * - Objects are stored with `access: "private"` (supported since `@vercel/blob` 2.x) and
 *   `addRandomSuffix: false`, so the Blob pathname **is** the storage key.
 * - `getSignedUrl` does not mint a Blob presigned URL: for private objects it returns the API
 *   proxy path `/files/<key>` (TEACH-16/19), which is the only sanctioned way for a browser to
 *   read them. `expiresInSeconds` is therefore ignored — the proxy enforces auth per request.
 * - `list()` walks every `cursor` page and applies path-style prefix matching on top of the
 *   API's raw string prefix.
 */
export class VercelBlobStorage implements ReadableStorageAdapter {
  private readonly token: string;
  private readonly publicPrefixes: readonly string[];
  private readonly proxyBasePath: string;
  private readonly listPageSize: number;

  constructor(options: VercelBlobStorageOptions) {
    if (!options.token) throw new Error("VercelBlobStorage: token is required");
    this.token = options.token;
    this.publicPrefixes = (options.publicPrefixes ?? []).map((p) => assertPrefix(p).prefix);
    this.proxyBasePath = (options.proxyBasePath ?? "/files").replace(/\/+$/, "");
    this.listPageSize = options.listPageSize ?? 1000;
  }

  /** `true` when `key` lives under one of the configured public prefixes. */
  isPublic(key: string): boolean {
    return this.publicPrefixes.some((p) => keyIsUnderPrefix(key, p));
  }

  private accessFor(key: string): "public" | "private" {
    return this.isPublic(key) ? "public" : "private";
  }

  async put(
    key: string,
    body: ReadableStream<Uint8Array> | Uint8Array,
    opts: StoragePutOptions,
  ): Promise<{ key: string }> {
    assertObjectKey(key);
    try {
      const result = await put(key, body instanceof Uint8Array ? new Blob([body]) : body, {
        token: this.token,
        access: this.accessFor(key),
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: opts.contentType || "application/octet-stream",
      });
      return { key: result.pathname };
    } catch (cause) {
      throw toBackendError("put", key, cause);
    }
  }

  async get(key: string): Promise<StorageObjectBody> {
    assertObjectKey(key);
    let result: Awaited<ReturnType<typeof get>>;
    try {
      result = await get(key, { token: this.token, access: this.accessFor(key) });
    } catch (cause) {
      if (cause instanceof BlobNotFoundError) {
        throw new StorageError("not_found", `Object not found: ${key}`, { key });
      }
      throw toBackendError("get", key, cause);
    }
    if (!result?.stream) {
      throw new StorageError("not_found", `Object not found: ${key}`, { key });
    }
    return {
      key,
      body: result.stream,
      contentType: result.blob.contentType ?? "application/octet-stream",
      size: result.blob.size ?? 0,
      updatedAt: result.blob.uploadedAt ?? new Date(),
    };
  }

  /**
   * Public prefix → the blob's CDN URL. Otherwise → `${proxyBasePath}/${key}` (relative path the
   * API serves). Throws `not_found` when the object does not exist.
   */
  async getSignedUrl(key: string, _opts: StorageSignedUrlOptions): Promise<string> {
    assertObjectKey(key);
    let meta: Awaited<ReturnType<typeof head>>;
    try {
      meta = await head(key, { token: this.token });
    } catch (cause) {
      if (cause instanceof BlobNotFoundError) {
        throw new StorageError("not_found", `Object not found: ${key}`, { key });
      }
      throw toBackendError("getSignedUrl", key, cause);
    }
    if (this.isPublic(key)) return meta.url;
    return `${this.proxyBasePath}/${encodeKeyForUrl(key)}`;
  }

  /** Idempotent: Vercel Blob's `del` succeeds for unknown pathnames. */
  async delete(key: string): Promise<void> {
    assertObjectKey(key);
    try {
      await del(key, { token: this.token });
    } catch (cause) {
      if (cause instanceof BlobNotFoundError) return;
      throw toBackendError("delete", key, cause);
    }
  }

  async *list(prefix: string): AsyncIterable<StorageObject> {
    const { prefix: normalised } = assertPrefix(prefix);
    let cursor: string | undefined;
    do {
      let page: Awaited<ReturnType<typeof list>>;
      try {
        page = await list({
          token: this.token,
          prefix: `${normalised}/`,
          limit: this.listPageSize,
          cursor,
        });
      } catch (cause) {
        throw toBackendError("list", undefined, cause);
      }
      for (const blob of page.blobs) {
        if (!keyIsUnderPrefix(blob.pathname, normalised)) continue;
        yield { key: blob.pathname, size: blob.size, updatedAt: blob.uploadedAt };
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }
}
