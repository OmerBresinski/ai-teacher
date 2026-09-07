import type { StorageObject, StoragePutOptions, StorageSignedUrlOptions } from "@tj/domain";
import { StorageError, toBackendError } from "./errors";
import { assertObjectKey, assertPrefix, encodeKeyForUrl, keyIsUnderPrefix } from "./keys";
import type { ReadableStorageAdapter, StorageObjectBody } from "./types";

export interface S3StorageOptions {
  /** S3 API endpoint, e.g. Railway's `https://t3.storageapi.dev` (`S3_ENDPOINT`). */
  endpoint: string;
  /** Bucket name as reported by `railway bucket credentials` (`S3_BUCKET`). */
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** SigV4 region. Railway reports `auto`; the default. */
  region?: string;
  /**
   * Path the API mounts its private-file proxy on. `getSignedUrl` returns
   * `${proxyBasePath}/${key}`. Default `/files`.
   */
  proxyBasePath?: string;
  /** Page size for `list()`; each page is one S3 `ListObjectsV2` call. Default 1000 (the S3 maximum). */
  listPageSize?: number;
}

const DEFAULT_REGION = "auto";
const DEFAULT_CONTENT_TYPE = "application/octet-stream";
const NOT_FOUND_CODES = new Set(["NoSuchKey", "NotFound"]);

/** `Bun.S3Client` raises an `S3Error` whose `code` is the S3 error code string. */
function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    NOT_FOUND_CODES.has(String((error as { code?: unknown }).code))
  );
}

/**
 * `StorageAdapter` backed by an S3-compatible bucket through `Bun.S3Client` (ADR 0026). In
 * production this is the Railway Bucket `files`.
 *
 * - Every object is private; there is no public mode. `getSignedUrl` never presigns: it returns
 *   the API proxy path `/files/<key>`, the only sanctioned way for a browser to read an object
 *   (per-request authorisation and response hardening live in the proxy). `expiresInSeconds` is
 *   therefore ignored.
 * - Requests are path-style (`<endpoint>/<bucket>/<key>`): virtual-hosted style fails with
 *   `NoSuchBucket` against Railway's endpoint.
 * - `list()` walks every continuation page and applies path-style prefix matching on top of the
 *   raw S3 prefix.
 */
export class S3Storage implements ReadableStorageAdapter {
  private readonly client: Bun.S3Client;
  private readonly proxyBasePath: string;
  private readonly listPageSize: number;

  constructor(options: S3StorageOptions) {
    const missing = (["endpoint", "bucket", "accessKeyId", "secretAccessKey"] as const).filter(
      (k) => !options[k],
    );
    if (missing.length > 0) {
      throw new Error(`S3Storage: missing required option(s): ${missing.join(", ")}`);
    }
    this.client = new Bun.S3Client({
      endpoint: options.endpoint,
      bucket: options.bucket,
      region: options.region || DEFAULT_REGION,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      virtualHostedStyle: false,
    });
    this.proxyBasePath = (options.proxyBasePath ?? "/files").replace(/\/+$/, "");
    this.listPageSize = options.listPageSize ?? 1000;
  }

  async put(
    key: string,
    body: ReadableStream<Uint8Array> | Uint8Array,
    opts: StoragePutOptions,
  ): Promise<{ key: string }> {
    assertObjectKey(key);
    const type = opts.contentType || DEFAULT_CONTENT_TYPE;
    try {
      if (body instanceof Uint8Array) {
        await this.client.write(key, body, { type });
      } else {
        // Multipart upload: parts go out as chunks arrive, never buffered whole in memory.
        const sink = this.client.file(key, { type }).writer();
        try {
          for await (const chunk of body) sink.write(chunk);
        } finally {
          await sink.end();
        }
      }
      return { key };
    } catch (cause) {
      throw toBackendError("put", key, cause);
    }
  }

  async get(key: string): Promise<StorageObjectBody> {
    assertObjectKey(key);
    let meta: Bun.S3Stats;
    try {
      // HEAD first so a missing key fails here, not lazily while the caller reads the stream.
      meta = await this.client.stat(key);
    } catch (cause) {
      if (isNotFound(cause)) {
        throw new StorageError("not_found", `Object not found: ${key}`, { key });
      }
      throw toBackendError("get", key, cause);
    }
    return {
      key,
      body: this.client.file(key).stream(),
      contentType: meta.type || DEFAULT_CONTENT_TYPE,
      size: meta.size,
      updatedAt: meta.lastModified,
    };
  }

  /**
   * Returns `${proxyBasePath}/${key}` (relative path the API serves). Throws `not_found` when the
   * object does not exist.
   */
  async getSignedUrl(key: string, _opts: StorageSignedUrlOptions): Promise<string> {
    assertObjectKey(key);
    try {
      await this.client.stat(key);
    } catch (cause) {
      if (isNotFound(cause)) {
        throw new StorageError("not_found", `Object not found: ${key}`, { key });
      }
      throw toBackendError("getSignedUrl", key, cause);
    }
    return `${this.proxyBasePath}/${encodeKeyForUrl(key)}`;
  }

  /** Idempotent: S3 `DeleteObject` succeeds for unknown keys. */
  async delete(key: string): Promise<void> {
    assertObjectKey(key);
    try {
      await this.client.delete(key);
    } catch (cause) {
      if (isNotFound(cause)) return;
      throw toBackendError("delete", key, cause);
    }
  }

  async *list(prefix: string): AsyncIterable<StorageObject> {
    const { prefix: normalised } = assertPrefix(prefix);
    let continuationToken: string | undefined;
    do {
      let page: Bun.S3ListObjectsResponse;
      try {
        page = await this.client.list({
          prefix: `${normalised}/`,
          maxKeys: this.listPageSize,
          ...(continuationToken ? { continuationToken } : {}),
        });
      } catch (cause) {
        throw toBackendError("list", undefined, cause);
      }
      for (const object of page.contents ?? []) {
        if (!keyIsUnderPrefix(object.key, normalised)) continue;
        yield {
          key: object.key,
          size: object.size ?? 0,
          updatedAt: object.lastModified ? new Date(object.lastModified) : new Date(0),
        };
      }
      continuationToken = page.isTruncated ? page.nextContinuationToken : undefined;
    } while (continuationToken);
  }
}
