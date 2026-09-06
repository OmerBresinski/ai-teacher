import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSessionUi } from "../use-editor-session";
import type { Box } from "./place-slide-actions";

/** How far the pointer travels before a press counts as a gesture, not a click. */
const DRAG_SLOP = 3;

/**
 * The measuring half of a floating bar that hangs off the slide frame (TeachDeck
 * `components/editor/canvas/use-slide-chrome.ts`): the frame's box, the boxes it has to keep clear
 * of, its own size, the viewport it is being placed in, and whether it should be on screen at all.
 * Both bars in the band use this — the Question / Answer tabs and the slide action pill — so they
 * measure on the same beat.
 */
export function useSlideChrome({
  stageRef,
  avoidRefs = NO_REFS,
  deps = [],
}: {
  /** The 960x540 slide frame. */
  stageRef: RefObject<HTMLDivElement | null>;
  /** Wrappers whose floating child owns part of the same band. Memoise it. */
  avoidRefs?: readonly RefObject<HTMLDivElement | null>[];
  /** Anything else that moves the bar: zoom, the active slide, the slide count. */
  deps?: unknown[];
}) {
  const { editingTextId, editingExplanation } = useSessionUi();
  const [dragging, setDragging] = useState(false);

  /** Out of the way while the slide is being worked on. */
  const hidden = !!editingTextId || !!editingExplanation || dragging;

  /* ---- hide while a canvas gesture is running --------------------------- */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let from: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      from = { x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      if (!from) return;
      // A click that selects is not a gesture: only real travel hides the bar.
      if (Math.abs(e.clientX - from.x) > DRAG_SLOP || Math.abs(e.clientY - from.y) > DRAG_SLOP) {
        setDragging(true);
      }
    };
    const up = () => {
      from = null;
      setDragging(false);
    };
    stage.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      stage.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [stageRef]);

  /* ---- placement -------------------------------------------------------- */
  const barRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Box | null>(null);
  const [avoid, setAvoid] = useState<Box[]>(NONE);
  const [size, setSize] = useState({ w: 0, h: 40 });
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const raf = useRef<number | null>(null);

  const measure = useCallback(() => {
    const s = stageRef.current?.getBoundingClientRect();
    setFrame((prev) => (s && !same(prev, s) ? box(s) : prev));
    // Each bar's own element is fixed-positioned inside its wrapper, so read the floating child.
    const next = avoidRefs
      .map((ref) => ref.current?.firstElementChild?.getBoundingClientRect())
      .filter((r): r is DOMRect => !!r && r.width > 0 && r.height > 0)
      .map(box);
    setAvoid((prev) => (sameList(prev, next) ? prev : next));
    const b = barRef.current?.getBoundingClientRect();
    if (b) {
      setSize((prev) =>
        prev.w === b.width && prev.h === b.height ? prev : { w: b.width, h: b.height },
      );
    }
    setViewport((prev) =>
      prev.w === window.innerWidth && prev.h === window.innerHeight
        ? prev
        : { w: window.innerWidth, h: window.innerHeight },
    );
  }, [stageRef, avoidRefs]);

  const schedule = useCallback(() => {
    if (raf.current !== null) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      measure();
    });
  }, [measure]);

  useLayoutEffect(() => {
    // First paint after a mount or a slide swap has to land before the bar shows, or it appears at
    // the wrong corner. Everything else (panning, zooming) can wait for the next frame.
    if (!hidden && (size.w === 0 || !frame)) measure();
    else if (!hidden) schedule();
  });

  // The caller's own triggers are spread in deliberately: they are the whole point of the argument.
  useEffect(() => {
    if (!hidden) schedule();
  }, [hidden, schedule, ...deps]);

  useEffect(
    () => () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
    },
    [],
  );

  useEffect(() => {
    const onScroll = (e: Event) => {
      const t = e.target;
      const stage = stageRef.current;
      if (t instanceof Node && stage && !t.contains(stage)) return;
      schedule();
    };
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [schedule, stageRef]);

  return { barRef, frame, avoid, size, viewport, hidden };
}

const NONE: Box[] = [];
const NO_REFS: readonly RefObject<HTMLDivElement | null>[] = [];

const box = (r: DOMRect): Box => ({ left: r.left, top: r.top, width: r.width, height: r.height });

const same = (a: Box | null, b: DOMRect): boolean =>
  !!a && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;

/** Value equality, so a re-measure that found the same boxes writes no state. */
const sameList = (a: Box[], b: Box[]): boolean =>
  a.length === b.length &&
  a.every((x, i) => {
    const y = b[i];
    return (
      !!y && x.left === y.left && x.top === y.top && x.width === y.width && x.height === y.height
    );
  });
