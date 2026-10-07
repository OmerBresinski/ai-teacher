/**
 * Round 8: the diagram spec as the drawer model writes it, meaning only (DIAGRAM-SOURCE B/C2).
 * The model gives quantities, roles, states, relations and outcomes; code derives every count,
 * position, heading and arrow word that follows (`fromMeaning`), and draws the internal spec
 * (`schema.ts`). Each text sits inside the item it names, never in a parallel array.
 *
 * Kinds with a meaning form here: particles, flow, bar-model, timeline. equal-groups and
 * fraction-shapes are meaning-only in `schema.ts` already. Every other kind is sent as it is.
 * Saved specs in the old (internal) form still parse and draw: `fromMeaning` only converts a spec
 * that parses as its meaning form, and each meaning form is strict, so an old spec never does.
 */
import { z } from "zod";
import { captionRule, fitsMeasured, LIMITS, measuredLabel } from "./limits";
import {
  type DiagramKind,
  DiagramSpecSchema,
  EqualGroupsSchema,
  FractionShapesSchema,
} from "./schema";

const label = (max: number) => z.string().trim().min(1).max(max);
const common = {
  alt: label(200).describe("One sentence a screen reader hears: what the drawing shows."),
  title: label(40)
    .optional()
    .describe("A short caption over the drawing, only when it adds something."),
};
const P = LIMITS.particles;

// ─── particles ──────────────────────────────────────────────────────────────────────────────

const STATE = z.enum(["solid", "liquid", "gas"]);

const PanelMeaning = z
  .object({
    state: STATE.describe("The state of the particles in this panel."),
    caption: measuredLabel(captionRule(2))
      .optional()
      .describe(
        "The heading over this panel. Left out, code writes it: the state's name, Before/After, or the collision's outcome. Ignored when names is letters.",
      ),
    note: label(P.noteChars).optional().describe("A short description under this panel only."),
    count: z.number().int().min(2).max(20).optional().describe("compare: how many particles."),
    extra: z
      .number()
      .int()
      .min(0)
      .max(12)
      .optional()
      .describe("compare: how many particles of a second kind are mixed in."),
    speed: z.enum(["slow", "fast"]).optional().describe("compare: how fast the particles move."),
    energy: z
      .number()
      .min(0)
      .max(100000)
      .optional()
      .describe("compare: this panel's temperature or energy, one unit across panels."),
    room: z
      .enum(["small", "large"])
      .optional()
      .describe("A gas only: the container's size (small = compressed)."),
    solid: z
      .boolean()
      .optional()
      .describe("true draws a solid lump on the floor with the particles around it (a surface)."),
    squash: z.boolean().optional().describe("A gas only: true draws a piston pushing in."),
    outcome: z
      .enum(["bounces", "reacts"])
      .optional()
      .describe("collision: whether the two particles bounce apart or react."),
    impact: z
      .enum(["low", "high"])
      .optional()
      .describe("collision: whether they meet with low or high energy."),
  })
  .strict();

