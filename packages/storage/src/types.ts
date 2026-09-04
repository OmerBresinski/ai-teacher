import type { ReadableStorageAdapter, StorageAdapter } from "@tj/domain";

// `ReadableStorageAdapter` / `StorageObjectBody` live in `@tj/domain` (ADR 0011 amendment) so the
// api's `AppType` can name them without pulling Bun-specific code into browser type-checks.
export type { ReadableStorageAdapter, StorageObjectBody } from "@tj/domain";

export function isReadableStorageAdapter(
  adapter: StorageAdapter,
): adapter is ReadableStorageAdapter {
  return typeof (adapter as Partial<ReadableStorageAdapter>).get === "function";
}
