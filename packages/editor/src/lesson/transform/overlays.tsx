import { Tooltip } from "@tj/ui";
import { Info } from "lucide-react";
import type { CSSProperties } from "react";
import type { Rect } from "../../model/geometry";
import { normaliseHref } from "../../text/links";
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

/**
 * The elements a marquee currently touches, shown live while it is dragged: a hairline just
 * inside each frame at 60%, no handles. Selection itself waits for pointer-up.
 */
export function CandidateOutlines({ boxes, scale }: { boxes: ElementBox[]; scale: number }) {
  return (
    <>
      {boxes.map((b) => (
        <div
          key={b.id}
          aria-hidden
          data-marquee-candidate={b.id}
          style={{
            position: "absolute",
            left: b.rect.x,
            top: b.rect.y,
            width: b.rect.w,
            height: b.rect.h,
            transform: b.rotation ? `rotate(${b.rotation}deg)` : undefined,
            transformOrigin: "50% 50%",
            outline: `${1 / scale}px solid ${TOKENS.frame}`,
            outlineOffset: `${-1 / scale}px`,
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

/** Badge side, screen px, and its inset from the frame corner. */
const CREDIT_SIZE = 20;
const CREDIT_INSET = 6;

/**
 * The attribution affordance on a selected searched image (TEACH-153 §5): a small "i" at the top
 * right of the frame; hover or focus reads "Photo by {credit}", and with a `creditUrl` it is a link
 * to the source. It stays through crop mode, so the credit is never hidden by adjusting.
 */
export function CreditBadge({
  rect,
  scale,
  credit,
  creditUrl,
}: {
  rect: Rect;
  scale: number;
  credit: string;
  creditUrl?: string;
}) {
  // Untrusted JSON could carry `javascript:` here; the same gate as a typed link.
  const href = creditUrl ? normaliseHref(creditUrl) : null;
  const size = CREDIT_SIZE / scale;
  const style: CSSProperties = {
    position: "absolute",
    left: rect.x + rect.w - size - CREDIT_INSET / scale,
    top: rect.y + CREDIT_INSET / scale,
    width: size,
    height: size,
    display: "grid",
    placeItems: "center",
    margin: 0,
    padding: 0,
    border: 0,
    borderRadius: "50%",
    background: "rgb(27 26 23 / 0.72)",
    color: "#fff",
    boxShadow: `0 0 0 ${1 / scale}px rgb(255 255 255 / 0.55)`,
    cursor: href ? "pointer" : "default",
    pointerEvents: "auto",
    outline: "none",
  };
  const label = `Photo by ${credit}`;
  const glyph = <Info size={12 / scale} strokeWidth={2} aria-hidden />;
  return (
    <Tooltip label={label}>
      {href ? (
        <a
          data-credit-badge
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${label}. Opens the source.`}
          onPointerDown={(e) => e.stopPropagation()}
          style={style}
        >
          {glyph}
        </a>
      ) : (
        <button
          type="button"
          data-credit-badge
          aria-label={label}
          onPointerDown={(e) => e.stopPropagation()}
          style={style}
        >
          {glyph}
        </button>
      )}
    </Tooltip>
  );
}
