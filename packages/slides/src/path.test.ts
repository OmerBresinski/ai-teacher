import { describe, expect, test } from "bun:test";
import { type PathSegment, pathData, pathEnds, pathSegments } from "./path";

const types = (segments: PathSegment[]) => segments.map((s) => s.type);
const cubics = (segments: PathSegment[]) =>
  segments.filter((s): s is Extract<PathSegment, { type: "cubic" }> => s.type === "cubic");

describe("pathSegments", () => {
  test("a plain path is straight segments scaled to the box", () => {
    const segments = pathSegments(
      {
        points: [
          { x: 0, y: 0 },
          { x: 0.5, y: 1 },
          { x: 1, y: 0 },
        ],
      },
      200,
      100,
    );
    expect(segments).toEqual([
      { type: "move", x: 0, y: 0 },
      { type: "line", x: 100, y: 100 },
      { type: "line", x: 200, y: 0 },
    ]);
  });

  test("a smooth left-to-right path is a monotone cubic: plateaus flat, no overshoot", () => {
    const h = 300;
    const segments = pathSegments(
      {
        smooth: true,
        points: [
          { x: 0, y: 0.8 },
          { x: 0.24, y: 0.8 },
          { x: 0.45, y: 0 },
          { x: 0.66, y: 1 },
          { x: 1, y: 1 },
        ],
      },
      400,
      h,
    );
    expect(types(segments)).toEqual(["move", "cubic", "cubic", "cubic", "cubic"]);
    for (const c of cubics(segments)) {
      for (const y of [c.y1, c.y2]) {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(h);
      }
    }
    const [first, , , last] = cubics(segments);
    expect(first?.y1).toBeCloseTo(0.8 * h);
    expect(first?.y2).toBeCloseTo(0.8 * h);
    expect(last?.y1).toBeCloseTo(h);
    expect(last?.y2).toBeCloseTo(h);
    // The peak's tangent is horizontal, so nothing is drawn above it.
    const [, rise, fall] = cubics(segments);
    expect(rise?.y2).toBeCloseTo(0);
    expect(fall?.y1).toBeCloseTo(0);
  });

  test("a smooth closed path is a Catmull-Rom loop that wraps round to the first point", () => {
    const segments = pathSegments(
      {
        smooth: true,
        closed: true,
        points: [
          { x: 0.5, y: 0 },
          { x: 1, y: 0.5 },
          { x: 0.5, y: 1 },
          { x: 0, y: 0.5 },
        ],
      },
      100,
      100,
    );
    expect(types(segments)).toEqual(["move", "cubic", "cubic", "cubic", "cubic", "close"]);
    const last = cubics(segments)[3];
    expect([last?.x, last?.y]).toEqual([50, 0]);
    // Uniform Catmull-Rom: the first control point is p1 + (p2 - p0) / 6, p0 wrapping to the end.
    const first = cubics(segments)[0];
    expect(first?.x1).toBeCloseTo(50 + (100 - 0) / 6);
    expect(first?.y1).toBeCloseTo(0 + (50 - 50) / 6);
  });

  test("a smooth open path that does not run left to right uses Catmull-Rom", () => {
    const segments = pathSegments(
      {
        smooth: true,
        points: [
          { x: 0, y: 1 },
          { x: 0.5, y: 0 },
          { x: 0.2, y: 1 },
        ],
      },
      100,
      100,
    );
    expect(types(segments)).toEqual(["move", "cubic", "cubic"]);
    // The end point repeats as its own neighbour: x2 = p2 - (p2 - p1) / 6.
    expect(cubics(segments)[1]?.x2).toBeCloseTo(20 - (20 - 50) / 6);
  });

  test("smooth with two points stays straight", () => {
    const segments = pathSegments(
      {
        smooth: true,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      },
      10,
      10,
    );
    expect(segments).toEqual([
      { type: "move", x: 0, y: 0 },
      { type: "line", x: 10, y: 10 },
    ]);
  });

  test("closed appends a close to a straight path", () => {
    const segments = pathSegments(
      {
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
      },
      10,
      10,
    );
    expect(types(segments)).toEqual(["move", "line", "line", "close"]);
  });
});

describe("pathData", () => {
  test("writes an SVG d with two-decimal rounding", () => {
    expect(
      pathData([
        { type: "move", x: 0, y: 1.005 },
        { type: "line", x: 10.123, y: 20.456 },
        { type: "cubic", x1: 1 / 3, y1: 2 / 3, x2: 1.5, y2: 2, x: 3, y: 4.999 },
        { type: "close" },
      ]),
    ).toBe("M0 1 L10.12 20.46 C0.33 0.67 1.5 2 3 5 Z");
  });
});

describe("pathEnds", () => {
  test("for a straight path each end points along its segment", () => {
    const ends = pathEnds([
      { type: "move", x: 0, y: 0 },
      { type: "line", x: 5, y: 5 },
      { type: "line", x: 10, y: 0 },
    ]);
    expect(ends).toEqual({
      start: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
      end: [
        { x: 10, y: 0 },
        { x: 5, y: 5 },
      ],
    });
  });

  test("for a cubic end the from point is its control point", () => {
    const ends = pathEnds([
      { type: "move", x: 0, y: 0 },
      { type: "cubic", x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 },
      { type: "cubic", x1: 7, y1: 8, x2: 9, y2: 10, x: 11, y: 12 },
      { type: "close" },
    ]);
    expect(ends?.start).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 2 },
    ]);
    expect(ends?.end).toEqual([
      { x: 11, y: 12 },
      { x: 9, y: 10 },
    ]);
  });

  test("a path with nothing drawn has no ends", () => {
    expect(pathEnds([{ type: "move", x: 0, y: 0 }])).toBeNull();
    expect(pathEnds([])).toBeNull();
  });
});
