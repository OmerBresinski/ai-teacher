import { useEffect, useState } from "react";

/**
 * A shared minute clock keeps relative timestamps stable across a library render.
 *
 * Ticks are skipped while the tab is hidden — a background tab has nothing to repaint, and each
 * tick re-renders every card — and the clock catches up the moment the tab is shown again.
 */
export function useNow(interval = 60_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "hidden") return;
      setNow(Date.now());
    };
    const timer = window.setInterval(tick, interval);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [interval]);

  return now;
}
