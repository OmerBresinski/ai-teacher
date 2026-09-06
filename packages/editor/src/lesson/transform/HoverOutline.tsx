import type { Rect } from "../../model/geometry";
import { HOVER_STROKE, TOKENS } from "./constants";

export type HoverOutlineProps = { rect: Rect; rotation?: number; scale: number };

/** 1px accent outline at 0.5 alpha on the hovered, non-selected element. */
export function HoverOutline({ rect, rotation = 0, scale }: HoverOutlineProps) {
  return (
    <div
      aria-hidden
      data-hover-outline
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        transformOrigin: "50% 50%",
        outline: `${HOVER_STROKE / scale}px solid ${TOKENS.frame}`,
        outlineOffset: 0,
        opacity: 0.5,
        pointerEvents: "none",
      }}
    />
  );
}
