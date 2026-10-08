/**
 * Line graphs: axes with round ticks, one to three series (a line or bars, on the left axis or a
 * second one on the right, as a hydrograph's rainfall), labelled stretches of the first series (a
 * heating curve's "melting"), pointed annotations ("peak discharge") and intervals between two x
 * values drawn as a labelled double arrow ("lag time").
 */

import { packRows } from "./legend";
import type { LineGraph } from "./schema";
import { look, sub } from "./style";
import { arrowHead, type Ctx, n, num, text, textWidth, ticks, wrap } from "./svg";

type Axis = { label: string; min: number; max: number; step?: number };
type Box = { x0: number; y0: number; x1: number; y1: number };

/** The widest a plot is drawn against its height (dd-diagrams: no squashed strips). */
export const ASPECT_MAX = 2.4;

/** The next round step above `s` (1, 2, 2.5, 5, 10 and their powers of ten). */
function nextNice(s: number): number {
  const p = 10 ** Math.floor(Math.log10(s) + 1e-9);
  const f = s / p;
  const up = [1, 2, 5, 10].find((v) => v > f + 1e-9) ?? 10;
  return up * p;
}

export function drawLineGraph(g: LineGraph, x: Ctx, w: number, h: number): string {
  const { c, fs } = x;
  const small = sub(fs);
  const xt = ticks(g.x.min, g.x.max, g.x.step);
  const yt = ticks(g.y.min, g.y.max, g.y.step);
  for (const [name, ax, right] of [
    ["y", g.y, false],
    ["y2", g.y2, true],
  ] as const) {
    const pts = g.series.filter((s) => (s.axis === "right") === right).flatMap((s) => s.points);
    if (ax && pts.length)
      x.axes?.push({ name, max: ax.max, data: Math.max(...pts.map((p) => p[1])) });
  }
  const y2t = g.y2 ? ticks(g.y2.min, g.y2.max, g.y2.step) : [];
  // dd-diagrams2: an energy profile's axes carry no numbers (reaction progress and energy here
  // are not measured), so it draws no ticks, only its two axis titles.
  const energy = energyHumps(g).length > 0;
  if (energy || g.qualitative) {
    yt.splice(0, yt.length);
    xt.splice(0, xt.length);
  }
  const tickW = (vals: number[]) => Math.max(0, ...vals.map((v) => textWidth(num(v), x, small)));
  // A flat two-point line is a threshold ("channel capacity"): drawn dashed and named on the line,
  // not in the legend.
  const flat = (s: LineGraph["series"][number]) =>
    s.style !== "bars" && s.points.length === 2 && s.points[0]?.[1] === s.points[1]?.[1];
  const keyed = g.series.filter((s) => s.label && !flat(s));
  const legend =
    keyed.length > 1 ||
    (keyed.length === 1 && g.series.length > 1 && g.series.filter((s) => !flat(s)).length > 1);
  // The legend runs in rows, a key that does not fit the width starting the next one (round H:
  // a third series, "Channel capacity", ran off the drawing on every narrow theme).
  const keyW = (label: string) => fs * 2.4 + textWidth(label, x, small);
  // Packed by the shared legend plan (FIX-ENERGY); a key's width carries its trailing space, which
  // may overhang the drawing's edge by `fs`.
  const keyIdx = legend ? g.series.flatMap((s, i) => (s.label && !flat(s) ? [i] : [])) : [];
  const legendAt: { i: number; lx: number; row: number }[] = packRows(
    keyIdx.map((i) => ({ w: keyW(g.series[i]?.label ?? ""), h: fs })),
    w + fs,
    0,
  ).flatMap((r, row) => r.items.map(({ i, x: lx }) => ({ i: keyIdx[i] as number, lx, row })));
  // dd-diagrams: in a wide, short box the legend stands in a column right of the plot, so the
  // plot keeps its height (K y11 s11: a top legend and label row left a 48-point plot).
  const sideLegend = legend && w > 2 * h;
  const sideKeyW = sideLegend ? Math.max(...keyIdx.map((i) => keyW(g.series[i]?.label ?? ""))) : 0;
  if (sideLegend) for (const [row, k] of legendAt.entries()) Object.assign(k, { lx: 0, row });
  const legendH =
    legend && !sideLegend ? fs * 1.8 + Math.max(0, ...legendAt.map((k) => k.row)) * fs * 1.3 : 0;
  // Intervals with no `y` get a band of their own under the legend, one row each.
  const banded = g.intervals.filter((v) => v.y === undefined);
  const bandRow = small * 1.2 + fs * 0.9;
  const bottom = small * 1.3 + fs * 1.5 + 6;
  // The y axis title runs along the plot: one line at the label size, else a step smaller, else
  // two lines; a title longer than that is a fault, never clipped (K y11 s11's "Gas volume / cm³").
  const loose0 = g.annotations.length;
  const high0 =
    !energyHumps(g).length &&
    g.annotations.some((a) => (a.y - g.y.min) / (g.y.max - g.y.min || 1) > 0.8);
  const top0 = legendH + fs * 0.8 + (loose0 > 0 && high0 ? fs * 1.2 : 0) + banded.length * bandRow;
  // The rotated title is centred on the plot and may run into the empty left margin above and
  // below it, but not into the legend row or off the drawing.
  const mid0 = top0 + (h - top0 - bottom) / 2;
  const along = Math.max(1, 2 * Math.min(mid0 - legendH, h - mid0) - 8);
  const yTitleForm = (label: string) => {
    for (const [f, k] of [
      [fs, 1],
      [small, 1],
      [small, 2],
    ] as const) {
      const lines = k === 1 ? [label] : wrap(label, x, along, 2, f, 600);
      if (lines.every((l) => !l.endsWith("…") && textWidth(l, x, f, 600) <= along))
        return { lines, f };
    }
    x.faults?.push(`the axis title "${label}" is longer than its axis`);
    return { lines: [label], f: small };
  };
  const yForm = yTitleForm(g.y.label);
  const y2Form = g.y2 ? yTitleForm(g.y2.label) : undefined;
  const titleW = (t: { lines: string[]; f: number }) => t.f * 1.2 * t.lines.length + t.f * 0.2;
  let left = titleW(yForm) + tickW(yt) + 10;
  const right =
    (g.y2 && y2Form
      ? titleW(y2Form) + tickW(y2t) + 10
      : Math.max(12, textWidth(num(g.x.max), x, small) / 2)) + (sideLegend ? sideKeyW + fs : 0);
  // dd-diagrams: a plot keeps a sane aspect (at most ASPECT_MAX as wide as tall): in a wide band
  // it is drawn narrower and centred, never stretched into a strip.
  let pw = w - left - right;
  const phGuess = h - top0 - bottom;
  if (phGuess > 0 && pw > ASPECT_MAX * phGuess) {
    const cut = pw - ASPECT_MAX * phGuess;
    left += cut / 2;
    pw -= cut;
  }
  const Xp = (v: number) => left + ((v - g.x.min) / (g.x.max - g.x.min)) * pw;
  // A hydrograph's two peaks named at the ends of its lag arrow, on a row above it, each leaning
  // outward (the textbook figure): one interval in the band whose ends are two annotated points.
  const peakRow = (() => {
    const lag = g.intervals.length === 1 ? g.intervals[0] : undefined;
    if (!lag || lag.y !== undefined) return undefined;
    const tol = (g.x.max - g.x.min) * 0.02;
    const a = g.annotations.findIndex((q) => Math.abs(q.x - lag.from) <= tol);
    const b = g.annotations.findIndex((q) => Math.abs(q.x - lag.to) <= tol);
    const fa = g.annotations[a];
    const fb = g.annotations[b];
    if (!fa || !fb || a === b) return undefined;
    const d = small * 0.5;
    const wa = textWidth(fa.label, x, small, 600);
    const wb = textWidth(fb.label, x, small, 600);
    const boxA = { x0: Xp(lag.from) + d - wa, x1: Xp(lag.from) + d };
    const boxB = { x0: Xp(lag.to) - d, x1: Xp(lag.to) - d + wb };
    if (boxA.x0 < 0) Object.assign(boxA, { x0: 0, x1: wa });
    if (boxB.x1 > w) Object.assign(boxB, { x0: w - wb, x1: w });
    if (boxA.x1 + small * 0.6 > boxB.x0) return undefined;
    return { skip: new Set([a, b]), boxA, boxB, a: fa, b: fb };
  })();
  const peakH = peakRow ? small * 1.5 : 0;
  const band = banded.length * bandRow + peakH;
  const loose = g.annotations.length - (peakRow ? 2 : 0);
  // dd-diagrams2: a row is kept over the plot only for a label on a point near its top.
  const span = g.y.max - g.y.min || 1;
  const high = g.annotations.some((a) => (a.y - g.y.min) / span > 0.8) && !energy;
  const top = legendH + fs * 0.8 + (loose > 0 && high ? fs * 1.2 : 0) + band;
  const ph = h - top - bottom;
  // A plot squeezed under its own labels shows no shape.
  if (ph < 0.42 * h || ph < small * 4.5)
    x.faults?.push("the graph is squashed under its labels, so the curve is too small to read");
  if (pw < small * 8 || pw > ASPECT_MAX * 1.25 * ph)
    x.faults?.push("the plot is too narrow or too flat to read its shape");
  // dd-diagrams: a short plot takes a rounder, larger step until its tick labels have room, and
  // its range runs out to whole steps, so the top of the axis is always labelled (T y11 s10
  // showed only "40" on a 0-60 axis after every other tick was dropped).
  const fitAxis = (a: Axis, vals: number[]): { axis: Axis; vals: number[] } => {
    let v = vals;
    let step = v.length > 1 ? (v[1] as number) - (v[0] as number) : a.max - a.min;
    while (v.length > 3 && ph / (v.length - 1) < small * 1.6) {
      step = nextNice(step);
      const lo = Math.floor(a.min / step + 1e-9) * step;
      const hi = Math.ceil(a.max / step - 1e-9) * step;
      v = ticks(lo, hi, step);
    }
    const lo = Math.min(a.min, v[0] ?? a.min);
    const s = v.length > 1 ? (v[1] as number) - (v[0] as number) : a.max - a.min;
    const last = v[v.length - 1] ?? a.max;
    // The axis's own top when it is not a tick: the next tick above it, labelled.
    const hi = last < a.max - 1e-9 ? last + s : Math.max(a.max, last);
    if (last < a.max - 1e-9) v = [...v, Math.round((last + s) * 1e6) / 1e6];
    return { axis: { ...a, min: lo, max: hi }, vals: v };
  };
  const fy = fitAxis(g.y, yt);
  const fy2 = g.y2 ? fitAxis(g.y2, y2t) : undefined;
  yt.splice(0, yt.length, ...fy.vals);
  if (fy2) y2t.splice(0, y2t.length, ...fy2.vals);
  // x tick labels keep a gap between them (the widest label and a little air apart).
  const xLabelW = Math.max(...xt.map((v) => textWidth(num(v), x, small)));
  while (xt.length > 3 && pw / (xt.length - 1) < xLabelW + small * 0.8) {
    const kept = xt.filter((_, i) => i % 2 === 0);
    xt.splice(0, xt.length, ...kept);
  }
  const shown = new Map<Axis | undefined, Axis>([
    [g.y, fy.axis],
    [g.y2, fy2?.axis ?? (g.y2 as Axis)],
  ]);
  const X = (v: number) => left + ((v - g.x.min) / (g.x.max - g.x.min)) * pw;
  const Yof = (a0: Axis) => {
    const a = shown.get(a0) ?? a0;
    return (v: number) => top + ph - ((v - a.min) / (a.max - a.min)) * ph;
  };
  const Y = Yof(g.y);
  const out: string[] = [];

  // Grid and ticks.
  for (const v of yt) {
    out.push(
      `<line x1="${n(left)}" y1="${n(Y(v))}" x2="${n(left + pw)}" y2="${n(Y(v))}" stroke="${c.line}" stroke-width="1.5"/>`,
    );
    out.push(text(x, left - 8, Y(v), [num(v)], { fs: small, anchor: "end", fill: c.ink }));
  }
  // Modern looks: no tick marks and no upright axes; the gridlines and the baseline carry the scale.
  const modern = look().preset !== "current";
  for (const v of xt) {
    if (!modern)
      out.push(
        `<line x1="${n(X(v))}" y1="${n(top + ph)}" x2="${n(X(v))}" y2="${n(top + ph + 6)}" stroke="${c.ink}" stroke-width="2"/>`,
      );
    out.push(text(x, X(v), top + ph + 8, [num(v)], { fs: small, v: "top", fill: c.ink }));
  }
  if (g.y2) {
    const Y2 = Yof(g.y2);
    for (const v of y2t) {
      // Modern looks: the right axis's bottom tick would sit on the last time tick; the
      // baseline already reads as its zero.
      if (modern && v === g.y2.min) continue;
      out.push(
        text(x, left + pw + 8, Y2(v), [num(v)], { fs: small, anchor: "start", fill: c.ink }),
      );
    }
  }
  // Axes, with the axis a zero crosses where it crosses.
  const baseY = Y(g.y.min <= 0 && g.y.max >= 0 ? 0 : g.y.min);
  // Modern looks let the gridlines stand for the y axis; a graph with no ticks (qualitative, an
  // energy profile) has no gridlines, so it keeps the axis line.
  out.push(
    modern && yt.length > 0
      ? ""
      : `<line x1="${n(left)}" y1="${n(top)}" x2="${n(left)}" y2="${n(top + ph)}" stroke="${c.ink}" stroke-width="2.5"/>`,
    `<line x1="${n(left)}" y1="${n(top + ph)}" x2="${n(left + pw)}" y2="${n(top + ph)}" stroke="${c.ink}" stroke-width="2.5"/>`,
  );
  if (baseY !== top + ph) {
    out.push(
      `<line x1="${n(left)}" y1="${n(baseY)}" x2="${n(left + pw)}" y2="${n(baseY)}" stroke="${c.muted}" stroke-width="1.5"/>`,
    );
  }
  if (g.y2 && !modern) {
    out.push(
      `<line x1="${n(left + pw)}" y1="${n(top)}" x2="${n(left + pw)}" y2="${n(top + ph)}" stroke="${c.ink}" stroke-width="2.5"/>`,
    );
  }
  // Axis titles.
  out.push(text(x, left + pw / 2, h - 2, [g.x.label], { v: "bottom", weight: 600 }));
  // The rotated title is recorded as its upright box, so the checks see it run off or collide.
  const yTitle = (t: { lines: string[]; f: number }, cx: number, rot: number) => {
    const len = Math.max(...t.lines.map((l) => textWidth(l, x, t.f, 600)));
    const thick = t.f * 1.2 * t.lines.length;
    x.rec?.push({
      text: t.lines.join(" "),
      x0: cx - thick / 2,
      x1: cx + thick / 2,
      y0: top + ph / 2 - len / 2,
      y1: top + ph / 2 + len / 2,
      fs: t.f,
      cut: false,
    });
    return `<g transform="translate(${n(cx)},${n(top + ph / 2)}) rotate(${rot})">${text({ ...x, rec: undefined }, 0, -((t.lines.length - 1) * t.f * 1.2) / 2, t.lines, { weight: 600, fs: t.f })}</g>`;
  };
  const yCx = left - tickW(yt) - 10 - titleW(yForm) / 2;
  out.push(yTitle(yForm, Math.max(titleW(yForm) / 2, yCx), -90));
  if (g.y2 && y2Form)
    out.push(yTitle(y2Form, left + pw + tickW(y2t) + 10 + titleW(y2Form) / 2, 90));

  // Series: bars first, so lines draw over them.
  const flatLabels: { label: string; y: number }[] = [];
  // The drawn curves as segments: a label is never set across one (the gate reads them too).
  const curves: [number, number, number, number][] = [];
  const colours = [c.accent, c.accent2, c.muted];
  const order = g.series
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.style === "bars" ? -1 : 0) - (b.s.style === "bars" ? -1 : 0));
  const tangents: string[] = [];
  const touchDots: string[] = [];
  const firstData = out.length;
  for (const { s, i } of order) {
    const colour = colours[i] ?? c.accent;
    const axis = s.axis === "right" && g.y2 ? g.y2 : g.y;
    const Ys = Yof(axis);
    if (s.style === "bars") {
      const slot = pw / Math.max(1, (g.x.max - g.x.min) / minGap(s.points.map((p) => p[0])));
      const bw = Math.max(4, Math.min(slot * 0.7, pw / 6));
      const base = Ys(axis.min <= 0 && axis.max >= 0 ? 0 : axis.min);
      for (const [px, py] of s.points) {
        const yy = Ys(py);
        // A bar at either end of the x axis is cut at the axis, never drawn over the tick labels.
        const x0 = Math.max(left, X(px) - bw / 2);
        const x1 = Math.min(left + pw, X(px) + bw / 2);
        if (x1 <= x0) continue;
        out.push(
          `<rect x="${n(x0)}" y="${n(Math.min(yy, base))}" width="${n(x1 - x0)}" height="${n(Math.abs(base - yy))}" fill="${colour}" fill-opacity="0.55" stroke="${colour}" stroke-width="1.5"/>`,
        );
      }
    } else if (flat(s)) {
      const yy = Ys(s.points[0]?.[1] ?? 0);
      curves.push([X(s.points[0]?.[0] ?? g.x.min), yy, X(s.points[1]?.[0] ?? g.x.max), yy]);
      out.push(
        `<line x1="${n(X(s.points[0]?.[0] ?? g.x.min))}" y1="${n(yy)}" x2="${n(X(s.points[1]?.[0] ?? g.x.max))}" y2="${n(yy)}" stroke="${c.ink}" stroke-width="2.5" stroke-dasharray="${n(fs * 0.5)} ${n(fs * 0.3)}"/>`,
      );
      if (s.label) flatLabels.push({ label: s.label, y: yy });
    } else if (s.style === "tangent") {
      // A tangent is a guide, not data (UX ruling 155): thin, dashed, in the second colour, run a
      // little past its two points, under the data line, with a dot where it touches the curve.
      const [p0, p1] = [s.points[0], s.points[s.points.length - 1]] as [
        [number, number],
        [number, number],
      ];
      const [ax, ay, bx, by] = [X(p0[0]), Ys(p0[1]), X(p1[0]), Ys(p1[1])];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const ext = fs * 0.8;
      const [ux, uy] = [((bx - ax) / len) * ext, ((by - ay) / len) * ext];
      tangents.push(
        `<line x1="${n(ax - ux)}" y1="${n(ay - uy)}" x2="${n(bx + ux)}" y2="${n(by + uy)}" stroke="${c.accent2}" stroke-width="2" stroke-dasharray="${n(fs * 0.45)} ${n(fs * 0.3)}" stroke-linecap="round"/>`,
      );
      const touch = touchPoint(g, s, Yof);
      if (touch) {
        touchDots.push(
          `<circle cx="${n(X(touch[0]))}" cy="${n(Ys(touch[1]))}" r="${n(Math.max(4, fs * 0.22))}" fill="${c.accent2}" stroke="${c.surface}" stroke-width="1.5"/>`,
        );
      }
    } else {
      s.points.forEach(([px, py], j) => {
        const q = s.points[j + 1];
        if (q) curves.push([X(px), Ys(py), X(q[0]), Ys(q[1])]);
      });
      // A smooth curve through the points (monotone cubic, so it never overshoots a plateau).
      const d = monotonePath(s.points.map(([px, py]) => [X(px), Ys(py)] as [number, number]));
      out.push(
        `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${n(Math.max(3.5, fs * 0.22))}" stroke-linejoin="round" stroke-linecap="round"/>`,
      );
    }
  }

  out.splice(firstData, 0, ...tangents);

  // dd-diagrams: an energy profile shows each activation energy as what it is, the climb from the
  // reactants' level to its own peak: a dashed reactant level and a double arrow per curve, named
  // by the label the writer put on that peak (K y11 s7 pointed "Higher" and "Lower" at the wrong
  // places). Two peaks at one x stand side by side, each with a short guide to its own peak.
  const eaMarks: {
    a: { x: number; y: number; label: string };
    ax: number;
    ay: number;
    ea: true;
  }[] = [];
  const eaUsed = new Set<number>();
  const humps = energyHumps(g);
  const humpColour = (pk: number) => {
    const i = g.series.findIndex((s) => Math.max(...s.points.map((p) => p[1])) === pk);
    return colours[i] ?? c.ink;
  };
  if (humps.length) {
    const ySpan = g.y.max - g.y.min || 1;
    const xSpan = g.x.max - g.x.min || 1;
    const shared = humps.length === 2 && Math.abs(X(humps[0]!.px) - X(humps[1]!.px)) < fs * 1.6;
    const head = Math.max(8, fs * 0.45);
    humps.forEach((hp, j) => {
      const off = shared ? (j === 0 ? -1 : 1) * fs * 0.7 : 0;
      const axp = X(hp.px) + off;
      const y0 = Y(hp.start);
      const y1 = Y(hp.peak);
      out.push(
        `<line x1="${n(X(hp.x0))}" y1="${n(y0)}" x2="${n(axp + fs * 0.4)}" y2="${n(y0)}" stroke="${c.muted}" stroke-width="1.5" stroke-dasharray="${n(fs * 0.35)} ${n(fs * 0.3)}"/>`,
        `<line x1="${n(axp)}" y1="${n(y0 - head * 0.8)}" x2="${n(axp)}" y2="${n(y1 + head * 0.8)}" stroke="${humpColour(hp.peak)}" stroke-width="2.5"/>`,
        arrowHead(axp, y0, axp, y1, head, humpColour(hp.peak)),
        arrowHead(axp, y1, axp, y0, head, humpColour(hp.peak)),
      );
      if (off)
        out.push(
          `<line x1="${n(X(hp.px))}" y1="${n(y1)}" x2="${n(axp)}" y2="${n(y1)}" stroke="${c.muted}" stroke-width="1.5"/>`,
        );
      curves.push([axp, y0, axp, y1]);
      const ai = g.annotations.findIndex(
        (a, k) =>
          !eaUsed.has(k) &&
          Math.abs(a.x - hp.px) <= 0.15 * xSpan &&
          Math.abs(a.y - hp.peak) <= 0.12 * ySpan,
      );
      if (ai >= 0) eaUsed.add(ai);
      const label =
        ai >= 0
          ? (g.annotations[ai]?.label ?? "Ea")
          : humps.length === 1
            ? "Ea"
            : j === 0
              ? "Higher Ea"
              : "Lower Ea";
      eaMarks.push({ a: { x: hp.px, y: hp.peak, label }, ax: axp, ay: (y0 + y1) / 2, ea: true });
    });
  }
  out.push(...touchDots);
  x.strokes?.push(...curves);
  const crossesCurve = (b: Box) =>
    curves.some(([ax, ay, bx, by]) => {
      for (let t = 0; t <= 1; t += 1 / 40) {
        const px = ax + (bx - ax) * t;
        const py = ay + (by - ay) * t;
        if (px > b.x0 + 3 && px < b.x1 - 3 && py > b.y0 + 4 && py < b.y1 - 4) return true;
      }
      return false;
    });

  // Labelled stretches of the first series.
  const segBoxes: Box[] = [];
  const first = g.series[0];
  if (first) {
    const Ys = Yof(first.axis === "right" && g.y2 ? g.y2 : g.y);
    for (const seg of g.segments) {
      const inRange = first.points
        .filter(([px]) => px >= seg.from && px <= seg.to)
        .map((p) => p[1]);
      const ys = [at(first.points, seg.from), at(first.points, seg.to), ...inRange];
      const peak = Math.min(...ys.map(Ys));
      const x1 = X(seg.from) + 3;
      const x2 = X(seg.to) - 3;
      const by = peak - fs * 0.5;
      out.push(
        `<path d="M${n(x1)},${n(by + 6)} L${n(x1)},${n(by)} L${n(x2)},${n(by)} L${n(x2)},${n(by + 6)}" fill="none" stroke="${c.ink}" stroke-width="1.5"/>`,
      );
      const sw = textWidth(seg.label, x, small, 600);
      segBoxes.push({
        x0: (x1 + x2) / 2 - sw / 2 - 4,
        y0: by - 4 - small * 1.3,
        x1: (x1 + x2) / 2 + sw / 2 + 4,
        y1: by + 6,
      });
      out.push(
        text(x, (x1 + x2) / 2, by - 4, [seg.label], {
          v: "bottom",
          fs: small,
          weight: 600,
          halo: c.bg,
        }),
      );
    }
  }

  // Intervals: where each one's arrow and label sit, worked out first so annotations keep clear.
  const rowOf = new Map(banded.map((v, i) => [v, i]));
  const spans = g.intervals.map((v) => {
    const x1 = X(v.from);
    const x2 = X(v.to);
    const row = rowOf.get(v) ?? 0;
    const ay =
      v.y === undefined ? legendH + peakH + row * bandRow + small * 1.2 + fs * 0.3 : Y(v.y);
    const lw = textWidth(v.label, x, small, 600);
    const cx = Math.max(lw / 2 + 2, Math.min(w - lw / 2 - 2, (x1 + x2) / 2));
    // dd-diagrams2: the label goes above its arrow, else under it, else beside the span, the first
    // place clear of the curves.
    const lh = small * 1.25;
    const forms = [
      {
        lx: cx,
        ly: ay - fs * 0.3,
        vv: "bottom" as const,
        b: { x0: cx - lw / 2, x1: cx + lw / 2, y0: ay - fs * 0.3 - lh, y1: ay - fs * 0.3 },
      },
      {
        lx: cx,
        ly: ay + fs * 0.3,
        vv: "top" as const,
        b: { x0: cx - lw / 2, x1: cx + lw / 2, y0: ay + fs * 0.3, y1: ay + fs * 0.3 + lh },
      },
      ...[x2 + 6 + lw / 2, x1 - 6 - lw / 2].map((px) => ({
        lx: px,
        ly: ay + lh / 2,
        vv: "bottom" as const,
        b: { x0: px - lw / 2, x1: px + lw / 2, y0: ay - lh / 2, y1: ay + lh / 2 },
      })),
    ];
    const lab =
      v.y === undefined
        ? (forms[0] as (typeof forms)[number])
        : (forms.find((q) => q.b.x0 >= left && q.b.x1 <= left + pw && !crossesCurve(q.b)) ??
          (forms[0] as (typeof forms)[number]));
    return { v, x1, x2, ay, cx, lw, lab };
  });
  const taken: Box[] = spans.flatMap((sp) => [
    { x0: sp.lab.b.x0 - 4, y0: sp.lab.b.y0, x1: sp.lab.b.x1 + 4, y1: sp.lab.b.y1 },
    { x0: sp.x1, y0: sp.ay - 6, x1: sp.x2, y1: sp.ay + 6 },
  ]);
  taken.push(...segBoxes);
  for (const f of flatLabels) {
    // One line, else two (a narrow label fits between where the curve crosses the line); right
    // end first (a storm's falling limb is back under the line there), above then below, sweeping
    // left: the first spot clear of every curve and label.
    const forms = [
      [f.label],
      wrap(f.label, x, textWidth(f.label, x, small, 600) * 0.62, 2, small, 600),
    ];
    const spots = forms.flatMap((lines) => {
      const lw = Math.max(...lines.map((l) => textWidth(l, x, small, 600)));
      const lh = small * 1.2 * (lines.length - 1) + small * 1.25;
      return [1, 0.75, 0.5, 0.25, 0].flatMap((k) =>
        [true, false].map((up) => {
          const x0 = left + 6 + k * Math.max(0, pw - 12 - lw);
          const ly = up ? f.y - 4 : f.y + 4;
          const box: Box = { x0, x1: x0 + lw, y0: up ? ly - lh : ly, y1: up ? ly : ly + lh };
          return { lines, lx: x0 + lw, up, ly, box };
        }),
      );
    });
    const ok = (b: Box) =>
      b.y0 >= legendH + band &&
      b.y1 <= top + ph &&
      !crossesCurve(b) &&
      taken.every((t) => b.x1 <= t.x0 || b.x0 >= t.x1 || b.y1 <= t.y0 || b.y0 >= t.y1);
    const sp = spots.find((p) => ok(p.box)) ?? (spots[0] as (typeof spots)[number]);
    taken.push(sp.box);
    out.push(
      text(x, sp.lx, sp.ly, sp.lines, {
        anchor: "end",
        fs: small,
        weight: 600,
        halo: c.bg,
        v: sp.up ? "bottom" : "top",
      }),
    );
  }

  // Annotations: a dot on the series point it names and a leader to its label. Each dot snaps to
  // the series whose value at its x is nearest its y, on that series' own axis (a hydrograph's
  // rainfall peak is on the right axis). Labels spread outward in x order, so two leaders never
  // cross, and each takes the first place clear of the plot's edges, the interval labels and the
  // labels already set.
  const dots: { a: { x: number; y: number; label: string }; ax: number; ay: number; ea?: true }[] =
    g.annotations.flatMap((a, k) =>
      eaUsed.has(k)
        ? []
        : [
            (() => {
              let best: { ay: number; d: number } | undefined;
              for (const s of g.series) {
                const axis = s.axis === "right" && g.y2 ? g.y2 : g.y;
                const range = axis.max - axis.min || 1;
                const d = Math.abs(at(s.points, a.x) - a.y) / range;
                if (d <= 0.15 && (!best || d < best.d))
                  best = { ay: Yof(axis)(at(s.points, a.x)), d };
              }
              return { a, ax: X(a.x), ay: best ? best.ay : Y(a.y) };
            })(),
          ],
    );
  dots.push(...eaMarks);
  const byX = [...dots].sort((p, q) => p.ax - q.ax);
  const topLimit = legendH + band;
  for (const d of dots) {
    taken.push({
      x0: d.ax - fs * 0.4,
      y0: d.ay - fs * 0.4,
      x1: d.ax + fs * 0.4,
      y1: d.ay + fs * 0.4,
    });
  }
  if (peakRow) {
    const ly = legendH + small * 1.25;
    for (const [lab, box, anchor] of [
      [peakRow.a, peakRow.boxA, "end"],
      [peakRow.b, peakRow.boxB, "start"],
    ] as const) {
      const d = dots.find((q) => q.a === lab);
      if (!d) continue;
      taken.push({ x0: box.x0, x1: box.x1, y0: ly - small * 1.25, y1: ly });
      out.push(
        `<line x1="${n(d.ax)}" y1="${n(d.ay)}" x2="${n(d.ax)}" y2="${n(ly + 2)}" stroke="${c.muted}" stroke-width="1.5" stroke-dasharray="${n(fs * 0.35)} ${n(fs * 0.3)}"/>`,
        `<circle cx="${n(d.ax)}" cy="${n(d.ay)}" r="${n(fs * 0.3)}" fill="${c.ink}" stroke="${c.bg}" stroke-width="2"/>`,
        text(x, anchor === "end" ? box.x1 : box.x0, ly, [lab.label], {
          anchor,
          fs: small,
          weight: 600,
          halo: c.bg,
          v: "bottom",
        }),
      );
    }
  }
  const loosePlaced = byX.filter((d) => !peakRow?.skip.has(g.annotations.indexOf(d.a)));
  for (const [i, d] of loosePlaced.entries()) {
    const { a, ax, ay } = d;
    let lab = a.label;
    let lw = textWidth(lab, x, small, 600);
    const lh = small * 1.25;
    const off = fs * 1.6;
    const edgeLeft = ax > left + pw * 0.6;
    const prefLeft =
      loosePlaced.length > 1
        ? i === 0
          ? true
          : i === loosePlaced.length - 1
            ? false
            : edgeLeft
        : edgeLeft;
    type Spot = { lx: number; ly: number; anchor: "start" | "middle" | "end"; down: boolean };
    const spot = (side: -1 | 0 | 1, down: boolean, lift = 1, reach = 1): Spot => ({
      lx: ax + side * off * reach,
      ly: ay + (down ? 1 : -1) * fs * 1.8 * lift,
      anchor: side < 0 ? "end" : side > 0 ? "start" : "middle",
      down,
    });
    const boxOf = (p: Spot): Box => {
      const tx = p.anchor === "middle" ? p.lx : p.lx + (p.anchor === "end" ? -4 : 4);
      const x0 = p.anchor === "middle" ? tx - lw / 2 : p.anchor === "end" ? tx - lw : tx;
      const y0 = p.down ? p.ly : p.ly - lh;
      return { x0, y0, x1: x0 + lw, y1: y0 + lh };
    };
    const inside = (b: Box) =>
      b.x0 >= left && b.x1 <= left + pw && b.y0 >= topLimit && b.y1 <= top + ph;
    const clear = (b: Box) =>
      !crossesCurve(b) &&
      taken.every((t) => b.x1 <= t.x0 || b.x0 >= t.x1 || b.y1 <= t.y0 || b.y0 >= t.y1);
    const near: -1 | 1 = prefLeft ? -1 : 1;
    const far: -1 | 1 = prefLeft ? 1 : -1;
    const inward: -1 | 1 = ax < left + pw / 2 ? 1 : -1;
    const tries: Spot[] = [
      // dd-diagrams2: first right by the point, leaning into the plot, below then above (an
      // energy profile's "Reactants" sits under its level, not at the top on a long leader).
      spot(inward, true, 0.25, 0.2),
      spot(inward, false, 0.25, 0.2),
      // Just over the point, leaning outward: over a peak nothing of the curve is higher.
      spot(near, false, 0.6, 0.25),
      spot(far, false, 0.6, 0.25),
      spot(near, false),
      spot(0, false),
      spot(near, false, 1.8),
      spot(far, false),
      spot(near, true),
      spot(0, true),
      spot(far, true),
      spot(far, false, 1.8),
      spot(near, true, 1.8),
      spot(0, false, 2.6),
      spot(near, false, 2.6),
      spot(far, false, 2.6),
    ];
    const grid = (): Spot[] => {
      const g2: Spot[] = [];
      for (let fx = 0.05; fx <= 0.96; fx += 0.075)
        for (let fy = 0.04; fy <= 0.97; fy += 0.08)
          for (const anchor of ["start", "end", "middle"] as const)
            g2.push({ lx: left + fx * pw, ly: top + fy * ph, anchor, down: true });
      return g2.sort((p, q) => Math.hypot(p.lx - ax, p.ly - ay) - Math.hypot(q.lx - ax, q.ly - ay));
    };
    // dd-diagrams: an activation-energy label stands right beside its own arrow, on the side away
    // from the other arrow, with no leader, wherever that side is clear.
    const eaSide: Spot[] = d.ea
      ? (eaMarks.length === 2 &&
        eaMarks[0]?.ax !== undefined &&
        ax < Math.max(...eaMarks.map((m) => m.ax))
          ? [-1, 1]
          : [1, -1]
        ).flatMap((side) =>
          [0, -0.9, 0.9, -1.8, 1.8].map((dy) => ({
            lx: ax + side * fs * 0.35,
            ly: ay + dy * fs - lh / 2,
            anchor: side < 0 ? ("end" as const) : ("start" as const),
            down: true,
          })),
        )
      : [];
    // When the writer's name for it does not fit beside the arrow, the textbook "Ea" does; each
    // arrow is drawn in its own curve's colour, so the two read apart.
    let side: Spot | undefined;
    for (const name of d.ea ? [a.label, "Ea"] : []) {
      lab = name;
      lw = textWidth(name, x, small, 600);
      side = eaSide.find((p) => inside(boxOf(p)) && clear(boxOf(p)));
      if (side) break;
    }
    if (!side) {
      lab = a.label;
      lw = textWidth(lab, x, small, 600);
    }
    const pick =
      side ??
      tries.find((p) => inside(boxOf(p)) && clear(boxOf(p))) ??
      // dd-diagrams: else the nearest clear space anywhere in the plot, reached by a leader line.
      grid().find((p) => inside(boxOf(p)) && clear(boxOf(p))) ??
      tries.find((p) => inside(boxOf(p))) ??
      spot(0, ay - fs * 2.6 < topLimit);
    const box = boxOf(pick);
    taken.push(box);
    const tx = pick.anchor === "middle" ? pick.lx : pick.lx + (pick.anchor === "end" ? -4 : 4);
    out.push(
      side
        ? ""
        : `<line x1="${n(ax)}" y1="${n(ay)}" x2="${n(pick.lx)}" y2="${n(pick.ly)}" stroke="${c.ink}" stroke-width="1.5"/>`,
      d.ea
        ? ""
        : `<circle cx="${n(ax)}" cy="${n(ay)}" r="${n(fs * 0.3)}" fill="${c.ink}" stroke="${c.bg}" stroke-width="2"/>`,
      text(x, tx, pick.ly, [lab], {
        anchor: pick.anchor,
        fs: small,
        weight: 600,
        halo: c.bg,
        v: pick.down ? "top" : "bottom",
      }),
    );
  }

  // Intervals: dashed drops at both ends, a double arrow between them, the label above it.
  for (const { v, x1, x2, ay, lab } of spans) {
    const head = Math.max(9, fs * 0.55);
    const dash = `stroke-dasharray="${n(fs * 0.35)} ${n(fs * 0.3)}"`;
    out.push(
      `<line x1="${n(x1)}" y1="${n(ay)}" x2="${n(x1)}" y2="${n(top + ph)}" stroke="${c.muted}" stroke-width="1.5" ${dash}/>`,
      `<line x1="${n(x2)}" y1="${n(ay)}" x2="${n(x2)}" y2="${n(top + ph)}" stroke="${c.muted}" stroke-width="1.5" ${dash}/>`,
      `<line x1="${n(x1 + head * 0.8)}" y1="${n(ay)}" x2="${n(x2 - head * 0.8)}" y2="${n(ay)}" stroke="${c.ink}" stroke-width="2.5"/>`,
      arrowHead(x1, ay, x2, ay, head, c.ink),
      arrowHead(x2, ay, x1, ay, head, c.ink),
    );
    out.push(text(x, lab.lx, lab.ly, [v.label], { v: lab.vv, fs: small, weight: 600, halo: c.bg }));
  }

  // Legend.
  for (let { i, lx, row } of legendAt) {
    const sr = g.series[i];
    if (!sr?.label) continue;
    const colour = colours[i] ?? c.accent;
    const ly = sideLegend ? top + row * fs * 1.5 : row * fs * 1.3;
    if (sideLegend) lx = w - sideKeyW;
    const sw =
      sr.style === "tangent"
        ? `<line x1="${n(lx)}" y1="${n(ly + fs * 0.7)}" x2="${n(lx + fs)}" y2="${n(ly + fs * 0.7)}" stroke="${c.accent2}" stroke-width="2" stroke-dasharray="${n(fs * 0.3)} ${n(fs * 0.2)}"/>`
        : sr.style === "bars"
          ? `<rect x="${n(lx)}" y="${n(ly + fs * 0.3)}" width="${n(fs)}" height="${n(fs * 0.8)}" fill="${colour}" fill-opacity="0.55"/>`
          : `<line x1="${n(lx)}" y1="${n(ly + fs * 0.7)}" x2="${n(lx + fs)}" y2="${n(ly + fs * 0.7)}" stroke="${colour}" stroke-width="4" stroke-linecap="round"/>`;
    out.push(sw, text(x, lx + fs * 1.4, ly + fs * 0.7, [sr.label], { anchor: "start", fs: small }));
  }
  return out.join("");
}

