import type { Id } from "@tj/domain/documents";
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Drag-to-reorder for the block list (TeachDeck `WorksheetEditor.tsx` "drag to reorder"). The
 * gutter handle starts it; the pointer's Y against the rows' midlines gives the drop index; one
 * `moveBlock` is dispatched on release. The moving block is shown as a DOM clone following the
 * cursor at near-zero opacity, over a faded source — nothing in the document changes until the
 * drop, so the sheet does not reflow under the pointer.
 *
 * Pointer refs, not state: the only render during a drag is the drop line moving.
 */

export type BlockDrag = {
  start: (id: Id, event: ReactPointerEvent<HTMLElement>) => void;
  /** Where the drop line sits, as `{ left, top, width }` in the column's coordinates; null idle. */
  dropLine: { left: number; top: number; width: number } | null;
};

export function useBlockDrag({
  order,
  rowEls,
  columnRef,
  onDrop,
}: {
  /** The block ids in document order; read at pointer time through a ref. */
  order: RefObject<Id[]>;
  rowEls: RefObject<Map<Id, HTMLElement>>;
  /** The scrolling column the drop line is positioned inside. */
  columnRef: RefObject<HTMLElement | null>;
  onDrop: (id: Id, toIndex: number) => void;
}): BlockDrag {
  const [dropLine, setDropLine] = useState<BlockDrag["dropLine"]>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const start = useCallback(
    (id: Id, event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault();
      const ids = order.current;
      const from = ids.indexOf(id);
      if (from === -1) return;

      const indexAt = (clientY: number) => {
        let index = ids.length;
        for (let i = 0; i < ids.length; i++) {
          const el = rowEls.current.get(ids[i] ?? "");
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          if (clientY < rect.top + rect.height / 2) {
            index = i;
            break;
          }
        }
        return index;
      };

      const lineAt = (index: number) => {
        const column = columnRef.current;
        if (!column) return null;
        const before = ids[index];
        const el = before
          ? rowEls.current.get(before)
          : rowEls.current.get(ids[ids.length - 1] ?? "");
        if (!el) return null;
        const base = column.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        return {
          left: rect.left - base.left,
          top: (before ? rect.top : rect.bottom) - base.top + column.scrollTop,
          width: rect.width,
        };
      };

      const source = rowEls.current.get(id);
      const rect = source?.getBoundingClientRect();
      const ghost = source?.cloneNode(true) as HTMLElement | undefined;
      if (ghost && rect) {
        ghost.classList.add("ws-drag-ghost");
        ghost.style.width = `${rect.width}px`;
        ghost.style.left = `${rect.left}px`;
        ghost.style.top = `${rect.top}px`;
        document.body.append(ghost);
      }
      source?.classList.add("ws-dragging");
      const startY = event.clientY;

      const onMove = (e: PointerEvent) => {
        setDropLine(lineAt(indexAt(e.clientY)));
        if (ghost) ghost.style.transform = `translateY(${e.clientY - startY}px)`;
      };
      const onUp = (e: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        ghost?.remove();
        source?.classList.remove("ws-dragging");
        setDropLine(null);
        const target = indexAt(e.clientY);
        const to = target > from ? target - 1 : target;
        if (to !== from) onDropRef.current(id, to);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [order, rowEls, columnRef],
  );

  return useMemo(() => ({ start, dropLine }), [start, dropLine]);
}
