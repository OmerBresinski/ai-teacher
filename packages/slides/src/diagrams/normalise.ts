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
import { parseDiagram } from "./index";
import { resolveLabels } from "./labelled";
import { fromMeaning } from "./meaning";
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
  // r3-diag: parsed as the slide draws it (long labels stretched), so a spec with a label a little
  // over its limit is still normalised.
  const s0 = parseDiagram(spec);
  if (!s0) return spec;
  const s = s0.kind === "line-graph" ? withTangents(s0) : s0;
  const tpl = asTemplate(s);
  if (tpl) return tpl;
  // r3-diag: compare panels the writer left identical, whose captions name what differs, take that
  // difference: lower/higher temperature moves slow/fast, higher concentration holds twice the
  // particles, higher pressure has the smaller container (y11 r2 s4 drew two identical panels).
  if (s.kind === "particles" && s.show === "compare" && s.panels && s.panels.length === 2) {
    const [a, b] = s.panels;
    const same = JSON.stringify(a) === JSON.stringify(b);
    const caps = (s.captions ?? []).join(" ").toLowerCase();
    if (same && a && b) {
      const low = (s.captions?.[0] ?? "").toLowerCase();
      const flip = /higher|more|hot|warm|high/.test(low) && !/lower|less|cold|low/.test(low);
      const [lo, hi] = flip ? [b, a] : [a, b];
      let changed = false;
      if (/temperat|hot|cold|heat/.test(caps)) {
        lo.speed = "slow";
        hi.speed = "fast";
        changed = true;
      } else if (/concentrat/.test(caps)) {
        hi.count = Math.min(20, lo.count * 2);
        changed = true;
      } else if (/pressure|compress|volume/.test(caps)) {
        hi.room = "small";
        changed = true;
      }
      if (changed) return { ...s, panels: flip ? [hi, lo] : [lo, hi] };
    }
  }
  // r3-diag: a before/after particle pair whose own words are about collisions and energy (y11 r2
  // s3 wrote "dissolving" with captions "Insufficient energy" / "Sufficient energy") is a collision
  // pair: drawn as particles meeting and bouncing apart or reacting, not as a solute dissolving.
  if (s.kind === "particles" && (s.show === "dissolving" || s.show === "diffusion")) {
    const words = [...(s.captions ?? []), ...(s.notes ?? []), ...(s.key ?? [])].join(" ");
    if (/collision|collide|energy|react/i.test(words)) {
      const outcome = (t: string) =>
        /\b(no|not|insufficient|low|too little|unsuccessful|without)\b/i.test(t)
          ? ("bounces" as const)
          : ("reacts" as const);
      const caps = s.captions ?? [];
      const outcomes = (caps.length ? caps : ["", ""])
        .slice(0, 2)
        .map((c, i) =>
          caps.length ? outcome(`${c} ${s.notes?.[i] ?? ""}`) : i === 0 ? "bounces" : "reacts",
        );
      const { key: _k, arrows: _a, ...rest } = s;
      const c: unknown = { ...rest, show: "collision", outcomes };
      if (parseDiagram(c)) return c;
    }
  }
  const out: DiagramSpec | undefined =
    s.kind === "line-graph" && isHydrograph(s)
      ? normaliseHydrograph(s)
      : s.kind === "labelled-diagram" && isParticleRow(s)
        ? normaliseParticles(s)
        : undefined;
  if (!out) return s === s0 ? spec : s;
  return parseDiagram(out) ? out : spec;
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
  let base = normaliseDiagram(spec);
  // Round 7 (r6 y12 s4): a cycle sets three to six steps round an ellipse; with more its boxes
  // overlap, so it is laid out as a chain.
  const c = base as { kind?: unknown; layout?: unknown; steps?: unknown[] };
  if (c?.kind === "flow" && c.layout === "cycle" && Array.isArray(c.steps) && c.steps.length > 6)
    base = { ...c, layout: "chain" };
  // Simpler forms only for a spec within its limits: one with long labels draws whole (stretched)
  // or steps up to a bigger zone, rather than losing its notes to fit (DIAGRAM-AUDIT step-up).
  const r = DiagramSpecSchema.safeParse(base);
  if (!r.success) {
    // BAKEOFF round 7 (r6 y12 s4: an 8-step cycle whose arrow words ran a character over and off
    // the drawing): a flow re-lays out as a chain, then without its arrow words, before it is
    // dropped, even when its arrow words miss their limit.
    const f = base as { kind?: unknown; layout?: unknown; steps?: { label?: unknown }[] };
    if (f?.kind === "flow" && Array.isArray(f.steps)) {
      const steps = f.steps.map((st) => ({ label: st?.label }));
      const forms = [
        ...(f.layout === "cycle" ? [{ ...f, layout: "chain" }] : []),
        { ...f, steps },
        ...(f.layout === "cycle" ? [{ ...f, layout: "chain", steps }] : []),
      ];
      return [base, ...forms.filter((v) => DiagramSpecSchema.safeParse(v).success)];
    }
    return [base];
  }
  const s = r.data;
  const out: DiagramSpec[] = [s];
  // Round 7: a cycle re-lays out as a chain (rows or a snake) before it loses anything.
  if (s.kind === "flow" && s.layout === "cycle") out.push({ ...s, layout: "chain" });
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
    if (s.layout === "cycle")
      out.push({ ...s, layout: "chain", steps: s.steps.map((st) => ({ label: st.label })) });
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

