import type { StorageAdapter } from "@tj/domain";
import { LocalDiskStorage } from "./local-disk";
import type { ReadableStorageAdapter } from "./types";
import { VercelBlobStorage } from "./vercel-blob";

export interface StorageEnv {
  /** When set, Vercel Blob is used. */
  BLOB_READ_WRITE_TOKEN?: string | undefined;
  /** Local-disk root; default `.data/storage` (git-ignored). Ignored when the token is set. */
  STORAGE_ROOT?: string | undefined;
  /** Optional base URL for local-disk `getSignedUrl`. Ignored when the token is set. */
  STORAGE_PUBLIC_BASE_URL?: string | undefined;
  /**
   * Comma-separated list of key prefixes stored as public blobs (see
   * `VercelBlobStorageOptions.publicPrefixes`). Ignored for local disk.
   */
  STORAGE_PUBLIC_PREFIXES?: string | undefined;
}

export type StorageKind = "vercel-blob" | "local-disk";

export interface CreatedStorage {
  adapter: ReadableStorageAdapter & StorageAdapter;
  kind: StorageKind;
}

export const DEFAULT_STORAGE_ROOT = ".data/storage";

/**
 * Pick an adapter from environment variables: Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set,
 * otherwise local disk at `STORAGE_ROOT ?? ".data/storage"`.
 */
export function createStorage(env: StorageEnv): CreatedStorage {
  const token = env.BLOB_READ_WRITE_TOKEN?.trim();
  if (token) {
    const publicPrefixes = (env.STORAGE_PUBLIC_PREFIXES ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    return { adapter: new VercelBlobStorage({ token, publicPrefixes }), kind: "vercel-blob" };
  }
  const rootDir = env.STORAGE_ROOT?.trim() || DEFAULT_STORAGE_ROOT;
  const publicBaseUrl = env.STORAGE_PUBLIC_BASE_URL?.trim() || undefined;
  return { adapter: new LocalDiskStorage(rootDir, { publicBaseUrl }), kind: "local-disk" };
}
