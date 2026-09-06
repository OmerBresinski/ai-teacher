import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { SlideMode } from "./kit";

/**
 * Edit-mode hooks the renderer needs from whoever owns the document. Nothing in this
 * package's view, present, capture or thumb paths provides one, so those modes never
 * touch editor state (ADR 0022 §4). The lesson editor (phase C) provides it.
 */
export type EditorHooks = {
  /**
   * Non-undoable and slide-addressed: a measured height is derived, not a user edit, and
   * it must land on the slide being rendered, not on whichever slide is active.
   */
  writeElementHeight: (slideId: string, id: string, h: number) => void;
};

export const EditorHooksContext = createContext<EditorHooks | null>(null);

/** Smallest change worth writing, in slide points. */
const MIN_DELTA = 1;

type Options = {
  /** Slide being rendered — the write is addressed to it, never to the active slide. */
  slideId: string;
  id: string;
  /** Stored height of the element in slide points. */
  h: number;
  mode: SlideMode;
  /** `style.autoHeight !== false` */
  autoHeight: boolean;
  /** Vertical padding to add to the measured content height. */
  chrome: number;
  /** False while another renderer owns the box (the Tiptap editor measures its own). */
  enabled?: boolean;
};

/**
 * Measures the rendered text and, in edit mode only, grows the element's stored height
 * so the transform layer's box always matches the type.
 *
 * Runs nowhere but `edit` — `view`, `present`, `capture` and `thumb` never create an
 * observer. Writes go through the non-undoable `updateElementLayout`, are gated on a
 * >=1pt difference and deduped through `lastWrite`, so opening a lesson whose authored
 * heights already match cannot dirty the document, push history or oscillate.
 */
export function useAutoHeight({
  slideId,
  id,
  h,
  mode,
  autoHeight,
  chrome,
  enabled = true,
}: Options) {
  const hooks = useContext(EditorHooksContext);
  const ref = useRef<HTMLDivElement | null>(null);
  const lastWrite = useRef<number | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    if (mode !== "edit" || !enabled || !hooks) return;
    const node = ref.current;
    if (!node) return;

    lastWrite.current = null;
    let frame = 0;

    const measure = () => {
      const content = Math.round(node.scrollHeight + chrome);
      if (!autoHeight) {
        setOverflowing(content - h > MIN_DELTA);
        return;
      }
      setOverflowing(false);
      if (Math.abs(content - h) < MIN_DELTA) return;
      if (lastWrite.current === content) return;
      lastWrite.current = content;
      hooks.writeElementHeight(slideId, id, content);
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    const ro = new ResizeObserver(schedule);
    ro.observe(node);
    schedule();
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [slideId, id, h, mode, autoHeight, chrome, enabled, hooks]);

  return { ref, overflowing };
}