/** A date label as a signed year (BC negative): "55 BC" -55, "AD 43" 43, "1923" 1923. */
export function yearOf(date: string): number | undefined {
  const bc = date.match(/(\d+)\s*(?:BC|BCE)\b/i);
  if (bc) return -Number(bc[1]);
  const ad = date.match(/(?:AD|CE)\s*(\d+)|(\d+)\s*(?:AD|CE)\b|\b(\d{1,4})\b/i);
  const n = ad?.[1] ?? ad?.[2] ?? ad?.[3];
  return n ? Number(n) : undefined;
}

/**
 * Round 6 (y4 r5: a BC-AD timeline failed both tries on `period.from: -55`): a spec's optional
 * decoration that cannot stand is mended in code, never a reason to lose the drawing. A timeline's
 * `period` given as years becomes the events' positions; one that still does not fit is dropped.
 */
type AreaLabel = { text?: unknown; at?: unknown };
type AreaRect = { type?: unknown; x?: number; y?: number; w?: number; h?: number };

/**
 * BAKEOFF round 7 (r6 y10m: the area model drawn as free lines with unequal cells and labels on
 * the wrong edges): an area model (grid method) is a table grid. The factors outside the rectangle
 * become the headers (along the top) and the first column (down the side); the labels inside it are
 * the products, each in the cell of its nearest factor column and row. Anything that does not read
 * as a full grid stays as it was.
 */
export function areaModelTable(spec: unknown): unknown {
  const s = spec as {
    kind?: unknown;
    title?: unknown;
    alt?: unknown;
    shapes?: AreaRect[];
    labels?: AreaLabel[];
  };
  if (!s || typeof s !== "object" || s.kind !== "labelled-diagram") return spec;
  if (
    !/\b(area model|grid method|box method|area diagram)\b/i.test(`${s.title ?? ""} ${s.alt ?? ""}`)
  )
    return spec;
  const rect = (s.shapes ?? []).find(
    (r) => r?.type === "rect" && [r.x, r.y, r.w, r.h].every((v) => typeof v === "number"),
  );
  if (!rect) return spec;
  const [rx, ry, rw, rh] = [rect.x ?? 0, rect.y ?? 0, rect.w ?? 0, rect.h ?? 0];
  const pts = (s.labels ?? []).flatMap((l) => {
    const at = l?.at as unknown;
    if (typeof l?.text !== "string" || !Array.isArray(at)) return [];
    const [x, y] = at as number[];
    return typeof x === "number" && typeof y === "number" ? [{ t: l.text.trim(), x, y }] : [];
  });
  const inX = (x: number) => x > rx && x < rx + rw;
  const inY = (y: number) => y > ry && y < ry + rh;
  const cells = pts.filter((p) => inX(p.x) && inY(p.y));
  const cols = pts.filter((p) => inX(p.x) && !inY(p.y)).sort((a, b) => a.x - b.x);
  const rows = pts.filter((p) => inY(p.y) && !inX(p.x)).sort((a, b) => a.y - b.y);
  if (cols.length < 2 || rows.length < 1 || cells.length !== cols.length * rows.length) return spec;
  if (cols.length > 4 || rows.length > 7) return spec;
  const near = <T extends { x: number; y: number }>(xs: T[], v: number, k: "x" | "y") =>
    xs.reduce((b, p, i) => (Math.abs(p[k] - v) < Math.abs((xs[b] as T)[k] - v) ? i : b), 0);
  const grid = rows.map(() => cols.map(() => ""));
  for (const c of cells) {
    const r = grid[near(rows, c.y, "y")] as string[];
    const k = near(cols, c.x, "x");
    if (r[k]) return spec;
    r[k] = c.t;
  }
  const table = {
    kind: "table",
    ...(typeof s.title === "string" ? { title: s.title } : {}),
    alt: typeof s.alt === "string" ? s.alt : "An area model grid",
    header: ["×", ...cols.map((c) => c.t)],
    rows: rows.map((r, i) => [r.t, ...(grid[i] as string[])]),
  };
  return DiagramSpecSchema.safeParse(table).success ? table : spec;
}

