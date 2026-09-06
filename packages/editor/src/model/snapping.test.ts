import { describe, expect, test } from "bun:test";
import {
  buildSnapTargets,
  computeEqualSpacing,
  computeMoveSnap,
  computeSnap,
  type Guide,
  type Rect,
  type SnapTarget,
  stageSnapTargets,
} from "./snapping";

/*
 * Behaviour tests from TeachDeck's `lib/__tests__/snapping.test.ts` catalogue (23 cases). The
 * thresholds are already in slide points: 8 screen px at 100% is 8 pt.
 */

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const el = (id: string, r: Rect): SnapTarget => ({ id, rect: r, kind: "element" });
const align = (guides: Guide[]) => guides.filter((g) => g.type === "align");
const spacing = (guides: Guide[]) => guides.filter((g) => g.type === "spacing");

describe("computeSnap — edges and centres", () => {
  test("snaps a left edge to a sibling left edge and reports one guide spanning both", () => {
    const r = computeSnap(rect(102, 200, 60, 50), [el("a", rect(100, 300, 100, 50))], 8);
    expect(r.dx).toBe(-2);
    expect(r.dy).toBe(0);
    expect(r.guides).toHaveLength(1);
    const [g] = align(r.guides);
    expect(g).toMatchObject({ axis: "x", position: 100, role: "edge", start: 200, end: 350 });
  });

  test("reports every line that ties, so identical boxes show all three", () => {
    const r = computeSnap(rect(102, 300, 100, 50), [el("a", rect(100, 100, 100, 50))], 8);
    expect(r.dx).toBe(-2);
    expect(r.guides).toHaveLength(3);
  });

  test("snaps to the slide centre line at 480, spanning the whole slide", () => {
    const r = computeSnap(rect(474, 10, 20, 20), stageSnapTargets(), 8);
    expect(r.dx).toBe(-4);
    const g = align(r.guides).find((x) => x.role === "slide-centre");
    expect(g).toMatchObject({ position: 480, start: 0, end: 540 });
  });

  test("snaps to the safe-area edges at 58 / 43", () => {
    expect(computeSnap(rect(62, 300, 100, 50), stageSnapTargets(), 8).dx).toBe(-4);
    expect(computeSnap(rect(300, 47, 100, 50), stageSnapTargets(), 8).dy).toBe(-4);
  });

  test("does nothing beyond the threshold", () => {
    const r = computeSnap(rect(120, 200, 100, 50), [el("a", rect(100, 300, 100, 50))], 8);
    expect(r).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  test("honours a scaled-down threshold (8 screen px at 200% zoom = 4pt)", () => {
    const targets = [el("a", rect(100, 300, 100, 50))];
    expect(computeSnap(rect(106, 200, 60, 50), targets, 8 / 1).dx).toBe(-6);
    expect(computeSnap(rect(106, 200, 60, 50), targets, 8 / 2).dx).toBe(0);
  });

  test("restricts snapping to the dragged edges when resizing", () => {
    const moving = rect(100, 0, 100, 50);
    const targets = [el("a", rect(203, 0, 50, 50))];
    expect(computeSnap(moving, targets, 8, { lines: { x: ["max"], y: [] } }).dx).toBe(3);
    expect(computeSnap(moving, targets, 8, { lines: { x: ["min"], y: [] } }).dx).toBe(0);
  });

  test("returns a zero delta but still guides for a perfect alignment", () => {
    const r = computeSnap(rect(100, 0, 100, 50), [el("a", rect(100, 200, 100, 50))], 8);
    expect(r.dx).toBe(0);
    expect(r.guides.length).toBeGreaterThan(0);
  });

  test("never draws a guide for the losing side of an opposite-sign tie", () => {
    const targets = [el("left", rect(0, 200, 96, 50)), el("right", rect(204, 200, 100, 50))];
    const r = computeSnap(rect(100, 200, 100, 50), targets, 4);
    expect(r.dx).toBe(-4);
    expect(align(r.guides).flatMap((g) => (g.axis === "x" ? [g.position] : []))).toEqual([96]);
  });

  test("still draws every same-sign tie", () => {
    const targets = [el("a", rect(100, 300, 100, 50)), el("b", rect(100, 400, 60, 50))];
    const r = computeSnap(rect(102, 200, 100, 50), targets, 8);
    expect(r.dx).toBe(-2);
    expect(align(r.guides).filter((g) => g.axis === "x" && g.position === 100)).toHaveLength(2);
  });

  test("freezes an axis whose allowed lines are empty (Shift-constrained drag)", () => {
    const targets = [el("a", rect(100, 100, 100, 50))];
    const free = computeSnap(rect(102, 103, 100, 50), targets, 8);
    expect([free.dx, free.dy]).toEqual([-2, -3]);
    const frozen = computeSnap(rect(102, 103, 100, 50), targets, 8, { lines: { y: [] } });
    expect([frozen.dx, frozen.dy]).toEqual([-2, 0]);
    expect(frozen.guides.every((g) => g.axis === "x")).toBe(true);
  });
});

describe("buildSnapTargets", () => {
  test("adds the slide and safe-area targets by default", () => {
    const t = buildSnapTargets([{ id: "a", rect: rect(0, 0, 10, 10) }]);
    expect(t.map((x) => x.kind)).toEqual(["slide", "safe", "element"]);
    expect(buildSnapTargets([{ id: "a", rect: rect(0, 0, 10, 10) }], false)).toHaveLength(1);
  });
});

describe("computeEqualSpacing", () => {
  const pair = [el("a", rect(0, 0, 100, 100)), el("b", rect(400, 0, 100, 100))];

  test("centres a box in the gap between two siblings", () => {
    const r = computeEqualSpacing(rect(210, 0, 100, 100), pair, 20);
    expect([r.dx, r.dy]).toEqual([-10, 0]);
    expect(r.guides).toHaveLength(1);
    expect(r.guides[0]).toMatchObject({
      axis: "x",
      gap: 100,
      cross: 50,
      segments: [
        { from: 100, to: 200 },
        { from: 300, to: 400 },
      ],
    });
  });

  test("continues an existing run with the same gap", () => {
    const targets = [el("a", rect(0, 0, 100, 100)), el("b", rect(150, 0, 100, 100))];
    const r = computeEqualSpacing(rect(305, 0, 100, 100), targets, 20);
    expect(r.dx).toBe(-5);
    expect(r.guides[0]?.gap).toBe(50);
  });

  test("ignores siblings that do not share a band on the cross axis", () => {
    expect(computeEqualSpacing(rect(210, 400, 100, 100), pair, 20)).toEqual({
      dx: 0,
      dy: 0,
      guides: [],
    });
  });

  test("needs at least two references", () => {
    const r = computeEqualSpacing(rect(210, 0, 100, 100), [el("a", rect(0, 0, 100, 100))], 20);
    expect(r.guides).toHaveLength(0);
  });

  test("works on the vertical axis too", () => {
    const targets = [el("a", rect(0, 0, 100, 100)), el("b", rect(0, 400, 100, 100))];
    const r = computeEqualSpacing(rect(0, 212, 100, 100), targets, 20);
    expect(r.dy).toBe(-12);
    expect(r.guides[0]?.axis).toBe("y");
  });
});

describe("computeMoveSnap", () => {
  const pair = [el("a", rect(0, 0, 100, 100)), el("b", rect(400, 0, 100, 100))];

  test("lets alignment win and fills the free axis with spacing", () => {
    const r = computeMoveSnap(rect(212, 0, 100, 100), pair, 8, 20);
    expect(r.dy).toBe(0);
    expect(r.dx).toBe(-12);
    expect(spacing(r.guides).some((g) => g.axis === "x")).toBe(true);
    expect(align(r.guides).some((g) => g.axis === "y")).toBe(true);
  });

  test("never lets spacing override an exact alignment", () => {
    const targets = [el("a", rect(0, 0, 100, 100)), el("b", rect(0, 400, 100, 100))];
    const r = computeMoveSnap(rect(0, 0, 100, 100), targets, 8, 20);
    expect(r.dy).toBe(0);
    expect(r.guides.every((g) => g.type === "align")).toBe(true);
  });

  test("fills both axes with spacing when neither aligns, bars on the final centre", () => {
    const targets = [...pair, el("c", rect(220, 400, 100, 100)), el("d", rect(220, 700, 100, 100))];
    const r = computeMoveSnap(rect(205, 15, 100, 200), targets, 8, 20);
    expect(align(r.guides)).toHaveLength(0);
    expect([r.dx, r.dy]).toEqual([-5, -15]);
    const bars = spacing(r.guides);
    expect(bars).toHaveLength(2);
    expect(bars.find((g) => g.axis === "x")?.cross).toBe(100);
    expect(bars.find((g) => g.axis === "y")?.cross).toBe(250);
  });

  test("draws the spacing bars across the element as it ends up, not as it was", () => {
    const r = computeMoveSnap(rect(210, 3, 100, 100), pair, 8, 20);
    expect([r.dx, r.dy]).toEqual([-10, -3]);
    expect(spacing(r.guides)[0]?.cross).toBe(50);
  });

  test("honours a frozen axis for spacing as well as alignment", () => {
    expect(computeMoveSnap(rect(215, 0, 100, 100), pair, 8, 20).dx).toBe(-15);
    const frozen = computeMoveSnap(rect(215, 0, 100, 100), pair, 8, 20, { lines: { x: [] } });
    expect(frozen.dx).toBe(0);
    expect(frozen.guides.every((g) => g.axis === "y")).toBe(true);
  });

  test("keeps the guide extents spanning only the elements involved", () => {
    const r = computeMoveSnap(rect(102, 200, 60, 50), [el("a", rect(100, 300, 100, 50))], 8, 20);
    expect(align(r.guides)[0]).toMatchObject({ start: 200, end: 350 });
  });
});
