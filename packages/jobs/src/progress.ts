import type { JobProgress } from "@tj/domain";
import type { ProgressExtra } from "./types";

/** Minimum gap between two `progress` events for one job. */
export const PROGRESS_MIN_INTERVAL_MS = 250;

export interface ProgressEmitterOptions {
  minIntervalMs: number;
  emit: (progress: JobProgress) => Promise<void>;
  onError: (err: unknown) => void;
  /** Test seam; defaults to `Date.now`. */
  now?: () => number;
}

export interface ProgressEmitter {
  /** `JobContext.progress`. Resolves once the event is written or coalesced (never throws). */
  emit: (percent?: number, message?: string, extra?: ProgressExtra) => Promise<void>;
  /** Write the pending coalesced event, if any, and wait for in-flight writes. */
  flush: () => Promise<void>;
}

/**
 * Leading + trailing throttle: the first call emits immediately; calls inside the window are
 * merged field by field — the latest value of each of `percent`, `message` and
 * `documentUpdatedAt` wins — and the merged event is emitted when the window closes. Nothing is
 * dropped silently — the last progress a handler reports always lands (at most `minIntervalMs`
 * late, or on `flush()`), and a `documentUpdatedAt` reported once inside the window survives a
 * later percent-only call. Events are written sequentially so `job_events.id` order matches call
 * order.
 */
export function createProgressEmitter(opts: ProgressEmitterOptions): ProgressEmitter {
  const now = opts.now ?? Date.now;
  let lastEmittedAt = Number.NEGATIVE_INFINITY;
  let pending: JobProgress | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();

  const write = (p: JobProgress): Promise<void> => {
    lastEmittedAt = now();
    chain = chain.then(() => opts.emit(p)).catch(opts.onError);
    return chain;
  };

  const emitPending = (): Promise<void> => {
    timer = null;
    if (!pending) return Promise.resolve();
    const p = pending;
    pending = null;
    return write(p);
  };

  return {
    emit(percent, message, extra) {
      const p: JobProgress = {};
      if (percent !== undefined) p.percent = percent;
      if (message !== undefined) p.message = message;
      if (extra?.documentUpdatedAt !== undefined) p.documentUpdatedAt = extra.documentUpdatedAt;
      const elapsed = now() - lastEmittedAt;
      if (elapsed >= opts.minIntervalMs && !timer) return write(p);
      pending = { ...pending, ...p };
      if (!timer) {
        timer = setTimeout(emitPending, Math.max(0, opts.minIntervalMs - elapsed));
      }
      return chain;
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await emitPending();
      await chain;
    },
  };
}
