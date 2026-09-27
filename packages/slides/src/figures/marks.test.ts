import { describe, expect, it } from "bun:test";
import type { LineElement, PathElement, SlideElement, TextElement } from "@tj/domain/documents";
// The layouts first: `./marks` sits in the layouts ↔ figures import cycle (see `./right-triangle`).
import "../layouts";
import { pathSegments, samplePath } from "../path";
import { getTheme } from "../themes";
import {
  angleArc,
  equalTicks,
  midArrow,
  northLine,
  parallelArrows,
  pointMark,
  rightAngleMark,
  segment,
} from "./marks";

/* TEACH-98 acceptance rows 8 to 10: the shared marks. */

const t = getTheme("chalk");
type Point = { x: number; y: number };

/** A path's points in the group's space. */
const pointsOf = (p: PathElement): Point[] =>
  p.points.map((q) => ({ x: p.x + q.x * p.w, y: p.y + q.y * p.h }));
/** A line's two ends in the group's space. */
const endsOf = (l: LineElement): [Point, Point] => [
  { x: l.x + l.from.x * l.w, y: l.y + l.from.y * l.h },
  { x: l.x + l.to.x * l.w, y: l.y + l.to.y * l.h },
];
/** A direction `deg` counter-clockwise on screen from the right, `r` from `v`. */
const polar = (v: Point, deg: number, r: number): Point => ({
  x: v.x + r * Math.cos((deg * Math.PI) / 180),
  y: v.y - r * Math.sin((deg * Math.PI) / 180),
});
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const minus = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y });
const noRotation = (els: SlideElement[]) => {
  for (const el of els) expect(el.rotation, `${el.type} "${el.name}"`).toBeUndefined();
};

