import { describe, expect, it } from "bun:test";
import type { GroupElement, PathElement, SlideElement, TextElement } from "@tj/domain/documents";
import { FIGURE_RECT } from "../layouts";
import { isEditorialIssue } from "../specs";
import { getTheme, THEMES } from "../themes";
// Through the index, not `./right-triangle`: that module is in the layouts ↔ figures import cycle
// and cannot be loaded first (see its header).
import { drawFigure, type FigureRect, rightTriangleValuesSchema } from ".";

/* TEACH-77 acceptance rows 3 to 7: the right-triangle Figure template. */

const RECT = FIGURE_RECT;
const chalk = getTheme("chalk");

const side = (length: number | undefined, label: string) =>
  length === undefined ? { label } : { length, label };
const values = (base?: number, height?: number, hypotenuse?: number, labels = ["", "", ""]) => ({
  base: side(base, labels[0] ?? `${base}`),
  height: side(height, labels[1] ?? `${height}`),
  hypotenuse: side(hypotenuse, labels[2] ?? `${hypotenuse}`),
});

const textOf = (el: TextElement) => el.doc.content?.[0]?.content?.[0]?.text ?? "";
const paths = (g: GroupElement) => g.children.filter((c): c is PathElement => c.type === "path");
const texts = (g: GroupElement) => g.children.filter((c): c is TextElement => c.type === "text");
const caption = (g: GroupElement) => texts(g).find((t) => textOf(t) === "Not drawn to scale");
const labels = (g: GroupElement) => texts(g).filter((t) => t !== caption(g));
const triangleOf = (g: GroupElement) => {
  const triangle = paths(g).find((p) => p.closed);
  if (!triangle) throw new Error("no closed path");
  return triangle;
};
/** Height over base of the triangle as drawn. */
const drawnRatio = (g: GroupElement) => {
  const t = triangleOf(g);
  return t.h / t.w;
};