export const ParticlesMeaningSchema = z
  .object({
    kind: z.literal("particles"),
    ...common,
    show: z
      .enum(["states", "change", "diffusion", "dissolving", "compare", "collision"])
      .describe(
        "states: one panel per state. change: panels in order, code names each arrow (melting, freezing, evaporating, condensing, subliming). diffusion and dissolving: a before and an after panel. compare: panels of one state that differ. collision: particles meeting, each panel with an outcome.",
      ),
    panels: z.array(PanelMeaning).min(1).max(P.panels),
    names: z
      .enum(["shown", "letters"])
      .optional()
      .describe(
        "letters: panels are headed A, B, C and never named, for a slide that asks pupils to name them.",
      ),
    energy: z
      .enum(["in", "out"])
      .optional()
      .describe("change: energy taken in or given out, written under the arrows."),
    motion: z.boolean().optional().describe("Draw movement marks."),
    names_of: z
      .object({
        particle: label(P.nameChars).optional().describe("What the main particles are."),
        extra: label(P.nameChars).optional().describe("What the second kind of particle is."),
        solid: label(P.nameChars).optional().describe("What the solid lump is."),
      })
      .strict()
      .optional()
      .describe("Names for the parts drawn; each only when that part is drawn."),
  })
  .strict()
  .superRefine((s, ctx) => {
    const issue = (message: string, path: (string | number)[] = []) =>
      ctx.addIssue({ code: "custom", message, path });
    const states = s.panels.map((p) => p.state);
    if (s.show === "states" && new Set(states).size !== states.length)
      issue("states: each state once");
    if (s.show === "change") {
      if (s.panels.length < 2) issue("change: at least two panels");
      states.forEach((st, i) => {
        if (i && st === states[i - 1]) issue("change: each panel a different state", ["panels", i]);
      });
    }
    if (s.show === "compare") {
      if (s.panels.length < 2) issue("compare: two or three panels");
      if (new Set(states).size !== 1) issue("compare: every panel the same state");
      const sig = (p: (typeof s.panels)[number]) =>
        JSON.stringify([p.count, p.extra, p.speed, p.energy, p.room, p.solid, p.squash]);
      if (new Set(s.panels.map(sig)).size < 2) issue("compare: the panels differ in something");
    }
    if (s.show === "collision")
      s.panels.forEach((p, i) => {
        if (!p.outcome) issue("collision: each panel has an outcome", ["panels", i]);
      });
    s.panels.forEach((p, i) => {
      if ((p.room || p.squash) && p.state !== "gas")
        issue("room and squash belong to a gas", ["panels", i]);
    });
    // A caption stands on two lines of its own panel, whose width the panel count sets.
    if (s.names !== "letters")
      s.panels.forEach((p, i) => {
        if (p.caption && !fitsMeasured(p.caption, captionRule(s.panels.length)))
          issue(
            `too wide for ${s.panels.length} panels: two lines of ${captionRule(s.panels.length).width} points`,
            ["panels", i, "caption"],
          );
      });
    if (s.names_of?.extra && !s.panels.some((p) => (p.extra ?? 0) > 0))
      issue("names_of.extra names particles no panel draws", ["names_of"]);
    if (s.names_of?.solid && !s.panels.some((p) => p.solid))
      issue("names_of.solid names a lump no panel draws", ["names_of"]);
    if ((s.show === "diffusion" || s.show === "dissolving") && s.panels.length !== 2)
      issue(`${s.show}: a before and an after panel`);
  });

/** The arrow word for a change of state, from the two states (code's, never the model's). */
export const CHANGE_WORD: Record<string, string> = {
  "solid>liquid": "melting",
  "liquid>solid": "freezing",
  "liquid>gas": "evaporating",
  "gas>liquid": "condensing",
  "solid>gas": "subliming",
  "gas>solid": "depositing",
};
const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

