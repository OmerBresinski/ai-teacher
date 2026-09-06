import type { Slide, Theme } from "@tj/domain/documents";
import { useEffect, useState } from "react";
import { lintSlide, type SlideLint } from "./lint";
import { createMeasurer } from "./measure";

/**
 * `useSlideLint(slide, theme)` — the navigator's warning dot and the canvas badge (TeachDeck
 * `use-slide-lint.ts`; takes the slide, which callers already have, rather than an id).
 *
 * Linting is lazy and debounced on purpose: a slide's elements are a fresh object on every
 * keystroke. The hook waits for the typing to stop, then runs in an idle callback, and only then
 * publishes a result. This is the one external subscription the engine needs — the DOM ruler — so
 * it is an effect rather than a memo; `measure.ts`'s cache makes a re-lint of an unchanged slide
 * free.
 */

const CLEAN: SlideLint = { overlaps: [], overflow: [], laneOverflow: [], ok: true };

/** Long enough that typing never triggers a lint, short enough to feel immediate. */
const DEBOUNCE = 400;

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const idle = (cb: () => void): number => {
  const w = window as IdleWindow;
  return w.requestIdleCallback ? w.requestIdleCallback(cb) : window.setTimeout(cb, 1);
};

const cancelIdle = (handle: number) => {
  const w = window as IdleWindow;
  if (w.cancelIdleCallback) w.cancelIdleCallback(handle);
  else window.clearTimeout(handle);
};

export function useSlideLint(slide: Slide | undefined, theme: Theme): SlideLint {
  const [result, setResult] = useState<SlideLint>(CLEAN);

  useEffect(() => {
    if (!slide) return;
    let handle = 0;
    const timer = window.setTimeout(() => {
      handle = idle(() => setResult(lintSlide(slide, createMeasurer(theme), theme)));
    }, DEBOUNCE);
    return () => {
      window.clearTimeout(timer);
      if (handle) cancelIdle(handle);
    };
  }, [slide, theme]);

  return slide ? result : CLEAN;
}
