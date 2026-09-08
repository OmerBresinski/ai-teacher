import { type ImageElement, SLIDE_H, SLIDE_W } from "@tj/domain/documents";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { type Point, type Rect, rectOf } from "../../model/geometry";
import * as reducers from "../../model/reducers";
import { useHistory } from "../document-context";
import {
  CENTRE,
  type Crop,
  type CropDraft,
  clampBoxToPicture,
  cropFromRects,
  draftAspect,
  draftCrop,
  draftFlip,
  draftRotate,
  draftZoom,
  focalAt,
  NUDGE_FRACTION,
  NUDGE_FRACTION_BIG,
  normaliseTransform,
  nudgeCrop,
  pan,
  pictureRect,
  pictureStyle,
  RESET_DRAFT,
  seedCrop,
  ZOOM_STEP,
  zoomOf,
} from "../image-adjust";
import { isInTextField } from "../keys";
import {
  type CropSession,
  useSessionActions,
  useSessionRead,
  useSessionUi,
} from "../use-editor-session";
import {
  CROP_CURSOR,
  DRAG_START_PX,
  FRAME_STROKE,
  HANDLE_DIR,
  type HandleId,
  MIN_SIZE,
  TOKENS,
} from "./constants";
import { announce, setPointerGestureActive } from "./gesture-state";
import { SelectionFrame } from "./SelectionFrame";

/*
 * Crop mode on the slide (TEACH-153). Mounted by `SelectionLayer` in place of the selection frame
 * while the session's `crop` names the selected image. The whole picture is drawn at its natural
 * extent over the slide, dimmed outside the element box; the element box stays where it is. The
 * eight handles trim the box against the picture, a drag inside pans the picture (under a crop
 * cursor; the handles keep their resize cursors and the slide its default), the wheel (and a
 * trackpad pinch) zooms about the pointer, a click sets the focal point. The keyboard has the
 * same reach: arrows nudge, + and - zoom, R turns, H and V flip, 0 resets, Enter or Escape finish.
 *
 * Nothing here writes the document until the mode ends: the draft lives in the session and is
 * committed once, as this layer unmounts, so a whole session is one undo step whichever way it
 * ended (Done, Enter, Escape, a click elsewhere, a slide change).
 */

const VEIL = "rgb(27 26 23 / 0.55)";
const GRID = "rgb(255 255 255 / 0.75)";
const FOCAL_RING = 18;

type Gesture =
  | { kind: "pan"; origin: Point; moved: boolean; startCrop: Crop; box: Rect; aspect: number }
  | {
      kind: "trim";
      origin: Point;
      moved: boolean;
      handle: HandleId;
      startBox: Rect;
      picture: Rect;
    };

export type CropLayerProps = {
  slideId: string;
  element: ImageElement;
  scale: number;
  coarsePointer: boolean;
  /** Client to slide coordinates, shared with the selection layer so both agree on the stage. */
  toSlide: (clientX: number, clientY: number) => Point;
  /** The canvas has keyboard focus: draw the two-tone band on the crop frame. */
  focusRing: boolean;
  /** Take the stage's focus from the pointer, so no keyboard ring appears for a click. */
  onPointerFocus: () => void;
};

