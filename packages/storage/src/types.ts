import type { StorageAdapter } from "@tj/domain";

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
 * `StorageAdapter` plus a server-side read. The `@tj/domain` interface has no `get` because
 * clients are meant to download through URLs; the API's private-file proxy (`GET /files/:key`,
 * see README) needs to stream bytes itself, so both adapters in this package implement this.
 *
 * Follow-up: lift `get` into `@tj/domain`'s `StorageAdapter` once the proxy route exists.
 */
export interface ReadableStorageAdapter extends StorageAdapter {
  /** Throws `StorageError` with code `not_found` when the object does not exist. */
  get(key: string): Promise<StorageObjectBody>;
}

export function isReadableStorageAdapter(
  adapter: StorageAdapter,
): adapter is ReadableStorageAdapter {
  return typeof (adapter as Partial<ReadableStorageAdapter>).get === "function";
}