/**
 * BAKEOFF round 7 (r6 y7 s5: "Liquid particles" over a solid-to-liquid pair): a particle drawing's
 * title agrees with what it draws. A states drawing titled for some of its states draws only
 * those; a title naming a state the drawing does not show is dropped (the heading names it).
 */
export function particleTitle(spec: unknown): unknown {
  const s = spec as {
    kind?: unknown;
    title?: unknown;
    show?: unknown;
    states?: unknown;
    panels?: { state?: unknown }[];
    captions?: unknown[];
    notes?: unknown[];
    arrows?: unknown[];
  };
  if (!s || typeof s !== "object" || s.kind !== "particles" || typeof s.title !== "string")
    return spec;
  const named = ["solid", "liquid", "gas"].filter((w) =>
    new RegExp(`\\b${w}`, "i").test(String(s.title)),
  );
  if (!named.length) return spec;
  const show = s.show ?? "states";
  const drawn =
    show === "states"
      ? Array.isArray(s.states)
        ? (s.states as string[])
        : ["solid", "liquid", "gas"]
      : (s.panels ?? []).map((p) => String(p?.state ?? "gas"));
  if (named.every((w) => drawn.includes(w)) && drawn.every((w) => named.includes(w))) return spec;
  const { title: _t, ...bare } = s;
  if (show !== "states" || !named.every((w) => drawn.includes(w))) return bare;
  const keep = drawn.map((w, i) => (named.includes(w) ? i : -1)).filter((i) => i >= 0);
  const pick = (xs?: unknown[]) =>
    Array.isArray(xs) && xs.length === drawn.length ? keep.map((i) => xs[i]) : undefined;
  const { panels: _p, arrows: _a, captions: _c, notes: _n, ...rest } = s;
  const captions = pick(s.captions);
  const notes = pick(s.notes);
  return {
    ...rest,
    states: keep.map((i) => drawn[i]),
    ...(captions ? { captions } : {}),
    ...(notes ? { notes } : {}),
  };
}

/**
 * BAKEOFF round 7 (r6 y2 s3: "one half" pointed at the unshaded half): a fraction label on a shape
 * with a shaded part names the shaded part. One label per fraction name, pointing at the middle of
 * the shaded part, when it does not already.
 */
