/**
 * Generator-side spec normalisation for the two core drawings a lesson leans on (round H): the
 * storm hydrograph (a line graph with rainfall bars) and the particle arrangement (a labelled
 * diagram of particle boxes). The writer says what to show; code decides where it goes, so the
 * drawing passes the geometry gate on every theme for a typical spec.
 *
 * - Hydrograph: every lag interval sits in the band above the plot (never across the curve), the
 *   two peaks are labelled and the lag between them drawn when the writer left one out.
 * - Particle arrangement: equal boxes evenly spaced in one row, one short description per box in
 *   the slot under its caption, arrows only between neighbouring boxes.
 *
 * Pure. A spec that is not one of these, or does not parse, comes back unchanged.
 */
import type { EnergyProfileValues } from "../figures/energy-profile";
import { resolveLabels } from "./labelled";
import {
  type DiagramSpec,
  DiagramSpecSchema,
  type LabelledDiagram,
  type LineGraph,
} from "./schema";

type Pt = [number, number];

/**
 * Round I, template first: a free-drawn storm hydrograph or particle row becomes its hand-built
 * template, carrying the writer's numbers and words; undefined when it cannot.
 */
export function asTemplate(s: DiagramSpec): DiagramSpec | undefined {
  // Only the plain storm hydrograph (rain and discharge); one with a threshold keeps its drawing.
  if (s.kind === "line-graph" && isHydrograph(s) && s.series.length === 2) {
    const rain = s.series.find((x) => x.style === "bars");
    const flow = s.series.find((x) => x.style !== "bars");
    const rp = rain ? peak(rain.points) : undefined;
    const fp = flow ? peak(flow.points) : undefined;
    const base = flow?.points[0]?.[1];
    const lag = rp && fp && fp[0] > rp[0] ? fp[0] - rp[0] : undefined;
    const span = s.x.max - s.x.min;
    const t: DiagramSpec = {
      kind: "hydrograph",
      alt: s.alt,
      ...(s.title ? { title: s.title } : {}),
      shape: lag !== undefined && lag / span > 0.3 ? "gentle" : "flashy",
      values: {
        ...(rp && rp[1] > 0 ? { peakRainfall: rp[1] } : {}),
        ...(fp && fp[1] > 0 ? { peakDischarge: fp[1] } : {}),
        ...(base !== undefined && fp && base >= 0 && base < fp[1] ? { baseFlow: base } : {}),
        ...(lag ? { lagHours: lag } : {}),
      },
    };
    const r = DiagramSpecSchema.safeParse(t);
    return r.success ? r.data : undefined;
  }
  if (s.kind === "labelled-diagram" && isParticleRow(s)) {
    const boxes = s.shapes
      .flatMap((sh, i) => (sh.type === "particles" ? [{ sh, i }] : []))
      .sort((a, b) => a.sh.x - b.sh.x);
    const states = boxes.map((b) => b.sh.arrangement);
    if (new Set(states).size !== states.length) return undefined;
    const own = (i: number) =>
      s.labels.find((l) => resolveLabels({ ...s, labels: [l] })[0]?.target === i)?.text;
    const notes = boxes.map((b) => own(b.i));
    const caps = boxes.map((b) => b.sh.caption);
    const t = {
      kind: "particles",
      alt: s.alt,
      ...(s.title ? { title: s.title } : {}),
      states,
      ...(caps.every(Boolean) ? { captions: caps } : {}),
      ...(notes.every(Boolean) ? { notes } : {}),
      ...(s.shapes.some((sh) => sh.type === "arrow") ? {} : {}),
    };
    const r = DiagramSpecSchema.safeParse(t);
    return r.success ? r.data : undefined;
  }
  return undefined;
}

/**
 * DIAGRAM-AUDIT #6: a series named as a tangent with at most three points on one straight line is
 * a guide, not data: drawn in the tangent style (thin, dashed, no legend entry), whatever the
 * writer set. Both real tangent graphs were drawn as a third data line with a "Tangent" legend.
 */
