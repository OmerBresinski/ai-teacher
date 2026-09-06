import { useEffect, useState } from "react";

/**
 * A ticking clock, shared by the timer readout and the presenter panel.
 * The interval only exists while something is actually counting, so a static
 * stage re-renders exactly never.
 */
export function useNow(active: boolean, intervalMs = 200): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}
