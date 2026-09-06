import { describe, expect, test } from "bun:test";
import { SLIDE_H, SLIDE_W } from "@tj/domain/documents";
import { fitWithin } from "./images";
import {
  clampRect,
  LINE_KINDS,
  makeEmbed,
  makeIcon,
  makeImage,
  makeLine,
  makeShape,
  makeTable,
  makeText,
  makeTimer,
  OVERHANG,
  placeRect,
  SHAPE_KINDS,
  TEXT_PRESETS,
} from "./insert";
import { getTheme } from "./themes";

const theme = getTheme("chalk");
const inside = (r: { x: number; y: number; w: number; h: number }) =>
  r.x >= 0 && r.y >= 0 && r.x + r.w <= SLIDE_W && r.y + r.h <= SLIDE_H;

describe("insert factories", () => {
  test("placeRect centres on the slide by default and clamps to the overhang", () => {
    expect(placeRect(100, 50)).toEqual({ x: 430, y: 245, w: 100, h: 50 });
    expect(placeRect(100, 50, { x: 0, y: 0 })).toEqual({ x: -50, y: OVERHANG - 50, w: 100, h: 50 });
    expect(clampRect({ x: 5000, y: 5000, w: 10, h: 10 })).toEqual({
      x: SLIDE_W - OVERHANG,
      y: SLIDE_H - OVERHANG,
      w: 10,
      h: 10,
    });
  });

  test("text presets: one line at the preset's width, placeholder copy, unknown preset falls back to body", () => {
    for (const spec of TEXT_PRESETS) {
      const el = makeText(spec.preset, theme);
      expect(el.w).toBe(spec.width);
      expect(el.h).toBe(Math.ceil(theme.sizes[spec.preset] * theme.lineHeights[spec.preset]));
      expect(el.style.preset).toBe(spec.preset);
      expect(JSON.stringify(el.doc)).toContain(spec.placeholder);
      expect(inside(el)).toBe(true);
    }
    expect(makeText("small", theme).w).toBe(520);
  });

  test("shapes: squares for ellipse/star/diamond, radius only on rounded, theme accent fill", () => {
    for (const { shape } of SHAPE_KINDS) {
      const el = makeShape(shape, theme);
      expect(el.fill).toBe(theme.colors.accent2);
      expect(inside(el)).toBe(true);
      if (shape === "ellipse" || shape === "star" || shape === "diamond") {
        expect(el.w).toBe(el.h);
      }
      expect(el.radius).toBe(shape === "rounded" ? theme.radius : undefined);
    }
    expect(makeShape("pill", theme)).toMatchObject({ w: 280, h: 96 });
  });

  test("lines, icons, tables, timers, embeds", () => {
    for (const { id } of LINE_KINDS) {
      const el = makeLine(id, theme);
      expect(el.arrowEnd).toBe(id === "arrow");
      expect(el.stroke).toBe(theme.colors.ink);
      expect(el).toMatchObject({ from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 }, strokeWidth: 3 });
    }
    expect(makeIcon("star", theme)).toMatchObject({
      icon: "star",
      color: theme.colors.accent,
      w: 120,
    });
    const table = makeTable(theme);
    expect(table.rows).toHaveLength(3);
    expect(table.rows[0]).toEqual(["Column", "Column", "Column"]);
    expect(table.fontSize).toBeGreaterThanOrEqual(theme.sizes.small);
    expect(makeTimer()).toMatchObject({ seconds: 300, w: 300, h: 180 });
    expect(makeEmbed()).toMatchObject({ url: "", w: 600, h: 338 });
  });

  test("images keep their aspect and cap at 60% of the slide", () => {
    const wide = makeImage("data:,", { w: 4000, h: 1000 });
    expect(wide.w).toBe(SLIDE_W * 0.6);
    expect(wide.h).toBe(Math.round((SLIDE_W * 0.6) / 4));
    expect(wide.fit).toBe("contain");
    // a small square scales up to the cap's shorter side, so it fills the box like TeachDeck
    const square = makeImage("data:,", { w: 100, h: 100 }, { x: 480, y: 270 });
    expect(square).toMatchObject({ w: SLIDE_H * 0.6, h: SLIDE_H * 0.6, x: 318, y: 108 });
    expect(fitWithin({ w: 0, h: 0 }, { w: 10, h: 10 })).toEqual({ w: 0, h: 0 });
  });
});
