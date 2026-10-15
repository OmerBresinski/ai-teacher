/**
 * The arrow primitive (TEACH-75 part x; THEMING §8 "Arrow primitive"). Every line arrow is a shaft
 * plus one open chevron head:
 * - the head's tip IS the shaft's end point, so the shaft ends under the head at any angle or length;
 * - the two arms sit symmetric about the shaft's end tangent, at ±32°, each 3.2 × the stroke long;
 * - head and shaft share one stroke, with round caps and joins, so nothing pokes past the tip.
 * Dashed and dotted shafts are phased (`stroke-dashoffset`) so a dash or dot ends under the head.
 * Filled block arrows are shapes, not line arrows, and do not use this. Pure geometry and strings.
 */

export type Pt = readonly [number, number];

/** Half the angle between the arms, in degrees. */
export const ARROW_ARM_DEG = 32;
/** Each arm's length as a multiple of the stroke width. */
export const ARROW_ARM_K = 3.2;
/** The build check's tolerances: shaft end to tip, and arm symmetry. */
export const ARROW_TIP_TOL = 0.5;
export const ARROW_SYM_TOL_DEG = 0.5;

export interface ArrowHead {
  /** The tip: the shaft's end point. */
  tip: Pt;
  /** Unit vector of the shaft's direction at its end (pointing out through the tip). */
  dir: Pt;
  /** The two arm ends. */
  arms: [Pt, Pt];
  /** The stroke the head and shaft share. */
  sw: number;
  /** The head as an open path: arm, tip, arm. */
  d: string;
}

const f = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};

/**
 * The head whose tip is `tip`, the shaft arriving from `from` (any point on the shaft's end
 * tangent behind the tip: the previous point of a line, the last control point of a curve).
 */
export function arrowHead(tip: Pt, from: Pt, sw: number): ArrowHead {
  const dx = tip[0] - from[0];
  const dy = tip[1] - from[1];
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L;
  const uy = dy / L;
  const a = (ARROW_ARM_DEG * Math.PI) / 180;
  const len = sw * ARROW_ARM_K;
  const arm = (s: number): Pt => {
    const c = Math.cos(s * a);
    const n = Math.sin(s * a);
    return [tip[0] - (ux * c - uy * n) * len, tip[1] - (ux * n + uy * c) * len];
  };
  const arms: [Pt, Pt] = [arm(1), arm(-1)];
  const d = `M${f(arms[0][0])} ${f(arms[0][1])} L${f(tip[0])} ${f(tip[1])} L${f(arms[1][0])} ${f(arms[1][1])}`;
  return { tip, dir: [ux, uy], arms, sw, d };
}

export interface StrokeStyle {
  /** Stroke colour (a theme var is fine). */
  ink: string;
  /** Numeric stroke width: the head's geometry is sized from it. */
  sw: number;
  /** What to write as `stroke-width` when it differs from `sw` (e.g. a CSS var resolving to `sw`). */
  width?: string;
  /** "dash gap" in user units; the shaft is phased so a dash (or dot) ends under the head. */
  dash?: string;
  /** Extra attributes for the shaft path, written verbatim. */
  shaftAttrs?: string;
}

