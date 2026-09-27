import { describe, expect, it } from "bun:test";
import type {
  GroupElement,
  LineElement,
  PathElement,
  SlideElement,
  TextElement,
} from "@tj/domain/documents";
import { boxH, FIGURE_RECT, FIGURE_RECT_WIDE } from "../layouts";
import { pathSegments, samplePath } from "../path";
import { isEditorialIssue } from "../specs";
import { getTheme, THEMES } from "../themes";
// Through the index, not `./triangle`: that module is in the layouts ↔ figures import cycle and
// cannot be loaded first (see the header of `./right-triangle`).
import {
  diagramVariantFor,
  drawFigure,
  FIGURE_TEMPLATES,
  type FigureRect,
  solveTriangle,
  TRIANGLE,
  type TriangleValues,
  triangleValuesSchema,
} from ".";

/* TEACH-221 acceptance rows 1 to 12: the triangle Figure template. */

const chalk = getTheme("chalk");
const m = (value?: number, label?: string) => ({
  ...(value === undefined ? {} : { value }),
  ...(label === undefined ? {} : { label }),
});
const ABC = { A: "A", B: "B", C: "C" };

type Point = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };

const textOf = (el: TextElement) =>
  (el.doc.content ?? []).map((p) => (p.content ?? []).map((n) => n.text ?? "").join("")).join("\n");
const texts = (g: GroupElement) => g.children.filter((c): c is TextElement => c.type === "text");
const paths = (g: GroupElement) => g.children.filter((c): c is PathElement => c.type === "path");
const lines = (g: GroupElement) => g.children.filter((c): c is LineElement => c.type === "line");
const caption = (g: GroupElement) => texts(g).find((t) => textOf(t) === "Not drawn to scale");
const labelled = (g: GroupElement, text: string) => {
  const found = texts(g).filter((t) => textOf(t) === text);
  if (found.length === 0) throw new Error(`no label "${text}"`);
  return found;
};
const triangles = (g: GroupElement) => paths(g).filter((p) => p.closed);
const arcs = (g: GroupElement) => paths(g).filter((p) => p.name === "Angle");
/** A closed path's corners in the group's space, in the order drawn: A, B, C. */
const cornersOf = (p: PathElement): Point[] =>
  p.points.map((q) => ({ x: p.x + q.x * p.w, y: p.y + q.y * p.h }));
const centreOf = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
/** The interior angle at `v` between the directions to `p` and `q`, in degrees. */
const angleAt = (v: Point, p: Point, q: Point) => {
  const a = Math.atan2(p.y - v.y, p.x - v.x);
  const b = Math.atan2(q.y - v.y, q.x - v.x);
  const d = Math.abs(((a - b) * 180) / Math.PI) % 360;
  return d > 180 ? 360 - d : d;
};
const anglesOf = (p: PathElement) => {
  const [A, B, C] = cornersOf(p) as [Point, Point, Point];
  return { A: angleAt(A, B, C), B: angleAt(B, C, A), C: angleAt(C, A, B) };
};
/** The group's rect for the values: the layout the template asks for. */
const rectFor = (v: unknown): FigureRect =>
  diagramVariantFor("triangle", v) === "figure-wide" ? FIGURE_RECT_WIDE : FIGURE_RECT;
const draw = (v: unknown, theme = chalk, rect = rectFor(v)) =>
  drawFigure("triangle", v, theme, rect);

/* ---- Rows 1 to 3: the solver ---------------------------------------------------------- */

const close = (got: Record<string, number> | undefined, want: Record<string, number>) => {
  if (!got) throw new Error("no triangle");
  for (const [key, value] of Object.entries(want)) expect(got[key], key).toBeCloseTo(value, 2);
};