describe("drawFigure: right-triangle", () => {
  it("draws 3, 4, x as one closed path, a mark and three labels, legs in 3:4 (row 3)", () => {
    const given = {
      base: { length: 3, label: "3 cm" },
      height: { length: 4, label: "4 cm" },
      hypotenuse: { label: "x" },
    };
    const g = drawFigure("right-triangle", given, chalk, RECT);
    expect([g.type, g.name, g.x, g.y, g.w, g.h]).toEqual([
      "group",
      "Right-angled triangle",
      RECT.x,
      RECT.y,
      RECT.w,
      RECT.h,
    ]);
    expect(g.figure).toEqual({ template: "right-triangle", values: given });
    expect(g.alt).toBe("Right-angled triangle. Base 3 cm, height 4 cm, hypotenuse x.");

    const [triangle, mark] = paths(g);
    expect(paths(g)).toHaveLength(2);
    expect(triangle?.closed).toBe(true);
    expect(triangle?.points).toHaveLength(3);
    expect(triangle?.stroke).toBe(chalk.colors.ink);
    expect(triangle?.strokeWidth).toBe(3);
    expect(triangle?.fill).toBeUndefined();
    expect(mark?.closed).toBeFalsy();
    expect(mark?.points).toHaveLength(3);
    // The mark sits in the corner between the base and the height.
    if (!triangle || !mark) throw new Error("no paths");
    expect(mark.x).toBe(triangle.x);
    expect(mark.y + mark.h).toBe(triangle.y + triangle.h);

    expect(texts(g).map(textOf)).toEqual(["3 cm", "4 cm", "x"]);
    for (const t of texts(g)) expect(t.style.preset).toBe("small");
    expect(caption(g)).toBeUndefined();
    expect(drawnRatio(g)).toBeCloseTo(4 / 3, 2);
  });

  it("clamps legs 7 and 24 to 2.5 and says so (row 4)", () => {
    const g = drawFigure("right-triangle", values(7, 24, undefined, ["7", "24", "x"]), chalk, RECT);
    expect(drawnRatio(g)).toBeCloseTo(2.5, 2);
    expect(caption(g)?.style.color).toBe(chalk.colors.muted);
    expect(caption(g)?.style.preset).toBe("small");
    expect(g.alt).toBe(
      "Right-angled triangle. Base 7, height 24, hypotenuse x. Not drawn to scale.",
    );
  });

  it("clamps a flat triangle to 0.4", () => {
    const g = drawFigure("right-triangle", values(24, 7, 25), chalk, RECT);
    expect(drawnRatio(g)).toBeCloseTo(0.4, 2);
    expect(caption(g)).toBeDefined();
  });

  it("derives the missing leg from the hypotenuse", () => {
    const g = drawFigure(
      "right-triangle",
      values(12, undefined, 13, ["12", "y", "13"]),
      chalk,
      RECT,
    );
    expect(drawnRatio(g)).toBeCloseTo(5 / 12, 2);
    expect(caption(g)).toBeUndefined();
  });

  it("draws the 3:4 schematic with the labels as given when the values cannot give two legs (row 5)", () => {
    const cases = [
      values(3, undefined, undefined, ["3 cm", "a", "b"]),
      values(4, undefined, 3, ["4 cm", "a", "3 cm"]),
      values(undefined, 4, 3, ["a", "4 cm", "3 cm"]),
    ];
    for (const given of cases) {
      const g = drawFigure("right-triangle", given, chalk, RECT);
      expect(drawnRatio(g)).toBeCloseTo(4 / 3, 2);
      expect(labels(g).map(textOf)).toEqual([
        given.base.label,
        given.height.label,
        given.hypotenuse.label,
      ]);
      expect(caption(g)).toBeDefined();
      expect(g.alt?.endsWith(" Not drawn to scale.")).toBe(true);
      expect(g.figure?.values).toEqual(given);
    }
  });

  it("draws three lengths that disagree from the legs, not to scale", () => {
    const g = drawFigure("right-triangle", values(3, 4, 6), chalk, RECT);
    expect(drawnRatio(g)).toBeCloseTo(4 / 3, 2);
    expect(caption(g)).toBeDefined();
  });

  it("draws the same fallback with empty labels for values of the wrong shape (row 5b)", () => {
    for (const given of [
      {},
      null,
      "3, 4, x",
      [3, 4],
      { base: 3, height: 4 },
      { base: { length: 3 } },
    ]) {
      const g = drawFigure("right-triangle", given, chalk, RECT);
      expect(drawnRatio(g)).toBeCloseTo(4 / 3, 2);
      expect(labels(g).map(textOf)).toEqual(["", "", ""]);
      expect(caption(g)).toBeDefined();
      expect(g.alt).toBe("Right-angled triangle. Not drawn to scale.");
    }
    expect(drawFigure("right-triangle", "rubbish", chalk, RECT).figure?.values).toEqual({});
  });

  it("is deterministic: the same values and theme give the same elements, ids aside", () => {
    const strip = (g: GroupElement) =>
      JSON.parse(JSON.stringify(g).replace(/"id":"[^"]+"/g, '"id":"_"'));
    const draw = () => drawFigure("right-triangle", values(5, 12, 13), chalk, RECT);
    expect(strip(draw())).toEqual(strip(draw()));
  });
});

describe("rightTriangleValuesSchema", () => {
  const issuesOf = (given: unknown) => {
    const result = rightTriangleValuesSchema.safeParse(given);
    return result.success ? [] : result.error.issues;
  };

  it("passes 3, 4, 5 and flags 3, 4, 6 as an editorial issue, not a shape failure (row 6)", () => {
    expect(issuesOf(values(3, 4, 5))).toEqual([]);
    const issues = issuesOf(values(3, 4, 6));
    expect(issues).toHaveLength(1);
    expect(isEditorialIssue(issues[0] ?? {})).toBe(true);
    expect(issues[0]?.message).toContain("base² + height² must equal hypotenuse²");
    expect(issues[0]?.path).toEqual(["hypotenuse", "length"]);
  });

  it("allows 1 % on a² + b² = c², and no more", () => {
    expect(issuesOf(values(1, 1, 1.41))).toEqual([]);
    expect(issuesOf(values(1, 1, 1.4))).toHaveLength(1);
  });

  it("makes every value rule editorial", () => {
    const cases = [
      values(3, undefined, undefined), // one length
      values(4, undefined, 3), // hypotenuse shorter than a leg
      values(3, 4, 4), // hypotenuse no longer than a leg
      values(-3, 4, undefined), // a negative length
      { ...values(3, 4, 5), hypotenuse: { length: 5, label: "the long side" } }, // 13 characters
    ];
    for (const given of cases) {
      const issues = issuesOf(given);
      expect(issues.length, JSON.stringify(given)).toBeGreaterThan(0);
      for (const issue of issues) expect(isEditorialIssue(issue), issue.message).toBe(true);
    }
  });

  it("leaves a missing label or a wrong type to the shape rules", () => {
    for (const given of [{}, { ...values(3, 4, 5), base: { length: "3" } }]) {
      const issues = issuesOf(given);
      expect(issues.length).toBeGreaterThan(0);
      for (const issue of issues) expect(isEditorialIssue(issue)).toBe(false);
    }
  });
});

/* ---- Row 7: labels inside the box and clear of every side --------------------------------- */

type Point = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };

