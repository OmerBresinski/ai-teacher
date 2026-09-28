import { useLayoutEffect, useRef, useState } from "react";

type ContentHeight = {
  height: number;
  /** The width changed too: the window reflowed the content, so follow it without easing. */
  reflowed: boolean;
};

/**
 * The live height of an element's content, so a wrapper can transition `height` when the content
 * changes: CSS cannot transition to or from `height: auto`. Attach `ref` to the content and give
 * the wrapper `height` plus `overflow: hidden`, with its transition switched off while `reflowed`
 * (a resize or rotation should track the layout, not lag behind it). `null` until the first
 * measurement, so the wrapper starts at its natural height and only later changes animate; without
 * ResizeObserver (the unit-test DOM) it stays `null` and nothing animates.
 */
export function useContentHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<ContentHeight | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    let width: number | null = null;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.borderBoxSize?.[0];
      const nextWidth = box?.inlineSize ?? element.offsetWidth;
      setSize({
        height: box?.blockSize ?? element.offsetHeight,
        reflowed: width !== null && nextWidth !== width,
      });
      width = nextWidth;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}