export function CropLayer({
  slideId,
  element,
  scale,
  coarsePointer,
  toSlide,
  focusRing,
  onPointerFocus,
}: CropLayerProps) {
  const history = useHistory();
  const actions = useSessionActions();
  const read = useSessionRead();
  const { crop: session } = useSessionUi();
  const draft: CropDraft = session?.draft ?? {};

  const box = draft.box ?? rectOf(element);
  const boxSize = { w: box.w, h: box.h };
  const aspect = draftAspect(draft, boxSize);
  const cropNow = draftCrop(draft, boxSize);
  const picture = pictureRect(box, cropNow);
  const focal = draft.focal ?? CENTRE;

  /* ---------------- measure the bitmap, seed the window ---------------- */

  useEffect(() => {
    if (draft.natural) return;
    const img = new Image();
    img.onload = () => {
      const natural = { w: img.naturalWidth || 1, h: img.naturalHeight || 1 };
      const d = read().crop?.draft;
      if (!d || d.natural) return;
      const b = d.box ?? rectOf(element);
      // The window the slide shows: a crop stored under another box shape is re-derived, exactly
      // as `ImageView` renders it, so the mode opens on the same picture.
      const crop = seedCrop({ ...element, ...d, w: b.w, h: b.h }, natural);
      actions.updateCrop({ natural, crop }, true);
    };
    img.src = element.src;
  }, [actions, draft.natural, element, read]);

  useEffect(() => {
    announce(
      "Crop mode. Drag the picture to move it, the handles trim the frame, scroll to zoom, click to set the focal point. Arrows nudge, plus and minus zoom, R turns, H and V flip, 0 resets, Enter finishes.",
    );
  }, []);

  /* ---------------- commit on unmount ---------------- */

  const last = useRef<CropSession | null>(session);
  if (session) last.current = session;
  const commitRef = useRef<() => void>(() => {});
  commitRef.current = () => {
    const s = last.current;
    last.current = null;
    if (!s?.dirty) return;
    const d = s.draft;
    history.dispatch(reducers.updateElement<ImageElement>, slideId, s.id, (el) => {
      if (d.box) Object.assign(el, { x: d.box.x, y: d.box.y, w: d.box.w, h: d.box.h });
      // A crop implies Fill: a Fit picture leaves the mode as cover, in the same undo step.
      if (d.fit) el.fit = d.fit;
      if (d.reset) {
        delete el.crop;
        delete el.focal;
        delete el.imageTransform;
        return;
      }
      if (d.crop) el.crop = d.crop;
      else delete el.crop;
      if (d.focal) el.focal = d.focal;
      else delete el.focal;
      const t = normaliseTransform(d.imageTransform);
      if (t) el.imageTransform = t;
      else delete el.imageTransform;
    });
    announce(d.reset ? "Picture reset." : "Crop applied.");
  };
  useEffect(() => () => commitRef.current(), []);

  /* ---------------- pointer gestures ---------------- */

  const gesture = useRef<Gesture | null>(null);
  const [live, setLive] = useState<{ box?: Rect; crop?: Crop } | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;

  const shownBox = live?.box ?? box;
  const shownCrop = live?.crop ?? cropNow;
  const shownPicture = live?.box ? picture : pictureRect(shownBox, shownCrop);

  const unrotate = useCallback(
    (dx: number, dy: number) => {
      const r = ((element.rotation ?? 0) * Math.PI) / 180;
      if (!r) return { dx, dy };
      return { dx: dx * Math.cos(r) + dy * Math.sin(r), dy: -dx * Math.sin(r) + dy * Math.cos(r) };
    },
    [element.rotation],
  );

  const begin = (g: Gesture, e: ReactPointerEvent) => {
    onPointerFocus();
    gesture.current = g;
    setPointerGestureActive(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Nothing to capture in a test DOM.
    }
  };

  const onPictureDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = toSlide(e.clientX, e.clientY);
    begin({ kind: "pan", origin: p, moved: false, startCrop: cropNow, box, aspect }, e);
  };

  const onHandleDown = (handle: HandleId, e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = toSlide(e.clientX, e.clientY);
    begin({ kind: "trim", origin: p, moved: false, handle, startBox: box, picture }, e);
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      const p = toSlide(e.clientX, e.clientY);
      const raw = { dx: p.x - g.origin.x, dy: p.y - g.origin.y };
      if (!g.moved && Math.hypot(raw.dx, raw.dy) * scale < DRAG_START_PX) return;
      g.moved = true;
      const { dx, dy } = unrotate(raw.dx, raw.dy);
      if (g.kind === "pan") {
        setLive({ crop: pan(g.startCrop, dx, dy, g.box) });
      } else {
        const d = HANDLE_DIR[g.handle];
        const s = g.startBox;
        let { x, y, w, h } = s;
        if (d.x < 0) {
          x = Math.min(s.x + s.w - MIN_SIZE, s.x + dx);
          w = s.x + s.w - x;
        } else if (d.x > 0) w = Math.max(MIN_SIZE, s.w + dx);
        if (d.y < 0) {
          y = Math.min(s.y + s.h - MIN_SIZE, s.y + dy);
          h = s.y + s.h - y;
        } else if (d.y > 0) h = Math.max(MIN_SIZE, s.h + dy);
        const next = clampBoxToPicture({ x, y, w, h }, g.picture, MIN_SIZE);
        setLive({ box: next, crop: cropFromRects(g.picture, next) });
      }
    };
    const end = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      gesture.current = null;
      setPointerGestureActive(false);
      const shown = liveRef.current;
      setLive(null);
      if (!g.moved) {
        if (g.kind === "pan") {
          // A click on the picture: the focal point. (Alt-click is the same, for muscle memory.)
          const f = focalAt(pictureRect(g.box, g.startCrop), toSlide(e.clientX, e.clientY));
          actions.updateCrop({ focal: f });
          announce(
            `Focal point set at ${Math.round(f.x * 100)} across, ${Math.round(f.y * 100)} down.`,
          );
        }
        return;
      }
      if (g.kind === "pan" && shown?.crop) {
        actions.updateCrop({ crop: shown.crop });
        announce("Picture moved.");
      } else if (g.kind === "trim" && shown?.box && shown.crop) {
        actions.updateCrop({ box: shown.box, crop: shown.crop });
        announce(
          `Frame trimmed to ${Math.round(shown.box.w)} by ${Math.round(shown.box.h)} points.`,
        );
      }
    };
    const cancel = () => {
      if (!gesture.current) return;
      gesture.current = null;
      setPointerGestureActive(false);
      setLive(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
    };
  }, [actions, scale, toSlide, unrotate]);

  /* ---------------- wheel and pinch: zoom about the pointer ---------------- */

  const catcher = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = catcher.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const s = read().crop;
      if (!s) return;
      const d = s.draft;
      const b = d.box ?? rectOf(element);
      const p = toSlide(e.clientX, e.clientY);
      const at = { x: (p.x - b.x) / b.w, y: (p.y - b.y) / b.h };
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
      const z = zoomOf(draftCrop(d, b), b, draftAspect(d, b)) * factor;
      actions.updateCrop(draftZoom(d, b, z, at));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [actions, element, read, toSlide]);

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (isInTextField(e.target)) return;
      if (e.target instanceof Element) {
        // A slider popover owns its arrows, and its Escape closes it (Radix), not the mode.
        if (e.target.closest('[data-radix-popper-content-wrapper], [role="dialog"]')) return;
        // The bar's own buttons keep Enter and Escape as finish; the rest of the keys are theirs.
        if (e.target.closest("[data-crop-toolbar]") && e.key !== "Escape" && e.key !== "Enter")
          return;
      }
      if (e.metaKey || e.ctrlKey) return;
      const s = read().crop;
      if (!s) return;
      const d = s.draft;
      const b = d.box ?? rectOf(element);
      const step = e.shiftKey ? NUDGE_FRACTION_BIG : NUDGE_FRACTION;
      const c = draftCrop(d, b);
      const zoom = zoomOf(c, b, draftAspect(d, b));
      const nudge = (dx: number, dy: number, said: string) => {
        actions.updateCrop({ crop: nudgeCrop(c, dx, dy) });
        announce(said);
      };
      switch (e.key) {
        case "Escape":
        case "Enter":
          actions.exitCrop();
          break;
        case "ArrowLeft":
          nudge(-step, 0, "Window left");
          break;
        case "ArrowRight":
          nudge(step, 0, "Window right");
          break;
        case "ArrowUp":
          nudge(0, -step, "Window up");
          break;
        case "ArrowDown":
          nudge(0, step, "Window down");
          break;
        case "+":
        case "=":
          actions.updateCrop(draftZoom(d, b, zoom + ZOOM_STEP));
          announce(`Zoom ${(Math.min(4, zoom + ZOOM_STEP)).toFixed(2)}`);
          break;
        case "-":
        case "_":
          actions.updateCrop(draftZoom(d, b, zoom - ZOOM_STEP));
          announce(`Zoom ${(Math.max(1, zoom - ZOOM_STEP)).toFixed(2)}`);
          break;
        case "r":
        case "R":
          actions.updateCrop(draftRotate(d, b));
          announce(`Turned to ${((d.imageTransform?.rotate ?? 0) + 90) % 360} degrees.`);
          break;
        case "h":
        case "H":
          actions.updateCrop(draftFlip(d, b, "h"));
          announce(d.imageTransform?.flipH ? "Horizontal flip undone." : "Flipped horizontally.");
          break;
        case "v":
        case "V":
          actions.updateCrop(draftFlip(d, b, "v"));
          announce(d.imageTransform?.flipV ? "Vertical flip undone." : "Flipped vertically.");
          break;
        case "0":
          actions.updateCrop(RESET_DRAFT);
          announce("Reset to the untouched picture.");
          break;
        default:
          return;
      }
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [actions, element, read]);

  /* ---------------- render ---------------- */

  const img = pictureStyle(
    { w: shownPicture.w, h: shownPicture.h },
    undefined,
    draft.imageTransform,
    focal,
  ).img;
  const dragging = live !== null;
  const rotation = element.rotation ?? 0;
  const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const px = (n: number) => n / scale;
  const veil = (r: Rect) =>
    r.w > 0 && r.h > 0 ? (
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: r.x,
          top: r.y,
          width: r.w,
          height: r.h,
          background: VEIL,
          pointerEvents: "none",
        }}
      />
    ) : null;
  const P = shownPicture;
  const B = shownBox;
  const line = (style: CSSProperties) => (
    <div
      aria-hidden
      style={{
        position: "absolute",
        background: GRID,
        boxShadow: `0 0 0 ${px(0.5)}px rgb(27 26 23 / 0.35)`,
        pointerEvents: "none",
        ...style,
      }}
    />
  );

  return (
    // The picture may run past the slide; it is clipped to the card like the slide's own content.
    <div
      data-crop-layer
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: SLIDE_W,
        height: SLIDE_H,
        overflow: "hidden",
        borderRadius: "inherit",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          transform: rotation ? `rotate(${rotation}deg)` : undefined,
          transformOrigin: `${centre.x}px ${centre.y}px`,
          pointerEvents: "none",
        }}
      >
        {/* The whole picture, natural extent, live under the pointer. */}
        <div
          ref={catcher}
          data-crop-picture
          onPointerDown={onPictureDown}
          style={{
            position: "absolute",
            left: P.x,
            top: P.y,
            width: P.w,
            height: P.h,
            overflow: "hidden",
            pointerEvents: "auto",
            touchAction: "none",
            cursor: CROP_CURSOR,
            background: "rgb(27 26 23 / 0.08)",
          }}
        >
          <img
            src={element.src}
            alt=""
            draggable={false}
            style={{
              display: "block",
              position: "absolute",
              left: "50%",
              top: "50%",
              width: img.width,
              height: img.height,
              transform: img.transform,
              objectFit: "fill",
              objectPosition: img.objectPosition,
              userSelect: "none",
            }}
          />
        </div>

        {/* Dim what the frame will not show. */}
        {veil({ x: P.x, y: P.y, w: P.w, h: B.y - P.y })}
        {veil({ x: P.x, y: B.y + B.h, w: P.w, h: P.y + P.h - B.y - B.h })}
        {veil({ x: P.x, y: B.y, w: B.x - P.x, h: B.h })}
        {veil({ x: B.x + B.w, y: B.y, w: P.x + P.w - B.x - B.w, h: B.h })}

        {/* Rule of thirds while a gesture is in flight. */}
        {dragging ? (
          <>
            {line({ left: B.x + B.w / 3, top: B.y, width: px(1), height: B.h })}
            {line({ left: B.x + (2 * B.w) / 3, top: B.y, width: px(1), height: B.h })}
            {line({ left: B.x, top: B.y + B.h / 3, width: B.w, height: px(1) })}
            {line({ left: B.x, top: B.y + (2 * B.h) / 3, width: B.w, height: px(1) })}
          </>
        ) : null}

        {/* The focal point: a ring with a dot. */}
        <div
          aria-hidden
          data-focal-ring
          style={{
            position: "absolute",
            left: P.x + focal.x * P.w - px(FOCAL_RING / 2),
            top: P.y + focal.y * P.h - px(FOCAL_RING / 2),
            width: px(FOCAL_RING),
            height: px(FOCAL_RING),
            borderRadius: "50%",
            border: `${px(2)}px solid #fff`,
            boxShadow: `0 0 0 ${px(1)}px rgb(27 26 23 / 0.45), inset 0 0 0 ${px(1)}px rgb(27 26 23 / 0.45)`,
            pointerEvents: "none",
            display: "grid",
            placeItems: "center",
          }}
        >
          <div
            style={{
              width: px(4),
              height: px(4),
              borderRadius: "50%",
              background: TOKENS.frame,
            }}
          />
        </div>

        <SelectionFrame
          rect={B}
          scale={scale}
          handles={!dragging}
          rotate={false}
          coarsePointer={coarsePointer}
          frameShadow={
            focusRing
              ? `0 0 0 ${px(FRAME_STROKE + 2)}px var(--focus-gap), 0 0 0 ${px(FRAME_STROKE + 4)}px var(--ring)`
              : undefined
          }
          onHandleDown={onHandleDown}
        />
      </div>
    </div>
  );
}
