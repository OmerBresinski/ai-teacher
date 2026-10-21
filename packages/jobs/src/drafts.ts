import type { SlideDraftPayload } from "@tj/domain";

/** Minimum gap between two `slide-draft` writes for one job (ADR 0039). */
export const DRAFT_MIN_INTERVAL_MS = 200;

export interface DraftEmitterOptions {
  minIntervalMs: number;
  emit: (draft: SlideDraftPayload) => Promise<void>;
  onError: (err: unknown) => void;
  /** Test seam; defaults to `Date.now`. */
  now?: () => number;
}

export interface DraftEmitter {
  /** `JobContext.draft`: fire and forget, never throws, never waits on the database. */
  emit: (draft: SlideDraftPayload) => void;
  /** Drop what is pending, take no more drafts, and wait for the writes in flight. */
  stop: () => Promise<void>;
}

/**
 * Live writing (ADR 0039): leading and trailing throttle over a job's slide drafts. The first draft
 * goes at once; inside the window only the newest draft per slide is kept, and when the window
 * closes the kept drafts are written in slide order, as one burst. A `final` draft is never
 * replaced by a later words draft of the same slide (the words are done; only a newer final
 * replaces it). Writes are serial, so row order follows slide order, and a burst waits while the
 * last one is still being written (a slow database gets fewer, newer drafts, never a growing
 * queue). Drafts are best effort: a failed write is reported to `onError` and the next carries on.
 */
export function createDraftEmitter(opts: DraftEmitterOptions): DraftEmitter {
  const now = opts.now ?? Date.now;
  let lastAt = Number.NEGATIVE_INFINITY;
  const pending = new Map<number, SlideDraftPayload>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();
  let stopped = false;

  /** Writes not yet done: while any is, the next burst waits (the newest drafts keep coalescing). */
  let inflight = 0;
  const flush = () => {
    timer = null;
    if (stopped || pending.size === 0) return;
    if (inflight > 0) {
      timer = setTimeout(flush, Math.max(1, opts.minIntervalMs));
      return;
    }
    const batch = [...pending.values()].sort((a, b) => a.index - b.index);
    pending.clear();
    lastAt = now();
    for (const d of batch) {
      inflight++;
      chain = chain
        .then(() => opts.emit(d))
        .catch(opts.onError)
        .finally(() => {
          inflight--;
        });
    }
  };

  return {
    emit(draft) {
      if (stopped) return;
      const held = pending.get(draft.index);
      if (!(held?.final && !draft.final)) pending.set(draft.index, draft);
      const elapsed = now() - lastAt;
      if (elapsed >= opts.minIntervalMs && !timer) return flush();
      if (!timer) timer = setTimeout(flush, Math.max(0, opts.minIntervalMs - elapsed));
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      pending.clear();
      await chain;
    },
  };
}