export function withTangents(g: LineGraph): LineGraph {
  const straight = (p: Pt[]) => {
    if (p.length === 2) return true;
    const [a, b, c] = p as [Pt, Pt, Pt];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const scale = Math.hypot(c[0] - a[0], c[1] - a[1]) ** 2 || 1;
    return Math.abs(cross) / scale < 1e-3;
  };
  const series = g.series.map((s) =>
    s.style !== "tangent" &&
    /tangent/i.test(s.label ?? "") &&
    s.points.length <= 3 &&
    straight(s.points as Pt[])
      ? { ...s, style: "tangent" as const }
      : s,
  );
  return series.some((s, i) => s !== g.series[i]) ? { ...g, series } : g;
}

type Hump = { first: number; last: number; top: number };
/** A curve's two ends and its interior peak (above both ends), or undefined when it has none. */
function humpOf(pts: Pt[]): Hump | undefined {
  const ys = pts.map((p) => p[1]);
  const top = Math.max(...ys);
  const at = ys.indexOf(top);
  const first = ys[0] as number;
  const last = ys[ys.length - 1] as number;
  if (at <= 0 || at >= ys.length - 1 || top <= Math.max(first, last)) return undefined;
  return { first, last, top };
}

/**
 * DIAGRAM-AUDIT #4: a line graph that is an energy profile (x is the reaction's progress, one
 * curve rising from the reactants' level to an interior peak and down to the products') as the
 * `energy-profile` figure's values, which draws it as a textbook curve with Ea and ΔH. Undefined
 * for anything else, and for two profiles (catalysed against uncatalysed: the figure draws one).
 */
export function energyProfileOf(spec: unknown): EnergyProfileValues | undefined {
  const r = DiagramSpecSchema.safeParse(spec);
  if (!r.success || r.data.kind !== "line-graph") return undefined;
  const g = r.data;
  if (!/progress|reaction|pathway/i.test(g.x.label) || !/energy/i.test(g.y.label)) return undefined;
  const curves = g.series.filter((s) => s.style === "line");
  if (curves.length < 1 || curves.length > 2 || g.series.length !== curves.length) return undefined;
  const humps = curves.map((c) => humpOf(c.points as Pt[]));
  if (humps.some((h) => !h)) return undefined;
  // Two profiles: the same two levels (within a tenth of the span), the lower peak catalysed.
  const order = humps
    .map((_, i) => i)
    .sort((a, b) => (humps[b] as Hump).top - (humps[a] as Hump).top);
  const main = humps[order[0] as number] as Hump;
  const other = order.length > 1 ? (humps[order[1] as number] as Hump) : undefined;
  const tol = 0.1 * (g.y.max - g.y.min);
  if (
    other &&
    (Math.abs(other.first - main.first) > tol ||
      Math.abs(other.last - main.last) > tol ||
      other.top >= main.top)
  )
    return undefined;
  const pts = (curves[order[0] as number] as LineGraph["series"][number]).points as Pt[];
  const ys = pts.map((p) => p[1]);
  const top = Math.max(...ys);
  const at = ys.indexOf(top);
  const first = ys[0] as number;
  const last = ys[ys.length - 1] as number;
  if (at <= 0 || at >= ys.length - 1 || top <= Math.max(first, last)) return undefined;
  const near = (x: number) =>
    g.annotations.find((a) => Math.abs(a.x - x) <= 0.15 * (g.x.max - g.x.min))?.label;
  const x0 = (pts[0] as Pt)[0];
  const x1 = (pts[pts.length - 1] as Pt)[0];
  const catLabel = other ? curves[order[1] as number]?.label : undefined;
  return {
    reactants: near(x0) ?? "Reactants",
    products: near(x1) ?? "Products",
    activationEnergy: top - first,
    energyChange: last - first,
    ...(other
      ? {
          catalysedActivationEnergy: other.top - first,
          ...(catLabel && catLabel.length <= 24 ? { catalysedLabel: catLabel } : {}),
        }
      : {}),
    energyAxis: g.y.label,
    progressAxis: g.x.label,
  };
}

