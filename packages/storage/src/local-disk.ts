import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { StorageObject, StoragePutOptions, StorageSignedUrlOptions } from "@tj/domain";
import { StorageError, toBackendError } from "./errors";
import { assertObjectKey, assertPrefix, encodeKeyForUrl } from "./keys";
import type { ReadableStorageAdapter, StorageObjectBody } from "./types";

export interface LocalDiskStorageOptions {
  /**
   * When set, `getSignedUrl` returns `${publicBaseUrl}/${key}` (e.g. a dev server that serves
   * the root directory statically) instead of a `file://` URL.
   */
  publicBaseUrl?: string;
}

/** Suffix of the JSON sidecar that records `contentType` next to each object. */
export const META_SUFFIX = ".meta.json";

const DEFAULT_CONTENT_TYPE = "application/octet-stream";

interface SidecarMeta {
  contentType: string;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

/**
 * `StorageAdapter` backed by a directory on the local file system. Used in development and
 * tests (ADR 0011); **not** for production.
 *
 * - Objects live at `<rootDir>/<key>`; `contentType` is kept in a `<key>.meta.json` sidecar that
 *   `list()` never reports.
 * - Keys are validated with the `@tj/domain` rules **and** the resolved path is asserted to stay
 *   under `rootDir`.
 * - `getSignedUrl` is not signed at all: it returns a `file://` URL (or `publicBaseUrl/key`) and
 *   ignores `expiresInSeconds`. Anyone with file-system access can read the object.
 */
export class LocalDiskStorage implements ReadableStorageAdapter {
  readonly rootDir: string;
  readonly publicBaseUrl: string | undefined;

  constructor(rootDir: string, options: LocalDiskStorageOptions = {}) {
    this.rootDir = resolve(rootDir);
    this.publicBaseUrl = options.publicBaseUrl?.replace(/\/+$/, "");
  }

  /** Absolute path for `key`, after domain validation and the root-containment check. */
  pathFor(key: string): string {
    assertObjectKey(key);
    return this.resolveUnderRoot(key);
  }

  private resolveUnderRoot(relPath: string): string {
    const abs = resolve(this.rootDir, relPath);
    const rel = relative(this.rootDir, abs);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) {
      throw new StorageError("invalid_key", "Storage key resolves outside the root directory", {
        key: relPath,
      });
    }
    return abs;
  }

  async put(
    key: string,
    body: ReadableStream<Uint8Array> | Uint8Array,
    opts: StoragePutOptions,
  ): Promise<{ key: string }> {
    const path = this.pathFor(key);
    try {
      await mkdir(join(path, ".."), { recursive: true });
      if (body instanceof Uint8Array) {
        await Bun.write(path, body);
      } else {
        // Incremental FileSink: chunks go to disk as they arrive, never buffered whole in memory.
        // (Bun.write(path, new Response(stream)) stalls on pull-based streams in Bun 1.3.x.)
        const sink = Bun.file(path).writer();
        try {
          for await (const chunk of body) sink.write(chunk);
        } finally {
          await sink.end();
        }
      }
      const meta: SidecarMeta = { contentType: opts.contentType || DEFAULT_CONTENT_TYPE };
      await Bun.write(`${path}${META_SUFFIX}`, JSON.stringify(meta));
      return { key };
    } catch (cause) {
      throw toBackendError("put", key, cause);
    }
  }

  async get(key: string): Promise<StorageObjectBody> {
    const path = this.pathFor(key);
    const file = Bun.file(path);
    let size: number;
    let updatedAt: Date;
    try {
      const s = await stat(path);
      if (!s.isFile()) throw new StorageError("not_found", `Object not found: ${key}`, { key });
      size = s.size;
      updatedAt = s.mtime;
    } catch (cause) {
      if (isNotFound(cause))
        throw new StorageError("not_found", `Object not found: ${key}`, { key });
      throw toBackendError("get", key, cause);
    }
    return {
      key,
      body: file.stream(),
      contentType: await this.readContentType(path),
      size,
      updatedAt,
    };
  }

  private async readContentType(path: string): Promise<string> {
    try {
      const meta = (await Bun.file(`${path}${META_SUFFIX}`).json()) as Partial<SidecarMeta>;
      return typeof meta.contentType === "string" ? meta.contentType : DEFAULT_CONTENT_TYPE;
    } catch {
      return DEFAULT_CONTENT_TYPE;
    }
  }

  /**
   * Returns a `file://` URL to the object, or `${publicBaseUrl}/${key}` when configured.
   * Throws `not_found` when the object does not exist. `expiresInSeconds` is ignored — nothing
   * about this URL is signed.
   */
  async getSignedUrl(key: string, _opts: StorageSignedUrlOptions): Promise<string> {
    const path = this.pathFor(key);
    const exists = await Bun.file(path).exists();
    if (!exists) throw new StorageError("not_found", `Object not found: ${key}`, { key });
    if (this.publicBaseUrl) return `${this.publicBaseUrl}/${encodeKeyForUrl(key)}`;
    return pathToFileURL(path).href;
  }

  /** Removes the object and its sidecar; a missing object is not an error. */
  async delete(key: string): Promise<void> {
    const path = this.pathFor(key);
    try {
      await rm(path, { force: true });
      await rm(`${path}${META_SUFFIX}`, { force: true });
    } catch (cause) {
      throw toBackendError("delete", key, cause);
    }
  }

  /**
   * Recursively lists objects under `prefix` (`<ws>` or `<ws>/sub/…`). Sidecars are excluded.
   * A prefix that does not exist yields nothing.
   */
  async *list(prefix: string): AsyncIterable<StorageObject> {
    const { prefix: normalised } = assertPrefix(prefix);
    const dir = this.resolveUnderRoot(normalised);
    yield* this.walk(dir);
  }

  private async *walk(dir: string): AsyncGenerator<StorageObject> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (cause) {
      if (isNotFound(cause)) return;
      throw toBackendError("list", undefined, cause);
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        yield* this.walk(full);
      } else if (entry.isFile() && !entry.name.endsWith(META_SUFFIX)) {
        const s = await stat(full);
        yield {
          key: relative(this.rootDir, full).split(sep).join("/"),
          size: s.size,
          updatedAt: s.mtime,
        };
      }
    }
  }
}
