import type { PathSegment } from "./path";

type Point = { x: number; y: number };

/*
 * Apart from `path.ts` so the lesson pages, which draw paths but never sample them, do not carry
 * this: the item row samples its connecting line, and the editor's layout kit (TEACH-205 part b)
 * loads the templates lazily.
 */

/**
 * Points along the drawn segments, in the same space: each cubic evaluated at t = k / perSegment
 * for k = 0 to perSegment with the Bézier formula, and each straight segment (a `close` included)
 * at as many evenly spaced points. What a check that something stays clear of a curve tests
 * against (TEACH-94).
 */
export function samplePath(segments: PathSegment[], perSegment = 16): Point[] {
  const points: Point[] = [];
  let start: Point | undefined;
  let pen: Point | undefined;
  for (const s of segments) {
    if (s.type === "move") {
      start = { x: s.x, y: s.y };
      pen = start;
      continue;
    }
    if (!pen || !start) continue;
    const from: Point = pen;
    const to: Point = s.type === "close" ? start : { x: s.x, y: s.y };
    for (let k = 0; k <= perSegment; k++) {
      const t = k / perSegment;
      const u = 1 - t;
      if (s.type === "cubic") {
        points.push({
          x: u * u * u * from.x + 3 * u * u * t * s.x1 + 3 * u * t * t * s.x2 + t * t * t * to.x,
          y: u * u * u * from.y + 3 * u * u * t * s.y1 + 3 * u * t * t * s.y2 + t * t * t * to.y,
        });
      } else {
        points.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
      }
    }
    pen = to;
  }
  return points;
}