/** `spec` with the core kinds' geometry decided in code; anything else as it came. */
export function normaliseDiagram(spec: unknown): unknown {
  const r = DiagramSpecSchema.safeParse(spec);
  if (!r.success) return spec;
  const s0 = r.data;
  const s = s0.kind === "line-graph" ? withTangents(s0) : s0;
  const tpl = asTemplate(s);
  if (tpl) return tpl;
  const out: DiagramSpec | undefined =
    s.kind === "line-graph" && isHydrograph(s)
      ? normaliseHydrograph(s)
      : s.kind === "labelled-diagram" && isParticleRow(s)
        ? normaliseParticles(s)
        : undefined;
  if (!out) return s === s0 ? spec : s;
  return DiagramSpecSchema.safeParse(out).success ? out : spec;
}

// ─── hydrograph ─────────────────────────────────────────────────────────────────────────────

/** A line graph with rainfall bars and a discharge line: a storm hydrograph. */
export function isHydrograph(g: LineGraph): boolean {
  return g.series.some((s) => s.style === "bars") && g.series.some((s) => s.style !== "bars");
}

/** A round step for a span (1, 2 or 5 times a power of ten, about five ticks). */
const niceStep = (span: number) => {
  const raw = span / 5;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
};

const peak = (pts: Pt[]): Pt | undefined =>
  pts.reduce<Pt | undefined>((b, p) => (!b || p[1] > b[1] ? p : b), undefined);

function normaliseHydrograph(g: LineGraph): LineGraph {
  const span = g.x.max - g.x.min;
  const near = (a: number, b: number) => Math.abs(a - b) <= span * 0.06;
  const rain = g.series.find((s) => s.style === "bars");
  const flow = g.series.find((s) => s.style !== "bars" && s.points.length > 2) ?? undefined;
  const annotations = [...g.annotations];
  const rainPeak = rain ? peak(rain.points) : undefined;
  const flowPeak = flow ? peak(flow.points) : undefined;
  const yIn = (v: number) => v >= g.y.min && v <= g.y.max;
  if (flowPeak && annotations.length < 4 && !annotations.some((a) => near(a.x, flowPeak[0]))) {
    const v = flow?.axis === "right" ? undefined : flowPeak[1];
    if (v !== undefined && yIn(v))
      annotations.push({ x: flowPeak[0], y: v, label: "Peak discharge" });
  }
  // A rainfall peak on the right axis is named in its own units; the schema keeps every
  // annotation inside the left axis, so one whose value is not is left to the legend.
  if (rainPeak && annotations.length < 4 && !annotations.some((a) => near(a.x, rainPeak[0]))) {
    if (yIn(rainPeak[1]))
      annotations.push({ x: rainPeak[0], y: rainPeak[1], label: "Peak rainfall" });
  }
  // Every interval in the band above the plot: set at a y, its label met the curve's labels.
  let intervals = g.intervals.map(({ y: _y, ...v }) => v);
  if (
    intervals.length === 0 &&
    rainPeak &&
    flowPeak &&
    flowPeak[0] > rainPeak[0] &&
    !g.segments.some((s) => /lag/i.test(s.label))
  ) {
    intervals = [{ from: rainPeak[0], to: flowPeak[0], label: "Lag time" }];
  }
  // Headroom over both peaks, so each peak's label sits above it inside the plot: an axis whose
  // top is within a fifth of its span of its peak gains steps until it is not.
  const roomy = <A extends LineGraph["y"]>(a: A, top: number | undefined): A => {
    if (top === undefined || !(top > a.min)) return a;
    const step = a.step ?? niceStep(a.max - a.min);
    let max = a.max;
    while (max - top < 0.2 * (max - a.min) && max < top * 3) max += step;
    return { ...a, max };
  };
  const leftTop = Math.max(
    ...g.series.filter((s) => s.axis !== "right").flatMap((s) => s.points.map((p) => p[1])),
  );
  const rightTop = g.y2
    ? Math.max(
        ...g.series.filter((s) => s.axis === "right").flatMap((s) => s.points.map((p) => p[1])),
      )
    : undefined;
  const y = roomy(g.y, Number.isFinite(leftTop) ? leftTop : undefined);
  const y2 = g.y2
    ? roomy(g.y2, rightTop !== undefined && Number.isFinite(rightTop) ? rightTop : undefined)
    : undefined;
  // With a second axis and one curve on each, the axis titles name both: no legend (its row was
  // the plot's height). A threshold line keeps its name, drawn on the line.
  const flat = (s: LineGraph["series"][number]) =>
    s.style !== "bars" && s.points.length === 2 && s.points[0]?.[1] === s.points[1]?.[1];
  const curves = g.series.filter((s) => !flat(s));
  const onePerAxis =
    !!g.y2 &&
    curves.filter((s) => s.axis === "right").length === 1 &&
    curves.filter((s) => s.axis !== "right").length === 1;
  const series = onePerAxis
    ? g.series.map((s) => (flat(s) ? s : { ...s, label: undefined }))
    : g.series;
  return { ...g, y, ...(y2 ? { y2 } : {}), series, annotations, intervals };
}

