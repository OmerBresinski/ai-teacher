import type { SlideGenerationState } from "@tj/domain/documents";

/*
 * Progressive persist (TEACH-110 part h, C2; rulings 90, 138, 166, 188): while the writer streams,
 * each slide is handed over as a per-slide patch with its own state (`writing` until it is done),
 * and the deck so far is written at most once a second. The patches are kept per slide, never as
 * a whole deck, so a later per-slide write (ruling 188: a slide editable once it is done, and a
 * slide the teacher edited never overwritten) can replace `write` without changing callers.
 *
 * Writes are serial: a patch during a write is folded into the next one. `close` stops the deck
 * and waits for a write in flight, so nothing it sends can land after the caller's own persist.
 */

export interface SlidePatch<T> {
  slide: T;
  state: SlideGenerationState;
}

export interface ProgressiveDeck<T> {
  /** Patch one slide (by its index in the deck) and schedule a write. */
  patch(index: number, slide: T, state?: SlideGenerationState): void;
  /** The patches so far, by index. */
  patches(): ReadonlyMap<number, SlidePatch<T>>;
  /** No more writes; resolves once a write in flight has finished. */
  close(): Promise<void>;
}

export function createProgressiveDeck<T>(opts: {
  /** Writes the patches so far (the deck's slides in index order with their states). */
  write: (patches: ReadonlyMap<number, SlidePatch<T>>) => Promise<void>;
  /** A failed write is reported, never thrown: the editable persist still follows. */
  onError: (error: unknown) => void;
  intervalMs?: number;
  now?: () => number;
}): ProgressiveDeck<T> {
  const interval = opts.intervalMs ?? 1000;
  const now = opts.now ?? Date.now;
  const patches = new Map<number, SlidePatch<T>>();
  let closed = false;
  let dirty = false;
  let lastAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;

  const flush = () => {
    timer = undefined;
    if (closed || !dirty) return;
    dirty = false;
    lastAt = now();
    inFlight = opts
      .write(new Map(patches))
      .then(undefined, opts.onError)
      .finally(() => {
        inFlight = undefined;
        if (dirty) schedule();
      });
  };
  const schedule = () => {
    if (closed || timer || inFlight) return;
    timer = setTimeout(flush, Math.max(0, lastAt + interval - now()));
  };
  return {
    patch(index, slide, state = "writing") {
      if (closed) return;
      patches.set(index, { slide, state });
      dirty = true;
      schedule();
    },
    patches: () => patches,
    async close() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      await inFlight;
    },
  };
}
