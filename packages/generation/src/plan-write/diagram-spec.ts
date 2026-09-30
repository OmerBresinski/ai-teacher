import { z } from "zod";

/*
 * The diagram spec a diagram slot is written as (spike/plan-write, from the diagram agent's schema in
 * scratchpad/pv-diagrams-NOTES.md, spike/diagrams `@tj/slides/diagrams` DiagramSpecSchema). A mirror
 * until that branch lands: then this file re-exports `DiagramSpecSchema` and the renderer draws it
 * (`withDiagramSlot` with a spec object). All text is plain; the limits are the renderer's.
 */

const tone = z.enum(["accent", "accent2", "muted", "surface", "none"]);
const text = (max: number) => z.string().trim().min(1).max(max);
const pt = z.array(z.number()).length(2).describe("[x, y]");
const common = {
  alt: text(200).describe("what a screen reader hears: the whole drawing in one sentence"),
  title: text(40).optional().describe("one line above the drawing"),
};

const barModel = z.object({
  kind: z.literal("bar-model"),
  ...common,
  bars: z
    .array(
      z.object({
        label: text(12),
        parts: z
          .array(
            z.object({
              value: z.number().positive().optional(),
              label: text(10).optional(),
              shaded: z.boolean().optional(),
            }),
          )
          .min(1)
          .max(12),
        total: text(14).optional(),
      }),
    )
    .min(1)
    .max(4),
  combined: text(14).optional(),
});

const axis = z.object({
  label: text(30),
  min: z.number(),
  max: z.number(),
  step: z.number().positive().optional(),
});
const lineGraph = z.object({
  kind: z.literal("line-graph"),
  ...common,
  x: axis,
  y: axis,
  y2: axis.optional(),
  series: z
    .array(
      z.object({
        label: text(20),
        points: z.array(pt).min(2).max(40).describe("[x, y] pairs, x ascending"),
        style: z.enum(["line", "bars"]).optional(),
        axis: z.enum(["left", "right"]).optional(),
      }),
    )
    .min(1)
    .max(3),
  segments: z
    .array(z.object({ from: z.number(), to: z.number(), label: text(20) }))
    .max(5)
    .optional(),
  annotations: z
    .array(z.object({ x: z.number(), y: z.number(), label: text(24) }))
    .max(4)
    .optional(),
});

const flow = z.object({
  kind: z.literal("flow"),
  ...common,
  layout: z.enum(["chain", "cycle"]),
  steps: z
    .array(z.object({ label: text(32), arrow: text(14).optional() }))
    .min(2)
    .max(6),
});

const shape = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("particles"),
    arrangement: z.enum(["solid", "liquid", "gas"]),
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
    caption: text(16).optional(),
  }),
  z.object({
    type: z.literal("circle"),
    cx: z.number(),
    cy: z.number(),
    r: z.number(),
    fill: tone.optional(),
  }),
  z.object({
    type: z.literal("ellipse"),
    cx: z.number(),
    cy: z.number(),
    rx: z.number(),
    ry: z.number(),
    fill: tone.optional(),
  }),
  z.object({
    type: z.literal("rect"),
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
    fill: tone.optional(),
    rounded: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("polygon"),
    points: z.array(pt).min(2).max(12),
    fill: tone.optional(),
  }),
  z.object({
    type: z.literal("line"),
    points: z.array(pt).min(2).max(12),
    dashed: z.boolean().optional(),
  }),
  z.object({ type: z.literal("arrow"), from: pt, to: pt }),
]);
const labelledDiagram = z.object({
  kind: z.literal("labelled-diagram"),
  ...common,
  canvas: z
    .enum(["square", "wide"])
    .optional()
    .describe("square is 100 x 100, wide is 160 x 100, origin top-left"),
  shapes: z.array(shape).min(1).max(12),
  labels: z
    .array(z.object({ text: text(24), at: pt, side: z.enum(["left", "right", "top", "bottom"]) }))
    .max(8)
    .optional(),
});

const numberLine = z.object({
  kind: z.literal("number-line"),
  ...common,
  min: z.number(),
  max: z.number(),
  step: z.number().positive(),
  labelEvery: z.number().positive().optional(),
  points: z
    .array(
      z.object({ value: z.number(), label: text(10).optional(), open: z.boolean().optional() }),
    )
    .max(6)
    .optional(),
  jumps: z
    .array(z.object({ from: z.number(), to: z.number(), label: text(10).optional() }))
    .max(6)
    .optional(),
  range: z.object({ from: z.number(), to: z.number() }).optional(),
});

const table = z.object({
  kind: z.literal("table"),
  ...common,
  header: z.array(text(20)).min(1).max(5).optional(),
  rows: z
    .array(z.array(text(28)).min(1).max(5))
    .min(1)
    .max(8),
});

/** One diagram, told apart by `kind`. */
export const DiagramSpecSchema = z.discriminatedUnion("kind", [
  barModel,
  lineGraph,
  flow,
  labelledDiagram,
  numberLine,
  table,
]);
export type DiagramSpec = z.infer<typeof DiagramSpecSchema>;

export const DIAGRAM_KINDS = DiagramSpecSchema.options.map((o) => o.shape.kind.value);

/** The contract line a writer reads for the diagram slot. */
export const DIAGRAM_CONTRACT = `- diagram: the drawing itself, as a diagram spec of one kind (${DIAGRAM_KINDS.join(", ")}), its labels short; never shown as text`;