// ─── particle arrangement ───────────────────────────────────────────────────────────────────

type Particles = Extract<LabelledDiagram["shapes"][number], { type: "particles" }>;

/** Two to four particle boxes, with nothing else drawn but arrows and lines. */
export function isParticleRow(d: LabelledDiagram): boolean {
  const boxes = d.shapes.filter((s) => s.type === "particles");
  return (
    boxes.length >= 2 &&
    boxes.length <= 4 &&
    d.shapes.every((s) => s.type === "particles" || s.type === "arrow" || s.type === "line")
  );
}

function normaliseParticles(d: LabelledDiagram): LabelledDiagram {
  // Each of the writer's labels on its own, so two for one box are never joined into one long one.
  const targetOf = (l: LabelledDiagram["labels"][number]) =>
    resolveLabels({ ...d, labels: [l] })[0];
  const order = d.shapes
    .map((s, i) => ({ s, i }))
    .filter((e): e is { s: Particles; i: number } => e.s.type === "particles")
    .sort((a, b) => a.s.x - b.s.x || a.s.y - b.s.y);
  const k = order.length;
  // An arrow kept is one that ran from one box toward the next (a change of state, a spread);
  // an arrow inside a box (random motion) or a wall line is dropped with its label.
  const between = (j: number) => {
    const a = order[j]?.s;
    const b = order[j + 1]?.s;
    if (!a || !b) return false;
    return d.shapes.some((sh) => {
      if (sh.type !== "arrow") return false;
      const mx = (sh.from[0] + sh.to[0]) / 2;
      return mx >= a.x + a.w - 4 && mx <= b.x + 4;
    });
  };
  const arrows = order.some((_, j) => between(j));
  const W = k >= 3 || arrows ? 160 : 100;
  const gap = arrows ? 16 : 8;
  const bw = Math.min(48, (W - 4 - (k - 1) * gap) / k);
  const left = (W - (k * bw + (k - 1) * gap)) / 2;
  const bh = 50;
  const top = 18;
  const shapes: LabelledDiagram["shapes"] = [];
  const labels: LabelledDiagram["labels"] = [];
  order.forEach(({ s, i }, j) => {
    const x = left + j * (bw + gap);
    shapes.push({ ...s, x, y: top, w: bw, h: bh });
    // One description per box, under its caption: the first label that names the box.
    const own = d.labels.find((l) => targetOf(l)?.target === i);
    if (own) labels.push({ text: own.text, at: [x + bw / 2, top + bh], side: "bottom" });
    if (between(j)) {
      const y = top + bh / 2;
      shapes.push({ type: "arrow", from: [x + bw + 3, y], to: [x + bw + gap - 3, y] });
    }
  });
  return { ...d, canvas: W === 160 ? "wide" : "square", shapes, labels };
}

// ─── simpler variants ───────────────────────────────────────────────────────────────────────

