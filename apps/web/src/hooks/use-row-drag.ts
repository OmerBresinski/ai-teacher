import type * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

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

export type GripProps = Pick<
  React.HTMLAttributes<HTMLElement>,
  "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onKeyDown"
> & { style: React.CSSProperties };

const IDLE: RowDrag = { from: null, insertion: null, pointerY: 0 };
const GRIP_STYLE: React.CSSProperties = { touchAction: "none" };

type Options = {
  rowHeight: number;
  count: number;
  onDrop: (from: number, insertion: number) => void;
};

type Press = {
  index: number;
  startY: number;
  active: boolean;
  target: HTMLElement;
  pointerId: number;
};

/**
 * Pointer-driven row reorder without a dnd library. Press a grip, move more than the threshold
 * vertically, and the hook tracks an insertion gap from the pointer's offset inside the list;
 * release commits through `onDrop`, Escape or `pointercancel` abandons. Transient pointer data
 * lives in refs so a move re-renders only when the visible state (from/insertion/ghost y)
 * changes, and `gripProps(index)` is memoised per index so memoised rows skip pointer-move renders.
 */
export function useRowDrag({ rowHeight, count, onDrop }: Options) {
  const [drag, setDrag] = useState<RowDrag>(IDLE);
  const listRef = useRef<HTMLOListElement>(null);
  const press = useRef<Press | null>(null);
  // Latest values for the stable handlers (advanced-use-latest).
  const latest = useRef({ rowHeight, count, onDrop });
  latest.current = { rowHeight, count, onDrop };

  const handlers = useMemo(() => {
    function release(): void {
      const current = press.current;
      if (current?.target.hasPointerCapture(current.pointerId)) {
        current.target.releasePointerCapture(current.pointerId);
      }
      press.current = null;
      setDrag(IDLE);
    }

    function insertionAt(clientY: number): number {
      const list = listRef.current;
      if (!list) return 0;
      const { rowHeight, count } = latest.current;
      const offset = clientY - list.getBoundingClientRect().top;
      return Math.max(0, Math.min(count, Math.round(offset / rowHeight)));
    }

    const cache = new Map<number, GripProps>();
    function gripProps(index: number): GripProps {
      const cached = cache.get(index);
      if (cached) return cached;
      const props: GripProps = {
        style: GRIP_STYLE,
        onPointerDown: (event) => {
          if (event.button !== 0) return;
          press.current = {
            index,
            startY: event.clientY,
            active: false,
            target: event.currentTarget,
            pointerId: event.pointerId,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        },
        onPointerMove: (event) => {
          const current = press.current;
          if (!current || current.index !== index) return;
          if (!current.active) {
            if (Math.abs(event.clientY - current.startY) < DRAG_THRESHOLD_PX) return;
            current.active = true;
          }
          const insertion = insertionAt(event.clientY);
          const pointerY = event.clientY;
          setDrag((previous) =>
            previous.from === index &&
            previous.insertion === insertion &&
            previous.pointerY === pointerY
              ? previous
              : { from: index, insertion, pointerY },
          );
        },
        onPointerUp: (event) => {
          const current = press.current;
          if (!current || current.index !== index) return;
          const drop = current.active ? insertionAt(event.clientY) : null;
          release();
          if (drop !== null) latest.current.onDrop(index, drop);
        },
        onPointerCancel: release,
        onKeyDown: (event) => {
          if (event.key === "Escape" && press.current) {
            event.stopPropagation();
            release();
          }
        },
      };
      cache.set(index, props);
      return props;
    }

    return { gripProps, cancel: release };
  }, []);

  // Abandon a drag if the list unmounts mid-gesture (e.g. the series is deleted elsewhere).
  useEffect(() => handlers.cancel, [handlers]);

  return { drag, listRef, gripProps: handlers.gripProps, cancel: handlers.cancel };
}
