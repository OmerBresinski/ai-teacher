/**
 * What a writer fills to get a diagram: one JSON spec per slide, discriminated on `kind`. Code
 * draws it (`render.ts`); the model never supplies geometry beyond values and, for a
 * labelled diagram, primitives on a fixed 100-unit canvas. The limits are the ones the renderers
 * can honestly lay out at a legible size in a half-slide slot; a spec past them does not parse,
 * and a spec that does not parse draws nothing.
 */
import { z } from "zod";
import { BarChartSchema, CarrollSchema, PieSchema, VennSchema } from "./charts";
import { captionRule, LIMITS, measuredLabel } from "./limits";
import { pair } from "./pair";

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
  points: z.array(pair(finite)).min(2).max(40),
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
    /**
     * Round 8: a trend's shape only (y12 shipped "Schematic patterns: these are not the original
     * numerical results"): the axes are named, no numbers stand on them, and the points are in
     * any units the axes' min and max frame (0 to 10 is enough).
     */
    qualitative: z
      .boolean()
      .optional()
      .describe(
        "true: the shape of a trend with no real numbers; axes keep their names and show no numbers.",
      ),
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
    /**
     * chain and cycle: `steps` in order. graph (round 8, built by code from a flow's nodes and links,
     * `meaning.ts`): `steps` are the unique boxes and `links` join them (branches, loops, returns,
     * arrows out of the drawing).
     */
    layout: z.enum(["chain", "cycle", "graph"]).default("chain"),
    steps: z
      .array(
        z.object({
          label: label(LIMITS.flow.nodeChars),
          arrow: measuredLabel(LIMITS.flow.link).optional(),
        }),
      )
      .min(2)
      .max(8),
    links: z
      .array(
        z.object({
          from: z.number().int().min(0),
          to: z.union([z.number().int().min(0), z.literal("out")]),
          label: measuredLabel(LIMITS.flow.link).optional(),
        }),
      )
      .max(LIMITS.flow.links)
      .optional(),
  })
  .refine((f) => f.layout !== "cycle" || f.steps.length >= 3, "a cycle needs three steps")
  .refine(
    (f) =>
      f.layout !== "graph" ||
      (!!f.links?.length &&
        f.links.every((l) => l.from < f.steps.length && (l.to === "out" || l.to < f.steps.length))),
    "a graph's links join its boxes",
  );

// ─── labelled diagram ───────────────────────────────────────────────────────────────────────

const coord = z.number().min(0).max(160);
const pt = pair(coord);

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
    // r3-diag: apparatus (a flask, bung, tube and syringe) takes more than 12 primitives.
    shapes: z.array(Shape).min(1).max(20),
    labels: z
      .array(
        z.object({
          text: label(LIMITS.labels.chars),
          at: pt,
          /** Optional: code places the label on the side that keeps it clear when absent. */
          side: z.enum(["left", "right", "top", "bottom"]).optional(),
        }),
      )
      .max(LIMITS.labels.max)
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
    header: z.array(label(LIMITS.table.headerChars)).min(1).max(LIMITS.table.cols).optional(),
    rows: z
      .array(z.array(z.string().trim().max(LIMITS.table.cellChars)).min(1).max(LIMITS.table.cols))
      .min(1)
      .max(LIMITS.table.rows),
  })
  .refine((t) => {
    const cols = t.header?.length ?? t.rows[0]?.length;
    return t.rows.every((r) => r.length === cols);
  }, "every row has one cell per column");

// ─── templates ────────────────────────────────────────────────────────────────────
// Hand-built textbook figures: the writer picks one and fills small typed slots; code owns all
// geometry, so a template draws cleanly on every theme and slot.

const STATE = z.enum(["solid", "liquid", "gas"]);