/** The head as SVG: one stroked open path, tagged for the build check (`data-tip`, `data-dir`). */
export function arrowHeadSvg(head: ArrowHead, ink: string, width: string = f(head.sw)): string {
  return `<path class="ahead" data-tip="${f(head.tip[0])},${f(head.tip[1])}" data-dir="${head.dir[0].toFixed(5)},${head.dir[1].toFixed(5)}" d="${head.d}" fill="none" stroke="${ink}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** Parse a "dash gap" (or "dash, gap") pattern; undefined when it is not two numbers. */
function dashPair(dash: string): [number, number] | undefined {
  const v = dash
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (v.length !== 2 || v.some((x) => !Number.isFinite(x) || x < 0) || v[0]! + v[1]! <= 0)
    return undefined;
  return [v[0]!, v[1]!];
}

/**
 * The `stroke-dashoffset` that ends a "dash gap" pattern exactly at `length`: the last dash (for a
 * dotted line, the last dot) finishes at the shaft's end, under the head, with no gap before it.
 */
export function endDashOffset(length: number, dash: number, gap: number): number {
  const period = dash + gap;
  if (period <= 0) return 0;
  const o = (((dash - length) % period) + period) % period;
  return Math.round(o * 1000) / 1000;
}

/** The shaft as SVG: `d` ending exactly at the head's tip. */
function shaftSvg(d: string, length: number, s: StrokeStyle): string {
  let dash = "";
  const pair = s.dash ? dashPair(s.dash) : undefined;
  if (s.dash) {
    dash = ` stroke-dasharray="${s.dash}"`;
    if (pair) dash += ` stroke-dashoffset="${f(endDashOffset(length, pair[0], pair[1]))}"`;
  }
  return `<path class="ashaft" d="${d}" fill="none" stroke="${s.ink}" stroke-width="${s.width ?? f(s.sw)}" stroke-linecap="round" stroke-linejoin="round"${dash}${s.shaftAttrs ? ` ${s.shaftAttrs}` : ""}/>`;
}

export interface Arrow {
  /** The shaft's path, ending at the tip. */
  shaft: string;
  head: ArrowHead;
  /** Shaft then head, as SVG. */
  svg: string;
}

/** A straight line arrow from `a` to its tip `b`. */
export function arrowLine(a0: Pt, b0: Pt, s: StrokeStyle): Arrow {
  const [a, b] = [r2(a0), r2(b0)];
  const head = arrowHead(b, a, s.sw);
  const shaft = `M${f(a[0])} ${f(a[1])} L${f(b[0])} ${f(b[1])}`;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return { shaft, head, svg: shaftSvg(shaft, len, s) + arrowHeadSvg(head, s.ink, s.width) };
}

/** A quadratic arrow from `a`, bowed through control `c`, to its tip `b`. */
export function arrowQuad(a0: Pt, c0: Pt, b0: Pt, s: StrokeStyle): Arrow {
  const [a, c, b] = [r2(a0), r2(c0), r2(b0)];
  const shaft = `M${f(a[0])} ${f(a[1])} Q${f(c[0])} ${f(c[1])} ${f(b[0])} ${f(b[1])}`;
  const head = arrowHead(b, approach(shaft, b, s.sw) ?? (near(c, b) ? a : c), s.sw);
  return {
    shaft,
    head,
    svg: shaftSvg(shaft, pathLength(shaft), s) + arrowHeadSvg(head, s.ink, s.width),
  };
}

/** A cubic arrow p0 → c1, c2 → tip p1; the head follows the end tangent (p1 − c2). */
export function arrowCubic(q0: Pt, q1: Pt, q2: Pt, q3: Pt, s: StrokeStyle): Arrow {
  // the head is built from the same rounded points the shaft is written with
  const [p0, c1, c2, p1] = [r2(q0), r2(q1), r2(q2), r2(q3)];
  const shaft = `M${f(p0[0])} ${f(p0[1])} C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p1[0])} ${f(p1[1])}`;
  const tangent = !near(c2, p1) ? c2 : !near(c1, p1) ? c1 : p0;
  const head = arrowHead(p1, approach(shaft, p1, s.sw) ?? tangent, s.sw);
  return {
    shaft,
    head,
    svg: shaftSvg(shaft, pathLength(shaft), s) + arrowHeadSvg(head, s.ink, s.width),
  };
}

/**
 * An arrow along any absolute path `d` (M, L, H, V, Q, C) whose last point is the tip; the head
 * follows the path's end tangent.
 */
export function arrowPath(d: string, s: StrokeStyle): Arrow | undefined {
  const end = pathEnd(d);
  if (!end) return undefined;
  const head = arrowHead(end.tip, approach(d, end.tip, s.sw) ?? end.from, s.sw);
  return {
    shaft: d,
    head,
    svg: shaftSvg(d, pathLength(d), s) + arrowHeadSvg(head, s.ink, s.width),
  };
}

/**
 * Where a curved shaft comes from as it reaches the head: the point on it one head-depth back
 * from the tip. On a curve the head follows this chord rather than the bare end tangent, so it sits
 * on the line the eye sees (the two agree on any gentle curve; they differ only when the last
 * control point all but touches the tip, where the tangent points somewhere the shaft does not go).
 */
function approach(d: string, tip: Pt, sw: number): Pt | undefined {
  const depth = sw * ARROW_ARM_K * Math.cos((ARROW_ARM_DEG * Math.PI) / 180);
  const pts = samplePath(d, 256);
  for (let k = pts.length - 2; k >= 0; k--) {
    const p = pts[k]!;
    const dist = Math.hypot(p[0] - tip[0], p[1] - tip[1]);
    if (dist >= depth) {
      // interpolate to exactly one head-depth back
      const q = pts[k + 1]!;
      const dq = Math.hypot(q[0] - tip[0], q[1] - tip[1]);
      const t = dist === dq ? 0 : (dist - depth) / (dist - dq);
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    }
  }
  return undefined;
}

const r2 = (p: Pt): Pt => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];
const near = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6;

type Seg = { k: "L"; p: Pt[] } | { k: "Q"; p: Pt[] } | { k: "C"; p: Pt[] };

/** Absolute M/L/H/V/Q/C path → segments (each with its start point first). */
function segments(d: string): Seg[] | undefined {
  const toks = d.match(/[MLHVQCZmlhvqcz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
  if (!toks) return undefined;
  const out: Seg[] = [];
  let cur: Pt = [0, 0];
  let start: Pt = [0, 0];
  let cmd = "";
  let i = 0;
  const num = () => Number(toks[i++]);
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i]!)) cmd = toks[i++]!;
    if (cmd !== cmd.toUpperCase() && cmd !== "z") return undefined;
    switch (cmd) {
      case "M":
        cur = [num(), num()];
        start = cur;
        cmd = "L";
        break;
      case "L": {
        const p: Pt = [num(), num()];
        out.push({ k: "L", p: [cur, p] });
        cur = p;
        break;
      }
      case "H": {
        const p: Pt = [num(), cur[1]];
        out.push({ k: "L", p: [cur, p] });
        cur = p;
        break;
      }
      case "V": {
        const p: Pt = [cur[0], num()];
        out.push({ k: "L", p: [cur, p] });
        cur = p;
        break;
      }
      case "Q": {
        const c: Pt = [num(), num()];
        const p: Pt = [num(), num()];
        out.push({ k: "Q", p: [cur, c, p] });
        cur = p;
        break;
      }
      case "C": {
        const c1: Pt = [num(), num()];
        const c2: Pt = [num(), num()];
        const p: Pt = [num(), num()];
        out.push({ k: "C", p: [cur, c1, c2, p] });
        cur = p;
        break;
      }
      case "Z":
      case "z":
        out.push({ k: "L", p: [cur, start] });
        cur = start;
        cmd = "";
        break;
      default:
        return undefined;
    }
    if (out.some((s) => s.p.some((q) => !Number.isFinite(q[0]) || !Number.isFinite(q[1]))))
      return undefined;
  }
  return out;
}

/** A point on a segment at t. */
function at(s: Seg, t: number): Pt {
  const [a, b, c, d] = s.p as [Pt, Pt, Pt?, Pt?];
  const u = 1 - t;
  if (s.k === "L") return [a[0] * u + b[0] * t, a[1] * u + b[1] * t];
  if (s.k === "Q")
    return [
      u * u * a[0] + 2 * u * t * b[0] + t * t * c![0],
      u * u * a[1] + 2 * u * t * b[1] + t * t * c![1],
    ];
  return [
    u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c![0] + t * t * t * d![0],
    u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c![1] + t * t * t * d![1],
  ];
}

/** Points along an absolute path, `n` per curve: for length and for tests. */
export function samplePath(d: string, n = 64): Pt[] {
  const segs = segments(d) ?? [];
  const pts: Pt[] = [];
  for (const s of segs) {
    if (!pts.length) pts.push(s.p[0]!);
    const steps = s.k === "L" ? 1 : n;
    for (let k = 1; k <= steps; k++) pts.push(at(s, k / steps));
  }
  return pts;
}

/** The drawn length of an absolute path (curves by fine sampling). */
export function pathLength(d: string): number {
  const pts = samplePath(d, 128);
  let L = 0;
  for (let k = 1; k < pts.length; k++)
    L += Math.hypot(pts[k]![0] - pts[k - 1]![0], pts[k]![1] - pts[k - 1]![1]);
  return L;
}

/** The path's end point and a point behind it on its end tangent. */
export function pathEnd(d: string): { tip: Pt; from: Pt } | undefined {
  const segs = segments(d);
  if (!segs?.length) return undefined;
  for (let k = segs.length - 1; k >= 0; k--) {
    const p = segs[k]!.p;
    const tip = p[p.length - 1]!;
    for (let j = p.length - 2; j >= 0; j--) if (!near(p[j]!, tip)) return { tip, from: p[j]! };
  }
  return undefined;
}

/**
 * The build check (THEMING §8): what is wrong with one arrow, or [] when it is clean. The shaft's
 * end must sit within 0.5px of the tip, and the arms within 0.5° of symmetric about the shaft.
 */
export function arrowFaults(
  head: { tip: Pt; dir: Pt; arms: readonly [Pt, Pt] },
  shaftEnd: Pt | undefined,
): string[] {
  const bad: string[] = [];
  const [tx, ty] = head.tip;
  if (!shaftEnd || Math.hypot(tx - shaftEnd[0], ty - shaftEnd[1]) > ARROW_TIP_TOL)
    bad.push("arrow: shaft end not under head tip");
  const [ux, uy] = head.dir;
  const ang = ([x, y]: Pt) =>
    (Math.acos(
      Math.max(
        -1,
        Math.min(1, ((x - tx) * -ux + (y - ty) * -uy) / (Math.hypot(x - tx, y - ty) || 1)),
      ),
    ) *
      180) /
    Math.PI;
  if (Math.abs(ang(head.arms[0]) - ang(head.arms[1])) > ARROW_SYM_TOL_DEG)
    bad.push("arrow: head arms not symmetric about the shaft");
  return bad;
}

/** Read a head back from its SVG attributes (`data-tip`, `data-dir`, `d`), as the DOM check does. */
export function headFromAttrs(
  tip: string,
  dir: string,
  d: string,
): { tip: Pt; dir: Pt; arms: [Pt, Pt] } {
  const t = tip.split(",").map(Number) as [number, number];
  const u = dir.split(",").map(Number) as [number, number];
  const v = (d.match(/-?[\d.]+(?:e[-+]?\d+)?/g) ?? []).map(Number);
  return {
    tip: t,
    dir: u,
    arms: [
      [v[0]!, v[1]!],
      [v[4]!, v[5]!],
    ],
  };
}

/** The head as a PPTX custom-geometry polyline (arm, tip, arm), from the same points as the SVG. */
export function arrowHeadPolyline(head: ArrowHead): Pt[] {
  return [head.arms[0], head.tip, head.arms[1]];
}
