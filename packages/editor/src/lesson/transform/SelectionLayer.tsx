import type { Id, Slide, SlideElement } from "@tj/domain/documents";
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
  rotatePoint,
  snapAngle,
  unionRect,
} from "../../model/geometry";
import * as reducers from "../../model/reducers";
import {
  buildSnapTargets,
  computeMoveSnap,
  computeSnap,
  type Guide,
  SNAP_THRESHOLD_PX,
  type SnapOptions,
  SPACING_THRESHOLD_PX,
} from "../../model/snapping";
import type { ElementTransform } from "../../slide/elements/ElementFrame";
import { useSlideScale } from "../../slide/SlideScaler";
import { useHistory } from "../document-context";
import {
  useSelection,
  useSessionActions,
  useSessionRead,
  useSessionUi,
} from "../use-editor-session";
import {
  ASPECT_LOCKED_TYPES,
  DRAG_START_PX,
  type HandleId,
  MIN_SIZE,
  ROTATE_FINE_DEG,
  ROTATE_SNAP_DEG,
  ROTATE_SNAP_THRESHOLD_DEG,
  TOKENS,
} from "./constants";
import { Guides } from "./Guides";
import {
  CANVAS_NOTICE_EVENT,
  type CanvasNoticeDetail,
  setPointerGestureActive,
} from "./gesture-state";
import { HoverOutline } from "./HoverOutline";
import { boxesOf, clampToStage, type ElementBox, hitsBox, marqueeHits } from "./hit-test";
import {
  anchorOf,
  applyEdgeSnap,
  clampGroupScale,
  movingLinesFor,
  resizeRect,
  scaleAbout,
  scaleGroupChildren,
} from "./resize";
import { SelectionFrame } from "./SelectionFrame";

/*
 * The editor's transform layer (TeachDeck `components/editor/transform/SelectionLayer.tsx`,
 * 1,090 lines, ported in pieces: marquee, move, resize, rotate, hover). Rendered by the Canvas as
 * a sibling of `<SlideView>` inside the same `<SlideScaler>`, so it shares the slide's coordinate
 * space and its scale. All chrome is divided by the scale, so a handle is 8 screen px and the snap
 * threshold is 8 screen px at 50%, 100% and 200% zoom alike.
 *
 * The one structural change from TeachDeck (ADR 0022 §4): pointer moves never write the document.
 * Each frame computes a **preview** — the rects the selection would have — and hands it to the
 * Canvas through `onPreview`; the Canvas paints `SlideView` from it via `transformOverride`. The
 * reducer runs once, on pointer-up, inside `beginTransaction`/`endTransaction`, so a drag is one
 * cache write, one undo step and one autosave.
 */

/** Element id → in-flight geometry, painted by `SlideView` instead of the cache. */
export type PreviewMap = ReadonlyMap<Id, ElementTransform>;

export type SelectionLayerProps = {
  slide: Slide;
  preview: PreviewMap | null;
  onPreview: (next: PreviewMap | null) => void;
  className?: string;
};

/** A pointer sample plus the modifier state we care about. */
type Sample = { x: number; y: number; shift: boolean; alt: boolean; meta: boolean };

type StartBox = {
  id: Id;
  rect: Rect;
  rotation: number;
  type: SlideElement["type"];
  lockHeight: boolean;
  /** Group children, in the group's local space, as they were at gesture start. */
  children?: SlideElement[];
};

type Gesture =
  | { kind: "none" }
  | {
      kind: "drag";
      ids: Id[];
      boxes: StartBox[];
      bounds: Rect;
      origin: Sample;
      duplicate: boolean;
      started: boolean;
      /** The total delta the preview currently shows — what pointer-up commits. */
      applied: Point;
    }
  | { kind: "marquee"; origin: Point; additive: boolean; base: Id[] }
  | {
      kind: "resize";
      handle: HandleId;
      ids: Id[];
      boxes: StartBox[];
      bounds: Rect;
      multi: boolean;
      started: boolean;
    }
  | {
      kind: "rotate";
      ids: Id[];
      boxes: StartBox[];
      pivot: Point;
      startAngle: number;
      started: boolean;
    };

const angleOf = (p: Point, about: Point) =>
  (Math.atan2(p.y - about.y, p.x - about.x) * 180) / Math.PI;

const sampleOf = (e: {
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}): Sample => ({
  x: e.clientX,
  y: e.clientY,
  shift: e.shiftKey,
  alt: e.altKey,
  meta: e.metaKey || e.ctrlKey,
});

const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  border: 0,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
};