export function shadedFractionLabels(spec: unknown): unknown {
  const s = spec as {
    kind?: unknown;
    shapes?: { type?: unknown; fill?: unknown; x?: number; y?: number; w?: number; h?: number }[];
    labels?: { text?: unknown; at?: unknown }[];
  };
  if (!s || typeof s !== "object" || s.kind !== "labelled-diagram" || !Array.isArray(s.labels))
    return spec;
  const shaded = (s.shapes ?? []).filter(
    (r) =>
      r?.type === "rect" &&
      r.fill === "accent" &&
      [r.x, r.y, r.w, r.h].every((v) => typeof v === "number"),
  ) as { x: number; y: number; w: number; h: number }[];
  if (!shaded.length) return spec;
  const x0 = Math.min(...shaded.map((r) => r.x));
  const y0 = Math.min(...shaded.map((r) => r.y));
  const x1 = Math.max(...shaded.map((r) => r.x + r.w));
  const y1 = Math.max(...shaded.map((r) => r.y + r.h));
  // Only one shaded region (its rects touch): two shaded shapes leave the labels alone.
  const area = shaded.reduce((a, r) => a + r.w * r.h, 0);
  if (area < (x1 - x0) * (y1 - y0) * 0.95) return spec;
  const FRACTION =
    /^(one|two|three|a)?\s*(half|halves|quarters?|thirds?|fifths?|sixths?|eighths?)$|^\d+\s*\/\s*\d+$/i;
  const inside = (at: unknown) =>
    Array.isArray(at) && at[0] > x0 && at[0] < x1 && at[1] > y0 && at[1] < y1;
  const seen = new Set<string>();
  let changed = false;
  const labels = s.labels.flatMap((l) => {
    const t = typeof l?.text === "string" ? l.text.trim() : "";
    if (!FRACTION.test(t)) return [l];
    const k = t.toLowerCase();
    if (seen.has(k)) {
      changed = true;
      return [];
    }
    seen.add(k);
    if (inside(l.at)) return [l];
    changed = true;
    return [{ ...l, at: [Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2)] }];
  });
  return changed ? { ...s, labels } : spec;
}

/**
 * Round 7 (r5 and r6 y7 "Solid particles": two identical solid panels, refused as showing no
 * difference): a compare whose panels are all the same is one state drawn once.
 */
export function oneStateCompare(spec: unknown): unknown {
  const s = spec as {
    kind?: unknown;
    show?: unknown;
    panels?: { state?: unknown }[];
    captions?: unknown[];
    notes?: unknown[];
  };
  if (!s || typeof s !== "object" || s.kind !== "particles" || s.show !== "compare") return spec;
  const ps = s.panels ?? [];
  if (ps.length < 2 || !ps.every((p) => JSON.stringify(p) === JSON.stringify(ps[0]))) return spec;
  const { panels: _p, arrows: _a, captions, notes, ...rest } = s as typeof s & { arrows?: unknown };
  return {
    ...rest,
    show: "states",
    states: [String(ps[0]?.state ?? "gas")],
    ...(Array.isArray(captions) && captions.length ? { captions: [captions[0]] } : {}),
    ...(Array.isArray(notes) && notes.length ? { notes: [notes[0]] } : {}),
  };
}

export function mendSpec(spec: unknown): unknown {
  // Round 8: a meaning-form spec becomes the form code draws first (meaning.ts).
  spec = fromMeaning(spec);
  spec = shadedFractionLabels(particleTitle(oneStateCompare(areaModelTable(spec))));
  const s = spec as {
    kind?: unknown;
    events?: { date?: unknown }[];
    period?: { from?: unknown; to?: unknown; label?: unknown } | null;
  };
  if (!s || typeof s !== "object" || s.kind !== "timeline" || !Array.isArray(s.events)) return spec;
  if (s.period === undefined) return spec;
  const n = s.events.length;
  const p = s.period;
  const ok = (a: unknown, b: unknown) =>
    Number.isInteger(a) &&
    Number.isInteger(b) &&
    (a as number) >= 1 &&
    (b as number) > (a as number) &&
    (b as number) <= n;
  const { period: _p, ...rest } = s;
  if (!p || typeof p !== "object" || typeof p.label !== "string" || !p.label.trim()) return rest;
  if (ok(p.from, p.to)) return spec;
  const years = s.events.map((e) => yearOf(String(e?.date ?? "")));
  const at = (y: unknown) => (typeof y === "number" ? years.indexOf(y) + 1 : 0);
  const from = at(p.from);
  const to = at(p.to);
  return ok(from, to) ? { ...rest, period: { ...p, from, to } } : rest;
}
