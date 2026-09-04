/**
 * Error raised by `@tj/storage` adapters for backend failures and adapter-level refusals.
 *
 * Keys that fail the `@tj/domain` rules (`parseStorageKey`) throw `StorageKeyError` from
 * `@tj/domain` instead — callers can catch either class and read `code` on this one.
 */
export type StorageErrorCode =
  /** The object does not exist (`getSignedUrl`, `get`). */
  | "not_found"
  /** The backend (file system, Vercel Blob API) failed; `cause` carries the original error. */
  | "backend"
  /**
   * The key passed domain validation but this adapter still refuses it (e.g. the resolved
   * local path would escape the root directory). Should never happen for keys built with
   * `storageKey()`.
   */
  | "invalid_key";

export class StorageError extends Error {
  override readonly name = "StorageError";
  readonly code: StorageErrorCode;
  /** The key the operation was about, when there is one. */
  readonly key: string | undefined;

  constructor(
    code: StorageErrorCode,
    message: string,
    options: { key?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.key = options.key;
  }
}

export function isStorageError(error: unknown, code?: StorageErrorCode): error is StorageError {
  return error instanceof StorageError && (code === undefined || error.code === code);
}

/** Wrap an unknown failure as a `backend` StorageError unless it already is a StorageError. */
export function toBackendError(operation: string, key: string | undefined, cause: unknown) {
  if (cause instanceof StorageError) return cause;
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new StorageError("backend", `${operation} failed: ${detail}`, { key, cause });
}
