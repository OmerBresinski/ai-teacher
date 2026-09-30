/**
 * What a writer fills to get a diagram: one JSON spec per slide, discriminated on `kind`. Code
 * draws it (`render.ts`); the model never supplies geometry beyond values and, for a
 * labelled diagram, primitives on a fixed 100-unit canvas. The limits are the ones the renderers
 * can honestly lay out at a legible size in a half-slide slot; a spec past them does not parse,
 * and a spec that does not parse draws nothing.
 */
import { z } from "zod";

const label = (max: number) => z.string().trim().min(1).max(max);
const finite = z.number().finite();
const tone = z.enum(["accent", "accent2", "muted", "surface", "none"]);

const common = {
  /** What a screen reader hears, and the image's alt text. */
  alt: label(200),
  /** A short caption set above the drawing. */
  title: label(40).optional(),
};

// ─── bar model ──────────────────────────────────────────────────────────────────────────────

const BarPart = z.object({
  value: z.number().positive().finite().default(1),
  label: label(10).optional(),
  shaded: z.boolean().optional(),
});

const Bar = z.object({
  label: label(12).optional(),
  parts: z.array(BarPart).min(1).max(12),
  total: label(14).optional(),
});

export const BarModelSchema = z.object({
  kind: z.literal("bar-model"),
  ...common,
  bars: z.array(Bar).min(1).max(4),
  combined: label(14).optional(),
});

// ─── line graph ─────────────────────────────────────────────────────────────────────────────

const Axis = z
  .object({
    label: label(30),
    min: finite,
    max: finite,
    step: z.number().positive().finite().optional(),
  })
  .refine((a) => a.max > a.min, "max must be above min");

const Series = z.object({
  label: label(20).optional(),
  points: z
    .array(z.tuple([finite, finite]))
    .min(2)
    .max(40),
  style: z.enum(["line", "bars"]).default("line"),
  axis: z.enum(["left", "right"]).default("left"),
});

const inside = (v: number, a: { min: number; max: number }) => v >= a.min && v <= a.max;

export const LineGraphSchema = z
  .object({
    kind: z.literal("line-graph"),
    ...common,
    x: Axis,
    y: Axis,
    y2: Axis.optional(),
    series: z.array(Series).min(1).max(3),
    segments: z
      .array(z.object({ from: finite, to: finite, label: label(20) }))
      .max(5)
      .default([]),
    annotations: z
      .array(z.object({ x: finite, y: finite, label: label(24) }))
      .max(4)
      .default([]),
  })
  .superRefine((g, ctx) => {
    g.series.forEach((s, i) => {
      const ya = s.axis === "right" ? g.y2 : g.y;
      if (!ya) {
        ctx.addIssue({
          code: "custom",
          message: "a right-axis series needs y2",
          path: ["series", i],
        });
        return;
      }
      s.points.forEach(([px, py], j) => {
        if (!inside(px, g.x) || !inside(py, ya)) {
          ctx.addIssue({ code: "custom", message: "point off the axes", path: ["series", i, j] });
        }
        const prev = s.points[j - 1];
        if (prev && px < prev[0]) {
          ctx.addIssue({ code: "custom", message: "x must ascend", path: ["series", i, j] });
        }
      });
    });
    g.segments.forEach((s, i) => {
      if (!(s.to > s.from) || !inside(s.from, g.x) || !inside(s.to, g.x)) {
        ctx.addIssue({ code: "custom", message: "segment off the x axis", path: ["segments", i] });
      }
    });
    g.annotations.forEach((a, i) => {
      if (!inside(a.x, g.x) || !inside(a.y, g.y)) {
        ctx.addIssue({
          code: "custom",
          message: "annotation off the axes",
          path: ["annotations", i],
        });
      }
    });
  });

// ─── flow ───────────────────────────────────────────────────────────────────────────────────

export const FlowSchema = z
  .object({
    kind: z.literal("flow"),
    ...common,
    layout: z.enum(["chain", "cycle"]).default("chain"),
    steps: z
      .array(z.object({ label: label(32), arrow: label(14).optional() }))
      .min(2)
      .max(6),
  })
  .refine((f) => f.layout === "chain" || f.steps.length >= 3, "a cycle needs three steps");

// ─── labelled diagram ───────────────────────────────────────────────────────────────────────

const coord = z.number().min(0).max(160);
const pt = z.tuple([coord, coord]);

const Shape = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("particles"),
    arrangement: z.enum(["solid", "liquid", "gas"]),
    x: coord,
    y: coord,
    w: z.number().min(10).max(160),
    h: z.number().min(10).max(100),
    caption: label(16).optional(),
  }),
  z.object({
    type: z.literal("circle"),
    cx: coord,
    cy: coord,
    r: z.number().positive().max(80),
    fill: tone.optional(),
  }),
  z.object({
    type: z.literal("ellipse"),
    cx: coord,
    cy: coord,
    rx: z.number().positive().max(80),
    ry: z.number().positive().max(80),
    fill: tone.optional(),
  }),
  z.object({
    type: z.literal("rect"),
    x: coord,
    y: coord,
    w: z.number().positive().max(160),
    h: z.number().positive().max(100),
    fill: tone.optional(),
    rounded: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("polygon"),
    points: z.array(pt).min(3).max(12),
    fill: tone.optional(),
  }),
  z.object({
    type: z.literal("line"),
    points: z.array(pt).min(2).max(12),
    dashed: z.boolean().optional(),
  }),
  z.object({ type: z.literal("arrow"), from: pt, to: pt }),
]);

