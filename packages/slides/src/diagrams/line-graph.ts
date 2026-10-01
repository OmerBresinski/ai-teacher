/**
 * Line graphs: axes with round ticks, one to three series (a line or bars, on the left axis or a
 * second one on the right, as a hydrograph's rainfall), labelled stretches of the first series (a
 * heating curve's "melting"), pointed annotations ("peak discharge") and intervals between two x
 * values drawn as a labelled double arrow ("lag time").
 */
import type { LineGraph } from "./schema";
import { arrowHead, type Ctx, n, num, text, textWidth, ticks } from "./svg";

type Axis = { label: string; min: number; max: number; step?: number };
type Box = { x0: number; y0: number; x1: number; y1: number };

export function drawLineGraph(g: LineGraph, x: Ctx, w: number, h: number): string {
  const { c, fs } = x;
  const small = Math.max(14, Math.round(fs * 0.85));
  const xt = ticks(g.x.min, g.x.max, g.x.step);
  const yt = ticks(g.y.min, g.y.max, g.y.step);
  const y2t = g.y2 ? ticks(g.y2.min, g.y2.max, g.y2.step) : [];
  const tickW = (vals: number[]) => Math.max(0, ...vals.map((v) => textWidth(num(v), x, small)));
  const legend = g.series.length > 1 && g.series.some((s) => s.label);
  // Intervals with no `y` get a band of their own under the legend, one row each.
  const banded = g.intervals.filter((v) => v.y === undefined);
  const bandRow = small * 1.2 + fs * 0.9;
  const band = banded.length * bandRow;
  const top = (legend ? fs * 1.8 : 0) + fs * 0.8 + (g.annotations.length ? fs * 1.2 : 0) + band;
  const left = fs * 1.4 + tickW(yt) + 10;
  const right = g.y2
    ? fs * 1.4 + tickW(y2t) + 10
    : Math.max(12, textWidth(num(g.x.max), x, small) / 2);
  const bottom = small * 1.3 + fs * 1.5 + 6;
  const pw = w - left - right;
  const ph = h - top - bottom;
  const X = (v: number) => left + ((v - g.x.min) / (g.x.max - g.x.min)) * pw;
  const Yof = (a: Axis) => (v: number) => top + ph - ((v - a.min) / (a.max - a.min)) * ph;
  const Y = Yof(g.y);
  const out: string[] = [];

  // Grid and ticks.
  for (const v of yt) {
    out.push(
      `<line x1="${n(left)}" y1="${n(Y(v))}" x2="${n(left + pw)}" y2="${n(Y(v))}" stroke="${c.line}" stroke-width="1.5"/>`,
    );
    out.push(text(x, left - 8, Y(v), [num(v)], { fs: small, anchor: "end", fill: c.muted }));
  }
  for (const v of xt) {
    out.push(
      `<line x1="${n(X(v))}" y1="${n(top + ph)}" x2="${n(X(v))}" y2="${n(top + ph + 6)}" stroke="${c.ink}" stroke-width="2"/>`,
    );
    out.push(text(x, X(v), top + ph + 8, [num(v)], { fs: small, v: "top", fill: c.muted }));
  }
  if (g.y2) {
    const Y2 = Yof(g.y2);
    for (const v of y2t) {
      out.push(
        text(x, left + pw + 8, Y2(v), [num(v)], { fs: small, anchor: "start", fill: c.muted }),
      );
    }
  }
  // Axes, with the axis a zero crosses where it crosses.
  const baseY = Y(g.y.min <= 0 && g.y.max >= 0 ? 0 : g.y.min);
  out.push(
    `<line x1="${n(left)}" y1="${n(top)}" x2="${n(left)}" y2="${n(top + ph)}" stroke="${c.ink}" stroke-width="2.5"/>`,
    `<line x1="${n(left)}" y1="${n(top + ph)}" x2="${n(left + pw)}" y2="${n(top + ph)}" stroke="${c.ink}" stroke-width="2.5"/>`,
  );
  if (baseY !== top + ph) {
    out.push(
      `<line x1="${n(left)}" y1="${n(baseY)}" x2="${n(left + pw)}" y2="${n(baseY)}" stroke="${c.muted}" stroke-width="1.5"/>`,
    );
  }
  if (g.y2) {
    out.push(
      `<line x1="${n(left + pw)}" y1="${n(top)}" x2="${n(left + pw)}" y2="${n(top + ph)}" stroke="${c.ink}" stroke-width="2.5"/>`,
    );
  }
  // Axis titles.
  out.push(text(x, left + pw / 2, h - 2, [g.x.label], { v: "bottom", weight: 600 }));
  const yTitle = (label: string, cx: number, rot: number) =>
    `<g transform="translate(${n(cx)},${n(top + ph / 2)}) rotate(${rot})">${text({ ...x, rec: undefined }, 0, 0, [label], { weight: 600 })}</g>`;
  out.push(yTitle(g.y.label, fs * 0.7, -90));
  if (g.y2) out.push(yTitle(g.y2.label, w - fs * 0.7, 90));

  // Series: bars first, so lines draw over them.
  const colours = [c.accent, c.accent2, c.muted];
  const order = g.series
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.style === "bars" ? -1 : 0) - (b.s.style === "bars" ? -1 : 0));
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
    } else {
      const d = s.points.map(([px, py]) => `${n(X(px))},${n(Ys(py))}`).join(" ");
      out.push(
        `<polyline points="${d}" fill="none" stroke="${colour}" stroke-width="${n(Math.max(3.5, fs * 0.22))}" stroke-linejoin="round" stroke-linecap="round"/>`,
      );
    }
  }

  // Labelled stretches of the first series.
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
      v.y === undefined ? (legend ? fs * 1.8 : 0) + row * bandRow + small * 1.2 + fs * 0.3 : Y(v.y);
    const lw = textWidth(v.label, x, small, 600);
    const cx = Math.max(lw / 2 + 2, Math.min(w - lw / 2 - 2, (x1 + x2) / 2));
    return { v, x1, x2, ay, cx, lw };
  });
  const taken: Box[] = spans.flatMap((sp) => [
    {
      x0: sp.cx - sp.lw / 2 - 4,
      y0: sp.ay - fs * 0.3 - small * 1.25,
      x1: sp.cx + sp.lw / 2 + 4,
      y1: sp.ay - fs * 0.3,
    },
    { x0: sp.x1, y0: sp.ay - 6, x1: sp.x2, y1: sp.ay + 6 },
  ]);

  // Annotations: a dot on the series point it names and a leader to its label. Each dot snaps to
  // the series whose value at its x is nearest its y, on that series' own axis (a hydrograph's
  // rainfall peak is on the right axis). Labels spread outward in x order, so two leaders never
  // cross, and each takes the first place clear of the plot's edges, the interval labels and the
  // labels already set.
  const dots = g.annotations.map((a) => {
    let best: { ay: number; d: number } | undefined;
    for (const s of g.series) {
      const axis = s.axis === "right" && g.y2 ? g.y2 : g.y;
      const range = axis.max - axis.min || 1;
      const d = Math.abs(at(s.points, a.x) - a.y) / range;
      if (d <= 0.15 && (!best || d < best.d)) best = { ay: Yof(axis)(at(s.points, a.x)), d };
    }
    return { a, ax: X(a.x), ay: best ? best.ay : Y(a.y) };
  });
  const byX = [...dots].sort((p, q) => p.ax - q.ax);
  const topLimit = (legend ? fs * 1.8 : 0) + band;
  for (const d of dots) {
    taken.push({
      x0: d.ax - fs * 0.4,
      y0: d.ay - fs * 0.4,
      x1: d.ax + fs * 0.4,
      y1: d.ay + fs * 0.4,
    });
  }
  for (const [i, d] of byX.entries()) {
    const { a, ax, ay } = d;
    const lw = textWidth(a.label, x, small, 600);
    const lh = small * 1.25;
    const off = fs * 1.6;
    const edgeLeft = ax > left + pw * 0.6;
    const prefLeft =
      byX.length > 1 ? (i === 0 ? true : i === byX.length - 1 ? false : edgeLeft) : edgeLeft;
    type Spot = { lx: number; ly: number; anchor: "start" | "middle" | "end"; down: boolean };
    const spot = (side: -1 | 0 | 1, down: boolean, lift = 1): Spot => ({
      lx: ax + side * off,
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
      taken.every((t) => b.x1 <= t.x0 || b.x0 >= t.x1 || b.y1 <= t.y0 || b.y0 >= t.y1);
    const near: -1 | 1 = prefLeft ? -1 : 1;
    const far: -1 | 1 = prefLeft ? 1 : -1;
    const tries: Spot[] = [
      spot(near, false),
      spot(0, false),
      spot(near, false, 1.8),
      spot(far, false),
      spot(near, true),
      spot(0, true),
      spot(far, true),
    ];
    const pick =
      tries.find((p) => inside(boxOf(p)) && clear(boxOf(p))) ??
      tries.find((p) => inside(boxOf(p))) ??
      spot(0, ay - fs * 2.6 < topLimit);
    const box = boxOf(pick);
    taken.push(box);
    const tx = pick.anchor === "middle" ? pick.lx : pick.lx + (pick.anchor === "end" ? -4 : 4);
    out.push(
      `<line x1="${n(ax)}" y1="${n(ay)}" x2="${n(pick.lx)}" y2="${n(pick.ly)}" stroke="${c.ink}" stroke-width="1.5"/>`,
      `<circle cx="${n(ax)}" cy="${n(ay)}" r="${n(fs * 0.3)}" fill="${c.ink}" stroke="${c.bg}" stroke-width="2"/>`,
      text(x, tx, pick.ly, [a.label], {
        anchor: pick.anchor,
        fs: small,
        weight: 600,
        halo: c.bg,
        v: pick.down ? "top" : "bottom",
      }),
    );
  }

  // Intervals: dashed drops at both ends, a double arrow between them, the label above it.
  for (const { v, x1, x2, ay, cx } of spans) {
    const head = Math.max(9, fs * 0.55);
    const dash = `stroke-dasharray="${n(fs * 0.35)} ${n(fs * 0.3)}"`;
    out.push(
      `<line x1="${n(x1)}" y1="${n(ay)}" x2="${n(x1)}" y2="${n(top + ph)}" stroke="${c.muted}" stroke-width="1.5" ${dash}/>`,
      `<line x1="${n(x2)}" y1="${n(ay)}" x2="${n(x2)}" y2="${n(top + ph)}" stroke="${c.muted}" stroke-width="1.5" ${dash}/>`,
      `<line x1="${n(x1 + head * 0.8)}" y1="${n(ay)}" x2="${n(x2 - head * 0.8)}" y2="${n(ay)}" stroke="${c.ink}" stroke-width="2.5"/>`,
      arrowHead(x1, ay, x2, ay, head, c.ink),
      arrowHead(x2, ay, x1, ay, head, c.ink),
    );
    out.push(
      text(x, cx, ay - fs * 0.3, [v.label], { v: "bottom", fs: small, weight: 600, halo: c.bg }),
    );
  }

  // Legend.
  if (legend) {
    let lx = left;
    g.series.forEach((s, i) => {
      if (!s.label) return;
      const colour = colours[i] ?? c.accent;
      const sw =
        s.style === "bars"
          ? `<rect x="${n(lx)}" y="${n(fs * 0.3)}" width="${n(fs)}" height="${n(fs * 0.8)}" fill="${colour}" fill-opacity="0.55"/>`
          : `<line x1="${n(lx)}" y1="${n(fs * 0.7)}" x2="${n(lx + fs)}" y2="${n(fs * 0.7)}" stroke="${colour}" stroke-width="4" stroke-linecap="round"/>`;
      out.push(sw, text(x, lx + fs * 1.4, fs * 0.7, [s.label], { anchor: "start", fs: small }));
      lx += fs * 2.4 + textWidth(s.label, x, small);
    });
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