function particlesFrom(m: z.infer<typeof ParticlesMeaningSchema>): unknown {
  const letters = m.names === "letters";
  const n = m.panels.length;
  const heading = (i: number, fallback: string) =>
    letters ? String.fromCharCode(65 + i) : (m.panels[i]?.caption ?? fallback);
  const notes = m.panels.map((p) => p.note ?? "");
  const withNotes = notes.some(Boolean) ? { notes } : {};
  const named = m.names_of;
  const key: [string, string] | undefined =
    named?.extra && m.panels.some((p) => (p.extra ?? 0) > 0)
      ? [named.particle ?? "Particle", named.extra]
      : undefined;
  const base = {
    kind: "particles",
    alt: m.alt,
    ...(m.title ? { title: m.title } : {}),
    ...(m.motion !== undefined ? { motion: m.motion } : {}),
    ...(key ? { key } : {}),
    ...(named?.solid ? { lump: named.solid } : {}),
  };
  const detailed = m.panels.some(
    (p) =>
      p.count !== undefined ||
      p.extra !== undefined ||
      p.speed ||
      p.energy !== undefined ||
      p.room ||
      p.solid ||
      p.squash,
  );
  if (m.show === "collision") {
    return {
      ...base,
      show: "collision",
      outcomes: m.panels.map((p) => p.outcome ?? "bounces"),
      captions: m.panels.map((p, i) =>
        heading(i, p.outcome === "reacts" ? "Reaction" : "Bounce apart"),
      ),
      notes: m.panels.map(
        (p) => p.note ?? (p.outcome === "reacts" ? "Product forms" : "No product"),
      ),
    };
  }
  if (m.show === "compare" || ((m.show === "states" || m.show === "change") && detailed)) {
    const panels = m.panels.map((p) => ({
      state: p.state,
      count: p.count ?? 10,
      extra: p.extra ?? 0,
      ...(p.speed ? { speed: p.speed } : {}),
      ...(p.energy !== undefined ? { energy: p.energy } : {}),
      room: p.squash ? "small" : (p.room ?? "large"),
      ...(p.solid ? { solid: true } : {}),
      ...(p.squash ? { squash: true } : {}),
    }));
    const arrows = m.show === "change" ? changeWords(m) : undefined;
    return {
      ...base,
      show: "compare",
      panels: n === 1 ? [panels[0], { ...panels[0] }] : panels,
      captions: m.panels.map((p, i) => heading(i, cap(p.state))).slice(0, Math.max(2, n)),
      ...withNotes,
      ...(arrows ? { arrows } : {}),
    };
  }
  if (m.show === "states" || m.show === "change") {
    const arrows = m.show === "change" ? changeWords(m) : undefined;
    return {
      ...base,
      show: "states",
      states: m.panels.map((p) => p.state),
      captions: m.panels.map((p, i) => heading(i, cap(p.state))),
      ...withNotes,
      ...(arrows ? { arrows } : {}),
    };
  }
  // diffusion / dissolving: before and after.
  return {
    ...base,
    show: m.show,
    captions: m.panels.map((_, i) => heading(i, i === 0 ? "Before" : "After")),
    ...withNotes,
    ...(key ? {} : named?.particle && named?.extra ? { key: [named.particle, named.extra] } : {}),
  };
}

function changeWords(m: z.infer<typeof ParticlesMeaningSchema>): string[] {
  const e = m.energy === "in" ? ": energy in" : m.energy === "out" ? ": energy out" : "";
  return m.panels.slice(1).map((p, i) => {
    const w = CHANGE_WORD[`${m.panels[i]?.state}>${p.state}`] ?? "changes";
    return `${w}${e}`;
  });
}

// ─── flow ───────────────────────────────────────────────────────────────────────────────────

const F = LIMITS.flow;

export const FlowMeaningSchema = z
  .object({
    kind: z.literal("flow"),
    ...common,
    nodes: z
      .array(label(F.nodeChars))
      .min(2)
      .max(F.nodes)
      .describe(
        "Each box once: a short phrase or one equation. A box the flow returns to is still listed once.",
      ),
    links: z
      .array(
        z
          .object({
            from: z
              .number()
              .int()
              .min(0)
              .describe("The box the arrow leaves (0-based index into nodes)."),
            to: z
              .union([z.number().int().min(0), z.literal("out")])
              .describe(
                'The box the arrow reaches; the same box as from is a loop; "out" is an arrow leaving the drawing (lost, forgotten, removed).',
              ),
            label: measuredLabel(F.link)
              .optional()
              .describe("The change or cause along the arrow, one or two words."),
          })
          .strict(),
      )
      .min(1)
      .max(F.links)
      .describe(
        "Arrows between boxes. Code lays out a chain, a branch, a cycle or a model with loops from these.",
      ),
  })
  .strict()
  .superRefine((f, ctx) => {
    const k = f.nodes.length;
    const low = f.nodes.map((t) => t.toLowerCase());
    if (new Set(low).size !== k)
      ctx.addIssue({ code: "custom", message: "each box appears once", path: ["nodes"] });
    const seen = new Set<number>();
    const loops = new Set<number>();
    f.links.forEach((l, i) => {
      if (l.from >= k || (l.to !== "out" && l.to >= k))
        ctx.addIssue({
          code: "custom",
          message: "a link names a box that is not there",
          path: ["links", i],
        });
      seen.add(l.from);
      if (l.to !== "out") seen.add(l.to);
      if (l.to === l.from) {
        if (loops.has(l.from))
          ctx.addIssue({ code: "custom", message: "one loop per box", path: ["links", i] });
        loops.add(l.from);
      }
    });
    if (seen.size < k)
      ctx.addIssue({ code: "custom", message: "every box is on a link", path: ["links"] });
  });

