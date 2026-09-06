import type { LineElement } from "@tj/domain/documents";
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

  // Pull the endpoints back so the arrowhead tip lands exactly on the endpoint.
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const inset = sw * 2.6;
  const ux = (dx / len) * inset;
  const uy = (dy / len) * inset;
  const sx = element.arrowStart ? x1 + ux : x1;
  const sy = element.arrowStart ? y1 + uy : y1;
  const ex = element.arrowEnd ? x2 - ux : x2;
  const ey = element.arrowEnd ? y2 - uy : y2;

  const head = (x: number, y: number, towardsX: number, towardsY: number) => {
    const a = Math.atan2(y - towardsY, x - towardsX);
    const size = sw * 3.2;
    const spread = 0.42;
    const p = (t: number) => `${x - Math.cos(a - t) * size},${y - Math.sin(a - t) * size}`;
    return `${x},${y} ${p(spread)} ${p(-spread)}`;
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
      <line
        x1={sx}
        y1={sy}
        x2={ex}
        y2={ey}
        stroke={stroke}
        strokeWidth={sw}
        strokeLinecap={element.dash === "dotted" ? "round" : "butt"}
        strokeDasharray={DASH(element.dash, sw)}
      />
      {element.arrowEnd ? <polygon points={head(x2, y2, x1, y1)} fill={stroke} /> : null}
      {element.arrowStart ? <polygon points={head(x1, y1, x2, y2)} fill={stroke} /> : null}
    </svg>
  );
}
