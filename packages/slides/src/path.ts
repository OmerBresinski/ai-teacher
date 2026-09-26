/**
 * The curve of a `path` element (ADR 0031), in the element's own point space. The editor's SVG
 * view and the PPTX exporter both draw these segments, so the screen and PowerPoint show the same
 * curve rather than two approximations of it.
 *
 * A smooth open path whose points run strictly left to right is a graph (an energy profile, a
 * rate curve): it gets a monotone cubic (Fritsch–Carlson), which never overshoots a level, so a
 * plateau stays flat and a peak is the highest point drawn. Any other smooth path (an arc, a
 * closed outline) gets a Catmull-Rom spline through its points.
 */
import type { PathElement } from "@tj/domain/documents";

type Point = { x: number; y: number };

export type PathSegment =
  | { type: "move"; x: number; y: number }
  | { type: "line"; x: number; y: number }
  | { type: "cubic"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: "close" };

export function pathSegments(
  element: Pick<PathElement, "points" | "smooth" | "closed">,
  w: number,
  h: number,
): PathSegment[] {
  const points = element.points.map((p) => ({ x: p.x * w, y: p.y * h }));
  const [first] = points;
  if (!first) return [];
  const segments: PathSegment[] = [{ type: "move", x: first.x, y: first.y }];
  if (!element.smooth || points.length < 3) {
    for (const p of points.slice(1)) segments.push({ type: "line", x: p.x, y: p.y });
  } else if (!element.closed && runsLeftToRight(points)) {
    segments.push(...monotoneCubic(points));
  } else {
    segments.push(...catmullRom(points, !!element.closed));
  }
  if (element.closed) segments.push({ type: "close" });
  return segments;
}

/** The SVG `d` attribute for the segments. */
export function pathData(segments: PathSegment[]): string {
  return segments.map(segmentData).join(" ");
}

const round = (v: number) => Math.round(v * 100) / 100;

function segmentData(s: PathSegment): string {
  switch (s.type) {
    case "move":
      return `M${round(s.x)} ${round(s.y)}`;
    case "line":
      return `L${round(s.x)} ${round(s.y)}`;
    case "cubic":
      return `C${round(s.x1)} ${round(s.y1)} ${round(s.x2)} ${round(s.y2)} ${round(s.x)} ${round(s.y)}`;
    case "close":
      return "Z";
  }
}

/**
 * Where each end of the drawn path points: the end point and the point the curve arrives from
 * (the last control point of a cubic), so an arrowhead follows the curve's direction.
 */
export function pathEnds(
  segments: PathSegment[],
): { start: [Point, Point]; end: [Point, Point] } | null {
  const drawn = segments.filter((s) => s.type !== "close");
  const move = drawn[0];
  const next = drawn[1];
  const last = drawn[drawn.length - 1];
  const before = drawn[drawn.length - 2];
  if (move?.type !== "move" || !next || next.type === "move" || !last || !before) return null;
  if (last.type === "move") return null;
  const startToward = next.type === "cubic" ? { x: next.x1, y: next.y1 } : next;
  const endFrom = last.type === "cubic" ? { x: last.x2, y: last.y2 } : before;
  return {
    start: [
      { x: move.x, y: move.y },
      { x: startToward.x, y: startToward.y },
    ],
    end: [
      { x: last.x, y: last.y },
      { x: endFrom.x, y: endFrom.y },
    ],
  };
}

function runsLeftToRight(points: Point[]): boolean {
  return points.every((p, i) => i === 0 || p.x > (points[i - 1]?.x ?? p.x));
}

/** Fritsch–Carlson monotone cubic through points with strictly increasing x. */
function monotoneCubic(points: Point[]): PathSegment[] {
  const at = (i: number) => points[i] as Point;
  const n = points.length;
  const secant: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    secant.push((at(i + 1).y - at(i).y) / (at(i + 1).x - at(i).x));
  }
  const d = (i: number) => secant[i] ?? 0;
  const slope = points.map((_, i) => {
    if (i === 0) return d(0);
    if (i === n - 1) return d(n - 2);
    const a = d(i - 1);
    const b = d(i);
    return a * b <= 0 ? 0 : (a + b) / 2;
  });
  for (let i = 0; i < n - 1; i++) {
    if (d(i) === 0) {
      slope[i] = 0;
      slope[i + 1] = 0;
      continue;
    }
    const a = (slope[i] ?? 0) / d(i);
    const b = (slope[i + 1] ?? 0) / d(i);
    const r = a * a + b * b;
    if (r > 9) {
      const t = 3 / Math.sqrt(r);
      slope[i] = t * a * d(i);
      slope[i + 1] = t * b * d(i);
    }
  }
  const segments: PathSegment[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p = at(i);
    const q = at(i + 1);
    const third = (q.x - p.x) / 3;
    segments.push({
      type: "cubic",
      x1: p.x + third,
      y1: p.y + (slope[i] ?? 0) * third,
      x2: q.x - third,
      y2: q.y - (slope[i + 1] ?? 0) * third,
      x: q.x,
      y: q.y,
    });
  }
  return segments;
}

/** Uniform Catmull-Rom through every point, as cubic Béziers; wraps round when closed. */
function catmullRom(points: Point[], closed: boolean): PathSegment[] {
  const n = points.length;
  const at = (i: number): Point =>
    closed ? (points[(i + n) % n] as Point) : (points[Math.max(0, Math.min(n - 1, i))] as Point);
  const segments: PathSegment[] = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    segments.push({
      type: "cubic",
      x1: p1.x + (p2.x - p0.x) / 6,
      y1: p1.y + (p2.y - p0.y) / 6,
      x2: p2.x - (p3.x - p1.x) / 6,
      y2: p2.y - (p3.y - p1.y) / 6,
      x: p2.x,
      y: p2.y,
    });
  }
  return segments;
}
