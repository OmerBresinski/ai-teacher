import type { PathElement } from "@tj/domain/documents";
import { pathData, pathEnds, pathSegments } from "@tj/slides";
import type { ElementViewProps } from "./kit";

const DASH = (kind: PathElement["dash"], w: number): string | undefined => {
  if (kind === "dashed") return `${w * 3} ${w * 2.2}`;
  if (kind === "dotted") return `0.001 ${w * 2.2}`;
  return undefined;
};

/** A `path` element (ADR 0032): the curve `pathSegments` computes, drawn as one SVG path. */
export function PathView({ element, theme }: ElementViewProps<PathElement>) {
  const w = Math.max(1, element.w);
  const h = Math.max(1, element.h);
  const sw = element.strokeWidth ?? 3;
  const stroke = element.stroke ?? theme.colors.ink;
  const segments = pathSegments(element, w, h);
  const ends = element.arrowStart || element.arrowEnd ? pathEnds(segments) : null;

  const head = ([tip, from]: [{ x: number; y: number }, { x: number; y: number }]) => {
    const a = Math.atan2(tip.y - from.y, tip.x - from.x);
    const size = sw * 3.2;
    const spread = 0.42;
    const p = (t: number) => `${tip.x - Math.cos(a - t) * size},${tip.y - Math.sin(a - t) * size}`;
    return `${tip.x},${tip.y} ${p(spread)} ${p(-spread)}`;
  };

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ position: "absolute", inset: 0, overflow: "visible" }}
      aria-hidden
      focusable="false"
    >
      <path
        d={pathData(segments)}
        fill={element.closed && element.fill ? element.fill : "none"}
        stroke={stroke}
        strokeWidth={sw}
        strokeLinejoin="round"
        strokeLinecap={element.dash === "dotted" ? "round" : "butt"}
        strokeDasharray={DASH(element.dash, sw)}
      />
      {ends && element.arrowEnd ? <polygon points={head(ends.end)} fill={stroke} /> : null}
      {ends && element.arrowStart ? <polygon points={head(ends.start)} fill={stroke} /> : null}
    </svg>
  );
}
