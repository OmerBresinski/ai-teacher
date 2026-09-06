import { SLIDE_W, type Slide, type Theme } from "@tj/domain/documents";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { rectOf, rotatedBounds, unionRect } from "../../model/geometry";
import {
  CHROME_EDGE as EDGE,
  CHROME_GAP as GAP,
  CHROME_MIN_TOP as MIN_TOP,
} from "../canvas/place-slide-actions";
import { useSelectedElements, useSessionUi } from "../use-editor-session";
import { TextToolbar } from "./TextToolbar";

/*
 * One floating toolbar, above the selection in screen space (TeachDeck `ContextualToolbar.tsx`;
 * SPEC §7). Fixed-positioned so nothing in the canvas can clip it, re-measured after every render,
 * so panning, zooming and resizing all keep it attached. This ticket mounts the text toolbar only;
 * the element and slide toolbars slot into the same switch with TEACH-105.
 *
 * The bar re-renders on every Tiptap transaction, so measuring inline would read two rects — two
 * forced layouts — on the typing path. Every measurement after the first therefore waits for a
 * frame, where the layout is already settled and a burst of renders collapses into one read.
 *
 * Positioning is this file, not a Radix Popover: the anchor is a selection rect in slide space,
 * not a DOM element, and the bar must stay put while the caret moves inside the box (ADR 0022 §2
 * names the floating engine as the one thing not ported; this is the 60 lines that replace it).
 */
export function ContextualToolbar({
  slide,
  theme,
  stageRef,
  scale,
}: {
  slide: Slide;
  theme: Theme;
  stageRef: RefObject<HTMLDivElement | null>;
  scale: number;
}) {
  const selected = useSelectedElements(slide);
  const { editingTextId } = useSessionUi();

  const bar = useRef<HTMLDivElement>(null);
  const [stageRect, setStageRect] = useState<{ left: number; top: number } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 40 });

  const frame = useRef<number | null>(null);
  // Which toolbar is on screen: a different one is a different width.
  const shape = `${slide.id}|${selected.map((el) => el.id).join(",")}|${editingTextId ?? ""}`;
  const lastShape = useRef<string | null>(null);

  const measure = useCallback(() => {
    const r = stageRef.current?.getBoundingClientRect();
    setStageRect((prev) =>
      r && (!prev || prev.left !== r.left || prev.top !== r.top)
        ? { left: r.left, top: r.top }
        : prev,
    );
    const b = bar.current?.getBoundingClientRect();
    if (b) {
      setSize((prev) =>
        prev.w === b.width && prev.h === b.height ? prev : { w: b.width, h: b.height },
      );
    }
  }, [stageRef]);

  const schedule = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      measure();
    });
  }, [measure]);

  useLayoutEffect(() => {
    // Swapping toolbars changes the width the centring depends on, so measure that before paint or
    // the bar lands off-centre for a frame. Typing, panning and zooming can wait for the next frame.
    if (lastShape.current !== shape || !stageRect || size.w === 0) {
      lastShape.current = shape;
      measure();
    } else {
      schedule();
    }
  });

  useEffect(
    () => () => {
      // Clearing the handle matters as much as cancelling it: StrictMode's double mount runs this
      // cleanup on a live component, and a stale handle would make every later `schedule()` return
      // early.
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );

  useEffect(() => {
    // Only a scroller that actually holds the stage can move the bar.
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

  const [only] = selected;
  // Until TEACH-105 the bar has one occupant: a single selected text element.
  if (!stageRect || selected.length !== 1 || !only || only.type !== "text") return null;

  // Anchor: the selection's bounds, or the top of the slide when nothing is selected.
  const bounds =
    selected.length > 0
      ? unionRect(selected.map((el) => rotatedBounds(rectOf(el), el.rotation ?? 0)))
      : { x: 0, y: 0, w: SLIDE_W, h: 0 };

  const centreX = stageRect.left + (bounds.x + bounds.w / 2) * scale;
  const above = stageRect.top + bounds.y * scale - GAP - size.h;
  const below = stageRect.top + (bounds.y + bounds.h) * scale + GAP;

  // Placement order: the free band ABOVE the slide first, then above the selection, then below
  // it. A bar inside the slide covers the very words being edited, so when the strip between the
  // top bar and the slide is tall enough it goes there and stays put for every selection.
  const outsideSlide = stageRect.top - GAP - size.h;
  const preferred = outsideSlide >= MIN_TOP ? outsideSlide : above >= MIN_TOP ? above : below;
  const top = Math.min(window.innerHeight - EDGE - size.h, Math.max(MIN_TOP, preferred));
  const half = size.w / 2;
  const left = Math.min(window.innerWidth - EDGE - half, Math.max(EDGE + half, centreX));

  return (
    <div
      ref={bar}
      data-contextual-toolbar
      style={{
        position: "fixed",
        left,
        top,
        transform: "translateX(-50%)",
        zIndex: 40,
        // Unmeasured for at most one un-painted render: transparent rather than `visibility:
        // hidden`, which would also take every control out of the accessibility tree.
        opacity: size.w === 0 ? 0 : undefined,
      }}
    >
      <TextToolbar
        // A fresh instance on entering/leaving text edit, so its link/menu state starts clean.
        key={only.id + String(editingTextId === only.id)}
        element={only}
        theme={theme}
        slideId={slide.id}
      />
    </div>
  );
}