/** The smallest gap between neighbouring x values (1 when there is none). */
function minGap(xs: number[]): number {
  let g = Number.POSITIVE_INFINITY;
  for (let i = 1; i < xs.length; i++) {
    const d = (xs[i] ?? 0) - (xs[i - 1] ?? 0);
    if (d > 0 && d < g) g = d;
  }
  return Number.isFinite(g) ? g : 1;
}

/** The series' value at `v`, straight-line between its points (the end values past its ends). */
function at(points: [number, number][], v: number): number {
  const firstPt = points[0];
  if (!firstPt) return 0;
  if (v <= firstPt[0]) return firstPt[1];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b && v <= b[0]) {
      return b[0] === a[0] ? b[1] : a[1] + ((v - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
    }
  }
  return points[points.length - 1]?.[1] ?? 0;
}

/** The point on the first data series nearest the tangent's midpoint (where it touches). */
function touchPoint(
  g: LineGraph,
  tangent: LineGraph["series"][number],
  _y: unknown,
): [number, number] | undefined {
  const data = g.series.find((s) => s.style === "line" && s !== tangent);
  const a = tangent.points[0];
  const b = tangent.points[tangent.points.length - 1];
  if (!data || !a || !b) return undefined;
  const mx = (a[0] + b[0]) / 2;
  const pts = data.points;
  for (let j = 0; j + 1 < pts.length; j++) {
    const p = pts[j] as [number, number];
    const q = pts[j + 1] as [number, number];
    if (mx >= p[0] && mx <= q[0]) {
      const k = q[0] === p[0] ? 0 : (mx - p[0]) / (q[0] - p[0]);
      return [mx, p[1] + (q[1] - p[1]) * k];
    }
  }
  return undefined;
}

