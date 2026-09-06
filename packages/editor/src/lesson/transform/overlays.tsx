import type { CSSProperties } from "react";
import type { Rect } from "../../model/geometry";
import { TOKENS } from "./constants";
import type { ElementBox } from "./hit-test";

/*
 * The transform layer's passive drawings — everything on the stage that is not a control: the
 * member outlines of a multi-selection, the marquee rectangle and the rotation readout. All
 * `pointer-events: none`; all chrome divided by the scale so it is the same size at every zoom.
 */

const LABEL_FONT = "var(--font-ui), system-ui, sans-serif";

/** One thin outline per member of a multi-selection, under the shared frame. */
export function MemberOutlines({ boxes, scale }: { boxes: ElementBox[]; scale: number }) {
  return (
    <>
      {boxes.map((b) => (
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
    </>
  );
}

export function Marquee({ rect, scale }: { rect: Rect; scale: number }) {
  return (
    <div
      aria-hidden
      data-marquee
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        background: TOKENS.marqueeFill,
        outline: `${1 / scale}px solid ${TOKENS.frame}`,
        pointerEvents: "none",
      }}
    />
  );
}

/** "37°" under the selection while a rotate handle is held. */
export function AngleLabel({
  bounds,
  angle,
  scale,
}: {
  bounds: Rect;
  angle: number;
  scale: number;
}) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: bounds.x + bounds.w / 2,
        top: bounds.y + bounds.h + 10 / scale,
        transform: "translateX(-50%)",
        background: TOKENS.frame,
        color: "#fff",
        fontSize: 11 / scale,
        lineHeight: 1.2,
        fontFamily: LABEL_FONT,
        fontVariantNumeric: "tabular-nums",
        padding: `${2 / scale}px ${6 / scale}px`,
        borderRadius: 3 / scale,
        whiteSpace: "nowrap",
        pointerEvents: "none",
      }}
    >
      {angle}&deg;
    </div>
  );
}

export const VISUALLY_HIDDEN: CSSProperties = {
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
