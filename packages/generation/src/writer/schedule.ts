/**
 * How many of the writer's per-slide tail jobs (fit repairs, restages, lost-picture fallbacks) run
 * at once. Each reads and writes only its own slide, so they need no queue; the bound keeps one
 * lesson from opening a dozen small-model calls together.
 */
export const TAIL_CONCURRENCY = 4;

/**
 * Runs `fn` over `items`, at most `limit` at a time, each item starting as soon as a lane is free
 * (never in batches). Resolves when every item has finished. The first failure stops new items
 * from starting and rejects once the items already running have finished, so no job is left
 * writing to a slide after the caller has moved on.
 */
export async function eachBounded<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failed: { error: unknown } | undefined;
  const lane = async () => {
    while (!failed && next < items.length) {
      const k = next++;
      // A failure is kept and rethrown below, after the lanes have stopped (never swallowed).
      await fn(items[k] as T, k).then(undefined, (error: unknown) => {
        failed ??= { error };
      });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  if (failed) throw failed.error;
}
