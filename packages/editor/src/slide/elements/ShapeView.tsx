import type { ShapeElement, ShapeKind } from "@tj/domain/documents";
import { lazy, type ReactNode, Suspense } from "react";
import { isDocEmpty } from "../../text/static";
import { type ElementViewProps, resolveTextStyle, textTypeCss } from "./kit";
import { RichText } from "./RichText";
import { TextShell } from "./TextView";

/** Edit mode only: the store subscription and, behind another lazy boundary, Tiptap. */
const EditableLabel = lazy(() => import("./EditableLabel"));

/** Path/geometry for every ShapeKind, drawn in the element's own point space. */
function shapeNode(kind: ShapeKind, w: number, h: number, radius: number) {
  const cx = w / 2;
  const cy = h / 2;
  switch (kind) {
    case "ellipse":
      return <ellipse cx={cx} cy={cy} rx={Math.max(0, cx)} ry={Math.max(0, cy)} />;
    case "rounded":
      return <rect x={0} y={0} width={w} height={h} rx={Math.min(radius, Math.min(w, h) / 2)} />;
    case "pill":
      return <rect x={0} y={0} width={w} height={h} rx={Math.min(w, h) / 2} />;
    case "triangle":
      return <polygon points={`${cx},0 ${w},${h} 0,${h}`} />;
    case "diamond":
      return <polygon points={`${cx},0 ${w},${cy} ${cx},${h} 0,${cy}`} />;
    case "star":
      return <polygon points={starPoints(w, h)} />;
    case "speech":
      return <path d={speechPath(w, h, radius)} />;
    default:
      return <rect x={0} y={0} width={w} height={h} />;
  }
}

function starPoints(w: number, h: number): string {
  const cx = w / 2;
  const cy = h / 2;
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const k = i % 2 === 0 ? 1 : 0.42;
    pts.push(`${cx + Math.cos(angle) * cx * k},${cy + Math.sin(angle) * cy * k}`);
  }
  return pts.join(" ");
}

function speechPath(w: number, h: number, radius: number): string {
  const body = h * 0.82;
  const r = Math.min(radius || 12, Math.min(w, body) / 2);
  const tailL = w * 0.18;
  const tailR = w * 0.34;
  return [
    `M ${r} 0`,
    `H ${w - r}`,
    `A ${r} ${r} 0 0 1 ${w} ${r}`,
    `V ${body - r}`,
    `A ${r} ${r} 0 0 1 ${w - r} ${body}`,
    `H ${tailR}`,
    `L ${tailL} ${h}`,
    `L ${tailL + (tailR - tailL) * 0.18} ${body}`,
    `H ${r}`,
    `A ${r} ${r} 0 0 1 0 ${body - r}`,
    `V ${r}`,
    `A ${r} ${r} 0 0 1 ${r} 0`,
    "Z",
  ].join(" ");
}

export function ShapeView({ element, theme, mode, slideId }: ElementViewProps<ShapeElement>) {
  const w = Math.max(1, element.w);
  const h = Math.max(1, element.h);
  const stroke = element.stroke;
  const strokeWidth = element.strokeWidth ?? (stroke ? 2 : 0);
  const fill = element.fill ?? theme.colors.surface;
  const radius = element.radius ?? theme.radius;

  const label = element.doc && !isDocEmpty(element.doc) ? element.doc : null;
  const r = resolveTextStyle(
    { align: "center", valign: "middle", padding: 12, ...element.textStyle },
    theme,
    element.textStyle?.preset ?? "body",
  );

  /** The shape, drawn either with its label, with the editor in the label's place, or bare. */
  const shape = (editor: ReactNode) => (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ position: "absolute", inset: 0, overflow: "visible" }}
        aria-hidden
        focusable="false"
      >
        <g
          fill={fill}
          stroke={stroke ?? "none"}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        >
          {shapeNode(element.shape, w, h, radius)}
        </g>
      </svg>
      {editor ? (
        <TextShell r={r} mode={mode} theme={theme} style={{ position: "relative" }}>
          {editor}
        </TextShell>
      ) : label ? (
        <TextShell r={r} mode={mode} theme={theme} style={{ position: "relative" }}>
          <div style={{ width: "100%", flex: "0 0 auto" }}>
            <RichText doc={label} style={textTypeCss(r)} />
          </div>
        </TextShell>
      ) : null}
    </div>
  );

  if (mode !== "edit") return shape(null);
  return (
    <Suspense fallback={shape(null)}>
      <EditableLabel
        slideId={slideId}
        id={element.id}
        doc={element.doc}
        // A shape can be given a label it never had, so the first edit seeds one.
        seedEmpty={element.doc === undefined}
        style={{ flex: "0 0 auto", ...textTypeCss(r) }}
        render={({ editor }) => shape(editor)}
      />
    </Suspense>
  );
}