export const ParticlesSchema = z
  .object({
    kind: z.literal("particles"),
    ...common,
    /** states: one panel per state; diffusion and dissolving: a before and an after panel. */
    show: z.enum(["states", "diffusion", "dissolving", "compare", "collision"]).default("states"),
    /**
     * compare: two or three containers side by side that differ in one thing: how many particles
     * (`count`, concentration), how many of a second kind (`extra`), how fast they move (`speed`,
     * temperature) or how big the container is (`room`, gas pressure).
     */
    panels: z
      .array(
        z.object({
          state: STATE.default("gas"),
          count: z.number().int().min(2).max(20).default(10),
          extra: z.number().int().min(0).max(12).default(0),
          speed: z.enum(["slow", "fast"]).optional(),
          /** r4: the panel's temperature or energy, any one unit across panels; motion scales with it. */
          energy: z.number().min(0).max(100000).optional(),
          room: z.enum(["small", "large"]).default("large"),
          /** Round 8: a solid lump on the panel's floor (a reactant surface, a solute lump). */
          solid: z.boolean().optional(),
          /** Round 8: a gas squashed by a piston: the lid drawn low with an inward arrow. */
          squash: z.boolean().optional(),
        }),
      )
      .min(2)
      .max(3)
      .optional(),
    /** collision: one or two panels, two particles meeting and then bouncing apart or reacting. */
    outcomes: z
      .array(z.enum(["bounces", "reacts"]))
      .min(1)
      .max(2)
      .optional(),
    states: z.array(STATE).min(1).max(3).default(["solid", "liquid", "gas"]),
    /** A name over each panel (default the state's name, or Before / After). */
    captions: z
      .array(measuredLabel(captionRule(2)))
      .max(3)
      .optional(),
    /** A short description under each panel ("fixed rows"); "" leaves that panel without one. */
    notes: z.array(z.string().trim().max(LIMITS.particles.noteChars)).max(3).optional(),
    /** Round 8: the name set on a solid lump (`panels[].solid`). */
    lump: label(LIMITS.particles.nameChars).optional(),
    /** Words on the arrow between neighbouring panels ("melting"). */
    arrows: z.array(label(24)).max(2).optional(),
    /** Movement marks: vibration in a solid, short arrows in a liquid or gas. */
    motion: z.boolean().default(false),
    /** For diffusion and dissolving: what the two colours are (a key under the panels). */
    key: pair(label(18)).optional(),
  })
  .refine(
    (p) => p.show !== "states" || new Set(p.states).size === p.states.length,
    "each state appears once, so the panels differ",
  )
  .refine((p) => p.show !== "compare" || !!p.panels, "compare needs panels")
  .refine((p) => p.show !== "collision" || !!p.outcomes, "collision needs outcomes");

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
    steps: z.array(label(LIMITS.cycle.stepChars)).min(LIMITS.cycle.min).max(LIMITS.cycle.max),
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

// ─── cubes (r4) ─────────────────────────────────────────────────────────────────────────────

/** Surface area: one large cube beside the same volume cut into `split`³ small cubes. */
export const CubesSchema = z.object({
  kind: z.literal("cubes"),
  ...common,
  /** Small cubes along each edge of the large one (2 gives 8 small cubes). */
  split: z.number().int().min(2).max(4).default(2),
  /** Over each side (default "One cube" and "8 small cubes"). */
  captions: z.array(label(24)).max(2).optional(),
  /** Under each side. */
  notes: z.array(label(28)).max(2).optional(),
  /** Count the exposed squares under each side ("24 squares exposed"). */
  areas: z.boolean().default(false),
});

// ─── equal groups and fraction shapes ───────────────────────────────────────────────
// Meaning only: the model says how many and how they are shared or cut; code draws every counter,
// ring, part and label.

