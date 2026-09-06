import type { CSSProperties } from "react";
import type { Guide } from "../../model/snapping";
import { GUIDE_STROKE, TOKENS } from "./constants";

type Props = { guides: Guide[]; scale: number };

const LABEL_FONT = "var(--font-ui), system-ui, sans-serif";

/**
 * Smart guides (TeachDeck `transform/Guides.tsx`). 1px solid magenta, zoom-invariant, spanning
 * only the elements involved. Distance labels appear on spacing snaps only, never on edge snaps.
 */
export function Guides({ guides, scale }: Props) {
  if (guides.length === 0) return null;
  const px = GUIDE_STROKE / scale;
  const cap = 7 / scale;

  return (
    <div data-guides style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden>
      {guides.map((g) => {
        if (g.type === "align") {
          const style: CSSProperties =
            g.axis === "x"
              ? { left: g.position - px / 2, top: g.start, width: px, height: g.end - g.start }
              : { left: g.start, top: g.position - px / 2, width: g.end - g.start, height: px };
          return (
            <div
              // Keyed on what the guide *is*, so React never reuses one guide's node for another.
              key={`a:${g.axis}:${g.position}:${g.targetId}:${g.role}`}
              data-guide={g.axis}
              style={{ position: "absolute", background: TOKENS.guide, ...style }}
            />
          );
        }
        return (
          <div key={`s:${g.axis}:${g.cross}:${g.gap}`} data-guide={g.axis}>
            {g.segments.map((seg) => {
              const len = Math.max(0, seg.to - seg.from);
              const bar: CSSProperties =
                g.axis === "x"
                  ? { left: seg.from, top: g.cross - px / 2, width: len, height: px }
                  : { left: g.cross - px / 2, top: seg.from, width: px, height: len };
              const capA: CSSProperties =
                g.axis === "x"
                  ? { left: seg.from - px / 2, top: g.cross - cap, width: px, height: cap * 2 }
                  : { left: g.cross - cap, top: seg.from - px / 2, width: cap * 2, height: px };
              const capB: CSSProperties =
                g.axis === "x"
                  ? { left: seg.to - px / 2, top: g.cross - cap, width: px, height: cap * 2 }
                  : { left: g.cross - cap, top: seg.to - px / 2, width: cap * 2, height: px };
              return (
                <div key={`${seg.from}:${seg.to}`}>
                  <div style={{ position: "absolute", background: TOKENS.guide, ...bar }} />
                  <div style={{ position: "absolute", background: TOKENS.guide, ...capA }} />
                  <div style={{ position: "absolute", background: TOKENS.guide, ...capB }} />
                  <div
                    style={{
                      position: "absolute",
                      left: g.axis === "x" ? (seg.from + seg.to) / 2 : g.cross,
                      top: g.axis === "x" ? g.cross : (seg.from + seg.to) / 2,
                      transform: "translate(-50%, -50%)",
                      background: TOKENS.guide,
                      color: "#fff",
                      fontSize: 11 / scale,
                      lineHeight: 1.2,
                      fontFamily: LABEL_FONT,
                      fontVariantNumeric: "tabular-nums",
                      padding: `${2 / scale}px ${5 / scale}px`,
                      borderRadius: 3 / scale,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {Math.round(g.gap)}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
