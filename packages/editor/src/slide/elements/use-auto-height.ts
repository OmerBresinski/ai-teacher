import { useContext, useEffect, useRef, useState } from "react";
import type { SlideMode } from "./kit";

export {
  type EditingState,
  EditingStateContext,
  type EditorHooks,
  EditorHooksContext,
  useEditingState,
  useEditorHooks,
} from "../editor-hooks";

import { EditorHooksContext } from "../editor-hooks";

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
