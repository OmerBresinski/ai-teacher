import type { Id, Slide } from "@tj/domain/documents";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  centre as centreOf,
  normaliseAngle,
  type Point,
  type Rect,
  rectOf,
  rotatedBounds,
  unionRect,
} from "../../model/geometry";
import * as reducers from "../../model/reducers";
import { buildSnapTargets, type Guide, type SnapTarget } from "../../model/snapping";
import type { ElementTransform } from "../../slide/elements/ElementFrame";
import { useSlideScale } from "../../slide/SlideScaler";
import { useHistory } from "../document-context";
import {
  useSelection,
  useSessionActions,
  useSessionRead,
  useSessionUi,
} from "../use-editor-session";
import { DRAG_START_PX, type HandleId } from "./constants";
import { describeBoxes } from "./describe";
import { Guides } from "./Guides";
import {
  angleOf,
  boundsOfBoxes,
  type Gesture,
  type PreviewMap,
  patchFor,
  previewDrag,
  previewResize,
  previewRotate,
  type Sample,
  sampleOf,
  startBoxOf,
} from "./gesture-maths";
import {
  CANVAS_NOTICE_EVENT,
  type CanvasNoticeDetail,
  setPointerGestureActive,
} from "./gesture-state";
import { HoverOutline } from "./HoverOutline";
import { boxesOf, type ElementBox, hitsBox, marqueeHits } from "./hit-test";
import { AngleLabel, Marquee, MemberOutlines, VISUALLY_HIDDEN } from "./overlays";
import { SelectionFrame } from "./SelectionFrame";

/*
 * The editor's transform layer (TeachDeck `components/editor/transform/SelectionLayer.tsx`).
 * Rendered by the Canvas as a sibling of `<SlideView>` inside the same `<SlideScaler>`, so it
 * shares the slide's coordinate space and its scale. This file is the orchestration: pointer
 * lifecycle, the gesture record and the render; the geometry of each gesture is `gesture-maths.ts`,
 * the passive drawings `overlays.tsx`, the live-region copy `describe.ts`.
 *
 * The one structural change from TeachDeck (ADR 0022 §4): pointer moves never write the document.
 * Each frame computes a **preview** — the rects the selection would have — and hands it to the
 * Canvas through `onPreview`; the Canvas paints `SlideView` from it via `transformOverride`. The
 * reducer runs once, on pointer-up, inside `beginTransaction`/`endTransaction`, so a drag is one
 * cache write, one undo step and one autosave. A cancelled gesture (pointercancel, window blur,
 * tab hidden) discards the preview and writes nothing.
 */

export type { PreviewMap };

export type SelectionLayerProps = {
  slide: Slide;
  preview: PreviewMap | null;
  onPreview: (next: PreviewMap | null) => void;
  /** True while the canvas is panning (Space held): the stage takes no gestures. */
  disabled?: boolean;
  className?: string;
};

