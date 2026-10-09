import { type PexelsClient, PexelsError } from "./pexels";

/*
 * A Pexels rate limiter (TEACH-110 part h, C6). One lesson's picture slots used to search all at
 * once (18 searches in 1.3 s): Pexels answered 429 to 5 of them and each of those slots fell to
 * the slower, paid generation path. Calls now pass a token bucket, and a 429 waits a short
 * backoff and tries once more before the caller sees it. A 429 whose reset is far off (the
 * monthly quota: `X-Ratelimit-Reset` is weeks away) is not retried.
 */

export interface PexelsLimitOptions {
  /** Calls that may go at once (the bucket's size). */
  burst?: number;
  /** Calls a second once the burst is spent. */
  perSecond?: number;
  /** The wait before the one retry after a 429. */
  backoffMs?: number;
  /** A 429 asking to wait longer than this is the quota, not a burst: no retry. */
  maxRetryAfterS?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export const PEXELS_BURST = 5;
export const PEXELS_PER_SECOND = 5;
export const PEXELS_BACKOFF_MS = 1000;

const abortable = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", stop);
      resolve();
    }
    function stop() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener("abort", stop, { once: true });
  });

export function limitPexels(client: PexelsClient, o: PexelsLimitOptions = {}): PexelsClient {
  const burst = o.burst ?? PEXELS_BURST;
  const perSecond = o.perSecond ?? PEXELS_PER_SECOND;
  const backoffMs = o.backoffMs ?? PEXELS_BACKOFF_MS;
  const maxRetryAfterS = o.maxRetryAfterS ?? 10;
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? abortable;
  let tokens = burst;
  let at = now();
  /** Waiters take tokens in arrival order. */
  let line: Promise<void> = Promise.resolve();

  const take = async (signal?: AbortSignal) => {
    for (;;) {
      const t = now();
      tokens = Math.min(burst, tokens + ((t - at) / 1000) * perSecond);
      at = t;
      if (tokens >= 1) {
        tokens -= 1;
        return;
      }
      await sleep(Math.ceil(((1 - tokens) / perSecond) * 1000), signal);
    }
  };
  const acquire = (signal?: AbortSignal) => {
    const mine = line.then(() => take(signal));
    // The next waiter queues behind this one whether it got its token or was aborted.
    line = mine.then(
      () => undefined,
      () => undefined,
    );
    return mine;
  };
  const limited = async <T>(call: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    await acquire(signal);
    try {
      return await call();
    } catch (error) {
      const busy =
        error instanceof PexelsError &&
        error.status === 429 &&
        (error.retryAfterS === undefined || error.retryAfterS <= maxRetryAfterS);
      if (!busy) throw error;
      const wait = Math.max(backoffMs, (error.retryAfterS ?? 0) * 1000);
      await sleep(wait, signal);
      await acquire(signal);
      return call();
    }
  };
  return {
    search: (params) => limited(() => client.search(params), params.signal),
    photo: (id, signal) => limited(() => client.photo(id, signal), signal),
  };
}
