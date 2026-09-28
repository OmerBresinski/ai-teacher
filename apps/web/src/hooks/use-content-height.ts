import { useLayoutEffect, useRef, useState } from "react";

/**
 * The live height of an element's content, so a wrapper can transition `height` when the content
 * changes: CSS cannot transition to or from `height: auto`. Attach `ref` to the content and give
 * the wrapper `height` plus `overflow: hidden`. `null` until the first measurement, so the wrapper
 * starts at its natural height and only later changes animate; without ResizeObserver (the
 * unit-test DOM) it stays `null` and nothing animates.
 */
export function useContentHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      setHeight(entry?.borderBoxSize?.[0]?.blockSize ?? element.offsetHeight);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, height] as const;
}