export function SelectionLayer({
  slide,
  preview,
  onPreview,
  disabled = false,
  className,
}: SelectionLayerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scale = useSlideScale();
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const history = useHistory();
  const selection = useSelection();
  const { editingTextId, showGuides } = useSessionUi();
  const actions = useSessionActions();
  const readSession = useSessionRead();

  const [coarse, setCoarse] = useState(false);
  const [hoverId, setHoverId] = useState<Id | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [angleLabel, setAngleLabel] = useState<number | null>(null);
  const [cursor, setCursor] = useState<CSSProperties["cursor"]>("default");
  const [focusRing, setFocusRing] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const mq = window.matchMedia?.("(pointer: coarse)");
    if (!mq) return;
    const apply = () => setCoarse(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const elements = slide.elements;
  const boxes = useMemo(() => boxesOf(elements), [elements]);
  const byId = useMemo(() => new Map(boxes.map((b) => [b.id, b])), [boxes]);

  /** Selected boxes, drawn from the preview while a gesture is in flight. */
  const selected = useMemo(
    () =>
      selection.flatMap((id) => {
        const b = byId.get(id);
        if (!b) return [];
        const p = preview?.get(id);
        return p
          ? [{ ...b, rect: { x: p.x, y: p.y, w: p.w, h: p.h }, rotation: p.rotation ?? 0 }]
          : [b];
      }),
    [selection, byId, preview],
  );
  const selectionBounds = useMemo(
    () =>
      selected.length ? unionRect(selected.map((b) => rotatedBounds(b.rect, b.rotation))) : null,
    [selected],
  );

  /* ---------------- accessibility ---------------- */

  // The live region gets the selection when it *changes* — never per frame of a drag.
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;
  const selectionKey = selection.join(",");
  useEffect(() => {
    const picked = selectionKey ? selectionKey.split(",") : [];
    setAnnouncement(
      describeBoxes(
        picked.flatMap((id) => {
          const b = boxesRef.current.find((x) => x.id === id);
          return b ? [b] : [];
        }),
      ),
    );
  }, [selectionKey]);

  // Feedback raised from the keyboard half of the layer (see gesture-state).
  useEffect(() => {
    const onNotice = (e: Event) =>
      setAnnouncement((e as CustomEvent<CanvasNoticeDetail>).detail.message);
    window.addEventListener(CANVAS_NOTICE_EVENT, onNotice);
    return () => window.removeEventListener(CANVAS_NOTICE_EVENT, onNotice);
  }, []);

  /* ---------------- gesture plumbing ---------------- */

  const gesture = useRef<Gesture>({ kind: "none" });
  const sample = useRef<Sample | null>(null);
  const raf = useRef(0);
  const snapTargets = useRef<SnapTarget[]>([]);
  const capture = useRef<{ el: Element; pointerId: number } | null>(null);
  /** The map last handed to `onPreview`, so pointer-up commits exactly what was on screen. */
  const previewRef = useRef<Map<Id, ElementTransform> | null>(null);
  const marqueeRef = useRef<Rect | null>(null);
  marqueeRef.current = marquee;

  const publish = useCallback(
    (next: Map<Id, ElementTransform> | null) => {
      previewRef.current = next;
      onPreview(next);
    },
    [onPreview],
  );

  // The stage cannot move mid-gesture, so measuring it on every pointer sample is a forced layout
  // for nothing. Cache it; invalidate on scroll, resize and zoom.
  const stageRect = useRef<DOMRect | null>(null);
  const measureStage = useCallback(() => {
    stageRect.current = rootRef.current?.getBoundingClientRect() ?? null;
    return stageRect.current;
  }, []);
  useEffect(() => {
    const invalidate = () => {
      stageRect.current = null;
    };
    window.addEventListener("scroll", invalidate, true);
    window.addEventListener("resize", invalidate);
    return () => {
      window.removeEventListener("scroll", invalidate, true);
      window.removeEventListener("resize", invalidate);
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: zoom changes the stage's screen rect
  useEffect(() => {
    stageRect.current = null;
  }, [scale]);

  const toSlide = useCallback(
    (clientX: number, clientY: number): Point => {
      const r = stageRect.current ?? measureStage();
      if (!r) return { x: 0, y: 0 };
      const s = scaleRef.current || 1;
      return { x: (clientX - r.left) / s, y: (clientY - r.top) / s };
    },
    [measureStage],
  );

  const startBoxesFor = useCallback(
    (ids: Id[]) =>
      ids.flatMap((id) => {
        const b = byId.get(id);
        return b ? [startBoxOf(b)] : [];
      }),
    [byId],
  );

  const rebuildTargets = useCallback(
    (excluded: Id[]) => {
      const skip = new Set(excluded);
      snapTargets.current = buildSnapTargets(
        elements.filter((e) => !skip.has(e.id)).map((e) => ({ id: e.id, rect: rectOf(e) })),
      );
    },
    [elements],
  );

  /**
   * Pointer capture keeps `pointermove`/`pointerup` coming even when the pointer leaves the
   * window. The window listeners below still do the work — captured events retarget to the
   * capturing element and bubble to `window` — but without the capture they stop arriving.
   */
  const capturePointer = (e: ReactPointerEvent) => {
    const el = e.currentTarget;
    try {
      el.setPointerCapture?.(e.pointerId);
      capture.current = { el, pointerId: e.pointerId };
    } catch {
      capture.current = null;
    }
  };

  const releasePointer = useCallback(() => {
    const held = capture.current;
    capture.current = null;
    if (!held) return;
    try {
      if (held.el.hasPointerCapture?.(held.pointerId))
        held.el.releasePointerCapture(held.pointerId);
    } catch {
      // The element may already be gone; nothing to release.
    }
  }, []);

  /* ---------------- per-frame preview ---------------- */

  const flush = useCallback(() => {
    raf.current = 0;
    const s = sample.current;
    const g = gesture.current;
    if (!s || g.kind === "none") return;
    const { snap, showGuides: guidesOn } = readSession();
    const settings = { snap, showGuides: guidesOn };
    const k = scaleRef.current || 1;

    if (g.kind === "drag") {
      if (!g.started) {
        if (Math.hypot(s.x - g.origin.x, s.y - g.origin.y) < DRAG_START_PX) return;
        // The transaction opens on the first movement, not on pointerdown, so a click that never
        // moves opens none. Alt-drag: the copies are made inside it, so duplicate-and-move is a
        // single undo step.
        history.beginTransaction();
        if (g.duplicate) {
          const made = history.dispatch(reducers.duplicateElements, slide.id, g.ids, 0);
          const copies = made?.ids ?? [];
          const els = copies.flatMap((id) => {
            const el = made?.lesson.slides
              .find((sl) => sl.id === slide.id)
              ?.elements.find((e) => e.id === id);
            return el ? [el] : [];
          });
          if (els.length === copies.length && els.length > 0) {
            g.ids = copies;
            g.boxes = boxesOf(els).map(startBoxOf);
            g.bounds = boundsOfBoxes(g.boxes);
            actions.select(copies);
          }
        }
        g.started = true;
      }
      const out = previewDrag(g, s, k, snapTargets.current, settings);
      g.applied = out.delta;
      publish(out.preview);
      setGuides(out.guides);
    } else if (g.kind === "resize") {
      const out = previewResize(g, s, toSlide(s.x, s.y), k, snapTargets.current, settings);
      if (!out) return;
      g.started = true;
      publish(out.preview);
      setGuides(out.guides);
    } else if (g.kind === "rotate") {
      const out = previewRotate(g, s, toSlide(s.x, s.y));
      g.started = true;
      publish(out.preview);
      setAngleLabel(out.label);
    } else if (g.kind === "marquee") {
      const p = toSlide(s.x, s.y);
      setMarquee({
        x: Math.min(p.x, g.origin.x),
        y: Math.min(p.y, g.origin.y),
        w: Math.abs(p.x - g.origin.x),
        h: Math.abs(p.y - g.origin.y),
      });
    }
  }, [actions, history, publish, readSession, slide.id, toSlide]);

  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(flush);
  }, [flush]);

  /* ---------------- ending a gesture ---------------- */

  /**
   * The one place the document is written by a pointer gesture: everything the preview showed is
   * dispatched inside one transaction (the drag's is already open — `reset` closes it). A marquee
   * selects what it enclosed.
   */
  const commit = useCallback(
    (g: Gesture) => {
      const shown = previewRef.current;
      if (g.kind === "drag" && g.started) {
        if (g.applied.x || g.applied.y) {
          history.dispatch(reducers.transformElements, slide.id, g.ids, {
            dx: g.applied.x,
            dy: g.applied.y,
          });
        }
      } else if ((g.kind === "resize" || g.kind === "rotate") && g.started && shown) {
        history.beginTransaction();
        for (const b of g.boxes) {
          const p = shown.get(b.id);
          if (p) history.dispatch(reducers.updateElement, slide.id, b.id, patchFor(g.kind, b, p));
        }
        history.endTransaction();
      } else if (g.kind === "marquee") {
        const m = marqueeRef.current;
        if (m && (m.w > 1 || m.h > 1)) {
          const hits = marqueeHits(boxesRef.current, m);
          actions.select(g.additive ? Array.from(new Set([...g.base, ...hits])) : hits);
        }
      }
    },
    [actions, history, slide.id],
  );

  /**
   * Forget the gesture and every transient drawing. A drag opened its transaction on first
   * movement; this closes it, so the history records whatever `commit` dispatched — or nothing at
   * all on a cancel (an Alt-duplicate's copies are the one exception, and stay where they are).
   */
  const reset = useCallback(() => {
    const g = gesture.current;
    if (g.kind === "drag" && g.started) history.endTransaction();
    gesture.current = { kind: "none" };
    sample.current = null;
    setPointerGestureActive(false);
    releasePointer();
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
    publish(null);
    setMarquee(null);
    setGuides([]);
    setAngleLabel(null);
  }, [history, publish, releasePointer]);

  /** Pointer released: commit what the preview showed, then reset. */
  const endGesture = useCallback(() => {
    commit(gesture.current);
    reset();
  }, [commit, reset]);

  /** Pointer cancelled, window blurred or tab hidden: the preview is discarded, nothing lands. */
  const cancelGesture = useCallback(() => {
    if (gesture.current.kind === "none") return;
    reset();
  }, [reset]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (gesture.current.kind === "none") return;
      sample.current = sampleOf(e);
      schedule();
    };
    const onUp = (e: PointerEvent) => {
      if (gesture.current.kind === "none") return;
      // Take the pointer's final position: a move that scheduled a rAF and was followed by
      // pointerup in the same frame would otherwise commit the second-to-last sample.
      sample.current = sampleOf(e);
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
      flush();
      endGesture();
    };
    // Alt-Tab, an OS-level drag or a tab switch never delivers pointerup, and pointercancel does
    // not fire for window blur. Without these the gesture is stranded and the transaction stays
    // open, so later edits go unrecorded too.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") cancelGesture();
    };
    const onKey = (e: KeyboardEvent) => {
      if (gesture.current.kind === "none" || !sample.current) return;
      sample.current = {
        ...sample.current,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey || e.ctrlKey,
      };
      schedule();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", cancelGesture);
    window.addEventListener("blur", cancelGesture);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", cancelGesture);
      window.removeEventListener("blur", cancelGesture);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [cancelGesture, endGesture, flush, schedule]);

  // Unmounting mid-gesture must not leave the history's transaction open either.
  const cancelRef = useRef(cancelGesture);
  cancelRef.current = cancelGesture;
  useEffect(() => () => cancelRef.current(), []);

  /* ---------------- hit testing ---------------- */

  const pick = useCallback(
    (p: Point): ElementBox | null => {
      const k = scaleRef.current || 1;
      for (let i = boxes.length - 1; i >= 0; i--) {
        const b = boxes[i];
        if (!b) continue;
        const slop = b.el.type === "line" ? 6 / k : 0;
        if (hitsBox(b, p, slop)) return b;
      }
      return null;
    },
    [boxes],
  );

  /* ---------------- pointer entry points ---------------- */

  /**
   * `:focus-visible` matches a *programmatic* `focus()` on a non-input element, so relying on it
   * would ring the whole slide on every click. Remember that this focus came from the pointer and
   * show the ring only for the keyboard.
   */
  const pointerFocus = useRef(false);
  const focusStage = () => {
    if (document.activeElement !== rootRef.current) pointerFocus.current = true;
    rootRef.current?.focus({ preventScroll: true });
  };

  const beginGesture = (g: Gesture, e: ReactPointerEvent) => {
    gesture.current = g;
    sample.current = sampleOf(e);
    setPointerGestureActive(g.kind !== "none");
    capturePointer(e);
  };

  const onStageDown = (e: ReactPointerEvent) => {
    // While the canvas pans (Space held) the press belongs to the scroller, not to the elements.
    if (e.button !== 0 || disabled) return;
    const session = readSession();
    measureStage();
    focusStage();
    const p = toSlide(e.clientX, e.clientY);
    const hit = pick(p);

    // A click anywhere outside the text being edited leaves the editor first.
    if (session.editingTextId) actions.setEditingText(null);
    if (session.editingExplanation) actions.setEditingExplanation(null);

    if (!hit) {
      if (!e.shiftKey) actions.clearSelection();
      beginGesture(
        {
          kind: "marquee",
          origin: p,
          additive: e.shiftKey,
          base: e.shiftKey ? session.selection : [],
        },
        e,
      );
      setMarquee({ x: p.x, y: p.y, w: 0, h: 0 });
      return;
    }

    if (e.shiftKey) {
      actions.toggleSelect(hit.id);
      return;
    }

    const ids = session.selection.includes(hit.id) ? session.selection : [hit.id];
    if (!session.selection.includes(hit.id)) actions.select([hit.id]);

    const movable = ids.filter((id) => !byId.get(id)?.locked);
    if (movable.length === 0) return;

    const startBoxes = startBoxesFor(movable);
    rebuildTargets(movable);
    beginGesture(
      {
        kind: "drag",
        ids: movable,
        boxes: startBoxes,
        bounds: boundsOfBoxes(startBoxes),
        origin: sampleOf(e),
        duplicate: e.altKey,
        started: false,
        applied: { x: 0, y: 0 },
      },
      e,
    );
  };

  const onStageHover = (e: ReactPointerEvent) => {
    if (gesture.current.kind !== "none") return;
    const hit = pick(toSlide(e.clientX, e.clientY));
    setHoverId(hit ? hit.id : null);
    setCursor(hit ? (hit.locked ? "default" : "move") : "default");
  };

  const unlockedSelection = () => readSession().selection.filter((id) => !byId.get(id)?.locked);

  const onHandleDown = (handle: HandleId, e: ReactPointerEvent) => {
    // While panning the press must reach the canvas's pan handler, so do not stop it here.
    if (disabled) return;
    e.stopPropagation();
    if (e.button !== 0) return;
    const ids = unlockedSelection();
    if (ids.length === 0) return;
    measureStage();
    focusStage();
    const startBoxes = startBoxesFor(ids);
    const [only] = startBoxes;
    rebuildTargets(ids);
    beginGesture(
      {
        kind: "resize",
        handle,
        ids,
        boxes: startBoxes,
        bounds: startBoxes.length === 1 && only ? only.rect : boundsOfBoxes(startBoxes),
        multi: startBoxes.length > 1,
        started: false,
      },
      e,
    );
  };

  const onRotateDown = (_corner: HandleId, e: ReactPointerEvent) => {
    if (disabled) return;
    e.stopPropagation();
    if (e.button !== 0) return;
    const ids = unlockedSelection();
    if (ids.length === 0) return;
    measureStage();
    focusStage();
    const startBoxes = startBoxesFor(ids);
    const [only] = startBoxes;
    const pivot = centreOf(startBoxes.length === 1 && only ? only.rect : boundsOfBoxes(startBoxes));
    const p = toSlide(e.clientX, e.clientY);
    beginGesture(
      {
        kind: "rotate",
        ids,
        boxes: startBoxes,
        pivot,
        startAngle: angleOf(p, pivot),
        started: false,
      },
      e,
    );
    setAngleLabel(Math.round(normaliseAngle(only?.rotation ?? 0)));
  };

  /* ---------------- render ---------------- */

  const stageProps = {
    onPointerDown: onStageDown,
    onPointerMove: onStageHover,
    onPointerLeave: () => setHoverId(null),
  };
  const stageStyle: CSSProperties = {
    position: "absolute",
    pointerEvents: "auto",
    touchAction: "none",
    cursor: disabled ? "grab" : cursor,
  };

  // While a text editor is mounted (TEACH-104), the stage catcher opens a hole over that element
  // so every pointer event inside it reaches the editor.
  const editingBox = editingTextId ? byId.get(editingTextId) : undefined;
  const hole = editingBox ? rotatedBounds(editingBox.rect, editingBox.rotation) : null;

  const hover = hoverId && !selection.includes(hoverId) ? byId.get(hoverId) : undefined;
  const [first] = selected;
  const gestureOn = preview !== null;

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: focus tracking only; the pointer catcher is the child below
    <div
      ref={rootRef}
      className={className}
      data-selection-layer
      // The canvas is a direct-manipulation surface, so it takes focus as one widget and handles
      // its own keys. Without a focusable stage the only way in is the always-on window bindings,
      // which a keyboard user can neither reach deliberately nor escape.
      role="application"
      aria-label="Slide"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the stage is one focusable widget (role application)
      tabIndex={0}
      onFocus={() => {
        setFocusRing(!pointerFocus.current);
        pointerFocus.current = false;
      }}
      onBlur={() => setFocusRing(false)}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "visible",
        // `SlideView` stacks its elements from z-index 1 and its overlays up to 900; a positive
        // z-index beats `auto` regardless of DOM order, so without this the catcher sits *under*
        // every element and a click never reaches the layer.
        zIndex: 1000,
        borderRadius: "inherit",
        outline: "none",
        // Keyboard focus only: a neutral inset hairline, the same answer the canvas scroller gives.
        boxShadow: focusRing ? `inset 0 0 0 ${2 / scale}px var(--border-strong)` : undefined,
      }}
    >
      <div role="status" aria-live="polite" style={VISUALLY_HIDDEN}>
        {announcement}
      </div>

      {hole ? (
        <>
          <div
            {...stageProps}
            style={{ ...stageStyle, left: 0, top: 0, right: 0, height: Math.max(0, hole.y) }}
          />
          <div
            {...stageProps}
            style={{ ...stageStyle, left: 0, top: hole.y + hole.h, right: 0, bottom: 0 }}
          />
          <div
            {...stageProps}
            style={{
              ...stageStyle,
              left: 0,
              top: hole.y,
              width: Math.max(0, hole.x),
              height: hole.h,
            }}
          />
          <div
            {...stageProps}
            style={{ ...stageStyle, left: hole.x + hole.w, top: hole.y, right: 0, height: hole.h }}
          />
        </>
      ) : (
        <div {...stageProps} data-stage-catcher style={{ ...stageStyle, inset: 0 }} />
      )}

      {hover ? <HoverOutline rect={hover.rect} rotation={hover.rotation} scale={scale} /> : null}

      {selected.length === 1 && first ? (
        <SelectionFrame
          rect={first.rect}
          rotation={first.rotation}
          scale={scale}
          locked={first.locked}
          handles={editingTextId !== first.id && !gestureOn}
          coarsePointer={coarse}
          onHandleDown={onHandleDown}
          onRotateDown={onRotateDown}
        />
      ) : null}

      {selected.length > 1 && selectionBounds ? (
        <>
          <MemberOutlines boxes={selected} scale={scale} />
          <SelectionFrame
            rect={selectionBounds}
            scale={scale}
            handles={!gestureOn}
            coarsePointer={coarse}
            onHandleDown={onHandleDown}
            onRotateDown={onRotateDown}
          />
        </>
      ) : null}

      {showGuides ? <Guides guides={guides} scale={scale} /> : null}
      {marquee ? <Marquee rect={marquee} scale={scale} /> : null}
      {angleLabel !== null && selectionBounds ? (
        <AngleLabel bounds={selectionBounds} angle={angleLabel} scale={scale} />
      ) : null}
    </div>
  );
}