type FlowM = z.infer<typeof FlowMeaningSchema>;

/** The flow's shape read from its links: a path, a ring, or anything else (a graph). */
export function flowShape(
  f: FlowM,
): { kind: "chain" | "cycle"; order: number[] } | { kind: "graph" } {
  const k = f.nodes.length;
  const inner = f.links.filter((l) => l.to !== "out" && l.to !== l.from) as {
    from: number;
    to: number;
  }[];
  if (inner.length !== f.links.length) return { kind: "graph" };
  const outs = Array(k).fill(0);
  const ins = Array(k).fill(0);
  for (const l of inner) {
    outs[l.from]++;
    ins[l.to]++;
  }
  if (outs.some((v) => v > 1) || ins.some((v) => v > 1)) return { kind: "graph" };
  const next = new Map(inner.map((l) => [l.from, l.to]));
  const walk = (start: number) => {
    const order = [start];
    while (order.length <= k) {
      const nx = next.get(order[order.length - 1] as number);
      if (nx === undefined || nx === start) break;
      order.push(nx);
    }
    return order;
  };
  if (inner.length === k - 1) {
    const start = ins.indexOf(0);
    const order = walk(start);
    if (order.length === k) return { kind: "chain", order };
  }
  if (inner.length === k && k >= 3) {
    const order = walk(0);
    if (order.length === k && next.get(order[k - 1] as number) === 0)
      return { kind: "cycle", order };
  }
  return { kind: "graph" };
}

function flowFrom(f: FlowM): unknown {
  const base = { kind: "flow", alt: f.alt, ...(f.title ? { title: f.title } : {}) };
  const shape = flowShape(f);
  const linkLabel = (a: number, b: number) =>
    f.links.find((l) => l.from === a && l.to === b)?.label;
  if (shape.kind === "chain" || shape.kind === "cycle") {
    const o = shape.order;
    return {
      ...base,
      layout: shape.kind,
      steps: o.map((i, j) => {
        const nx = shape.kind === "cycle" ? o[(j + 1) % o.length] : o[j + 1];
        const arrow = nx === undefined ? undefined : linkLabel(i, nx);
        return { label: f.nodes[i], ...(arrow ? { arrow } : {}) };
      }),
    };
  }
  return {
    ...base,
    layout: "graph",
    steps: f.nodes.map((label) => ({ label })),
    links: f.links,
  };
}

// ─── bar model ──────────────────────────────────────────────────────────────────────────────

const B = LIMITS.bars;

const BarMeaning = z
  .object({
    label: label(B.labelChars).optional().describe("A name to the left of the bar (whose share)."),
    whole: z
      .number()
      .positive()
      .finite()
      .optional()
      .describe("The bar's whole quantity; code splits it into equal parts and labels them."),
    parts: z
      .number()
      .int()
      .min(1)
      .max(B.parts)
      .optional()
      .describe("How many equal parts the whole is split into."),
    values: z
      .array(z.number().positive().finite())
      .min(1)
      .max(B.parts)
      .optional()
      .describe("Unequal parts: each part's quantity, in order (instead of whole and parts)."),
    shaded: z
      .number()
      .int()
      .min(0)
      .max(B.parts)
      .optional()
      .describe("How many parts, from the left, are shaded."),
    unknown: z
      .enum(["none", "whole", "each"])
      .optional()
      .describe("What pupils find: whole shows the total as ?, each shows every part as ?."),
    unit: label(B.unitChars).optional().describe('The unit: "£", "cm", "kg" (code places it).'),
  })
  .strict()
  .refine(
    (b) =>
      b.values
        ? b.whole === undefined && b.parts === undefined
        : b.whole !== undefined && b.parts !== undefined,
    "give whole and parts, or values",
  )
  .refine(
    (b) => (b.shaded ?? 0) <= (b.values?.length ?? b.parts ?? 0),
    "more parts shaded than the bar has",
  );

