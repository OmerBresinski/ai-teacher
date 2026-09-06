/**
 * Ink helpers for present mode. Pure functions in slide coordinates (960x540pt),
 * so a stroke drawn on a 4K projector and one drawn on a laptop are the same data.
 */

export type InkTool = "pen" | "highlighter";

export type InkPoint = { x: number; y: number };

export type InkPath = {
  id: string;
  tool: InkTool;
  /** Hex, in the ink palette below. */
  color: string;
  /** Stroke width in slide points. Pressure-agnostic: one width per tool. */
  width: number;
  points: InkPoint[];
};

/** SPEC §8: pen 4pt opaque, highlighter 18pt multiply at 40%. */
export const PEN = { color: "#D92D20", width: 4 } as const;
export const HIGHLIGHTER = { color: "#FFD400", width: 18 } as const;
export const HIGHLIGHTER_ALPHA = 0.4;

/** Eraser radius in slide points; a stroke is removed whole, never split. */
export const ERASER_RADIUS = 14;

export const inkDefaults = (tool: InkTool) => (tool === "pen" ? PEN : HIGHLIGHTER);

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

/** Squared distance from `p` to the segment `a`–`b`. */
function sqSegmentDistance(p: InkPoint, a: InkPoint, b: InkPoint): number {
  let x = a.x;
  let y = a.y;
  let dx = b.x - x;
  let dy = b.y - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b.x;
      y = b.y;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p.x - x;
  dy = p.y - y;
  return dx * dx + dy * dy;
}

/**
 * Ramer–Douglas–Peucker. A whiteboard pen emits a point every few milliseconds;
 * dropping the ones that sit on the line keeps the SVG small without visibly
 * changing the stroke.
 */
export function simplify(points: InkPoint[], tolerance = 1.4): InkPoint[] {
  if (points.length < 3) return points.slice();
  const sq = tolerance * tolerance;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop() as [number, number];
    let worst = 0;
    let index = -1;
    const pa = points[a];
    const pb = points[b];
    if (!pa || !pb) continue;
    for (let i = a + 1; i < b; i++) {
      const pi = points[i];
      if (!pi) continue;
      const d = sqSegmentDistance(pi, pa, pb);
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (worst > sq && index > 0) {
      keep[index] = true;
      stack.push([a, index], [index, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const r = (n: number) => Math.round(n * 10) / 10;

/** Quadratic through segment midpoints: smooth without a spline library. */
export function pathD(points: InkPoint[]): string {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return "";
  if (points.length === 1) return `M ${r(first.x)} ${r(first.y)} l 0.01 0`;
  let d = `M ${r(first.x)} ${r(first.y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const n = points[i + 1];
    if (!p || !n) continue;
    d += ` Q ${r(p.x)} ${r(p.y)} ${r((p.x + n.x) / 2)} ${r((p.y + n.y) / 2)}`;
  }
  d += ` L ${r(last.x)} ${r(last.y)}`;
  return d;
}

/* ------------------------------------------------------------------ */
/* Incremental path building                                           */
/* ------------------------------------------------------------------ */

/**
 * A stroke in progress. `pathD` re-serialises every point on every call, which
 * at pointer rate is quadratic in the length of the stroke; a live stroke instead
 * appends one segment per point and keeps the string it has already built.
 * `strokeD(builder)` is always identical to `pathD(points so far)`.
 */
export type StrokeBuilder = {
  /** Everything up to, but not including, the trailing segment to `last`. */
  base: string;
  last: InkPoint;
  points: InkPoint[];
};

export function beginStroke(at: InkPoint): StrokeBuilder {
  return { base: `M ${r(at.x)} ${r(at.y)}`, last: at, points: [at] };
}

/** O(1): appends the quadratic that the previous point has now become. */
export function extendStroke(b: StrokeBuilder, at: InkPoint): StrokeBuilder {
  if (b.points.length >= 2) {
    const p = b.last;
    b.base += ` Q ${r(p.x)} ${r(p.y)} ${r((p.x + at.x) / 2)} ${r((p.y + at.y) / 2)}`;
  }
  b.last = at;
  b.points.push(at);
  return b;
}

export function strokeD(b: StrokeBuilder): string {
  if (b.points.length === 1) return `${b.base} l 0.01 0`;
  return `${b.base} L ${r(b.last.x)} ${r(b.last.y)}`;
}

/** True when the eraser circle touches any part of the stroke. */
export function hitsPath(path: InkPath, at: InkPoint, radius = ERASER_RADIUS): boolean {
  const reach = radius + path.width / 2;
  const sq = reach * reach;
  const pts = path.points;
  const only = pts[0];
  if (pts.length === 1 && only) {
    const dx = only.x - at.x;
    const dy = only.y - at.y;
    return dx * dx + dy * dy <= sq;
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a && b && sqSegmentDistance(at, a, b) <= sq) return true;
  }
  return false;
}

/** Removes whole strokes under the eraser. Returns the same array when nothing hit. */
export function erasePaths(paths: InkPath[], at: InkPoint, radius = ERASER_RADIUS): InkPath[] {
  const next = paths.filter((p) => !hitsPath(p, at, radius));
  return next.length === paths.length ? paths : next;
}
