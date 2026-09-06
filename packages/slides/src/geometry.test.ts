import { describe, expect, test } from "bun:test";
import {
  centre,
  contains,
  intersects,
  normaliseAngle,
  rectOf,
  rotatedBounds,
  rotatePoint,
  snapAngle,
  unionRect,
} from "./geometry";

describe("geometry", () => {
  test("unionRect covers every rect; empty input is the zero rect", () => {
    expect(
      unionRect([
        { x: 10, y: 20, w: 100, h: 50 },
        { x: 50, y: 0, w: 100, h: 30 },
      ]),
    ).toEqual({ x: 10, y: 0, w: 140, h: 70 });
    expect(unionRect([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  test("rectOf and centre", () => {
    const r = rectOf({ x: 10, y: 20, w: 100, h: 50 });
    expect(r).toEqual({ x: 10, y: 20, w: 100, h: 50 });
    expect(centre(r)).toEqual({ x: 60, y: 45 });
  });

  test("intersects and contains", () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };
    expect(intersects(a, { x: 50, y: 50, w: 100, h: 100 })).toBe(true);
    expect(intersects(a, { x: 100, y: 0, w: 10, h: 10 })).toBe(false);
    expect(contains(a, { x: 10, y: 10, w: 20, h: 20 })).toBe(true);
    expect(contains(a, { x: 90, y: 10, w: 20, h: 20 })).toBe(false);
  });

  test("rotatedBounds: 0° is the rect, 90° swaps the sides about the centre", () => {
    const r = { x: 0, y: 0, w: 100, h: 50 };
    expect(rotatedBounds(r)).toEqual(r);
    const turned = rotatedBounds(r, 90);
    expect(turned.w).toBeCloseTo(50);
    expect(turned.h).toBeCloseTo(100);
    expect(turned.x).toBeCloseTo(25);
    expect(turned.y).toBeCloseTo(-25);
  });

  test("rotatePoint turns about a pivot", () => {
    const p = rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 90);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(10);
  });

  test("snapAngle snaps within the threshold and leaves the rest", () => {
    expect(snapAngle(17)).toBe(15);
    expect(snapAngle(43)).toBe(45);
    expect(snapAngle(22)).toBe(22);
    expect(snapAngle(359)).toBe(360);
  });

  test("normaliseAngle wraps into [0, 360)", () => {
    expect(normaliseAngle(-30)).toBe(330);
    expect(normaliseAngle(720)).toBe(0);
    expect(normaliseAngle(45)).toBe(45);
  });
});
