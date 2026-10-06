/**
 * What a writer fills to get a diagram: one JSON spec per slide, discriminated on `kind`. Code
 * draws it (`render.ts`); the model never supplies geometry beyond values and, for a
 * labelled diagram, primitives on a fixed 100-unit canvas. The limits are the ones the renderers
 * can honestly lay out at a legible size in a half-slide slot; a spec past them does not parse,
 * and a spec that does not parse draws nothing.
 */
import { z } from "zod";
import { BarChartSchema, CarrollSchema, PieSchema, VennSchema } from "./charts";

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

/** A part label a bar model can show: a number, a fraction, an unknown ("?") or one letter. */
const QUANTITY = /[0-9?¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|^[a-z]$/i;
/** The number a label leads with ("35 books" → 35), if it leads with one. */
const leading = (t: string): number | undefined => {
  const m = /^\s*(\d[\d,]*(?:\.\d+)?)(?![\d/⁄])/.exec(t);
  return m ? Number((m[1] as string).replace(/,/g, "")) : undefined;
};

/**
 * dd-diagrams: a bar model draws quantities. Its parts are labelled with numbers (or "?"), and a
 * total that leads with a number is the sum of its parts (their values, or their numbered labels):
 * K y9 s3 drew "5 loaves" over parts worth 10 marks, a count of things set over money, which reads
 * as wrong. Such a spec does not parse, so the slide falls back to words.
 */
export const BarModelSchema = z
  .object({
    kind: z.literal("bar-model"),
    ...common,
    bars: z.array(Bar).min(1).max(4),
    combined: label(14).optional(),
  })
  .superRefine((m, ctx) => {
    m.bars.forEach((b, i) => {
      b.parts.forEach((p, j) => {
        if (p.label && !QUANTITY.test(p.label))
          ctx.addIssue({
            code: "custom",
            message: `part label "${p.label}" is not a quantity`,
            path: ["bars", i, "parts", j, "label"],
          });
      });
      const n = b.total ? leading(b.total) : undefined;
      if (n === undefined) return;
      const values = b.parts.reduce((a, p) => a + p.value, 0);
      const defaults = b.parts.every((p) => p.value === 1);
      const labelled = b.parts.map((p) => (p.label ? leading(p.label) : undefined));
      const byLabels = labelled.every((v) => v !== undefined)
        ? labelled.reduce<number>((a, v) => a + (v as number), 0)
        : undefined;
      const near = (a: number) => Math.abs(a - n) <= 1e-6 * Math.max(1, n);
      if (!defaults && !near(values) && !(byLabels !== undefined && near(byLabels)))
        ctx.addIssue({
          code: "custom",
          message: `total "${b.total}" is not the sum of its parts (${values})`,
          path: ["bars", i, "total"],
        });
    });
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
  /** `tangent`: a thin dashed guide line touching the curve, drawn under the data (UX ruling 155). */
  style: z.enum(["line", "bars", "tangent"]).default("line"),
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
    /**
     * A span between two x values drawn as a labelled double arrow ("lag time" from peak rainfall
     * to peak discharge). Set above the plot, or at `y` (left-axis units) when given.
     */
    intervals: z
      .array(z.object({ from: finite, to: finite, label: label(20), y: finite.optional() }))
      .max(2)
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
    g.intervals.forEach((v, i) => {
      if (!(v.to > v.from) || !inside(v.from, g.x) || !inside(v.to, g.x))
        ctx.addIssue({
          code: "custom",
          message: "interval off the x axis",
          path: ["intervals", i],
        });
      if (v.y !== undefined && !inside(v.y, g.y))
        ctx.addIssue({
          code: "custom",
          message: "interval off the y axis",
          path: ["intervals", i],
        });
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
          /** Optional: code places the label on the side that keeps it clear when absent. */
          side: z.enum(["left", "right", "top", "bottom"]).optional(),
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

// ─── templates (round I) ────────────────────────────────────────────────────────────────────
// Hand-built textbook figures: the writer picks one and fills small typed slots; code owns all
// geometry, so a template draws cleanly on every theme and slot.

const STATE = z.enum(["solid", "liquid", "gas"]);

export const ParticlesSchema = z
  .object({
    kind: z.literal("particles"),
    ...common,
    /** states: one panel per state; diffusion and dissolving: a before and an after panel. */
    show: z.enum(["states", "diffusion", "dissolving"]).default("states"),
    states: z.array(STATE).min(1).max(3).default(["solid", "liquid", "gas"]),
    /** A name over each panel (default the state's name, or Before / After). */
    captions: z.array(label(16)).max(3).optional(),
    /** A short description under each panel ("fixed rows"). */
    notes: z.array(label(28)).max(3).optional(),
    /** Words on the arrow between neighbouring panels ("melting"). */
    arrows: z.array(label(14)).max(2).optional(),
    /** Movement marks: vibration in a solid, short arrows in a liquid or gas. */
    motion: z.boolean().default(false),
    /** For diffusion and dissolving: what the two colours are (a key under the panels). */
    key: z.tuple([label(18), label(18)]).optional(),
  })
  .refine(
    (p) => new Set(p.states).size === p.states.length,
    "each state appears once, so the panels differ",
  );

export const HydrographSchema = z.object({
  kind: z.literal("hydrograph"),
  ...common,
  /** flashy: short lag, steep high peak; gentle: long lag, low broad peak. */
  shape: z.enum(["flashy", "gentle"]).default("flashy"),
  /** Optional numbers; with none the axes carry titles only. */
  values: z
    .object({
      peakRainfall: z.number().positive().finite().optional(),
      peakDischarge: z.number().positive().finite().optional(),
      baseFlow: z.number().nonnegative().finite().optional(),
      lagHours: z.number().positive().finite().optional(),
    })
    .optional(),
  /** Which features are labelled (default all six). */
  marks: z
    .array(
      z.enum([
        "peak-rainfall",
        "peak-discharge",
        "lag-time",
        "rising-limb",
        "falling-limb",
        "base-flow",
      ]),
    )
    .optional(),
});

export const TimelineSchema = z
  .object({
    kind: z.literal("timeline"),
    ...common,
    /** In time order, evenly spaced. */
    events: z
      .array(z.object({ date: label(14), text: label(40) }))
      .min(2)
      .max(7),
    /** A highlighted span between two events (1-based positions in `events`). */
    period: z
      .object({ from: z.number().int().min(1), to: z.number().int().min(1), label: label(24) })
      .optional(),
  })
  .refine(
    (t) => !t.period || (t.period.to > t.period.from && t.period.to <= t.events.length),
    "a period runs from an earlier event to a later one",
  );

export const LayersSchema = z.object({
  kind: z.literal("layers"),
  ...common,
  /** Top to bottom, each named by a label on a leader line; thickness 1 to 3. */
  layers: z
    .array(z.object({ label: label(24), thickness: z.number().min(1).max(3).default(1) }))
    .min(3)
    .max(6),
});

export const CycleSchema = z
  .object({
    kind: z.literal("cycle"),
    ...common,
    /** Clockwise from the top. */
    steps: z.array(label(32)).min(3).max(5),
  })
  .refine(
    (c) => new Set(c.steps.map((s) => s.toLowerCase())).size === c.steps.length,
    "each step appears once",
  );

export const RIVER_PARTS = {
  "v-valley": ["valley-side", "channel", "river-bed", "vertical-erosion"],
  "meander-section": [
    "river-cliff",
    "slip-off-slope",
    "fastest-flow",
    "erosion",
    "deposition",
    "outer-bank",
    "inner-bank",
  ],
  "meander-plan": [
    "outer-bank",
    "inner-bank",
    "river-cliff",
    "slip-off-slope",
    "fastest-flow",
    "flow-direction",
  ],
} as const;

export const RiverSchema = z
  .object({
    kind: z.literal("river"),
    ...common,
    view: z.enum(["v-valley", "meander-section", "meander-plan"]),
    /** Each part named once; code knows where every part is. */
    labels: z
      .array(
        z.object({
          part: z.enum([...new Set(Object.values(RIVER_PARTS).flat())] as [string, ...string[]]),
          text: label(24),
        }),
      )
      .min(1)
      .max(6),
  })
  .superRefine((r, ctx) => {
    const ok = RIVER_PARTS[r.view] as readonly string[];
    const seen = new Set<string>();
    r.labels.forEach((l, i) => {
      if (!ok.includes(l.part))
        ctx.addIssue({
          code: "custom",
          message: `no ${l.part} in a ${r.view}`,
          path: ["labels", i],
        });
      if (seen.has(l.part))
        ctx.addIssue({ code: "custom", message: "each part once", path: ["labels", i] });
      seen.add(l.part);
    });
  });

// ─── the union ──────────────────────────────────────────────────────────────────────────────

export const DiagramSpecSchema = z.discriminatedUnion("kind", [
  BarModelSchema,
  LineGraphSchema,
  FlowSchema,
  LabelledDiagramSchema,
  NumberLineSchema,
  TableSchema,
  ParticlesSchema,
  HydrographSchema,
  TimelineSchema,
  LayersSchema,
  CycleSchema,
  RiverSchema,
  BarChartSchema,
  PieSchema,
  VennSchema,
  CarrollSchema,
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
export type Particles = z.infer<typeof ParticlesSchema>;
export type Hydrograph = z.infer<typeof HydrographSchema>;
export type Timeline = z.infer<typeof TimelineSchema>;
export type Layers = z.infer<typeof LayersSchema>;
export type Cycle = z.infer<typeof CycleSchema>;
export type River = z.infer<typeof RiverSchema>;
export type { BarChart, Carroll, Pie, Venn } from "./charts";

/** The hand-built templates (round I): code owns their geometry; the picture ladder tries them first. */
export const TEMPLATE_KINDS = [
  "particles",
  "hydrograph",
  "timeline",
  "layers",
  "cycle",
  "river",
  "bar-model",
  "number-line",
] as const;

export const DIAGRAM_KINDS: DiagramKind[] = [
  "bar-model",
  "line-graph",
  "flow",
  "labelled-diagram",
  "number-line",
  "table",
  "particles",
  "hydrograph",
  "timeline",
  "layers",
  "cycle",
  "river",
  "bar-chart",
  "pie",
  "venn",
  "carroll",
];
