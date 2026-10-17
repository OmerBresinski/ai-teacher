import { describe, expect, test } from "bun:test";
import type { PathElement, ShapeElement } from "@tj/domain/documents";
import { getTheme } from "../themes";
import {
  CARD_TREATS,
  COVER_COMPS,
  FIELD_EDGES,
  FRAME_STYLES,
  hexagonPoints,
  innerSides,
  MARK_SHAPES,
  marksFromTokens,
  notchPoints,
  octagonPoints,
  outlineArea,
  RULE_STYLES,
  TITLE_TREATS,
  TORN_DEPTH,
  tornPoints,
} from "./marks";
import { markLook, paintSurface, SURFACE_TOKENS, surfacesOf } from "./surfaces";

const inBox = (pts: { x: number; y: number }[]) =>
  pts.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);

describe("mark geometry", () => {
  test("hexagon: six points in the box, flat top, sides cut by a quarter", () => {
    const h = hexagonPoints();
    expect(h).toHaveLength(6);
    expect(inBox(h)).toBe(true);
    expect(h[0]).toEqual({ x: 0.25, y: 0 });
    expect(h[2]).toEqual({ x: 1, y: 0.5 });
    expect(outlineArea(h)).toBeCloseTo(0.75, 5);
  });

  test("octagon: eight points, corners cut by 29% of the short side", () => {
    const o = octagonPoints(100, 50);
    expect(o).toHaveLength(8);
    expect(inBox(o)).toBe(true);
    expect(o[0]?.x).toBeCloseTo(14.5 / 100, 4);
  });

  test("notch: the top-left and bottom-right corners cut by the leg, never past half a side", () => {
    const n = notchPoints(200, 100, 10);
    expect(n).toEqual([
      { x: 0.05, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 0.9 },
      { x: 0.95, y: 1 },
      { x: 0, y: 1 },
      { x: 0, y: 0.1 },
    ]);
    const huge = notchPoints(20, 20, 50);
    expect(huge[0]).toEqual({ x: 0.5, y: 0 });
  });

  test("torn: inside the box, at most TORN_DEPTH deep, slide-edge sides straight, stable", () => {
    const box = { x: 0, y: 120, w: 400, h: 300 };
    const sides = innerSides(box);
    expect(sides).toEqual({ top: true, left: false, right: true, bottom: true });
    const t = tornPoints(box.w, box.h, sides);
    expect(inBox(t)).toBe(true);
    expect(tornPoints(box.w, box.h, sides)).toEqual(t);
    for (const p of t) {
      const px = p.x * box.w;
      const py = p.y * box.h;
      const inward = Math.min(py, box.w - px, box.h - py);
      if (px > 0.001) expect(inward).toBeLessThanOrEqual(TORN_DEPTH + 0.01);
    }
    // The left side is the slide's edge: no point bites in from it.
    expect(t.filter((p) => p.x > 0 && p.x < 0.02 && p.y > 0.05 && p.y < 0.95)).toHaveLength(0);
  });
});

/*
 * The theme-family guard (audit 17 Oct): every theme declares each shape family, the value is a
 * known keyword, and Geometric's declared shapes reach the painter (the PPTX half is
 * `packages/editor/src/export/pptx-surfaces.test.ts`). On 463f30aa9 tokens.json had none of these
 * keys, so the first test fails there.
 */
const FAMILIES: [string, readonly string[]][] = [
  ["badge-shape", MARK_SHAPES],
  ["key-shape", MARK_SHAPES],
  ["medal-shape", MARK_SHAPES],
  ["chip-shape", MARK_SHAPES],
  ["card-treat", CARD_TREATS],
  ["rule-style", RULE_STYLES],
  ["frame-style", FRAME_STYLES],
  ["field-edge", FIELD_EDGES],
  ["title-treat", TITLE_TREATS],
  ["cover", COVER_COMPS],
];

