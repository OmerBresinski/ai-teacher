import { describe, expect, test } from "bun:test";
import {
  beginStroke,
  ERASER_RADIUS,
  erasePaths,
  extendStroke,
  hitsPath,
  type InkPath,
  type InkPoint,
  pathD,
  simplify,
  strokeD,
} from "./ink";

/*
 * Present-mode ink, in slide points (TeachDeck `lib/present/__tests__/ink.test.ts`, TEACH-113 gap
 * analysis): the incremental stroke builder is always the same string as `pathD` over the points
 * so far, and the eraser removes a stroke whole. `present.spec.ts` draws and erases with a real
 * pointer; this pins the geometry it runs on.
 */

/** A deterministic wobble, so a failure is reproducible. */
function points(n: number): InkPoint[] {
  const out: InkPoint[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ x: i * 3.7 + Math.sin(i) * 4, y: 100 + Math.cos(i * 0.7) * 30 });
  }
  return out;
}

const first = (pts: InkPoint[]): InkPoint => {
  const p = pts[0];
  if (!p) throw new Error("empty");
  return p;
};

describe("incremental stroke building", () => {
  test("matches pathD at every length", () => {
    const pts = points(40);
    let builder = beginStroke(first(pts));
    expect(strokeD(builder)).toBe(pathD(pts.slice(0, 1)));
    for (let i = 1; i < pts.length; i++) {
      builder = extendStroke(builder, pts[i] as InkPoint);
      expect(strokeD(builder)).toBe(pathD(pts.slice(0, i + 1)));
    }
  });

  test("appends rather than rebuilding: the prefix never changes", () => {
    const pts = points(12);
    const builder = beginStroke(first(pts));
    const prefixes: string[] = [];
    for (let i = 1; i < pts.length; i++) {
      extendStroke(builder, pts[i] as InkPoint);
      prefixes.push(builder.base);
    }
    for (let i = 1; i < prefixes.length; i++) {
      expect((prefixes[i] as string).startsWith(prefixes[i - 1] as string)).toBe(true);
    }
  });

  test("keeps every point for the commit, simplification aside", () => {
    const pts = points(30);
    const builder = beginStroke(first(pts));
    for (let i = 1; i < pts.length; i++) extendStroke(builder, pts[i] as InkPoint);
    expect(builder.points).toEqual(pts);
    const simplified = simplify(builder.points);
    expect(simplified.length).toBeLessThanOrEqual(pts.length);
    // The ends are never dropped, and a straight line collapses to them.
    expect(simplified[0]).toEqual(first(pts));
    expect(simplified[simplified.length - 1]).toEqual(pts[pts.length - 1] as InkPoint);
    const straight = Array.from({ length: 20 }, (_, i) => ({ x: i * 5, y: 50 }));
    expect(simplify(straight)).toEqual([
      { x: 0, y: 50 },
      { x: 95, y: 50 },
    ]);
  });

  test("a single tap is a visible dot, not an empty path", () => {
    expect(pathD([{ x: 10, y: 20 }])).toBe("M 10 20 l 0.01 0");
    expect(strokeD(beginStroke({ x: 10, y: 20 }))).toBe("M 10 20 l 0.01 0");
    expect(pathD([])).toBe("");
  });
});

describe("the eraser", () => {
  const stroke: InkPath = {
    id: "s1",
    tool: "pen",
    color: "#D92D20",
    width: 4,
    points: [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ],
  };
  const dot: InkPath = { ...stroke, id: "s2", points: [{ x: 400, y: 300 }] };

  test("hits a stroke within the radius plus half its width, and misses beyond it", () => {
    expect(hitsPath(stroke, { x: 150, y: 100 + ERASER_RADIUS })).toBe(true);
    expect(hitsPath(stroke, { x: 150, y: 100 + ERASER_RADIUS + 2 })).toBe(true); // + width / 2
    expect(hitsPath(stroke, { x: 150, y: 100 + ERASER_RADIUS + 3 })).toBe(false);
    expect(hitsPath(dot, { x: 410, y: 300 })).toBe(true);
    expect(hitsPath(dot, { x: 430, y: 300 })).toBe(false);
  });

  test("removes whole strokes under the eraser and returns the same array when nothing hit", () => {
    const paths = [stroke, dot];
    expect(erasePaths(paths, { x: 0, y: 0 })).toBe(paths);
    expect(erasePaths(paths, { x: 150, y: 100 })).toEqual([dot]);
    expect(erasePaths(paths, { x: 400, y: 300 })).toEqual([stroke]);
  });
});
