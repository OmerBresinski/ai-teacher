import { useCallback, useEffect, useRef } from "react";

/**
 * Coalesce ids reported within `delay` of one another into one `onFlush([...ids])` (TEACH-134
 * FR 2): two fact commits a second apart are one cascade, not two. Timer and set live in refs —
 * nothing here is rendered. Unmounting drops whatever is pending: the panel is gone, the app has
 * nothing to enqueue for.
 */
export const COALESCE_MS = 1_000;

export function useCoalescedIds(
  onFlush: (ids: string[]) => void,
  delay: number = COALESCE_MS,
): (id: string) => void {
  const pending = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFlushRef = useRef(onFlush);
  onFlushRef.current = onFlush;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return useCallback(
    (id: string) => {
      pending.current.add(id);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        const ids = [...pending.current];
        pending.current.clear();
        if (ids.length > 0) onFlushRef.current(ids);
      }, delay);
    },
    [delay],
  );
}