export const BarModelMeaningSchema = z
  .object({
    kind: z.literal("bar-model"),
    ...common,
    bars: z.array(BarMeaning).min(1).max(B.bars),
    combined: z.boolean().optional().describe("true labels the total of all the bars together."),
  })
  .strict();

const fmt = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r);
};
const withUnit = (v: string, unit?: string) =>
  !unit ? v : /^[£$€¥]$/.test(unit) ? `${unit}${v}` : `${v} ${unit}`;

function barFrom(m: z.infer<typeof BarModelMeaningSchema>): unknown {
  let all = 0;
  const bars = m.bars.map((b) => {
    const values =
      b.values ?? Array(b.parts as number).fill((b.whole as number) / (b.parts as number));
    const sum = values.reduce((a, v) => a + v, 0);
    all += sum;
    return {
      ...(b.label ? { label: b.label } : {}),
      parts: values.map((v, i) => ({
        value: v,
        label: b.unknown === "each" ? "?" : withUnit(fmt(v), b.unit),
        ...(i < (b.shaded ?? 0) ? { shaded: true } : {}),
      })),
      total: b.unknown === "whole" ? "?" : withUnit(fmt(sum), b.unit),
    };
  });
  const unit = m.bars[0]?.unit;
  return {
    kind: "bar-model",
    alt: m.alt,
    ...(m.title ? { title: m.title } : {}),
    bars,
    ...(m.combined && m.bars.length > 1 ? { combined: withUnit(fmt(all), unit) } : {}),
  };
}

// ─── timeline ───────────────────────────────────────────────────────────────────────────────

const T = LIMITS.timeline;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * A date as a point in time in years (BC negative; a month and a day add their fraction), or
 * undefined when it names no year. "January 1923" < "November 1923"; "55 BC" < "AD 43".
 */
export function timeOf(date: string): number | undefined {
  const bc = /\b(\d{1,4})\s*(BCE|BC)\b/i.exec(date);
  const ad = /\b(AD|CE)\s*(\d{1,4})\b|\b(\d{1,4})\s*(AD|CE)\b/i.exec(date);
  const long = /\b(\d{3,4})\b/.exec(date);
  const lone = /^\s*(\d{1,4})\s*$/.exec(date);
  const year = bc
    ? -Number(bc[1])
    : ad
      ? Number(ad[2] ?? ad[3])
      : long
        ? Number(long[1])
        : lone
          ? Number(lone[1])
          : undefined;
  if (year === undefined) return undefined;
  const low = date.toLowerCase();
  const mi = MONTHS.findIndex((mo) => new RegExp(`\\b${mo}`).test(low));
  const dayHit =
    mi >= 0 ? /\b(\d{1,2})(st|nd|rd|th)?\b/.exec(date.replace(String(Math.abs(year)), "")) : null;
  const day = dayHit ? Math.min(31, Number(dayHit[1])) : 1;
  const frac = mi >= 0 ? (mi + (day - 1) / 31) / 12 : 0;
  return year + frac;
}

export const TimelineMeaningSchema = z
  .object({
    kind: z.literal("timeline"),
    ...common,
    events: z
      .array(
        z
          .object({
            date: label(T.dateChars).describe(
              'The date as pupils read it ("AD 43", "November 1923").',
            ),
            text: label(T.textChars).describe("What happened, in a few words."),
          })
          .strict(),
      )
      .min(T.min)
      .max(T.max)
      .describe("Events; code sorts them by date and spaces them by the time between them."),
    period: z
      .object({
        from: label(T.dateChars).describe("The date the span starts, as written on an event."),
        to: label(T.dateChars).describe("The date the span ends, as written on an event."),
        label: label(T.periodChars).describe("What the span is."),
      })
      .strict()
      .optional()
      .describe("A highlighted span between two of the events' dates."),
  })
  .strict();