export const LabelledDiagramSchema = z
  .object({
    kind: z.literal("labelled-diagram"),
    ...common,
    canvas: z.enum(["square", "wide"]).default("square"),
    shapes: z.array(Shape).min(1).max(12),
    labels: z
      .array(
        z.object({
          text: label(24),
          at: pt,
          side: z.enum(["left", "right", "top", "bottom"]),
        }),
      )
      .max(8)
      .default([]),
  })
  .superRefine((d, ctx) => {
    const W = d.canvas === "wide" ? 160 : 100;
    const off = (x: number, y: number) => x > W || y > 100;
    d.labels.forEach((l, i) => {
      if (off(l.at[0], l.at[1]))
        ctx.addIssue({ code: "custom", message: "label off the canvas", path: ["labels", i] });
    });
    d.shapes.forEach((s, i) => {
      const pts: [number, number][] =
        s.type === "polygon" || s.type === "line"
          ? s.points
          : s.type === "arrow"
            ? [s.from, s.to]
            : s.type === "circle"
              ? [[s.cx, s.cy]]
              : s.type === "ellipse"
                ? [[s.cx, s.cy]]
                : [[s.x + s.w, s.y + s.h]];
      if (pts.some(([x, y]) => off(x, y)))
        ctx.addIssue({ code: "custom", message: "shape off the canvas", path: ["shapes", i] });
    });
  });

// ─── number line ────────────────────────────────────────────────────────────────────────────

export const NumberLineSchema = z
  .object({
    kind: z.literal("number-line"),
    ...common,
    min: finite,
    max: finite,
    step: z.number().positive().finite(),
    labelEvery: z.number().positive().finite().optional(),
    points: z
      .array(z.object({ value: finite, label: label(10).optional(), open: z.boolean().optional() }))
      .max(6)
      .default([]),
    jumps: z
      .array(z.object({ from: finite, to: finite, label: label(10).optional() }))
      .max(6)
      .default([]),
    range: z.object({ from: finite, to: finite }).optional(),
  })
  .superRefine((l, ctx) => {
    if (!(l.max > l.min) || (l.max - l.min) / l.step > 40) {
      ctx.addIssue({ code: "custom", message: "min < max with at most 40 ticks" });
      return;
    }
    const inLine = (v: number) => v >= l.min && v <= l.max;
    if (l.points.some((p) => !inLine(p.value)))
      ctx.addIssue({ code: "custom", message: "point off the line" });
    if (l.jumps.some((j) => !inLine(j.from) || !inLine(j.to) || j.from === j.to))
      ctx.addIssue({ code: "custom", message: "jump off the line" });
    if (l.range && (!inLine(l.range.from) || !inLine(l.range.to) || l.range.to <= l.range.from))
      ctx.addIssue({ code: "custom", message: "range off the line" });
  });

// ─── table ──────────────────────────────────────────────────────────────────────────────────

export const TableSchema = z
  .object({
    kind: z.literal("table"),
    ...common,
    header: z.array(label(20)).min(1).max(5).optional(),
    rows: z
      .array(z.array(z.string().trim().max(28)).min(1).max(5))
      .min(1)
      .max(8),
  })
  .refine((t) => {
    const cols = t.header?.length ?? t.rows[0]?.length;
    return t.rows.every((r) => r.length === cols);
  }, "every row has one cell per column");

// ─── the union ──────────────────────────────────────────────────────────────────────────────

export const DiagramSpecSchema = z.discriminatedUnion("kind", [
  BarModelSchema,
  LineGraphSchema,
  FlowSchema,
  LabelledDiagramSchema,
  NumberLineSchema,
  TableSchema,
]);

export type DiagramSpec = z.infer<typeof DiagramSpecSchema>;
export type DiagramSpecInput = z.input<typeof DiagramSpecSchema>;
export type DiagramKind = DiagramSpec["kind"];
export type BarModel = z.infer<typeof BarModelSchema>;
export type LineGraph = z.infer<typeof LineGraphSchema>;
export type Flow = z.infer<typeof FlowSchema>;
export type LabelledDiagram = z.infer<typeof LabelledDiagramSchema>;
export type NumberLine = z.infer<typeof NumberLineSchema>;
export type Table = z.infer<typeof TableSchema>;

export const DIAGRAM_KINDS: DiagramKind[] = [
  "bar-model",
  "line-graph",
  "flow",
  "labelled-diagram",
  "number-line",
  "table",
];