describe("theme-family guard", () => {
  for (const [id, tokens] of Object.entries(SURFACE_TOKENS))
    test(`${id} declares every shape family with a known keyword`, () => {
      for (const [key, allowed] of FAMILIES) {
        expect(tokens[key], `${id} ${key}`).toBeDefined();
        expect(allowed, `${id} ${key}=${tokens[key]}`).toContain(tokens[key] as string);
      }
    });

  test("each theme's declared families reach the surface painter", () => {
    const kinds: Record<string, ShapeElement["shape"][]> = {
      disc: ["ellipse"],
      pill: ["ellipse", "pill"],
      hex: ["hexagon"],
      notch: ["notch"],
      square: ["rect"],
      tile: ["rect"],
      rounded: ["rounded"],
      tag: ["rounded"],
      outline: ["ellipse", "rounded"],
      sticky: ["rect"],
    };
    for (const id of Object.keys(SURFACE_TOKENS)) {
      const t = getTheme(id);
      const m = surfacesOf(t).marks;
      const box = { x: 100, y: 100, w: 40, h: 40 };
      const badge = paintSurface({ id: "b", role: "badge", box }, t) as ShapeElement;
      expect(kinds[m.badge], `${id} badge ${m.badge}`).toContain(badge.shape);
      expect(kinds[m.key], `${id} key ${m.key}`).toContain(
        markLook(t, "key", 40, "#000000", "#FFFFFF").shape,
      );
      const rule = paintSurface({ id: "r", role: "rule", box: { x: 0, y: 0, w: 300, h: 2 } }, t);
      if (m.rule === "solid") expect(rule?.type).toBe("shape");
      else expect((rule as PathElement).dash).toBe(m.rule === "dots" ? "dotted" : "dashed");
      const field = paintSurface(
        { id: "f", role: "field-b", box: { x: 0, y: 200, w: 960, h: 340 } },
        t,
      );
      if (m.field === "straight") expect(field?.type).toBe("shape");
      else expect(field?.type).toBe("path");
    }
  });

  test("Geometric: hexagon badges, notched keys and cards, dotted rules, hexagon cover", () => {
    const t = getTheme("geometric");
    expect(marksFromTokens(SURFACE_TOKENS.geometric ?? {})).toMatchObject({
      badge: "hex",
      key: "notch",
      medal: "hex",
      chip: "hex",
      rule: "dots",
      field: "notch",
      cover: "shape",
      ground: "dots",
    });
    const card = paintSurface({ id: "c", role: "card", box: { x: 80, y: 120, w: 300, h: 200 } }, t);
    expect(card?.type).toBe("path");
    expect((card as PathElement).points).toEqual(notchPoints(300, 200, 10));
  });
});

/*
 * RTL (ROOT/build/RTL-DESIGN.md): a slide mirrors with one transform on boxes, x' = 960 - x - w,
 * and a path's points (fractions of its box) mirror as x' = 1 - x. A notch drawn as path geometry
 * must land on the opposite corners; a hexagon is its own mirror.
 */
describe("marks mirror with their box (RTL)", () => {
  const mirror = (e: PathElement): PathElement => ({
    ...e,
    x: 960 - e.x - e.w,
    points: e.points.map((p) => ({ x: Math.round((1 - p.x) * 10000) / 10000, y: p.y })),
  });
  test("a Geometric card's notch moves to the top-right and bottom-left", () => {
    const t = getTheme("geometric");
    const card = paintSurface(
      { id: "c", role: "card", box: { x: 80, y: 120, w: 300, h: 200 } },
      t,
    ) as PathElement;
    const m = mirror(card);
    expect(m.x).toBe(580);
    const cut = (pts: { x: number; y: number }[], cx: number, cy: number) =>
      !pts.some((p) => p.x === cx && p.y === cy);
    expect(cut(card.points, 0, 0)).toBe(true);
    expect(cut(card.points, 1, 0)).toBe(false);
    expect(cut(m.points, 1, 0)).toBe(true);
    expect(cut(m.points, 0, 1)).toBe(true);
    expect(cut(m.points, 0, 0)).toBe(false);
  });
  test("a hexagon badge is its own mirror", () => {
    const h = hexagonPoints();
    const m = h.map((p) => ({ x: 1 - p.x, y: p.y }));
    for (const p of m) expect(h).toContainEqual(p);
  });
});
