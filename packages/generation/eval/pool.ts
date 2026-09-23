/*
 * A small worker pool for the lab benches: at most `limit` tasks in flight, results in input
 * order. A bench's admission control lives in the shared `Budget` (every call reserves its
 * worst case, input estimate plus `maxOutputTokens` at list price, and settles the difference on
 * completion); the pool only bounds how many of those reservations are held at once.
 */

export const DEFAULT_CONCURRENCY = 6;

export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const width = Math.max(1, Math.floor(limit));
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
  return results;
}
