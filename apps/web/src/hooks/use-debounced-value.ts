import { useEffect, useState } from "react";

/**
 * `value`, settling `ms` after it last changed. The library's search box writes the URL on every
 * keystroke (so the address bar and Escape stay exact) but asks the server only once the teacher
 * pauses; the list keeps the previous results meanwhile (`keepPreviousData`). The timer is the one
 * external subscription, so this is an effect by design. An empty value applies at once: clearing
 * the box should not wait.
 */
export function useDebouncedValue(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (value === "") {
      setDebounced("");
      return;
    }
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return value === "" ? "" : debounced;
}
