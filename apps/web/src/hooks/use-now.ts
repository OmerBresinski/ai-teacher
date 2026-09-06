import { useSyncExternalStore } from "react";

/**
 * A shared minute clock for relative timestamps. One interval serves every subscriber and they all
 * read the same `now`, so timestamps stay consistent across a render. Ticks are skipped while the
 * tab is hidden — a background tab has nothing to repaint — and the clock catches up on
 * `visibilitychange`.
 *
 * Subscribe from the leaf that renders the time (`EditedTime`), not from the page: the memoised
 * cards then take no `now` prop and a tick re-renders only the `<time>` elements.
 */
const TICK_MS = 60_000;
const listeners = new Set<() => void>();
let now = Date.now();
let timer: number | undefined;

function tick(): void {
  if (document.visibilityState === "hidden") return;
  now = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    // Start fresh: `now` may be minutes old when the first subscriber mounts after idle time.
    // React re-checks the snapshot right after subscribing, so the change is picked up at once.
    now = Date.now();
    timer = window.setInterval(tick, TICK_MS);
    document.addEventListener("visibilitychange", tick);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    }
  };
}

const read = (): number => now;

export function useNow(): number {
  return useSyncExternalStore(subscribe, read, read);
}
