/**
 * DIAGRAM-AUDIT item 7: the coordinate-distance figure. Two points on a squared grid with axes
 * through the origin, the run and the rise drawn as dashed arrows in the second colour with their
 * lengths, and the distance between the points as a solid line named in the accent: the hidden
 * right-angled triangle of Pythagoras on a grid, the method made visible.
 */
import type { SlideElement, Theme } from "@tj/domain/documents";
import { z } from "zod";
import { figureLook, STROKE } from "../diagrams/style";
import { mix } from "../diagrams/svg";
import type { FigureDrawing, FigureTemplate } from "./index";
import { fitLabel, labelText } from "./labels";
import { pointMark, segment } from "./marks";

const point = z.object({ x: z.number().int(), y: z.number().int(), label: z.string().optional() });
const shape = z.object({
  a: point,
  b: point,
  /** The distance's name ("d" when absent); italic in the accent, as an unknown. */
  distance: z.string().optional(),
});
export type CoordinateDistanceValues = z.infer<typeof shape>;

const values = shape.superRefine((v, ctx) => {
  if (v.a.x === v.b.x || v.a.y === v.b.y)
    ctx.addIssue({ code: "custom", message: "The points differ in both x and y.", path: ["b"] });
  for (const p of [v.a, v.b])
    if (Math.abs(p.x) > 12 || Math.abs(p.y) > 12)
      ctx.addIssue({ code: "custom", message: "Keep coordinates within -12 to 12.", path: ["a"] });
});

const FALLBACK: CoordinateDistanceValues = {
  a: { x: 1, y: 1, label: "A" },
  b: { x: 5, y: 4, label: "B" },
};

