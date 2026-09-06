import { describe, expect, test } from "bun:test";
import { type Point, type Rect, rotatePoint } from "../../model/geometry";
import { HANDLE_DIR, HANDLES, type HandleId, MIN_SIZE } from "./constants";
import {
  anchorOf,
  applyEdgeSnap,
  clampGroupScale,
  movingLinesFor,
  resizeRect,
  scaleAbout,
  scaleGroupChildren,
  scaleWithin,
} from "./resize";

/* From TeachDeck's `transform-resize.test.ts` catalogue (23 cases + the 32-case anchor matrix). */

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

/** The world-space point a drag on `handle` is supposed to leave alone. */
function worldAnchor(r: Rect, rotation: number, handle: HandleId): Point {
  const d = HANDLE_DIR[handle];
  const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  const local = { x: c.x - (d.x * r.w) / 2, y: c.y - (d.y * r.h) / 2 };
  return rotatePoint(local, c, rotation);
}

/** A pointer that drags `handle` 40pt outwards along the element's own axes. */
function pointerFor(r: Rect, rotation: number, handle: HandleId, out = 40): Point {
  const d = HANDLE_DIR[handle];
  const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  const local = { x: c.x + d.x * (r.w / 2 + out), y: c.y + d.y * (r.h / 2 + out) };
  return rotatePoint(local, c, rotation);
}

describe("resizeRect — the anchor stays put", () => {
  const start = rect(100, 80, 200, 120);
  for (const rotation of [0, 30, 90, 137]) {
    for (const handle of HANDLES) {
      test(`keeps the opposite side fixed: ${handle} at ${rotation}deg`, () => {
        const out = resizeRect({
          handle,
          start,
          rotation,
          pointer: pointerFor(start, rotation, handle),
        });
        const before = worldAnchor(start, rotation, handle);
        const after = worldAnchor(out, rotation, handle);
        expect(after.x).toBeCloseTo(before.x, 6);
        expect(after.y).toBeCloseTo(before.y, 6);
        const d = HANDLE_DIR[handle];
        expect(out.w).toBeCloseTo(d.x ? start.w + 40 : start.w, 6);
        expect(out.h).toBeCloseTo(d.y ? start.h + 40 : start.h, 6);
      });
    }
  }
});

describe("resizeRect — modifiers", () => {
  const start = rect(0, 0, 200, 100);

  test("Alt resizes about the centre", () => {
    const out = resizeRect({ handle: "se", start, pointer: { x: 400, y: 300 }, fromCentre: true });
    expect(out).toEqual({ x: -200, y: -200, w: 600, h: 500 });
  });

  test("Alt keeps the centre fixed at every rotation", () => {
    for (const rotation of [0, 30, 90, 137]) {
      const out = resizeRect({
        handle: "nw",
        start,
        rotation,
        pointer: pointerFor(start, rotation, "nw"),
        fromCentre: true,
      });
      expect(out.x + out.w / 2).toBeCloseTo(100, 6);
      expect(out.y + out.h / 2).toBeCloseTo(50, 6);
    }
  });

  test("aspect keeps the start ratio on a corner", () => {
    const out = resizeRect({ handle: "se", start, pointer: { x: 400, y: 160 }, aspect: true });
    expect(out.w / out.h).toBeCloseTo(start.w / start.h, 6);
    expect(out).toEqual({ x: 0, y: 0, w: 400, h: 200 });
  });

  test("lockHeight leaves an auto-height text alone on a width drag", () => {
    const out = resizeRect({ handle: "e", start, pointer: { x: 500, y: 50 }, lockHeight: true });
    expect([out.w, out.h]).toEqual([500, 100]);
  });
});

describe("resizeRect — MIN_SIZE", () => {
  const start = rect(0, 0, 200, 100);

  test("bottoms out at MIN_SIZE without moving the anchor", () => {
    const out = resizeRect({ handle: "e", start, pointer: { x: -1000, y: 50 } });
    expect([out.w, out.x]).toEqual([MIN_SIZE, 0]);
  });

  test("solves the aspect ratio against the unclamped drag", () => {
    const out = resizeRect({ handle: "se", start, pointer: { x: -300, y: 200 }, aspect: true });
    expect([out.w, out.h]).toEqual([32, MIN_SIZE]);
    expect(out.w / out.h).toBeCloseTo(start.w / start.h, 6);
  });

  test("never lets an aspect drag put either axis under MIN_SIZE", () => {
    const out = resizeRect({ handle: "se", start, pointer: { x: -1000, y: -1000 }, aspect: true });
    expect(Math.min(out.w, out.h)).toBeGreaterThanOrEqual(MIN_SIZE);
  });
});