function timelineFrom(m: z.infer<typeof TimelineMeaningSchema>): unknown {
  const ts = m.events.map((e) => timeOf(e.date));
  const events = ts.every((t) => t !== undefined)
    ? m.events
        .map((e, i) => ({ e, t: ts[i] as number, i }))
        .sort((a, b) => a.t - b.t || a.i - b.i)
        .map((x) => x.e)
    : m.events;
  const at = (d: string) => {
    const exact = events.findIndex((e) => e.date.trim().toLowerCase() === d.trim().toLowerCase());
    if (exact >= 0) return exact + 1;
    const t = timeOf(d);
    if (t === undefined) return 0;
    const near = events
      .map((e, i) => ({ i, d: Math.abs((timeOf(e.date) ?? Number.POSITIVE_INFINITY) - t) }))
      .sort((a, b) => a.d - b.d)[0];
    return near && near.d < 0.5 ? near.i + 1 : 0;
  };
  const from = m.period ? at(m.period.from) : 0;
  const to = m.period ? at(m.period.to) : 0;
  return {
    kind: "timeline",
    alt: m.alt,
    ...(m.title ? { title: m.title } : {}),
    events,
    ...(m.period && from && to > from ? { period: { from, to, label: m.period.label } } : {}),
  };
}

// ─── the meaning forms ──────────────────────────────────────────────────────────────────────

/** The kinds whose drawer form differs from the internal form. */
export const MEANING_SCHEMAS = {
  particles: ParticlesMeaningSchema,
  flow: FlowMeaningSchema,
  "bar-model": BarModelMeaningSchema,
  timeline: TimelineMeaningSchema,
} as const;

/** The schema the drawer model fills for `kind`: its meaning form, else the drawn form. */
export function drawerSchema(kind: DiagramKind): z.ZodType | undefined {
  if (kind in MEANING_SCHEMAS) return MEANING_SCHEMAS[kind as keyof typeof MEANING_SCHEMAS];
  if (kind === "equal-groups") return EqualGroupsSchema;
  if (kind === "fraction-shapes") return FractionShapesSchema;
  return (DiagramSpecSchema.options as unknown as { shape: { kind: { value: string } } }[]).find(
    (o) => o.shape.kind.value === kind,
  ) as unknown as z.ZodType | undefined;
}

/**
 * `spec` in the form code draws: a spec that parses as its kind's meaning form is converted (code
 * derives counts, headings, arrow words, labels, order); anything else is returned unchanged.
 * Never throws.
 */
export function fromMeaning(spec: unknown): unknown {
  try {
    const kind = (spec as { kind?: unknown })?.kind;
    if (typeof kind !== "string" || !(kind in MEANING_SCHEMAS)) return spec;
    const r = MEANING_SCHEMAS[kind as keyof typeof MEANING_SCHEMAS].safeParse(spec);
    if (!r.success) return spec;
    const m = r.data as never;
    switch (kind) {
      case "particles":
        return particlesFrom(m);
      case "flow":
        return flowFrom(m);
      case "bar-model":
        return barFrom(m);
      case "timeline":
        return timelineFrom(m);
    }
  } catch {}
  return spec;
}

/** Why a meaning-form spec does not stand, as `path: message` lines ("" when it parses). */
export function meaningFaults(spec: unknown): string {
  const kind = (spec as { kind?: unknown })?.kind;
  const s = typeof kind === "string" ? drawerSchema(kind as DiagramKind) : undefined;
  if (!s) return "";
  const r = s.safeParse(spec);
  if (r.success) return "";
  return r.error.issues
    .slice(0, 4)
    .map((i) => `${i.path.map(String).join(".") || "spec"}: ${i.message}`)
    .join("; ");
}

/**
 * An equal-groups spec as the writer asked for it: a request whose labels give the per-group count
 * (y2's "3", "3", "3", "3" for a quarter of 12) shows that count on every group, never "?" or none.
 * Anything else is returned unchanged. Never throws.
 */
export function withAskedCounts(spec: unknown, labels: readonly string[]): unknown {
  const s = spec as { kind?: unknown; total?: unknown; groups?: unknown };
  if (s?.kind !== "equal-groups" || typeof s.total !== "number" || typeof s.groups !== "number")
    return spec;
  if (!s.groups || s.total % s.groups) return spec;
  const per = String(s.total / s.groups);
  if (!labels.some((l) => l.trim() === per)) return spec;
  const { unknown: _u, ...rest } = spec as Record<string, unknown>;
  return { ...rest, show_count: "each" };
}