function draw(
  v0: CoordinateDistanceValues | undefined,
  t: Theme,
  size: { w: number; h: number },
): FigureDrawing {
  const v = v0 && v0.a.x !== v0.b.x && v0.a.y !== v0.b.y ? v0 : FALLBACK;
  const look = figureLook(t, mix);
  const xs = [0, v.a.x, v.b.x];
  const ys = [0, v.a.y, v.b.y];
  const x0 = Math.min(...xs) - 1;
  const x1 = Math.max(...xs) + 1;
  const y0 = Math.min(...ys) - 1;
  const y1 = Math.max(...ys) + 1;
  const pad = 34;
  const cell = Math.min((size.w - 2 * pad) / (x1 - x0), (size.h - 2 * pad) / (y1 - y0));
  const ox = (size.w - cell * (x1 - x0)) / 2;
  const oy = (size.h - cell * (y1 - y0)) / 2;
  const X = (x: number) => ox + (x - x0) * cell;
  const Y = (y: number) => oy + (y1 - y) * cell;
  const grid = mix(t.colors.ink, t.colors.background, 0.18);
  const out: SlideElement[] = [];
  for (let x = x0; x <= x1; x++)
    out.push(
      segment(
        { x: X(x), y: Y(y0) },
        { x: X(x), y: Y(y1) },
        { stroke: grid, strokeWidth: STROKE.hair, name: "Grid" },
      ),
    );
  for (let y = y0; y <= y1; y++)
    out.push(
      segment(
        { x: X(x0), y: Y(y) },
        { x: X(x1), y: Y(y) },
        { stroke: grid, strokeWidth: STROKE.hair, name: "Grid" },
      ),
    );
  const axis = { stroke: t.colors.ink, strokeWidth: STROKE.line, arrowEnd: true };
  out.push(segment({ x: X(x0), y: Y(0) }, { x: X(x1), y: Y(0) }, { ...axis, name: "x axis" }));
  out.push(segment({ x: X(0), y: Y(y0) }, { x: X(0), y: Y(y1) }, { ...axis, name: "y axis" }));
  const A = { x: X(v.a.x), y: Y(v.a.y) };
  const B = { x: X(v.b.x), y: Y(v.b.y) };
  const corner = { x: B.x, y: A.y };
  const guide = {
    stroke: t.colors.accent2,
    strokeWidth: STROKE.line,
    dash: "dashed" as const,
    arrowEnd: true,
  };
  out.push(
    segment(A, corner, { ...guide, name: "Run" }),
    segment(corner, B, { ...guide, name: "Rise" }),
  );
  out.push(segment(A, B, { stroke: look.unknown, strokeWidth: STROKE.data, name: "Distance" }));
  out.push(...pointMark(A, "dot", t), ...pointMark(B, "dot", t));
  const label = (text: string, cx: number, cy: number, color = t.colors.ink, italic = false) => {
    const f = fitLabel(t, text, { maxW: 120, bold: true });
    return labelText(
      t,
      f.text,
      { x: cx - f.w / 2, y: cy - f.h / 2, w: f.w, h: f.h },
      "center",
      color,
      { bold: true, italic },
    );
  };
  const run = Math.abs(v.b.x - v.a.x);
  const rise = Math.abs(v.b.y - v.a.y);
  const up = B.y < A.y;
  out.push(label(String(run), (A.x + corner.x) / 2, A.y + (up ? 18 : -18), t.colors.accent2));
  out.push(
    label(String(rise), corner.x + (B.x > A.x ? 20 : -20), (corner.y + B.y) / 2, t.colors.accent2),
  );
  const mx = (A.x + B.x) / 2;
  const my = (A.y + B.y) / 2;
  out.push(
    label(
      v.distance?.trim() || "d",
      mx - (B.x > A.x ? 16 : -16) * (up ? 1 : -1),
      my - 16,
      look.unknown,
      true,
    ),
  );
  // A point's name goes in the first spot around it clear of every drawn line (axes, run, rise,
  // distance) and inside the figure: the collision pass, so no name sits on a stroke.
  const segs = out.flatMap((k) =>
    k.type === "line" && k.name !== "Grid"
      ? [
          [
            { x: k.x + k.from.x * k.w, y: k.y + k.from.y * k.h },
            { x: k.x + k.to.x * k.w, y: k.y + k.to.y * k.h },
          ],
        ]
      : [],
  );
  const clear = (b: { x: number; y: number; w: number; h: number }) =>
    b.x >= 2 &&
    b.y >= 0 &&
    b.x + b.w <= size.w - 2 &&
    b.y + b.h <= size.h &&
    !segs.some(([p, q]) => {
      for (let k = 0; k <= 24; k++) {
        const x =
          (p as { x: number }).x + (((q as { x: number }).x - (p as { x: number }).x) * k) / 24;
        const y =
          (p as { y: number }).y + (((q as { y: number }).y - (p as { y: number }).y) * k) / 24;
        if (x > b.x + 6 && x < b.x + b.w - 6 && y > b.y + b.h * 0.2 && y < b.y + b.h * 0.8)
          return true;
      }
      return false;
    });
  const name = (p: typeof v.a, P: { x: number; y: number }) => {
    const f = fitLabel(t, `${p.label?.trim() || ""} (${p.x}, ${p.y})`.trim(), {
      maxW: 160,
      bold: true,
    });
    const spots = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ].map(([dx, dy]) => ({
      x: P.x + (dx as number) * (f.w / 2 + 10) - f.w / 2,
      y: P.y + (dy as number) * (f.h / 2 + 8) - f.h / 2,
      w: f.w,
      h: f.h,
    }));
    const b = spots.find(clear) ?? (spots[0] as (typeof spots)[number]);
    return labelText(t, f.text, b, "center", t.colors.ink, { bold: true });
  };
  out.push(name(v.a, A), name(v.b, B));
  return {
    children: out,
    alt: `Points ${v.a.label ?? "A"} (${v.a.x}, ${v.a.y}) and ${v.b.label ?? "B"} (${v.b.x}, ${v.b.y}) on a grid; across ${run}, up ${rise}; the distance between them is ${v.distance ?? "d"}.`,
  };
}

export const COORDINATE_DISTANCE: FigureTemplate<CoordinateDistanceValues> = {
  name: "Coordinate distance",
  shape,
  values,
  draw,
  unknown: (v) => ({ value: Math.hypot(v.b.x - v.a.x, v.b.y - v.a.y), unit: "length" }),
};
