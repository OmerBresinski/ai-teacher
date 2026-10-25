import type { StorageAdapter } from "@tj/domain";
import { checkStorage, type StorageCheck, type StorageKind } from "@tj/storage";
import type { WorkerDeps } from "./deps";

interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

/**
 * The boot storage check (25 Oct 2026 incident: a reset bucket secret, every picture paid for and
 * then lost at `storage.put`, while the worker had booted and logged `storage="s3"`). On S3, one
 * put and delete (`checkStorage`); local disk is not checked. A failure does not stop the worker:
 * lessons still write. It logs at error level and drops `imageGeneration`, so nothing is paid for
 * that cannot be saved: the lesson runs as on a worker without `OPENAI_API_KEY` (no picture maker,
 * `lesson-pipeline.ts`), and any stock picture it still tries fails free at its own save.
 */
export async function verifyStorage<D extends WorkerDeps & { storageKind: StorageKind }>(
  deps: D,
  logger: Logger,
  check: (adapter: StorageAdapter) => Promise<StorageCheck> = checkStorage,
): Promise<D & { storageCheck: "ok" | "failed" | "skipped" }> {
  if (deps.storageKind !== "s3") return { ...deps, storageCheck: "skipped" };
  const out = await check(deps.storage);
  if (out.ok) {
    logger.info({ storage: deps.storageKind, ms: out.ms }, "storage_check ok");
    return { ...deps, storageCheck: "ok" };
  }
  const { ok: _ok, ...failure } = out;
  logger.error(
    { storage: deps.storageKind, ...failure, imageGeneration: "disabled" },
    "storage_check failed: picture generation is off until the worker restarts with working storage",
  );
  const { imageGeneration: _off, ...rest } = deps;
  return { ...rest, storageCheck: "failed" } as D & { storageCheck: "failed" };
}
