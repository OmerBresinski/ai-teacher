import type { LineElement } from "@tj/domain/documents";
import { arrowGeometry, endDashOffset } from "@tj/slides/arrow";
import type { ElementViewProps } from "./kit";

const DASH = (kind: LineElement["dash"], w: number): string | undefined => {
  if (kind === "dashed") return `${w * 3} ${w * 2.2}`;
  if (kind === "dotted") return `0.001 ${w * 2.2}`;
  return undefined;
};

export function LineView({ element, theme }: ElementViewProps<LineElement>) {
  const w = Math.max(1, element.w);
  const h = Math.max(1, element.h);
  const sw = element.strokeWidth ?? 3;
  const stroke = element.stroke ?? theme.colors.ink;
  const x1 = element.from.x * w;
  const y1 = element.from.y * h;
  const x2 = element.to.x * w;
  const y2 = element.to.y * h;

  // Arrowheads are the arrow primitive (TEACH-75 part x), as diagrams and the PPTX export draw
  // them: an open chevron sharing the line's stroke, its tip on the endpoint; a dashed or dotted
  // shaft stops two strokes short of it.
  const dash = DASH(element.dash, sw);
  const endGeo = element.arrowEnd
    ? arrowGeometry(`M${x1} ${y1} L${x2} ${y2}`, sw, dash)
    : undefined;
  const startGeo = element.arrowStart
    ? arrowGeometry(`M${x2} ${y2} L${x1} ${y1}`, sw, dash)
    : undefined;
  const lastPoint = (d?: string): [number, number] | undefined => {
    const v = d?.match(/-?[\d.]+(?:e[-+]?\d+)?/g)?.map(Number);
    return v && v.length >= 2 ? [v[v.length - 2] as number, v[v.length - 1] as number] : undefined;
  };
  const [ex, ey] = lastPoint(endGeo?.shaft) ?? [x2, y2];
  const [sx, sy] = lastPoint(startGeo?.shaft) ?? [x1, y1];
  const shaftLen = Math.hypot(ex - sx, ey - sy);
  const pair = dash?.split(" ").map(Number);
  const offset =
    pair && endGeo && pair.length === 2
      ? endDashOffset(shaftLen, pair[0] as number, pair[1] as number)
      : undefined;
  const head = (g?: { head: { d: string } }) =>
    g ? (
      <path
        d={g.head.d}
        fill="none"
        stroke={stroke}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ) : null;

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ position: "absolute", inset: 0, overflow: "visible" }}
      aria-hidden
      focusable="false"
    >
      <line
        x1={sx}
        y1={sy}
        x2={ex}
        y2={ey}
        stroke={stroke}
        strokeWidth={sw}
        strokeLinecap={element.dash === "dotted" || endGeo || startGeo ? "round" : "butt"}
        strokeDasharray={dash}
        strokeDashoffset={offset}
      />
      {head(endGeo)}
      {head(startGeo)}
    </svg>
  );
}