/**
 * An SVG path through points in x order as a monotone cubic (Fritsch-Carlson): smooth, and never
 * above or below its neighbouring points, so a curve that levels off stays level.
 */
export function monotonePath(p: [number, number][]): string {
  if (p.length < 3) return p.map(([x, y], i) => `${i ? "L" : "M"}${n(x)},${n(y)}`).join(" ");
  const k = p.length;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i + 1 < k; i++) {
    const [x0, y0] = p[i] as [number, number];
    const [x1, y1] = p[i + 1] as [number, number];
    dx.push(x1 - x0);
    m.push(x1 === x0 ? 0 : (y1 - y0) / (x1 - x0));
  }
  const t: number[] = [m[0] ?? 0];
  for (let i = 1; i + 1 < k; i++) {
    const a = m[i - 1] ?? 0;
    const b = m[i] ?? 0;
    t.push(
      a * b <= 0
        ? 0
        : (3 * (dx[i - 1]! + dx[i]!)) /
            ((2 * dx[i]! + dx[i - 1]!) / a + (dx[i]! + 2 * dx[i - 1]!) / b),
    );
  }
  t.push(m[k - 2] ?? 0);
  let d = `M${n(p[0]![0])},${n(p[0]![1])}`;
  for (let i = 0; i + 1 < k; i++) {
    const [x0, y0] = p[i] as [number, number];
    const [x1, y1] = p[i + 1] as [number, number];
    const h = dx[i]! / 3;
    d += ` C${n(x0 + h)},${n(y0 + t[i]! * h)} ${n(x1 - h)},${n(y1 - t[i + 1]! * h)} ${n(x1)},${n(y1)}`;
  }
  return d;
}

/** dd-diagrams: an energy profile's humps (reaction progress against energy), highest first. */
function energyHumps(g: LineGraph): { x0: number; start: number; px: number; peak: number }[] {
  if (!/progress|reaction|pathway/i.test(g.x.label) || !/energy/i.test(g.y.label)) return [];
  const lines = g.series.filter((s) => s.style === "line" && s.points.length >= 3);
  if (lines.length < 1 || lines.length > 2) return [];
  const out = lines.map((s) => {
    const ys = s.points.map((p) => p[1]);
    const peak = Math.max(...ys);
    const k = ys.indexOf(peak);
    const [x0, start] = s.points[0] as [number, number];
    const end = ys[ys.length - 1] as number;
    return k > 0 && k < ys.length - 1 && peak > Math.max(start, end)
      ? { x0, start, px: (s.points[k] as [number, number])[0], peak }
      : undefined;
  });
  if (out.some((o) => !o)) return [];
  return (out as { x0: number; start: number; px: number; peak: number }[]).sort(
    (a, b) => b.peak - a.peak,
  );
}