describe("rightAngleMark", () => {
  it("row 8: an open three-point path with its corners size along each direction, at 30° and 120°", () => {
    const v = { x: 100, y: 200 };
    const size = 18;
    const mark = rightAngleMark(v, polar(v, 30, 90), polar(v, 120, 40), size, t);
    expect(mark.type).toBe("path");
    expect(mark.closed).toBeUndefined();
    expect(mark.smooth).toBeUndefined();
    expect(mark.stroke).toBe(t.colors.ink);
    noRotation([mark]);
    const [first, corner, last] = pointsOf(mark);
    expect(pointsOf(mark)).toHaveLength(3);
    const near = (a: Point | undefined, b: Point) => {
      expect(a?.x).toBeCloseTo(b.x, 6);
      expect(a?.y).toBeCloseTo(b.y, 6);
    };
    near(first, polar(v, 30, size));
    near(last, polar(v, 120, size));
    // The far corner closes the square: size from each corner point, size·√2 from the vertex.
    near(corner, polar(polar(v, 30, size), 120, size));
    expect(dist(corner as Point, v)).toBeCloseTo(size * Math.SQRT2, 6);
  });

  it("draws right-triangle's axis-aligned mark as the m×m box with points (0,0) (1,0) (1,1)", () => {
    const mark = rightAngleMark({ x: 40, y: 300 }, { x: 40, y: 100 }, { x: 240, y: 300 }, 20, t);
    expect([mark.x, mark.y, mark.w, mark.h]).toEqual([40, 280, 20, 20]);
    expect(mark.points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);
  });

  it("takes a colour", () => {
    const mark = rightAngleMark({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, 10, t, {
      color: t.colors.accent,
    });
    expect(mark.stroke).toBe(t.colors.accent);
  });
});

describe("angleArc", () => {
  const samples = (arc: PathElement) => samplePath(pathSegments(arc, arc.w, arc.h), 16);
  const bearing = (v: Point, p: Point) =>
    ((((Math.atan2(v.y - p.y, p.x - v.x) * 180) / Math.PI) % 360) + 360) % 360;

  it("row 9: two smooth arcs on radii 30 and 34 within 0.5pt, from 20° to 80° counter-clockwise", () => {
    const v = { x: 200, y: 200 };
    const arcs = angleArc(v, 20, 80, 30, t, { count: 2 });
    expect(arcs).toHaveLength(2);
    noRotation(arcs);
    arcs.forEach((arc, i) => {
      expect(arc.smooth).toBe(true);
      expect(arc.closed).toBeUndefined();
      const radius = 30 + 4 * i;
      const pts = samples(arc).map((p) => ({ x: p.x + arc.x, y: p.y + arc.y }));
      for (const p of pts) expect(Math.abs(dist(p, v) - radius)).toBeLessThanOrEqual(0.5);
      const angles = pts.map((p) => bearing(v, p));
      expect(Math.min(...angles)).toBeCloseTo(20, 3);
      expect(Math.max(...angles)).toBeCloseTo(80, 3);
      // Counter-clockwise on screen: the first point is at 20°, the last at 80°.
      expect(angles[0]).toBeCloseTo(20, 3);
      expect(angles.at(-1)).toBeCloseTo(80, 3);
    });
  });

  it("stays on the circle for arcs that run left to right, across 0° and at a reflex angle", () => {
    const v = { x: 200, y: 200 };
    for (const [from, to] of [
      [200, 340],
      [330, 30],
      [10, 350],
      [90, 180],
    ] as const) {
      for (const radius of [16, 30, 60]) {
        for (const arc of angleArc(v, from, to, radius, t, { count: 3 })) {
          const r = dist(pointsOf(arc)[0] as Point, v);
          for (const p of samples(arc))
            expect(
              Math.abs(dist({ x: p.x + arc.x, y: p.y + arc.y }, v) - r),
              `${from}→${to} at ${r}`,
            ).toBeLessThanOrEqual(0.5);
        }
      }
    }
  });

  it("draws no arc between equal angles, and the full circle a whole turn apart", () => {
    const v = { x: 100, y: 100 };
    expect(angleArc(v, 40, 40, 20, t, { count: 2 })).toHaveLength(0);
    const [full] = angleArc(v, 0, 360, 20, t);
    expect(full?.w).toBeCloseTo(40, 6);
    expect(full?.h).toBeCloseTo(40, 6);
  });

  it("draws one arc by default, in ink", () => {
    const arcs = angleArc({ x: 0, y: 0 }, 0, 90, 20, t);
    expect(arcs).toHaveLength(1);
    expect(arcs[0]?.stroke).toBe(t.colors.ink);
  });
});

describe("the side marks", () => {
  const a = { x: 50, y: 300 };
  const b = { x: 290, y: 120 };
  const mid = { x: 170, y: 210 };
  const u = { x: 0.8, y: -0.6 };

  it("row 10: three ticks perpendicular to AB at its midpoint, 4pt apart", () => {
    const ticks = equalTicks(a, b, 3, t);
    expect(ticks).toHaveLength(3);
    noRotation(ticks);
    const centres = ticks.map((tick) => {
      const [p, q] = endsOf(tick);
      expect(Math.abs(dot(minus(q, p), u))).toBeLessThan(1e-9);
      return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    });
    // Centred on the midpoint, along AB, 4pt apart.
    expect(dist(centres[1] as Point, mid)).toBeLessThan(1e-9);
    expect(dist(centres[0] as Point, centres[1] as Point)).toBeCloseTo(4, 9);
    expect(dist(centres[2] as Point, centres[1] as Point)).toBeCloseTo(4, 9);
    for (const c of centres)
      expect(Math.abs(dot(minus(c, mid), { x: -u.y, y: u.x }))).toBeLessThan(1e-9);
  });

  it("row 10: two chevrons at the midpoint pointing from A to B", () => {
    const chevrons = parallelArrows(a, b, 2, t);
    expect(chevrons).toHaveLength(2);
    noRotation(chevrons);
    const tips = chevrons.map((c) => {
      const [arm1, tip, arm2] = pointsOf(c);
      expect(c.closed).toBeUndefined();
      // The tip is further along AB than both arms: the chevron points from A to B.
      expect(dot(minus(tip as Point, arm1 as Point), u)).toBeGreaterThan(0);
      expect(dot(minus(tip as Point, arm2 as Point), u)).toBeGreaterThan(0);
      return tip as Point;
    });
    // Centred on the midpoint between them.
    const centre = {
      x: ((tips[0]?.x ?? 0) + (tips[1]?.x ?? 0)) / 2,
      y: ((tips[0]?.y ?? 0) + (tips[1]?.y ?? 0)) / 2,
    };
    expect(Math.abs(dot(minus(centre, mid), { x: -u.y, y: u.x }))).toBeLessThan(1e-9);
    expect(dist(centre, mid)).toBeLessThan(10);
  });

  it("row 10: one filled arrowhead at the midpoint, pointing from A to B", () => {
    const head = midArrow(a, b, t);
    noRotation([head]);
    expect(head.closed).toBe(true);
    expect(head.fill).toBe(t.colors.ink);
    const pts = pointsOf(head);
    const [tip, ...base] = pts;
    for (const p of base) expect(dot(minus(tip as Point, p), u)).toBeGreaterThan(0);
    // Its length is centred on the midpoint.
    const baseMid = {
      x: ((base[0]?.x ?? 0) + (base[1]?.x ?? 0)) / 2,
      y: ((base[0]?.y ?? 0) + (base[1]?.y ?? 0)) / 2,
    };
    const centre = { x: ((tip?.x ?? 0) + baseMid.x) / 2, y: ((tip?.y ?? 0) + baseMid.y) / 2 };
    expect(dist(centre, mid)).toBeLessThan(1e-9);
  });
});

describe("northLine and pointMark", () => {
  it("row 10: a vertical line with its arrow up and an N label above it", () => {
    const p = { x: 120, y: 200 };
    const [line, label, ...rest] = northLine(p, 40, t);
    expect(rest).toHaveLength(0);
    if (line?.type !== "line" || label?.type !== "text") throw new Error("a line and a label");
    noRotation([line, label]);
    const [from, to] = endsOf(line);
    expect(from).toEqual(p);
    expect(to).toEqual({ x: 120, y: 160 });
    expect(line.arrowEnd).toBe(true);
    expect(line.arrowStart).toBeUndefined();
    const text = (label as TextElement).doc.content?.[0]?.content?.[0]?.text;
    expect(text).toBe("N");
    expect(label.y + label.h).toBeLessThanOrEqual(to.y);
    expect(label.x + label.w / 2).toBeCloseTo(to.x, 9);
  });

  it("row 10: a cross as two lines through p, and a dot as a filled ellipse on it", () => {
    const p = { x: 80, y: 90 };
    const cross = pointMark(p, "cross", t);
    expect(cross).toHaveLength(2);
    noRotation(cross);
    for (const el of cross) {
      if (el.type !== "line") throw new Error("a line");
      const [q, r] = endsOf(el);
      // p lies on the segment: halfway between its ends.
      expect(dist({ x: (q.x + r.x) / 2, y: (q.y + r.y) / 2 }, p)).toBeLessThan(1e-9);
    }
    const [d1, d2] = cross.map((el) =>
      el.type === "line" ? minus(...endsOf(el)) : { x: 0, y: 0 },
    );
    expect(dot(d1 as Point, d2 as Point)).toBeCloseTo(0, 9);
    const [dotMark, ...more] = pointMark(p, "dot", t);
    expect(more).toHaveLength(0);
    if (dotMark?.type !== "shape") throw new Error("a shape");
    expect(dotMark.shape).toBe("ellipse");
    expect(dotMark.fill).toBe(t.colors.ink);
    expect(dotMark.x + dotMark.w / 2).toBe(p.x);
    expect(dotMark.y + dotMark.h / 2).toBe(p.y);
  });
});

describe("degenerate sides", () => {
  it("collapses a mark on a side whose ends meet to a point, with no NaN and no throw", () => {
    const p = { x: 30, y: 40 };
    const els: SlideElement[] = [
      rightAngleMark(p, p, p, 12, t),
      ...equalTicks(p, p, 2, t),
      ...parallelArrows(p, p, 1, t),
      midArrow(p, p, t),
    ];
    for (const el of els) {
      for (const n of [el.x, el.y, el.w, el.h]) expect(Number.isFinite(n), el.name).toBe(true);
      if (el.type === "path")
        for (const q of el.points) expect(Number.isFinite(q.x + q.y)).toBe(true);
    }
  });
});

describe("segment", () => {
  it("gives a horizontal or vertical line a 16pt box and keeps its ends", () => {
    const flat = segment({ x: 10, y: 50 }, { x: 110, y: 50 }, { name: "Flat" });
    expect([flat.x, flat.y, flat.w, flat.h]).toEqual([10, 42, 100, 16]);
    expect(endsOf(flat)).toEqual([
      { x: 10, y: 50 },
      { x: 110, y: 50 },
    ]);
    expect(flat.name).toBe("Flat");
  });
});
