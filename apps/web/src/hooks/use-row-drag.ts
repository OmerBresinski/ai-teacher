import type * as React from "react";
import { useRef, useState } from "react";

/** Pointer travel before a press becomes a drag (TeachDeck). */
export const DRAG_THRESHOLD_PX = 4;

export type RowDrag = {
  /** Index of the row being dragged, or `null`. */
  from: number | null;
  /** Gap the row would drop into: `0` above the first row … `count` below the last. */
  insertion: number | null;
  /** Viewport y of the pointer, for a fixed-position ghost. */
  pointerY: number;
};

const IDLE: RowDrag = { from: null, insertion: null, pointerY: 0 };

type Options = {
  rowHeight: number;
  count: number;
  onDrop: (from: number, insertion: number) => void;
};

/**
 * Pointer-driven row reorder without a dnd library. Press a grip, move more than the threshold
 * vertically, and the hook tracks an insertion gap from the pointer's offset inside the list;
 * release commits through `onDrop`, Escape or `pointercancel` abandons. Transient pointer data
 * lives in refs so a move re-renders only when the visible state (from/insertion/ghost y)
 * changes.
 */
export function useRowDrag({ rowHeight, count, onDrop }: Options) {
  const [drag, setDrag] = useState<RowDrag>(IDLE);
  const listRef = useRef<HTMLOListElement>(null);
  const press = useRef<{ index: number; startY: number; active: boolean } | null>(null);

  function reset(): void {
    press.current = null;
    setDrag(IDLE);
  }

  function insertionAt(clientY: number): number {
    const list = listRef.current;
    if (!list) return 0;
    const offset = clientY - list.getBoundingClientRect().top;
    return Math.max(0, Math.min(count, Math.round(offset / rowHeight)));
  }

  function gripProps(
    index: number,
  ): Pick<
    React.HTMLAttributes<HTMLElement>,
    "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onKeyDown"
  > & { style: React.CSSProperties } {
    return {
      style: { touchAction: "none" },
      onPointerDown: (event) => {
        if (event.button !== 0) return;
        press.current = { index, startY: event.clientY, active: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event) => {
        const current = press.current;
        if (!current) return;
        if (!current.active) {
          if (Math.abs(event.clientY - current.startY) < DRAG_THRESHOLD_PX) return;
          current.active = true;
        }
        const insertion = insertionAt(event.clientY);
        setDrag((previous) =>
          previous.from === index &&
          previous.insertion === insertion &&
          previous.pointerY === event.clientY
            ? previous
            : { from: index, insertion, pointerY: event.clientY },
        );
      },
      onPointerUp: (event) => {
        const current = press.current;
        if (!current) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        if (current.active) onDrop(index, insertionAt(event.clientY));
        reset();
      },
      onPointerCancel: reset,
      onKeyDown: (event) => {
        if (event.key === "Escape" && press.current) {
          event.stopPropagation();
          reset();
        }
      },
    };
  }

  return { drag, listRef, gripProps, cancel: reset };
}