describe("solveTriangle (rows 1 and 2)", () => {
  it("solves SSS", () => {
    close(solveTriangle({ sides: { a: m(5), b: m(6), c: m(7) } }), {
      a: 5,
      b: 6,
      c: 7,
      A: 44.415,
      B: 57.122,
      C: 78.463,
    });
  });

  it("solves SAS", () => {
    close(solveTriangle({ sides: { a: m(5), b: m(7) }, angles: { C: m(40) } }), {
      a: 5,
      b: 7,
      c: 4.514,
      A: 45.396,
      B: 94.604,
      C: 40,
    });
  });

  it("solves ASA and AAS", () => {
    close(solveTriangle({ sides: { c: m(10) }, angles: { A: m(50), B: m(60) } }), {
      a: 8.152,
      b: 9.216,
      c: 10,
      A: 50,
      B: 60,
      C: 70,
    });
    close(solveTriangle({ sides: { a: m(10) }, angles: { A: m(50), B: m(60) } }), {
      a: 10,
      b: 11.305,
      c: 12.267,
      C: 70,
    });
  });

  it("solves RHS: hypotenuse 13, leg 5", () => {
    close(solveTriangle({ rightAngleAt: "C", sides: { a: m(5), c: m(13) } }), {
      a: 5,
      b: 12,
      c: 13,
      A: 22.62,
      B: 67.38,
      C: 90,
    });
  });

  it("takes the acute SSA solution unless obtuse is set (row 2)", () => {
    const given = { sides: { a: m(7), b: m(9) }, angles: { A: m(40) } };
    close(solveTriangle(given), { B: 55.735, C: 84.265, c: 10.836 });
    close(solveTriangle({ ...given, obtuse: true }), { B: 124.265, C: 15.735, c: 2.953 });
    // One solution only: the side opposite the angle is the longer, so obtuse changes nothing.
    const one = { sides: { a: m(9), b: m(7) }, angles: { A: m(40) } };
    expect(solveTriangle({ ...one, obtuse: true })).toEqual(solveTriangle(one));
  });

  it("gives two angles alone at a unit scale", () => {
    const solved = solveTriangle({ angles: { A: m(40), B: m(60) } });
    close(solved, { A: 40, B: 60, C: 80, c: 1 });
  });

  it("prefers SSS when more is given than needed", () => {
    const solved = solveTriangle({
      rightAngleAt: "C",
      sides: { a: m(5), b: m(12), c: m(14) },
    });
    close(solved, { a: 5, b: 12, c: 14 });
    expect(solved?.C).toBeGreaterThan(100);
  });

  it("gives undefined when the values cannot fix a triangle", () => {
    for (const given of [
      {},
      { sides: { a: m(5) } },
      { sides: { a: m(2), b: m(3), c: m(9) } },
      { angles: { A: m(100), B: m(90) } },
      { sides: { a: m(3), b: m(9) }, angles: { A: m(40) } },
      { sides: { a: m(-5), b: m(3), c: m(4) } },
    ] satisfies TriangleValues[])
      expect(solveTriangle(given), JSON.stringify(given)).toBeUndefined();
  });
});

describe("unknown (rows 6 and 7)", () => {
  it("gives the triangle's unknown side from the rest (row 6)", () => {
    const v: TriangleValues = {
      rightAngleAt: "C",
      sides: { a: m(5, "5 cm"), c: m(13, "13 cm"), b: m(undefined, "x") },
      unknown: "b",
    };
    const got = TRIANGLE.unknown?.(v);
    expect(got?.unit).toBe("length");
    expect(got?.value).toBeCloseTo(12, 9);
  });

  it("solves without the unknown's own value, so a wrong value is not echoed", () => {
    const v: TriangleValues = {
      sides: { a: m(5), b: m(7) },
      angles: { C: m(40), A: m(50, "θ") },
      unknown: "A",
    };
    const got = TRIANGLE.unknown?.(v);
    expect(got?.unit).toBe("degrees");
    expect(got?.value).toBeCloseTo(45.396, 2);
  });

  it("gives no side of a triangle given only by its angles, and nothing with no unknown", () => {
    expect(TRIANGLE.unknown?.({ angles: { A: m(40), B: m(60) }, unknown: "a" })).toBeUndefined();
    expect(TRIANGLE.unknown?.({ angles: { A: m(40), B: m(60) }, unknown: "C" })?.value).toBe(80);
    expect(TRIANGLE.unknown?.({ sides: { a: m(5), b: m(6), c: m(7) } })).toBeUndefined();
    expect(TRIANGLE.unknown?.({ sides: { a: m(5), b: m(6) }, unknown: "c" })).toBeUndefined();
  });

  it("gives right-triangle's labelled side with no length (row 7)", () => {
    const unknown = FIGURE_TEMPLATES["right-triangle"].unknown;
    const v = {
      base: { length: 3, label: "3 cm" },
      height: { length: 4, label: "4 cm" },
      hypotenuse: { label: "x" },
    };
    expect(unknown?.(v)).toEqual({ value: 5, unit: "length" });
  });
});

/* ---- The values schema ------------------------------------------------------------------ */