/** Does the segment p→q pass through the box's interior (Liang–Barsky clipping)? */
function segmentHitsBox(p: Point, q: Point, box: Box): boolean {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, p.x - box.x],
    [dx, box.x + box.w - p.x],
    [-dy, p.y - box.y],
    [dy, box.y + box.h - p.y],
  ];
  for (const [d, n] of edges) {
    if (d === 0) {
      if (n <= 0) return false;
      continue;
    }
    const t = n / d;
    if (d < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return false;
  }
  return true;
}

const sidesOf = (triangle: PathElement): [Point, Point][] => {
  const corners = triangle.points.map((p) => ({
    x: triangle.x + p.x * triangle.w,
    y: triangle.y + p.y * triangle.h,
  }));
  return corners.map((c, i) => [c, corners[(i + 1) % corners.length] as Point]);
};

const inside = (el: SlideElement, rect: FigureRect) =>
  el.x > 0 && el.y > 0 && el.x + el.w <= rect.w && el.y + el.h <= rect.h;

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("right-triangle placement on every theme (row 7)", () => {
  const GRID = [
    { name: "3-4", v: values(3, 4, undefined, ["3 cm", "4 cm", "x"]) },
    { name: "5-12", v: values(5, 12, undefined, ["5 cm", "12 cm", "x"]) },
    { name: "8-15", v: values(8, 15, undefined, ["8 m", "15 m", "17 m"]) },
    { name: "7-24", v: values(7, 24, undefined, ["7 mm", "24 mm", "h"]) },
    { name: "1-1", v: values(1, 1, undefined, ["1", "1", "√2"]) },
    { name: "12, hypotenuse 13", v: values(12, undefined, 13, ["12 cm", "y", "13 cm"]) },
    { name: "leg 9, hypotenuse 15", v: values(undefined, 9, 15, ["a", "9 cm", "15 cm"]) },
    {
      name: "12-character labels",
      v: values(3, 4, 5, ["base 3.0 cm", "height 4 cm", "12.5 metres"]),
    },
    { name: "fallback", v: {} },
  ];
  for (const theme of THEMES) {
    for (const { name, v } of GRID) {
      it(`${name} on ${theme.id}`, () => {
        const g = drawFigure("right-triangle", v, theme, RECT);
        for (const child of g.children)
          expect(inside(child, RECT), `${child.type} ${child.name ?? ""} inside`).toBe(true);
        const sides = sidesOf(triangleOf(g));
        const boxes = texts(g);
        for (const box of boxes) {
          for (const [p, q] of sides)
            expect(segmentHitsBox(p, q, box), `"${textOf(box)}" clear of a side`).toBe(false);
          for (const other of boxes)
            if (other !== box)
              expect(overlaps(box, other), `"${textOf(box)}" / "${textOf(other)}"`).toBe(false);
        }
      });
    }
  }
});
