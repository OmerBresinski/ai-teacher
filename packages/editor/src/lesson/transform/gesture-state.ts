/**
 * A pinch of module-level state shared by the two halves of the transform layer, which are
 * deliberately not in the same React tree: `SelectionLayer` (pointer) and `useCanvasKeys`
 * (keyboard). Both drive the same document transaction, so the keyboard has to know when the
 * pointer owns a gesture — an arrow key pressed mid-drag would otherwise open its own transaction
 * inside the drag's. (TeachDeck `components/editor/transform/gesture-state.ts`.)
 */

let pointerGestureActive = false;

export function setPointerGestureActive(active: boolean): void {
  pointerGestureActive = active;
}

export function isPointerGestureActive(): boolean {
  return pointerGestureActive;
}

/** The canvas region, for focus-scoped keyboard handling. */
export const CANVAS_ROOT_SELECTOR = "[data-selection-layer]";

/**
 * True when focus is inside the canvas. `Tab` is only ours to swallow when it is — otherwise a
 * keyboard user could never tab out to the toolbar.
 */
export function isCanvasFocused(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  return el instanceof Element && el.closest(CANVAS_ROOT_SELECTOR) !== null;
}

/** Canvas feedback for the screen reader, announced by `SelectionLayer`. */
export const CANVAS_NOTICE_EVENT = "tj:canvas-notice";
export type CanvasNoticeDetail = { message: string };

export function announce(message: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<CanvasNoticeDetail>(CANVAS_NOTICE_EVENT, { detail: { message } }),
  );
}