describe("triangleValuesSchema", () => {
  const issuesOf = (given: unknown) => {
    const result = triangleValuesSchema.safeParse(given);
    return result.success ? [] : result.error.issues;
  };

  it("passes every way of fixing a triangle", () => {
    for (const given of [
      { sides: { a: m(5), b: m(6), c: m(7) } },
      { sides: { a: m(5), b: m(7) }, angles: { C: m(40, "40°") } },
      { sides: { c: m(10) }, angles: { A: m(50), B: m(60) } },
      { rightAngleAt: "C", sides: { a: m(5), c: m(13), b: m(12, "x") }, unknown: "b" },
      { sides: { a: m(7), b: m(9) }, angles: { A: m(40) }, obtuse: true },
      { angles: { A: m(40), B: m(60), C: m(80) } },
      { angles: { A: m(40), B: m(60) }, pair: { scale: 2, vertices: { A: "P", B: "Q", C: "R" } } },
    ])
      expect(issuesOf(given), JSON.stringify(given)).toEqual([]);
  });

  it("makes every value rule editorial, one issue each (row 4 and row 5)", () => {
    const cases: [unknown, PropertyKey[]][] = [
      [{ sides: { a: m(5) } }, []],
      [{ sides: { a: m(2), b: m(3), c: m(9) } }, ["sides"]],
      [{ angles: { A: m(100), B: m(90) } }, ["angles"]],
      [{ angles: { A: m(100), B: m(50), C: m(40) } }, ["angles"]],
      [{ rightAngleAt: "A", angles: { B: m(95) } }, ["angles"]],
      [{ sides: { a: m(5) }, angles: { A: m(200) } }, ["angles"]],
      [{ rightAngleAt: "C", sides: { a: m(5), b: m(12), c: m(14) } }, []],
      [{ rightAngleAt: "C", sides: { a: m(13), c: m(12) } }, ["sides", "c", "value"]],
      [{ sides: { a: m(3), b: m(9) }, angles: { A: m(40) } }, ["sides"]],
      [{ sides: { a: m(5), b: m(6), c: m(7) }, angles: { A: m(60) } }, []],
      [{ sides: { a: m(5), b: m(6), c: m(-7) } }, ["sides", "c", "value"]],
      [{ sides: { a: m(5, "the side of length 5"), b: m(6), c: m(7) } }, ["sides", "a", "label"]],
      [{ sides: { a: m(5), b: m(6), c: m(7) }, vertices: { A: "ABCD" } }, ["vertices", "A"]],
      [{ sides: { a: m(5), b: m(6), c: m(7) }, pair: { scale: 0 } }, ["pair", "scale"]],
      [
        { sides: { a: m(5), b: m(6), c: m(7) }, pair: { scale: 2, sides: { a: "a".repeat(13) } } },
        ["pair", "sides", "a"],
      ],
      [
        { sides: { a: m(5), b: m(6), c: m(7) }, pair: { scale: 2, vertices: { B: "PQRS" } } },
        ["pair", "vertices", "B"],
      ],
    ];
    for (const [given, path] of cases) {
      const issues = issuesOf(given);
      expect(issues.length, JSON.stringify(given)).toBe(1);
      expect(issues[0]?.path, JSON.stringify(given)).toEqual(path);
      for (const issue of issues) expect(isEditorialIssue(issue), issue.message).toBe(true);
    }
    // Exactly at each cap is fine; the given angles agree within 0.5° and the sides within 1 %.
    expect(
      issuesOf({
        vertices: { A: "Q′′", B: "R", C: "S" },
        sides: { a: m(5, "a".repeat(12)), b: m(6.05), c: m(7) },
        angles: { A: m(44.8, "b".repeat(12)) },
      }),
    ).toEqual([]);
  });

  it("leaves a wrong type to the shape rules", () => {
    for (const given of [
      { sides: { a: 5 } },
      { rightAngleAt: "D" },
      { pair: { vertices: ABC } },
      { unknown: "x" },
      { equalSides: ["d"] },
    ]) {
      const issues = issuesOf(given);
      expect(issues.length, JSON.stringify(given)).toBeGreaterThan(0);
      for (const issue of issues) expect(isEditorialIssue(issue)).toBe(false);
    }
  });
});

/* ---- Rows 3 to 10 and 12: the drawing ----------------------------------------------------- */

const ROW6: TriangleValues = {
  vertices: ABC,
  rightAngleAt: "C",
  sides: { a: m(5, "5 cm"), c: m(13, "13 cm"), b: m(undefined, "x") },
  unknown: "b",
};
const ROW10: TriangleValues = {
  vertices: ABC,
  sides: { a: m(5, "5 cm"), b: m(6, "6 cm"), c: m(7, "7 cm") },
  pair: { scale: 2, vertices: { A: "P", B: "Q", C: "R" }, sides: { a: "10 cm", c: "y" } },
};

