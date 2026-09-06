import { type RefObject, useCallback, useEffect, useLayoutEffect, useState } from "react";

export type IndicatorRect = { x: number; w: number };

/**
 * The sliding indicator `Segmented` draws: measure the active item, and re-measure whenever the
 * track resizes. `offsetLeft`/`offsetWidth` rather than two `getBoundingClientRect()` calls
 * subtracted — the offsets are integers relative to the track, so the chip never sits a fraction
 * off the label it belongs to. From TeachDeck `components/ui2/indicator.ts`.
 */
export function useIndicator<T>(
  trackRef: RefObject<HTMLElement | null>,
  itemRefs: RefObject<Map<T, HTMLElement>>,
  active: T,
  /** Changes when the item list changes, so the indicator re-measures. */
  itemsKey = "",
): IndicatorRect | null {
  const [rect, setRect] = useState<IndicatorRect | null>(null);

  const measure = useCallback(() => {
    // `itemsKey` is read here on purpose: a new key means the item set changed.
    void itemsKey;
    const el = itemRefs.current?.get(active);
    if (!el || !trackRef.current) return setRect(null);
    setRect({ x: el.offsetLeft, w: el.offsetWidth });
  }, [active, itemRefs, trackRef, itemsKey]);

  useLayoutEffect(measure, [measure]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => ro.disconnect();
  }, [measure, trackRef]);

  return rect;
}
