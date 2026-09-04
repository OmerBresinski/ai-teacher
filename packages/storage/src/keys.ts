import { type ParsedStorageKey, parseStorageKey, StorageKeyError, WorkspaceId } from "@tj/domain";

/**
 * Validate a full object key (`<workspaceId>/<segment>/…`) with the `@tj/domain` rules and
 * return its parsed form. Throws `StorageKeyError` — the same class `storageKey()` throws — so a
 * caller sees one error type for "bad key" regardless of where it was caught.
 */
export function assertObjectKey(key: string): ParsedStorageKey {
  const parsed = parseStorageKey(typeof key === "string" ? key : "");
  if (!parsed.ok) throw new StorageKeyError(`Invalid storage key: ${parsed.error}`, key);
  return parsed.value;
}

export interface ParsedPrefix {
  workspaceId: WorkspaceId;
  /** Segments after the workspace id; empty when the prefix is the bare workspace id. */
  parts: string[];
  /** Normalised prefix without a trailing slash. */
  prefix: string;
}

/**
 * Validate a `list()` prefix. Accepts either a bare workspace id (`<uuid>`) or a full key
 * (`<uuid>/sub/…`); a single trailing `/` is tolerated and stripped. Throws `StorageKeyError`.
 */
export function assertPrefix(prefix: string): ParsedPrefix {
  const raw = typeof prefix === "string" ? prefix : "";
  const trimmed = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  const ws = WorkspaceId.safeParse(trimmed);
  if (ws.success) return { workspaceId: ws.data, parts: [], prefix: ws.data };
  const parsed = parseStorageKey(trimmed);
  if (!parsed.ok) throw new StorageKeyError(`Invalid storage prefix: ${parsed.error}`, prefix);
  return { workspaceId: parsed.value.workspaceId, parts: parsed.value.parts, prefix: trimmed };
}

/**
 * Path-style prefix match: `key` is `prefix` itself or lives under `prefix/`. Unlike a raw string
 * prefix, `<ws>/sources` does **not** match `<ws>/sources-old/x`.
 */
export function keyIsUnderPrefix(key: string, prefix: string): boolean {
  return key === prefix || key.startsWith(`${prefix}/`);
}

/** Percent-encode each segment of a key for use in a URL path (keeps the `/` separators). */
export function encodeKeyForUrl(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}
