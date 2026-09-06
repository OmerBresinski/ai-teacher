import { Lock } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Rect } from "../../model/geometry";
import {
  CORNERS,
  FRAME_STROKE,
  HANDLE_DIR,
  HANDLE_RADIUS,
  HANDLE_SIZE,
  HANDLES,
  type HandleId,
  handleHitSize,
  LOCK_GLYPH,
  ROTATE_CURSOR,
  ROTATE_ZONE,
  resizeCursor,
  TOKENS,
} from "./constants";

export type SelectionFrameProps = {
  rect: Rect;
  rotation?: number;
  scale: number;
  /** Locked elements show a padlock and no handles. */
  locked?: boolean;
  /** Hide handles (during a gesture, or while the text editor is open). */
  handles?: boolean;
  coarsePointer?: boolean;
  onHandleDown?: (handle: HandleId, e: ReactPointerEvent) => void;
  onRotateDown?: (corner: HandleId, e: ReactPointerEvent) => void;
};

/**
 * Selection frame (TeachDeck `transform/SelectionFrame.tsx`): 1.5px accent, zoom-invariant.
 * Handles are drawn 8px and hit-tested at 20px (28px on coarse pointers) — drawn size and hit
 * size are deliberately different numbers. On an element too small to carry eight 20px boxes the
 * hit size shrinks; the drawn size never does (`handleHitSize`).
 *
 * The 20px rotate zones sit diagonally outside each corner and overlap the corner handle's own
 * hit box in the outer quadrant; the handles are later siblings, so they win — resize is the
 * commoner gesture.
 */
export function SelectionFrame({
  rect,
  rotation = 0,
  scale,
  locked = false,
  handles = true,
  coarsePointer = false,
  onHandleDown,
  onRotateDown,
}: SelectionFrameProps) {
  const draw = HANDLE_SIZE / scale;
  const hit = handleHitSize(rect, scale, coarsePointer) / scale;
  const zone = ROTATE_ZONE / scale;
  const showHandles = handles && !locked;

  return (
    <div
      data-selection-frame
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        transformOrigin: "50% 50%",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          outline: `${FRAME_STROKE / scale}px solid ${TOKENS.frame}`,
          outlineOffset: 0,
        }}
      />

      {locked ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: rect.w,
            top: 0,
            transform: "translate(-100%, -100%)",
            padding: 2 / scale,
            color: TOKENS.frame,
            lineHeight: 0,
          }}
        >
          {/* Sized by zoom, so stroke 2 on the 24px grid is the 1px line. */}
          <Lock size={LOCK_GLYPH / scale} strokeWidth={2} />
        </div>
      ) : null}

      {showHandles
        ? CORNERS.map((c) => {
            const d = HANDLE_DIR[c];
            return (
              <div
                key={`rot-${c}`}
                data-rotate-handle={c}
                onPointerDown={(e) => onRotateDown?.(c, e)}
                style={{
                  position: "absolute",
                  left: d.x < 0 ? -zone : rect.w,
                  top: d.y < 0 ? -zone : rect.h,
                  width: zone,
                  height: zone,
                  cursor: ROTATE_CURSOR,
                  pointerEvents: "auto",
                  touchAction: "none",
                }}
              />
            );
          })
        : null}

      {showHandles
        ? HANDLES.map((h) => {
            const d = HANDLE_DIR[h];
            const cx = ((d.x + 1) / 2) * rect.w;
            const cy = ((d.y + 1) / 2) * rect.h;
            return (
              <div
                key={h}
                data-handle={h}
                onPointerDown={(e) => onHandleDown?.(h, e)}
                style={{
                  position: "absolute",
                  left: cx - hit / 2,
                  top: cy - hit / 2,
                  width: hit,
                  height: hit,
                  cursor: resizeCursor(h, rotation),
                  pointerEvents: "auto",
                  touchAction: "none",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <div
                  style={{
                    width: draw,
                    height: draw,
                    borderRadius: HANDLE_RADIUS / scale,
                    background: TOKENS.handleFill,
                    boxShadow: `0 0 0 ${FRAME_STROKE / scale}px ${TOKENS.frame}`,
                  }}
                />
              </div>
            );
          })
        : null}
    </div>
  );
}