describe("drawFigure: triangle", () => {
  it("draws one closed path at right-triangle's stroke, in proportion (row 1, SSS)", () => {
    const v = { vertices: ABC, sides: { a: m(5, "5 cm"), b: m(6, "6 cm"), c: m(7, "7 cm") } };
    const g = draw(v);
    expect([g.type, g.name, g.w, g.h]).toEqual(["group", "Triangle", FIGURE_RECT.w, FIGURE_RECT.h]);
    expect(g.figure).toEqual({ template: "triangle", values: v });
    const [t] = triangles(g);
    if (!t) throw new Error("no triangle");
    expect([t.strokeWidth, t.stroke, t.smooth]).toEqual([3, chalk.colors.ink, undefined]);
    const [A, B, C] = cornersOf(t) as [Point, Point, Point];
    // The longest side (c, AB) is the base, horizontal at the bottom, C above it.
    expect(A.y).toBeCloseTo(B.y, 5);
    expect(C.y).toBeLessThan(A.y);
    expect(dist(B, C) / dist(A, B)).toBeCloseTo(5 / 7, 2);
    expect(dist(C, A) / dist(A, B)).toBeCloseTo(6 / 7, 2);
    expect(caption(g)).toBeUndefined();
    for (const text of ["A", "B", "C", "5 cm", "6 cm", "7 cm"])
      expect(labelled(g, text)).toHaveLength(1);
    // No angle labelled, so no arcs.
    expect(arcs(g)).toHaveLength(0);
    expect(g.alt).toBe("Triangle ABC. AB 7 cm, BC 5 cm, CA 6 cm.");
  });

  it("names the vertices where they land and puts each label on its own side", () => {
    const g = draw({ vertices: ABC, sides: { a: m(5, "5 cm"), b: m(6, "6 cm"), c: m(7, "7 cm") } });
    const [t] = triangles(g);
    const [A, B, C] = cornersOf(t as PathElement) as [Point, Point, Point];
    const nearest = (text: string, points: Point[]) => {
      const [label] = labelled(g, text);
      const c = centreOf(label as TextElement);
      return points.reduce(
        (best, p, i) => (dist(c, p) < dist(c, points[best] as Point) ? i : best),
        0,
      );
    };
    expect(nearest("A", [A, B, C])).toBe(0);
    expect(nearest("B", [A, B, C])).toBe(1);
    expect(nearest("C", [A, B, C])).toBe(2);
    const mid = (p: Point, q: Point) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    const mids = [mid(B, C), mid(C, A), mid(A, B)];
    expect(nearest("5 cm", mids)).toBe(0);
    expect(nearest("6 cm", mids)).toBe(1);
    expect(nearest("7 cm", mids)).toBe(2);
  });

  it("draws two angles alone with those angles and no caption (row 3)", () => {
    const g = draw({ angles: { A: m(40, "40°"), B: m(60, "60°") } });
    const angles = anglesOf(triangles(g)[0] as PathElement);
    expect(angles.A).toBeCloseTo(40, 1);
    expect(angles.B).toBeCloseTo(60, 1);
    expect(caption(g)).toBeUndefined();
    expect(arcs(g)).toHaveLength(2);
    expect(g.alt).toBe("Triangle. Angle A 40°, angle B 60°.");
  });

  it("draws the schematic triangle with the labels as given for values that fix none (row 4)", () => {
    const cases: TriangleValues[] = [
      { vertices: ABC, sides: { a: m(5, "5 cm") } },
      { vertices: ABC, sides: { a: m(2, "2"), b: m(3, "3"), c: m(9, "9") } },
      { vertices: ABC, angles: { A: m(100, "100°"), B: m(90, "90°") } },
    ];
    for (const v of cases) {
      const g = draw(v);
      const angles = anglesOf(triangles(g)[0] as PathElement);
      expect(angles.A).toBeCloseTo(50, 1);
      expect(angles.B).toBeCloseTo(60, 1);
      expect(angles.C).toBeCloseTo(70, 1);
      expect(caption(g)).toBeDefined();
      expect(g.alt?.endsWith(" Not drawn to scale.")).toBe(true);
      for (const [key, measure] of Object.entries({ ...v.sides, ...v.angles }))
        expect(labelled(g, measure?.label ?? ""), key).toHaveLength(1);
      expect(triangleValuesSchema.safeParse(v).error?.issues.every(isEditorialIssue)).toBe(true);
    }
    // Values of the wrong shape: the schematic, no labels, the caption.
    for (const given of [null, "triangle", { sides: { a: 5 } }]) {
      const g = draw(given, chalk, FIGURE_RECT);
      expect(texts(g).map(textOf)).toEqual(["Not drawn to scale"]);
      expect(g.alt).toBe("Triangle. Not drawn to scale.");
    }
  });

  it("draws disagreeing values from the preferred subset, captioned (row 5)", () => {
    const v: TriangleValues = {
      vertices: ABC,
      rightAngleAt: "C",
      sides: { a: m(5, "5"), b: m(12, "12"), c: m(14, "14") },
    };
    const g = draw(v);
    const [A, B, C] = cornersOf(triangles(g)[0] as PathElement) as [Point, Point, Point];
    expect(dist(B, C) / dist(A, B)).toBeCloseTo(5 / 14, 2);
    expect(dist(C, A) / dist(A, B)).toBeCloseTo(12 / 14, 2);
    expect(caption(g)).toBeDefined();
    expect(triangleValuesSchema.safeParse(v).error?.issues).toHaveLength(1);
  });

  it("puts the right angle bottom left, the longer leg along the bottom (row 6)", () => {
    const g = draw(ROW6);
    const [A, B, C] = cornersOf(triangles(g)[0] as PathElement) as [Point, Point, Point];
    // CA (12) is the longer leg: along the bottom, A to the right; CB (5) goes straight up.
    expect(C.y).toBeCloseTo(A.y, 5);
    expect(A.x).toBeGreaterThan(C.x);
    expect(B.x).toBeCloseTo(C.x, 5);
    expect(B.y).toBeLessThan(C.y);
    expect(dist(C, A) / dist(C, B)).toBeCloseTo(12 / 5, 2);
    const square = paths(g).find((p) => p.name === "Right angle");
    if (!square) throw new Error("no right-angle mark");
    const corners = cornersOf(square);
    // The square's corner at C: its first and last points lie along C's two sides.
    expect(Math.min(...corners.map((p) => dist(p, C)))).toBeGreaterThan(0);
    expect(Math.max(...corners.map((p) => dist(p, C)))).toBeLessThan(40);
    expect(arcs(g)).toHaveLength(0);
    // The unknown shows its letter, never its value.
    expect(labelled(g, "x")).toHaveLength(1);
    expect(texts(g).map(textOf)).not.toContain("12");
    expect(caption(g)).toBeUndefined();
    expect(TRIANGLE.unknown?.(ROW6)?.value).toBeCloseTo(12, 9);
  });

  it("shows an unknown with no label as a question mark, never its value, in the alt text too", () => {
    const g = draw({ sides: { a: m(5), b: m(7), c: m(4.51) }, angles: { C: m(40) }, unknown: "c" });
    expect(labelled(g, "?")).toHaveLength(1);
    expect(g.alt).toBe("Triangle. Side a 5, side b 7, side c unknown, angle C 40°.");
    expect(texts(g).map(textOf).sort()).toEqual(["40°", "5", "7", "?"]);
    expect(texts(g).map(textOf)).not.toContain("4.51");
    expect(arcs(g)).toHaveLength(1);
  });

  it("marks an isosceles triangle's equal sides and angles (row 8)", () => {
    const v: TriangleValues = {
      vertices: ABC,
      sides: { a: m(8, "8 cm"), b: m(8, "8 cm"), c: m(6) },
      angles: { C: m(undefined, "x") },
      equalSides: ["a", "b"],
      equalAngles: ["A", "B"],
      unknown: "C",
    };
    const g = draw(v);
    const ticks = lines(g).filter((l) => l.name === "Equal side");
    expect(ticks).toHaveLength(2);
    const [A, B, C] = cornersOf(triangles(g)[0] as PathElement) as [Point, Point, Point];
    const tickMid = (l: LineElement) => ({ x: l.x + l.w / 2, y: l.y + l.h / 2 });
    const mid = (p: Point, q: Point) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    const tickMids = ticks.map(tickMid);
    for (const side of [mid(B, C), mid(C, A)])
      expect(Math.min(...tickMids.map((p) => dist(p, side)))).toBeLessThan(1);
    // Two arcs at A and at B, one at C.
    const arcCount = (p: Point) =>
      arcs(g).filter((a) => {
        const r = cornersOf(a).map((q) => dist(q, p));
        return Math.max(...r) - Math.min(...r) < 1;
      }).length;
    expect([arcCount(A), arcCount(B), arcCount(C)]).toEqual([2, 2, 1]);
    for (const a of arcs(g))
      expect([a.smooth, a.closed, a.strokeWidth]).toEqual([true, undefined, 2]);
  });

  it("draws a 5° angle at 15°, captioned (row 9)", () => {
    const v = { vertices: ABC, angles: { A: m(5, "5°"), B: m(100, "100°") }, sides: { c: m(10) } };
    const g = draw(v);
    const angles = anglesOf(triangles(g)[0] as PathElement);
    expect(angles.A).toBeCloseTo(15, 1);
    expect(angles.A + angles.B + angles.C).toBeCloseTo(180, 5);
    expect(caption(g)).toBeDefined();
    expect(g.alt?.endsWith(" Not drawn to scale.")).toBe(true);
    // A right angle stays square when another angle is widened.
    const right = draw({ rightAngleAt: "C", angles: { A: m(5) }, sides: { c: m(10) } });
    const r = anglesOf(triangles(right)[0] as PathElement);
    expect([r.A, r.B, r.C].map((a) => Math.round(a * 10) / 10)).toEqual([15, 75, 90]);
  });

  it("draws a similar pair twice the size in the wide layout (row 10)", () => {
    expect(diagramVariantFor("triangle", ROW10)).toBe("figure-wide");
    expect(diagramVariantFor("triangle", { ...ROW10, pair: undefined })).toBe("figure-left");
    expect(diagramVariantFor("triangle")).toBe("figure-left");
    const g = draw(ROW10);
    expect(g.w).toBe(FIGURE_RECT_WIDE.w);
    const [first, second] = triangles(g);
    if (!first || !second) throw new Error("two triangles");
    const side = (p: PathElement) => {
      const [A, B] = cornersOf(p) as [Point, Point];
      return dist(A, B);
    };
    expect(side(second) / side(first)).toBeCloseTo(2, 1);
    // Beside the first or, when that draws them larger, below it: never over it.
    expect(second.x > first.x + first.w || second.y > first.y + first.h).toBe(true);
    for (const child of g.children) expect(insideRect(child, FIGURE_RECT_WIDE)).toBe(true);
    for (const text of ["P", "Q", "R", "10 cm", "y"]) expect(labelled(g, text)).toHaveLength(1);
    expect(caption(g)).toBeUndefined();
    expect(g.alt).toBe(
      "Triangle ABC. AB 7 cm, BC 5 cm, CA 6 cm, and a similar triangle PQR, scale factor 2.",
    );
  });

  it("mirrors the pair when asked, and says congruent for scale 1", () => {
    const v = { ...ROW10, pair: { scale: 1, vertices: { A: "P", B: "Q", C: "R" }, mirror: true } };
    const g = draw(v);
    const [first, second] = triangles(g) as [PathElement, PathElement];
    const [A, B] = cornersOf(first) as [Point, Point];
    const [P, Q] = cornersOf(second) as [Point, Point];
    expect(Math.sign(B.x - A.x)).toBe(-Math.sign(Q.x - P.x));
    expect(g.alt).toContain(", and a congruent triangle PQR.");
    // A pair drawn at an extreme scale is clamped and captioned.
    const far = draw({ ...ROW10, pair: { scale: 10 } });
    expect(caption(far)).toBeDefined();
  });

  it("writes the alt text from the values (row 12)", () => {
    expect(draw(ROW6).alt).toBe("Triangle ABC with a right angle at C. AB 13 cm, BC 5 cm, CA x.");
    expect(draw(ROW10).alt).toContain(", and a similar triangle PQR, scale factor 2.");
    // With no vertex names, sides go by letter.
    expect(
      draw({
        rightAngleAt: "C",
        sides: { a: m(5, "5 cm"), c: m(13, "13 cm") },
        angles: { A: m(undefined, "θ") },
        unknown: "A",
      }).alt,
    ).toBe("Triangle with a right angle at C. Side a 5 cm, side c 13 cm, angle A θ.");
  });

  it("is deterministic: the same values and theme give the same elements, ids aside", () => {
    const strip = (g: GroupElement) =>
      JSON.parse(JSON.stringify(g).replace(/"id":"[^"]+"/g, '"id":"_"'));
    expect(strip(draw(ROW10))).toEqual(strip(draw(ROW10)));
  });
});

/* ---- Row 11: every label inside the box, clear of every stroke and of every other label ---- */

const CAP = "12.5 metres!";
const LONG = "the length of the side opposite the angle at the top of the triangle, in centimetres";

const GRID: { name: string; v: TriangleValues }[] = [
  {
    name: "SSS (row 1)",
    v: { vertices: ABC, sides: { a: m(5, "5 cm"), b: m(6, "6 cm"), c: m(7, "7 cm") } },
  },
  {
    name: "SAS",
    v: {
      vertices: ABC,
      sides: { a: m(5, "5 cm"), b: m(7, "7 cm") },
      angles: { C: m(40, "40°") },
      unknown: "c",
    },
  },
  {
    name: "ASA",
    v: { vertices: ABC, sides: { c: m(10, "10 m") }, angles: { A: m(50, "50°"), B: m(60, "60°") } },
  },
  {
    name: "AAS",
    v: {
      vertices: ABC,
      sides: { a: m(10, "10 m") },
      angles: { A: m(50, "50°"), B: m(60, "60°"), C: m(undefined, "x") },
      unknown: "C",
    },
  },
  { name: "RHS", v: { vertices: ABC, rightAngleAt: "C", sides: { a: m(5, "5"), c: m(13, "13") } } },
  {
    name: "SSA acute (row 2)",
    v: {
      vertices: ABC,
      sides: { a: m(7, "7"), b: m(9, "9") },
      angles: { A: m(40, "40°"), B: m(undefined, "θ") },
      unknown: "B",
    },
  },
  {
    name: "SSA obtuse (row 2)",
    v: {
      vertices: ABC,
      sides: { a: m(7, "7"), b: m(9, "9") },
      angles: { A: m(40, "40°"), B: m(undefined, "θ") },
      unknown: "B",
      obtuse: true,
    },
  },
  {
    name: "two angles (row 3)",
    v: { vertices: ABC, angles: { A: m(40, "40°"), B: m(60, "60°"), C: m(undefined, "x") } },
  },
  { name: "one side (row 4)", v: { vertices: ABC, sides: { a: m(5, "5 cm") } } },
  {
    name: "sides 2, 3, 9 (row 4)",
    v: { vertices: ABC, sides: { a: m(2, "2"), b: m(3, "3"), c: m(9, "9") } },
  },
  {
    name: "angles 190° (row 4)",
    v: { vertices: ABC, angles: { A: m(100, "100°"), B: m(90, "90°") } },
  },
  {
    name: "disagreeing (row 5)",
    v: {
      vertices: ABC,
      rightAngleAt: "C",
      sides: { a: m(5, "5"), b: m(12, "12"), c: m(14, "14") },
    },
  },
  { name: "right angle, unknown b (row 6)", v: ROW6 },
  {
    name: "right-angled trigonometry",
    v: {
      vertices: ABC,
      rightAngleAt: "C",
      sides: { c: m(10, "10 cm"), a: m(undefined, "x") },
      angles: { A: m(35, "35°") },
      unknown: "a",
    },
  },
  {
    name: "isosceles (row 8)",
    v: {
      vertices: ABC,
      sides: { a: m(8, "8 cm"), b: m(8, "8 cm"), c: m(6, "6 cm") },
      angles: { C: m(undefined, "x") },
      equalSides: ["a", "b"],
      equalAngles: ["A", "B"],
      unknown: "C",
    },
  },
  {
    name: "5° angle (row 9)",
    v: { vertices: ABC, angles: { A: m(5, "5°"), B: m(100, "100°") }, sides: { c: m(10, "10") } },
  },
  { name: "similar pair (row 10)", v: ROW10 },
  {
    name: "similar pair, mirrored, angles labelled",
    v: {
      ...ROW10,
      angles: { A: m(undefined, "α"), B: m(undefined, "β") },
      pair: {
        scale: 1.5,
        mirror: true,
        vertices: { A: "P′", B: "Q′", C: "R′" },
        angles: { A: "α", B: "β" },
        sides: { a: "7.5 cm", b: "9 cm", c: "z" },
      },
    },
  },
  {
    name: "half-size pair",
    v: {
      ...ROW10,
      pair: {
        scale: 0.5,
        vertices: { A: "X", B: "Y", C: "Z" },
        sides: { a: "2.5", b: "3", c: "3.5" },
      },
    },
  },
  {
    name: "obtuse (120°, 5, 7)",
    v: {
      vertices: ABC,
      sides: { a: m(5, "5 cm"), b: m(7, "7 cm"), c: m(undefined, "x") },
      angles: { C: m(120, "120°") },
      unknown: "c",
    },
  },
  {
    name: "thin (15°, 80°)",
    v: {
      vertices: ABC,
      sides: { c: m(10, "10 cm") },
      angles: { A: m(15, "15°"), B: m(80, "80°"), C: m(undefined, "θ") },
      unknown: "C",
    },
  },
  {
    name: "thin, right-angled",
    v: {
      vertices: ABC,
      rightAngleAt: "C",
      sides: { c: m(20, "20 cm"), a: m(undefined, "h") },
      angles: { A: m(15, "15°") },
      unknown: "a",
    },
  },
  {
    name: "equilateral",
    v: {
      vertices: ABC,
      sides: { a: m(6, "6 cm"), b: m(6, "6 cm"), c: m(6, "6 cm") },
      angles: { A: m(60, "60°"), B: m(60, "60°"), C: m(60, "60°") },
      equalSides: ["a", "b", "c"],
    },
  },
  {
    name: "labels at their caps",
    v: {
      vertices: { A: "Q′′", B: "WWW", C: "MMM" },
      sides: { a: m(5, CAP), b: m(6, CAP), c: m(7, CAP) },
      angles: { A: m(44.42, CAP), B: m(57.12, CAP), C: m(78.46, CAP) },
    },
  },
  {
    name: "labels at their caps, thin",
    v: {
      vertices: { A: "WWW", B: "MMM", C: "QQQ" },
      sides: { c: m(10, CAP), a: m(undefined, CAP), b: m(undefined, CAP) },
      angles: { A: m(15, CAP), B: m(20, CAP), C: m(undefined, CAP) },
    },
  },
  {
    name: "pair, labels at their caps",
    v: {
      vertices: { A: "WWW", B: "MMM", C: "QQQ" },
      sides: { a: m(5, CAP), b: m(6, CAP), c: m(7, CAP) },
      angles: { A: m(44.42, CAP) },
      pair: {
        scale: 2,
        vertices: { A: "PPP", B: "QQQ", C: "RRR" },
        sides: { a: CAP, b: CAP, c: CAP },
        angles: { A: CAP },
      },
    },
  },
  {
    name: "labels over their caps",
    v: {
      vertices: ABC,
      sides: { a: m(5, LONG), b: m(6, LONG), c: m(7, LONG) },
      angles: { A: m(44.42, LONG), B: m(57.12, LONG), C: m(78.46, LONG) },
    },
  },
  {
    name: "pair, labels over their caps",
    v: {
      vertices: ABC,
      sides: { a: m(5, LONG), b: m(6, LONG), c: m(7, LONG) },
      angles: { C: m(78.46, LONG) },
      pair: {
        scale: 2,
        vertices: { A: "P", B: "Q", C: "R" },
        sides: { a: LONG, b: LONG, c: LONG },
        angles: { C: LONG },
      },
    },
  },
  {
    name: "expression labels",
    v: {
      vertices: ABC,
      sides: { a: m(10, "5x"), b: m(7, "x - 5"), c: m(12, "2x + 2") },
      angles: { A: m(54.9, "3y°"), C: m(84, "(y + 10)°") },
    },
  },
  {
    name: "ASCII shorthands",
    v: {
      vertices: { A: "A'", B: "B''", C: "C" },
      sides: { a: m(Math.SQRT2, "sqrt2"), b: m(1, "1"), c: m(1, "1") },
      rightAngleAt: "A",
      angles: { B: m(45, "45deg") },
    },
  },
];

/** Points every `step` along a line, both ends included, in the group's space. */
function sampleLine(l: LineElement, step = 4): Point[] {
  const a = { x: l.x + l.from.x * l.w, y: l.y + l.from.y * l.h };
  const b = { x: l.x + l.to.x * l.w, y: l.y + l.to.y * l.h };
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
  return Array.from({ length: n + 1 }, (_, k) => ({
    x: a.x + ((b.x - a.x) * k) / n,
    y: a.y + ((b.y - a.y) * k) / n,
  }));
}

/** A path's samples, 16 per segment (a straight segment every 4pt), in the group's space. */
function samplePathElement(p: PathElement): Point[] {
  const segments = pathSegments(p, p.w, p.h);
  const curved = samplePath(segments, 16).map((q) => ({ x: p.x + q.x, y: p.y + q.y }));
  // A straight segment's two ends are all `samplePath` gives it: add points along it.
  const along: Point[] = [];
  for (let i = 1; i < curved.length; i++) {
    const a = curved[i - 1] as Point;
    const b = curved[i] as Point;
    const n = Math.max(1, Math.ceil(dist(a, b) / 4));
    for (let k = 0; k <= n; k++)
      along.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  // The closing side.
  if (p.closed && curved.length > 1) {
    const a = curved.at(-1) as Point;
    const b = curved[0] as Point;
    const n = Math.max(1, Math.ceil(dist(a, b) / 4));
    for (let k = 0; k <= n; k++)
      along.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return along;
}

const SHRINK = 2;
const insideShrunk = (p: Point, b: Box) =>
  p.x > b.x + SHRINK && p.x < b.x + b.w - SHRINK && p.y > b.y + SHRINK && p.y < b.y + b.h - SHRINK;

function insideRect(el: SlideElement, rect: FigureRect) {
  return el.x >= 0 && el.y >= 0 && el.x + el.w <= rect.w && el.y + el.h <= rect.h;
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("triangle placement on every theme (row 11)", () => {
  for (const theme of THEMES) {
    for (const { name, v } of GRID) {
      // A pair is laid out wide, but a caller may still name figure-left: both must hold.
      const rects = v.pair ? [FIGURE_RECT_WIDE, FIGURE_RECT] : [FIGURE_RECT];
      for (const rect of rects) {
        it(`${name} on ${theme.id}, ${rect.w} wide`, () => {
          const g = drawFigure("triangle", v, theme, rect);
          for (const child of g.children) {
            expect(child.rotation, `${child.type} ${child.name ?? ""} rotated`).toBeUndefined();
            expect(insideRect(child, rect), `${child.type} ${child.name ?? ""} inside`).toBe(true);
          }
          for (const t of triangles(g))
            expect(Math.max(t.w, t.h), "the triangle stays visible").toBeGreaterThanOrEqual(60);
          const strokes = [
            ...paths(g).map((p) => ({ name: p.name, points: samplePathElement(p) })),
            ...lines(g).map((l) => ({ name: l.name, points: sampleLine(l) })),
          ];
          const labels = texts(g);
          for (const label of labels) {
            const text = textOf(label);
            for (const stroke of strokes) {
              const hit = stroke.points.find((p) => insideShrunk(p, label));
              expect(hit, `"${text}" clear of ${stroke.name}`).toBeUndefined();
            }
            for (const other of labels)
              if (other !== label)
                expect(overlaps(label, other), `"${text}" / "${textOf(other)}"`).toBe(false);
          }
        });
      }
    }
  }
});

/* ---- Labels past their caps wrap, and are cut past three lines ---------------------------- */

describe("triangle labels over their caps", () => {
  for (const theme of THEMES) {
    it(`keeps a side label within the cap on one line on ${theme.id}`, () => {
      const v = { vertices: ABC, sides: { a: m(5, CAP), b: m(6, CAP), c: m(7, CAP) } };
      const g = drawFigure("triangle", v, theme, FIGURE_RECT);
      const shown = labelled(g, CAP);
      expect(shown).toHaveLength(3);
      for (const label of shown) expect(label.h).toBe(boxH(theme, "small"));
    });

    it(`cuts a label past three lines with an ellipsis on ${theme.id}, the alt keeping all of it`, () => {
      const v = { vertices: ABC, sides: { a: m(5, LONG), b: m(6, "6"), c: m(7, "7") } };
      const g = drawFigure("triangle", v, theme, FIGURE_RECT);
      const [cut] = texts(g).filter((t) => textOf(t).endsWith("…"));
      if (!cut) throw new Error("no cut label");
      expect(LONG.startsWith(textOf(cut).slice(0, -1).replace(/\n/g, " "))).toBe(true);
      expect(cut.h).toBeLessThanOrEqual(boxH(theme, "small", 3));
      expect(g.alt).toContain(`BC ${LONG}`);
    });
  }
});

describe("triangle labels in Unicode", () => {
  it("turns ASCII shorthands into the characters a label draws", () => {
    const g = draw(GRID.find((r) => r.name === "ASCII shorthands")?.v);
    for (const text of ["A′", "B″", "√2", "45°"]) expect(labelled(g, text)).toHaveLength(1);
  });
});
