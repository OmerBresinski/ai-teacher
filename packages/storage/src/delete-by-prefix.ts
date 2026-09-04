import type { StorageAdapter } from "@tj/domain";
import { assertPrefix } from "./keys";

export interface DeleteByPrefixOptions {
  /** Concurrent `delete` calls in flight. Default 5, clamped to 1..5. */
  concurrency?: number;
}

export interface DeleteByPrefixResult {
  /** Number of objects that were listed and deleted. */
  deleted: number;
}

export const MAX_DELETE_CONCURRENCY = 5;

/** Minimal counting semaphore. */
function semaphore(limit: number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  return {
    async acquire(): Promise<void> {
      if (active < limit) {
        active++;
        return;
      }
      await new Promise<void>((resolve) => waiters.push(resolve));
      active++;
    },
    release(): void {
      active--;
      waiters.shift()?.();
    },
  };
}

/**
 * Delete every object under `prefix` (a workspace id, or `<ws>/sub/…`) — the F15-R02 "deletion
 * destroys originals" primitive. Lists lazily and deletes with at most `concurrency` calls in
 * flight so a big workspace does not hammer the backend. Rethrows the first failure after the
 * in-flight deletes settle.
 */
export async function deleteByPrefix(
  adapter: StorageAdapter,
  prefix: string,
  options: DeleteByPrefixOptions = {},
): Promise<DeleteByPrefixResult> {
  const { prefix: normalised } = assertPrefix(prefix);
  const limit = Math.max(
    1,
    Math.min(MAX_DELETE_CONCURRENCY, Math.floor(options.concurrency ?? MAX_DELETE_CONCURRENCY)),
  );
  const sem = semaphore(limit);
  const inFlight = new Set<Promise<void>>();
  let deleted = 0;
  let failure: unknown;

  for await (const object of adapter.list(normalised)) {
    if (failure !== undefined) break;
    await sem.acquire();
    const task = adapter
      .delete(object.key)
      .then(() => {
        deleted++;
      })
      .catch((error: unknown) => {
        failure ??= error;
      })
      .finally(() => {
        sem.release();
        inFlight.delete(task);
      });
    inFlight.add(task);
  }
  await Promise.all(inFlight);
  if (failure !== undefined) throw failure;
  return { deleted };
}
