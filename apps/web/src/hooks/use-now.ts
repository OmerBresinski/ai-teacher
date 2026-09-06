import { useEffect, useState } from "react";

/** A shared minute clock keeps relative timestamps stable across a library render. */
export function useNow(interval = 60_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(timer);
  }, [interval]);

  return now;
}
