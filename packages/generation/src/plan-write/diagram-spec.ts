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

// ─── templates (round I): pick one, fill its slots; code draws every line and label ──────────

const particles = z.object({
  kind: z.literal("particles"),
  ...common,
  show: z
    .enum(["states", "diffusion", "dissolving"])
    .describe("states: one panel per state; diffusion or dissolving: a before and an after panel"),
  states: z
    .array(z.enum(["solid", "liquid", "gas"]))
    .min(1)
    .max(3)
    .describe("for show states: the states to draw, each once, in order"),
  captions: z
    .array(text(16))
    .max(3)
    .optional()
    .describe("a name over each panel; default the state or Before / After"),
  notes: z
    .array(text(28))
    .max(3)
    .optional()
    .describe("one short description under each panel, e.g. fixed rows"),
  arrows: z
    .array(text(14))
    .max(2)
    .optional()
    .describe("words on the arrow between neighbouring panels, e.g. melting"),
  motion: z.boolean().optional().describe("movement marks on the particles"),
  key: z
    .array(text(18))
    .length(2)
    .optional()
    .describe("diffusion or dissolving: what the two colours are"),
});

const hydrograph = z.object({
  kind: z.literal("hydrograph"),
  ...common,
  shape: z
    .enum(["flashy", "gentle"])
    .describe("flashy: short lag, high steep peak; gentle: long lag, low broad peak"),
  values: z
    .object({
      peakRainfall: z.number().positive().optional().describe("mm"),
      peakDischarge: z.number().positive().optional().describe("m³/s"),
      baseFlow: z.number().optional().describe("m³/s"),
      lagHours: z.number().positive().optional(),
    })
    .optional()
    .describe("only numbers the slide uses; with none the axes carry titles only"),
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
    .optional()
    .describe("the features labelled; default all six"),
});

const timeline = z.object({
  kind: z.literal("timeline"),
  ...common,
  events: z
    .array(z.object({ date: text(14), text: text(40) }))
    .min(3)
    .max(7)
    .describe("in time order"),
  period: z
    .object({ from: z.number().int(), to: z.number().int(), label: text(24) })
    .optional()
    .describe("a highlighted span from one event to a later one, by their 1-based positions"),
});

const layers = z.object({
  kind: z.literal("layers"),
  ...common,
  layers: z
    .array(z.object({ label: text(24), thickness: z.number().min(1).max(3).optional() }))
    .min(3)
    .max(6)
    .describe("top to bottom, each named on a leader line; thickness 1 to 3"),
});

const cycle = z.object({
  kind: z.literal("cycle"),
  ...common,
  steps: z.array(text(32)).min(3).max(5).describe("clockwise from the top, each different"),
});

const river = z.object({
  kind: z.literal("river"),
  ...common,
  view: z
    .enum(["v-valley", "meander-section", "meander-plan"])
    .describe(
      "v-valley: upper-course cross-section; meander-section: across a bend; meander-plan: a bend from above",
    ),
  labels: z
    .array(
      z.object({
        part: z
          .enum([
            "valley-side",
            "channel",
            "river-bed",
            "vertical-erosion",
            "river-cliff",
            "slip-off-slope",
            "fastest-flow",
            "erosion",
            "deposition",
            "outer-bank",
            "inner-bank",
            "flow-direction",
          ])
          .describe(
            "v-valley: valley-side, channel, river-bed, vertical-erosion; meander-section: river-cliff, slip-off-slope, fastest-flow, erosion, deposition, outer-bank, inner-bank; meander-plan: outer-bank, inner-bank, river-cliff, slip-off-slope, fastest-flow, flow-direction",
          ),
        text: text(24),
      }),
    )
    .min(1)
    .max(6)
    .describe("each part once; code knows where every part is"),
});

/** One diagram, told apart by `kind`. */
export const DiagramSpecSchema = z.discriminatedUnion("kind", [
  particles,
  hydrograph,
  timeline,
  layers,
  cycle,
  river,
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
  `- diagram: the drawing itself, as a diagram spec of one kind; never shown as text. Templates come first: particles (arrangement of particles in solids, liquids and gases, diffusion, dissolving), hydrograph (a storm hydrograph), timeline (dated events in order), layers (a layered structure or cross-section), cycle (a cycle of three to five steps), river (a V-shaped valley, or a meander across or from above), bar-model and number-line. A template's slots are its words and values only; code draws it. Use a template whenever it shows the idea, and the free kinds (line-graph, labelled-diagram, flow, table) only when none does. Its text is labels, not sentences: a label, annotation, interval, series name, particle caption or table header is one to three words; an axis label is a few words with its unit; a flow step is a short phrase and a flow arrow one or two words; a table cell is a short phrase; the title is one short line and the alt one sentence. A field with nothing to say is left out, never empty.`,
  "  - line-graph: an annotation marks one point of one series, at that point's own x and y (on the series' own axis), and its label names that series' feature (\"Peak rainfall\" at the tallest rainfall bar, \"Peak discharge\" at the top of the discharge line). An interval's y is in the left axis's units, below both curves' peaks. A lag time is an interval from the rainfall peak's x to the discharge peak's x.",
  "  - labelled-diagram: shapes on a canvas 100 high (100 or 160 wide). Each label's point is inside or on the shape it names; a label is 1 to 3 words, one per shape, at most 6. Particle boxes are one per state, the caption the state's name; a label on a particle box says something the caption does not (\"fixed rows\", never the state's name again).",
].join("\n");
