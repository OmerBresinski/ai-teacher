import { describe, expect, test } from "bun:test";
import type { SlideElement } from "@tj/domain/documents";
import { shownSpans, shownTogether } from "./reflow";

/* TEACH-247 part ae: which clicks each element is on screen, and which pairs ever share one. */
const text = (id: string, x: number, y: number, w: number, h: number, step = 0) =>
  ({
    id,
    type: "text",
    x,
    y,
    w,
    h,
    ...(step ? { revealStep: step } : {}),
  }) as unknown as SlideElement;
const cover = (id: string, x: number, y: number, w: number, h: number, step: number, more = {}) =>
  ({
    id,
    type: "shape",
    shape: "rect",
    x,
    y,
    w,
    h,
    fill: "#ffffff",
    revealStep: step,
    ...more,
  }) as unknown as SlideElement;

describe("shownSpans (TEACH-247 part ae)", () => {
  test("a box tiled by two covers on a later click is hidden from that click", () => {
    const els = [
      text("card", 100, 100, 600, 80),
      cover("left", 0, 50, 400, 300, 1),
      cover("right", 400, 50, 560, 300, 1),
      text("verdict", 100, 120, 200, 40, 1),
    ];
    const spans = shownSpans(els);
    expect(spans[0]).toEqual([0, 1]);
    expect(shownTogether(spans, 0, 3)).toBe(false);
  });
  test("a partial cover hides nothing", () => {
    const els = [text("card", 100, 100, 600, 80), cover("left", 0, 50, 400, 300, 1)];
    expect(shownSpans(els)[0]).toEqual([0, Number.POSITIVE_INFINITY]);
  });
  test("a translucent cover hides nothing (opacity, #rrggbbaa, rgba)", () => {
    for (const more of [
      { opacity: 0.5 },
      { fill: "#ffffff80" },
      { fill: "rgba(255, 255, 255, 0.4)" },
    ]) {
      const els = [text("card", 100, 100, 200, 80), cover("tint", 0, 0, 960, 540, 1, more)];
      expect(shownSpans(els)[0]).toEqual([0, Number.POSITIVE_INFINITY]);
    }
  });
  test("an opaque cover drawn before the box does not hide it", () => {
    const els = [cover("ground", 0, 0, 960, 540, 1), text("card", 100, 100, 200, 80)];
    expect(shownSpans(els)[1]).toEqual([0, Number.POSITIVE_INFINITY]);
  });
  test("two boxes on screen at the same click still overlap", () => {
    const els = [text("a", 100, 100, 300, 80), text("b", 120, 120, 300, 80, 1)];
    expect(shownTogether(shownSpans(els), 0, 1)).toBe(true);
  });
});