const shortLabel = (t: string, max = 16) => {
  const head = t.split(/[:(]/)[0]?.trim() ?? t;
  if (head.length <= max) return head;
  const words = head.split(/\s+/);
  let out = "";
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > max) break;
    out = next;
  }
  return out || head.slice(0, max);
};

/**
 * The normalised spec, then simpler ones that teach the same thing, in order: what code falls back
 * to when a drawing still collides on some theme, before any re-ask. A hydrograph loses its limb
 * labels, then its labels shorten; a particle row's descriptions shorten, then go (the captions
 * still name each state). Other kinds have no simpler form.
 */
export function simplerDiagrams(spec: unknown): unknown[] {
  const base = normaliseDiagram(spec);
  const r = DiagramSpecSchema.safeParse(base);
  if (!r.success) return [base];
  const s = r.data;
  const out: DiagramSpec[] = [s];
  if (s.kind === "line-graph" && isHydrograph(s)) {
    const a: LineGraph = { ...s, segments: [] };
    const b: LineGraph = {
      ...a,
      annotations: a.annotations.map((x) => ({ ...x, label: shortLabel(x.label) })),
      intervals: a.intervals.map((x) => ({ ...x, label: shortLabel(x.label, 12) })),
      series: a.series.map((x) => (x.label ? { ...x, label: shortLabel(x.label) } : x)),
    };
    const c: LineGraph = { ...b, annotations: b.annotations.slice(0, 2) };
    // The slide's heading names the graph: its own title is the first thing a short slot loses.
    const { title: _t, ...d } = a;
    const { title: _t2, ...e } = c;
    out.push(a, d as LineGraph, b, c, e as LineGraph);
  }
  // dd-diagrams: an energy profile's long peak labels shorten to the textbook "Ea".
  if (s.kind === "line-graph" && s.annotations.some((a) => /activation energy/i.test(a.label))) {
    out.push({
      ...s,
      annotations: s.annotations.map((a) => ({
        ...a,
        label: a.label.replace(/activation energy/i, "Ea"),
      })),
    });
  }
  if (s.kind === "labelled-diagram" && isParticleRow(s)) {
    const { title: _t, ...bare } = s;
    out.push(
      { ...s, labels: s.labels.map((l) => ({ ...l, text: shortLabel(l.text, 12) })) },
      bare as LabelledDiagram,
      { ...s, labels: [] },
    );
  }
  // dd-diagrams: an energy profile's long peak labels shorten to the textbook "Ea".
  if (s.kind === "line-graph" && s.annotations.some((a) => /activation energy/i.test(a.label))) {
    out.push({
      ...s,
      annotations: s.annotations.map((a) => ({
        ...a,
        label: a.label.replace(/activation energy/i, "Ea"),
      })),
    });
  }
  // dd-diagrams2: a flow's arrow words are connectives ("so", "then"); a flow that cannot fit
  // with them draws without them before it is refused.
  if (s.kind === "flow" && s.steps.some((st) => st.arrow)) {
    out.push({ ...s, steps: s.steps.map((st) => ({ label: st.label })) });
    if (s.title) {
      const { title: _t, ...bare } = s;
      out.push({ ...bare, steps: s.steps.map((st) => ({ label: st.label })) } as DiagramSpec);
    }
  }
  if (s.kind === "particles") {
    const { title: _t, ...bare } = s;
    const { notes: _n, ...plain } = bare;
    out.push(bare as DiagramSpec, plain as DiagramSpec);
  }
  if (["hydrograph", "timeline", "layers", "cycle", "river"].includes(s.kind) && s.title) {
    const { title: _t, ...bare } = s;
    out.push(bare as DiagramSpec);
  }
  if (s.kind === "hydrograph") {
    const { title: _t, ...bare } = s;
    out.push({ ...bare, marks: ["peak-rainfall", "peak-discharge", "lag-time"] } as DiagramSpec);
  }
  return out.filter((v) => DiagramSpecSchema.safeParse(v).success);
}
