import type { StorageAdapter } from "@tj/domain";
import { LocalDiskStorage } from "./local-disk";
import { S3Storage } from "./s3";
import type { ReadableStorageAdapter } from "./types";

export interface StorageEnv {
  /** When set (non-blank), the S3 adapter is used and the other `S3_*` variables are required. */
  S3_BUCKET?: string | undefined;
  S3_ENDPOINT?: string | undefined;
  S3_ACCESS_KEY_ID?: string | undefined;
  S3_SECRET_ACCESS_KEY?: string | undefined;
  /** SigV4 region; default `auto` (what Railway reports). */
  S3_REGION?: string | undefined;
  /** Local-disk root; default `.data/storage` (git-ignored). Ignored when `S3_BUCKET` is set. */
  STORAGE_ROOT?: string | undefined;
  /** Optional base URL for local-disk `getSignedUrl`. Ignored when `S3_BUCKET` is set. */
  STORAGE_PUBLIC_BASE_URL?: string | undefined;
}

export type StorageKind = "s3" | "local-disk";

export interface CreatedStorage {
  adapter: ReadableStorageAdapter & StorageAdapter;
  kind: StorageKind;
}

export const DEFAULT_STORAGE_ROOT = ".data/storage";

const S3_REQUIRED = ["S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;

/**
 * Pick an adapter from environment variables (ADR 0026): S3 when `S3_BUCKET` is set, otherwise
 * local disk at `STORAGE_ROOT ?? ".data/storage"`. Throws when `S3_BUCKET` is set but any other
 * required `S3_*` variable is blank, so a half-configured deploy fails at boot instead of silently
 * falling back to ephemeral local disk.
 */
export function createStorage(env: StorageEnv): CreatedStorage {
  const bucket = env.S3_BUCKET?.trim();
  if (bucket) {
    const missing = S3_REQUIRED.filter((name) => !env[name]?.trim());
    if (missing.length > 0) {
      throw new Error(`createStorage: S3_BUCKET is set but ${missing.join(", ")} missing`);
    }
    return {
      adapter: new S3Storage({
        bucket,
        endpoint: (env.S3_ENDPOINT as string).trim(),
        accessKeyId: (env.S3_ACCESS_KEY_ID as string).trim(),
        secretAccessKey: (env.S3_SECRET_ACCESS_KEY as string).trim(),
        region: env.S3_REGION?.trim() || undefined,
      }),
      kind: "s3",
    };
  }
  const rootDir = env.STORAGE_ROOT?.trim() || DEFAULT_STORAGE_ROOT;
  const publicBaseUrl = env.STORAGE_PUBLIC_BASE_URL?.trim() || undefined;
  return { adapter: new LocalDiskStorage(rootDir, { publicBaseUrl }), kind: "local-disk" };
}