export const EqualGroupsSchema = z
  .object({
    kind: z.literal("equal-groups"),
    ...common,
    total: z
      .number()
      .int()
      .min(2)
      .max(LIMITS.groups.totalMax)
      .describe("How many counters in all."),
    groups: z
      .number()
      .int()
      .min(LIMITS.groups.groupsMin)
      .max(LIMITS.groups.groupsMax)
      .describe("How many equal groups they are shared into."),
    layout: z
      .enum(["rings", "rows"])
      .default("rings")
      .describe(
        "rings: each group circled; rows: each group a row, for an array or repeated adding.",
      ),
    show_count: z
      .enum(["each", "one", "none"])
      .default("each")
      .describe("Which groups show how many they hold: each, only the first, or none."),
    unknown: z
      .boolean()
      .optional()
      .describe("true when pupils find how many are in each group: the count shows as ?."),
  })
  .strict()
  .refine((g) => g.total % g.groups === 0, "equal groups need a total the groups divide");

const FractionShape = z
  .object({
    shape: z.enum(["circle", "square", "rectangle", "bar"]).describe("The whole."),
    parts: z
      .number()
      .int()
      .min(2)
      .max(LIMITS.fractions.partsMax)
      .describe("How many equal parts the whole is cut into."),
    cut: z
      .enum(["auto", "vertical", "horizontal", "grid", "diagonal"])
      .default("auto")
      .describe(
        "How it is cut: auto, vertical strips, horizontal strips, a grid (4, 6, 8, 9 or 12 parts) or diagonals (a square or rectangle in 2 or 4). A circle is always cut into equal sectors.",
      ),
    shaded: z
      .number()
      .int()
      .min(0)
      .describe("How many parts are shaded (0 for a shape pupils shade)."),
    name: label(LIMITS.fractions.nameChars)
      .optional()
      .describe("A name set under the shape: a letter pupils are pointed to, or a fraction."),
  })
  .strict();

export const FractionShapesSchema = z
  .object({
    kind: z.literal("fraction-shapes"),
    ...common,
    shapes: z.array(FractionShape).min(1).max(LIMITS.fractions.shapes),
  })
  .strict()
  .superRefine((f, ctx) => {
    f.shapes.forEach((s, i) => {
      if (s.shaded > s.parts)
        ctx.addIssue({
          code: "custom",
          message: "more parts shaded than cut",
          path: ["shapes", i],
        });
      if (
        s.cut === "diagonal" &&
        (s.shape === "circle" || s.shape === "bar" || ![2, 4].includes(s.parts))
      )
        ctx.addIssue({
          code: "custom",
          message: "diagonals cut a square or rectangle into 2 or 4",
          path: ["shapes", i, "cut"],
        });
      if (s.cut === "grid" && (s.shape === "circle" || ![4, 6, 8, 9, 12].includes(s.parts)))
        ctx.addIssue({
          code: "custom",
          message: "a grid cuts a square or rectangle into 4, 6, 8, 9 or 12",
          path: ["shapes", i, "cut"],
        });
      if (s.shape === "circle" && s.cut !== "auto")
        ctx.addIssue({
          code: "custom",
          message: "a circle is cut into equal sectors (cut auto)",
          path: ["shapes", i, "cut"],
        });
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
  CubesSchema,
  EqualGroupsSchema,
  FractionShapesSchema,
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
export type Cubes = z.infer<typeof CubesSchema>;
export type EqualGroups = z.infer<typeof EqualGroupsSchema>;
export type FractionShapes = z.infer<typeof FractionShapesSchema>;
export type { BarChart, Carroll, Pie, Venn } from "./charts";

/** The hand-built templates: code owns their geometry; the picture ladder tries them first. */
export const TEMPLATE_KINDS = [
  "particles",
  "hydrograph",
  "timeline",
  "layers",
  "cycle",
  "river",
  "bar-model",
  "number-line",
  "cubes",
  "equal-groups",
  "fraction-shapes",
] as const;

/** Every kind, read off the union (one list, so a new kind cannot be left out). */
export const DIAGRAM_KINDS: DiagramKind[] = (
  DiagramSpecSchema.options as unknown as { shape: { kind: { value: DiagramKind } } }[]
).map((o) => o.shape.kind.value);