describe("movingLinesFor", () => {
  test("names only the edges the handle drags", () => {
    expect(movingLinesFor("se")).toEqual({ x: ["max"], y: ["max"] });
    expect(movingLinesFor("nw")).toEqual({ x: ["min"], y: ["min"] });
    expect(movingLinesFor("n")).toEqual({ x: [], y: ["min"] });
    expect(movingLinesFor("e")).toEqual({ x: ["max"], y: [] });
  });
});

describe("applyEdgeSnap", () => {
  const r = rect(100, 100, 200, 100);

  test("moves the dragged edge and leaves the anchor put", () => {
    expect(applyEdgeSnap(r, "e", 4, 0, MIN_SIZE)).toEqual(rect(100, 100, 204, 100));
    expect(applyEdgeSnap(r, "w", -4, 0, MIN_SIZE)).toEqual(rect(96, 100, 204, 100));
    expect(applyEdgeSnap(r, "n", 0, 4, MIN_SIZE)).toEqual(rect(100, 104, 200, 96));
  });

  test("respects the minimum", () => {
    expect(applyEdgeSnap(r, "e", -1000, 0, MIN_SIZE).w).toBe(MIN_SIZE);
  });
});

describe("anchorOf", () => {
  const from = rect(100, 100, 200, 100);

  test("is the opposite corner for a corner handle", () => {
    expect(anchorOf(from, "se")).toEqual({ x: 100, y: 100 });
    expect(anchorOf(from, "nw")).toEqual({ x: 300, y: 200 });
  });

  test("uses the centre on axes the handle does not drive", () => {
    expect(anchorOf(from, "e")).toEqual({ x: 100, y: 150 });
    expect(anchorOf(from, "s")).toEqual({ x: 200, y: 100 });
  });

  test("is the centre under Alt", () => {
    expect(anchorOf(from, "se", true)).toEqual({ x: 200, y: 150 });
  });
});

describe("scaleAbout", () => {
  test("agrees with scaleWithin for an unrotated member", () => {
    const from = rect(0, 0, 200, 100);
    const to = rect(0, 0, 400, 300);
    const child = rect(50, 25, 60, 30);
    expect(scaleAbout(child, anchorOf(from, "se"), to.w / from.w, to.h / from.h)).toEqual(
      scaleWithin(child, from, to),
    );
  });

  test("scales a member by its centre, so a rotated member does not drift", () => {
    const out = scaleAbout(rect(100, 100, 40, 20), { x: 0, y: 0 }, 2, 2);
    expect([out.x + out.w / 2, out.y + out.h / 2, out.w, out.h]).toEqual([240, 220, 80, 40]);
  });

  test("leaves everything alone at scale 1", () => {
    const r = rect(10, 20, 30, 40);
    expect(scaleAbout(r, { x: 5, y: 5 }, 1, 1)).toEqual(r);
  });
});

describe("clampGroupScale", () => {
  test("floors the scale on the smallest member, once for the whole group", () => {
    expect(clampGroupScale(0.2, [200, 100, 32])).toBe(0.5);
    expect(clampGroupScale(0.8, [200, 100, 32])).toBe(0.8);
  });

  test("never forces a scale above 1", () => {
    expect(clampGroupScale(0.5, [8])).toBe(1);
    expect(clampGroupScale(2, [8])).toBe(2);
  });

  test("ignores zero-sized members", () => {
    expect(clampGroupScale(0.3, [0, 200])).toBeCloseTo(0.3, 6);
  });
});

describe("scaleGroupChildren", () => {
  test("scales children in the group local space without mutating the input", () => {
    const children = [
      { id: "a", x: 0, y: 0, w: 50, h: 20 },
      { id: "b", x: 60, y: 40, w: 40, h: 20 },
    ];
    expect(scaleGroupChildren(children, 2, 0.5)).toEqual([
      { id: "a", x: 0, y: 0, w: 100, h: 10 },
      { id: "b", x: 120, y: 20, w: 80, h: 10 },
    ]);
    expect(children[1]).toEqual({ id: "b", x: 60, y: 40, w: 40, h: 20 });
  });

  test("recurses into a nested group", () => {
    const children = [{ x: 10, y: 10, w: 20, h: 20, children: [{ x: 5, y: 5, w: 10, h: 10 }] }];
    expect(scaleGroupChildren(children, 2, 2)[0]?.children).toEqual([
      { x: 10, y: 10, w: 20, h: 20 },
    ]);
  });
});