/** A screen-reader name for an element: its own name, else its kind. */
function nameOf(el: SlideElement): string {
  const named = (el as { name?: string }).name;
  if (named) return named;
  if (el.type === "image") return el.alt ? `Image, ${el.alt}` : "Image";
  return el.type.replace("-", " ").replace(/^./, (c) => c.toUpperCase());
}

function describeBoxes(boxes: ElementBox[]): string {
  const [b] = boxes;
  if (!b) return "Nothing selected";
  if (boxes.length > 1) return `${boxes.length} elements selected`;
  const r = b.rect;
  const parts = [
    `${nameOf(b.el)} selected`,
    `x ${Math.round(r.x)}, y ${Math.round(r.y)}`,
    `${Math.round(r.w)} by ${Math.round(r.h)} points`,
  ];
  if (b.rotation) parts.push(`rotated ${Math.round(normaliseAngle(b.rotation))} degrees`);
  if (b.locked) parts.push("locked");
  return parts.join(", ");
}

const startBoxOf = (b: ElementBox): StartBox => ({
  id: b.id,
  rect: b.rect,
  rotation: b.rotation,
  type: b.el.type,
  lockHeight: (b.el.type === "text" || b.el.type === "gap-text") && b.el.style.autoHeight !== false,
  children: b.el.type === "group" ? b.el.children : undefined,
});

const boundsOfBoxes = (boxes: StartBox[]) =>
  unionRect(boxes.map((b) => rotatedBounds(b.rect, b.rotation)));

/** A group's children scaled with its frame, so the contents follow (or `undefined` for others). */
function childrenFor(b: StartBox, rect: Rect): SlideElement[] | undefined {
  if (!b.children) return undefined;
  const sx = b.rect.w === 0 ? 1 : rect.w / b.rect.w;
  const sy = b.rect.h === 0 ? 1 : rect.h / b.rect.h;
  return scaleGroupChildren(b.children, sx, sy);
}

