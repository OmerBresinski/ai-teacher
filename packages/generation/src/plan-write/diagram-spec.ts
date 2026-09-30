import { z } from "zod";

/*
 * The diagram spec a diagram slot is written as (spike/plan-write, from the diagram agent's schema in
 * scratchpad/pv-diagrams-NOTES.md, spike/diagrams `@tj/slides/diagrams` DiagramSpecSchema). A mirror
 * until that branch lands: then this file re-exports `DiagramSpecSchema` and the renderer draws it
 * (`withDiagramSlot` with a spec object). All text is plain; the limits are the renderer's.
 */

const tone = z.enum(["accent", "accent2", "muted", "surface", "none"]);
/**
 * A text field on the wire: its limit is stated to the writer, not enforced here. A text over it
 * (or empty) fails the renderer's own parse when the slide is drawn, and the slide lands as a
 * normal teaching slide without the drawing (plan-write `diagramDraws`), never a failed writer call.
 */
const text = (max: number, what?: string) =>
  z
    .string()
    .trim()
    .describe(`${what ? `${what}; ` : ""}at most ${max} characters`);
const pt = z.array(z.number()).length(2).describe("[x, y]");
const common = {
  alt: text(200, "what a screen reader hears: the whole drawing in one sentence"),
  title: text(40, "one line above the drawing").optional(),
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
    .array(
      z.object({
        x: z.number(),
        y: z.number().describe("in the left axis's units"),
        label: text(24),
      }),
    )
    .max(4)
    .optional(),
  intervals: z
    .array(
      z.object({
        from: z.number(),
        to: z.number(),
        label: text(20),
        y: z.number().optional().describe("in the left axis's units"),
      }),
    )
    .max(2)
    .optional()
    .describe("a span between two x values, drawn as a labelled double arrow (a lag time)"),
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
    .optional()
    .describe(
      "each label on, inside or just beside the shape it names (one further away is dropped); one name per shape",
    ),
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

/**
 * The contract lines a writer reads for the diagram slot: the renderer's limits as units of text
 * (words, phrases), never character counts (rulings 82 and 132); the renderer's parse still holds
 * the limits, and a spec over one lands as a teaching slide without the drawing.
 */
export const DIAGRAM_CONTRACT = [
  `- diagram: the drawing itself, as a diagram spec of one kind (${DIAGRAM_KINDS.join(", ")}); never shown as text. Its text is labels, not sentences: a label, annotation, interval, series name, particle caption or table header is one to three words; an axis label is a few words with its unit; a flow step is a short phrase and a flow arrow one or two words; a table cell is a short phrase; the title is one short line and the alt one sentence. A field with nothing to say is left out, never empty.`,
  "  - line-graph: an annotation marks one point of one series, at that point's own x and y (on the series' own axis), and its label names that series' feature (\"Peak rainfall\" at the tallest rainfall bar, \"Peak discharge\" at the top of the discharge line). An interval's y is in the left axis's units, below both curves' peaks. A lag time is an interval from the rainfall peak's x to the discharge peak's x.",
  "  - labelled-diagram: shapes on a canvas 100 high (100 or 160 wide). Each label's point is inside or on the shape it names; a label is 1 to 3 words, one per shape, at most 6. Particle boxes are one per state, the caption the state's name; a label on a particle box says something the caption does not (\"fixed rows\", never the state's name again).",
].join("\n");
