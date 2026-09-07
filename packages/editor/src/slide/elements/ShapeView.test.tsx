import { describe, expect, test } from "bun:test";
import type { ShapeElement, Theme } from "@tj/domain/documents";
import { shapeNode, shapeRadius } from "./ShapeView";

/* TEACH-151: a plain rectangle rounds its corners by `radius`, clamped exactly as "rounded" is. */

const rx = (kind: ShapeElement["shape"], w: number, h: number, radius: number) =>
  shapeNode(kind, w, h, radius).props.rx;

describe("shapeNode", () => {
  test("a rectangle honours its corner radius", () => {
    expect(shapeNode("rect", 200, 100, 24).type).toBe("rect");
    expect(rx("rect", 200, 100, 24)).toBe(24);
    expect(rx("rect", 200, 100, 0)).toBe(0);
  });

  test("rect and rounded clamp the radius to half the short side alike", () => {
    expect(rx("rect", 200, 40, 24)).toBe(20);
    expect(rx("rounded", 200, 40, 24)).toBe(20);
    expect(rx("rect", 30, 200, 100)).toBe(15);
  });

  test("a pill stays fully round whatever the radius", () => {
    expect(rx("pill", 200, 40, 4)).toBe(20);
    expect(rx("pill", 200, 40, 0)).toBe(20);
  });
});

describe("shapeRadius", () => {
  const theme = { radius: 12 } as Theme;
  test("a rectangle is square until given corners; rounded takes the theme's", () => {
    expect(shapeRadius({ shape: "rect" } as ShapeElement, theme)).toBe(0);
    expect(shapeRadius({ shape: "rect", radius: 24 } as ShapeElement, theme)).toBe(24);
    expect(shapeRadius({ shape: "rounded" } as ShapeElement, theme)).toBe(12);
  });
});