export function SelectionLayer({ slide, preview, onPreview, className }: SelectionLayerProps) {
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
  const snapTargets = useRef<ReturnType<typeof buildSnapTargets>>([]);
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
    (ids: Id[]): StartBox[] =>
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

  const previewDrag = useCallback(
    (g: Extract<Gesture, { kind: "drag" }>, s: Sample) => {
      const session = readSession();
      const k = scaleRef.current || 1;
      let dx = (s.x - g.origin.x) / k;
      let dy = (s.y - g.origin.y) / k;

      // Shift constrains to one axis. The frozen axis is passed to the snapper as "no lines may
      // snap here", so neither alignment nor equal spacing can put the movement back.
      const lines: NonNullable<SnapOptions["lines"]> = {};
      if (s.shift) {
        if (Math.abs(dx) >= Math.abs(dy)) {
          dy = 0;
          lines.y = [];
        } else {
          dx = 0;
          lines.x = [];
        }
      }

      let next: Guide[] = [];
      if (session.snap && !s.meta) {
        const moved: Rect = { ...g.bounds, x: g.bounds.x + dx, y: g.bounds.y + dy };
        const r = computeMoveSnap(
          moved,
          snapTargets.current,
          SNAP_THRESHOLD_PX / k,
          SPACING_THRESHOLD_PX / k,
          { lines },
        );
        dx += r.dx;
        dy += r.dy;
        next = r.guides;
      }

      const moved: Rect = { ...g.bounds, x: g.bounds.x + dx, y: g.bounds.y + dy };
      const clamped = clampToStage(moved);
      const cdx = clamped.x - moved.x;
      const cdy = clamped.y - moved.y;
      if (cdx || cdy) {
        dx += cdx;
        dy += cdy;
        // The clamp has just pushed the element off whatever it snapped to: drop the guide.
        next = next.filter((g2) => !(cdx && g2.axis === "x") && !(cdy && g2.axis === "y"));
      }

      g.applied = { x: dx, y: dy };
      const map = new Map<Id, ElementTransform>();
      for (const b of g.boxes) {
        map.set(b.id, {
          x: b.rect.x + dx,
          y: b.rect.y + dy,
          w: b.rect.w,
          h: b.rect.h,
          rotation: b.rotation,
        });
      }
      publish(map);
      setGuides(session.showGuides ? next : []);
    },
    [publish, readSession],
  );

  const previewResize = useCallback(
    (g: Extract<Gesture, { kind: "resize" }>, s: Sample) => {
      const session = readSession();
      const k = scaleRef.current || 1;
      const p = toSlide(s.x, s.y);
      const corner = g.handle.length === 2;
      const map = new Map<Id, ElementTransform>();

      if (!g.multi) {
        const b = g.boxes[0];
        if (!b) return;
        const aspectDefault = ASPECT_LOCKED_TYPES.has(b.type);
        const aspect = corner && (s.shift ? !aspectDefault : aspectDefault);
        let rect = resizeRect({
          handle: g.handle,
          start: b.rect,
          rotation: b.rotation,
          pointer: p,
          fromCentre: s.alt,
          aspect,
          lockHeight: b.lockHeight,
        });
        let next: Guide[] = [];
        // `applyEdgeSnap` works in slide axes, so it is only meaningful on an unrotated element.
        if (session.snap && !s.meta && !s.alt && !aspect && !b.rotation) {
          const r = computeSnap(rect, snapTargets.current, SNAP_THRESHOLD_PX / k, {
            lines: movingLinesFor(g.handle),
          });
          rect = applyEdgeSnap(rect, g.handle, r.dx, r.dy, MIN_SIZE);
          next = r.guides;
        }
        g.started = true;
        map.set(b.id, { ...rect, rotation: b.rotation });
        publish(map);
        setGuides(session.showGuides ? next : []);
        return;
      }

      // Multi-select: one bounding box, everything inside scales with it about the handle's
      // anchor. Members are scaled by their *centre*, so a rotated member keeps its place, and the
      // scale is floored once for the whole group so small members cannot shear the arrangement.
      const target = resizeRect({
        handle: g.handle,
        start: g.bounds,
        pointer: p,
        fromCentre: s.alt,
        aspect: corner ? !s.shift : false,
      });
      const anchor = anchorOf(g.bounds, g.handle, s.alt);
      const sx = clampGroupScale(
        g.bounds.w === 0 ? 1 : target.w / g.bounds.w,
        g.boxes.map((b) => b.rect.w),
      );
      const sy = clampGroupScale(
        g.bounds.h === 0 ? 1 : target.h / g.bounds.h,
        g.boxes.map((b) => b.rect.h),
      );
      g.started = true;
      for (const b of g.boxes) {
        const r = scaleAbout(b.rect, anchor, sx, sy);
        const h = b.lockHeight ? b.rect.h : r.h;
        const y = b.lockHeight ? r.y + (r.h - h) / 2 : r.y;
        map.set(b.id, { x: r.x, y, w: r.w, h, rotation: b.rotation });
      }
      publish(map);
      setGuides([]);
    },
    [publish, readSession, toSlide],
  );

  const previewRotate = useCallback(
    (g: Extract<Gesture, { kind: "rotate" }>, s: Sample) => {
      const p = toSlide(s.x, s.y);
      const raw = angleOf(p, g.pivot) - g.startAngle;

      // Snap the *resulting* angle, not the change in angle: an element already at 7° must land
      // on 15°, not on 7 + 15. The delta is derived from the snapped result so a multi-selection
      // stays rigid.
      const base = g.boxes[0]?.rotation ?? 0;
      const target = s.meta
        ? base + raw
        : s.alt
          ? Math.round((base + raw) / ROTATE_FINE_DEG) * ROTATE_FINE_DEG
          : snapAngle(base + raw, ROTATE_SNAP_DEG, ROTATE_SNAP_THRESHOLD_DEG);
      const delta = target - base;
      g.started = true;

      const map = new Map<Id, ElementTransform>();
      for (const b of g.boxes) {
        const rotation = normaliseAngle(b.rotation + delta);
        if (g.boxes.length === 1) {
          map.set(b.id, { ...b.rect, rotation });
        } else {
          const c = rotatePoint(centreOf(b.rect), g.pivot, delta);
          map.set(b.id, {
            x: c.x - b.rect.w / 2,
            y: c.y - b.rect.h / 2,
            w: b.rect.w,
            h: b.rect.h,
            rotation,
          });
        }
      }
      publish(map);
      const shown = g.boxes.length === 1 ? normaliseAngle(target) : normaliseAngle(delta);
      setAngleLabel(Math.round(shown));
    },
    [publish, toSlide],
  );

  /* ---------------- commit on release ---------------- */

  /**
   * The one place the document is written by a pointer gesture. Everything the preview showed is
   * dispatched inside the transaction the gesture opened on its first movement.
   */
  const commit = useCallback(
    (g: Gesture) => {
      const slideId = slide.id;
      const shown = previewRef.current;
      if (g.kind === "drag" && g.started) {
        if (g.applied.x || g.applied.y) {
          history.dispatch(reducers.transformElements, slideId, g.ids, {
            dx: g.applied.x,
            dy: g.applied.y,
          });
        }
        history.endTransaction();
        return;
      }
      if ((g.kind === "resize" || g.kind === "rotate") && g.started && shown) {
        // A transaction so a multi-select's N patches are one undo step.
        history.beginTransaction();
        for (const b of g.boxes) {
          const p = shown.get(b.id);
          if (!p) continue;
          const rect = { x: p.x, y: p.y, w: p.w, h: p.h };
          const children = g.kind === "resize" ? childrenFor(b, rect) : undefined;
          history.dispatch(reducers.updateElement, slideId, b.id, {
            ...rect,
            ...(g.kind === "rotate" ? { rotation: p.rotation ?? 0 } : null),
            ...(children ? { children } : null),
          } as Partial<SlideElement>);
        }
        history.endTransaction();
      }
    },
    [history, slide.id],
  );

  const endGesture = useCallback(() => {
    const g = gesture.current;
    commit(g);
    if (g.kind === "marquee") {
      const m = marqueeRef.current;
      if (m && (m.w > 1 || m.h > 1)) {
        const hits = marqueeHits(boxesRef.current, m);
        actions.select(g.additive ? Array.from(new Set([...g.base, ...hits])) : hits);
      }
      setMarquee(null);
    }
    gesture.current = { kind: "none" };
    sample.current = null;
    setPointerGestureActive(false);
    releasePointer();
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
    publish(null);
    setGuides([]);
    setAngleLabel(null);
  }, [actions, commit, publish, releasePointer]);

  /* ---------------- window listeners ---------------- */

  const flush = useCallback(() => {
    raf.current = 0;
    const s = sample.current;
    const g = gesture.current;
    if (!s || g.kind === "none") return;
    if (g.kind === "drag") {
      if (!g.started) {
        const moved = Math.hypot(s.x - g.origin.x, s.y - g.origin.y);
        if (moved < DRAG_START_PX) return;
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
      previewDrag(g, s);
    } else if (g.kind === "resize") {
      previewResize(g, s);
    } else if (g.kind === "rotate") {
      previewRotate(g, s);
    } else if (g.kind === "marquee") {
      const p = toSlide(s.x, s.y);
      setMarquee({
        x: Math.min(p.x, g.origin.x),
        y: Math.min(p.y, g.origin.y),
        w: Math.abs(p.x - g.origin.x),
        h: Math.abs(p.y - g.origin.y),
      });
    }
  }, [actions, history, previewDrag, previewResize, previewRotate, slide.id, toSlide]);

  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(flush);
  }, [flush]);

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
    const onAbort = () => {
      if (gesture.current.kind === "none") return;
      endGesture();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onAbort();
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
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", onAbort);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", onAbort);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [endGesture, flush, schedule]);

  // Unmounting mid-gesture must not leave the history's transaction open either.
  const endRef = useRef(endGesture);
  endRef.current = endGesture;
  useEffect(
    () => () => {
      if (gesture.current.kind !== "none") endRef.current();
    },
    [],
  );

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
    if (e.button !== 0) return;
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
    cursor,
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

      {selected.length > 1 ? (
        <>
          {selected.map((b) => (
            <div
              key={b.id}
              aria-hidden
              style={{
                position: "absolute",
                left: b.rect.x,
                top: b.rect.y,
                width: b.rect.w,
                height: b.rect.h,
                transform: b.rotation ? `rotate(${b.rotation}deg)` : undefined,
                transformOrigin: "50% 50%",
                outline: `${1 / scale}px solid ${TOKENS.frame}`,
                opacity: 0.6,
                pointerEvents: "none",
              }}
            />
          ))}
          {selectionBounds ? (
            <SelectionFrame
              rect={selectionBounds}
              scale={scale}
              handles={!gestureOn}
              coarsePointer={coarse}
              onHandleDown={onHandleDown}
              onRotateDown={onRotateDown}
            />
          ) : null}
        </>
      ) : null}

      {showGuides ? <Guides guides={guides} scale={scale} /> : null}

      {marquee ? (
        <div
          aria-hidden
          data-marquee
          style={{
            position: "absolute",
            left: marquee.x,
            top: marquee.y,
            width: marquee.w,
            height: marquee.h,
            background: TOKENS.marqueeFill,
            outline: `${1 / scale}px solid ${TOKENS.frame}`,
            pointerEvents: "none",
          }}
        />
      ) : null}

      {angleLabel !== null && selectionBounds ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: selectionBounds.x + selectionBounds.w / 2,
            top: selectionBounds.y + selectionBounds.h + 10 / scale,
            transform: "translateX(-50%)",
            background: TOKENS.frame,
            color: "#fff",
            fontSize: 11 / scale,
            lineHeight: 1.2,
            fontFamily: "var(--font-ui), system-ui, sans-serif",
            fontVariantNumeric: "tabular-nums",
            padding: `${2 / scale}px ${6 / scale}px`,
            borderRadius: 3 / scale,
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {angleLabel}&deg;
        </div>
      ) : null}
    </div>
  );
}
