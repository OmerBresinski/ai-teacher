import { describe, expect, test } from "bun:test";
import { SLIDE_H, SLIDE_W } from "@tj/domain/documents";
import { clearShift } from "./Canvas";
import {
  fitScale,
  CANVAS_GUTTER_X as GX,
  CANVAS_GUTTER_Y as GY,
  MIN_DOCKED_SCALE,
  PANE_MAX,
  PANE_MIN,
  paneMode,
  paneWidth,
  slideScale,
} from "./shell-layout";

/*
 * The shell rules swept over every screen from 1024 x 700 to 2560 x 1440: the slide fits what is
 * left, opening the pane never re-fits it, nothing collides, and the pane stays readable.
 * The chrome is layout A's: a 48 px left rail, a 48 px top bar, an 88 px filmstrip.
 */
const RAIL = 48;
const TOP = 48;
const STRIP = 88;
/** The zoom row at its widest (residual badge, steps group, zoom, options) and the bubble. */
const FOOTER_MAX_W = 480;
const FOOTER_RIGHT_WITH_BUBBLE = 80;
const BUBBLE = { right: 16, size: 48 };
/** The pane's text column: the pane less its padding and the reply's avatar indent. */
const PANE_TEXT_INSET = 64;
/** About 34 characters of 14 px text. */
const READABLE_LINE = 240;

type Box = { x: number; w: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w;

function layout(vw: number, vh: number, open: boolean) {
  const canvasW = vw - RAIL;
  const canvasH = vh - TOP - STRIP;
  const pane = paneWidth(vw);
  const mode = paneMode(canvasW, canvasH, pane);
  const scale = slideScale(canvasW, canvasH, pane);
  const slideW = SLIDE_W * scale;
  const contentW = slideW + GX * 2;
  const shift = clearShift(canvasW, contentW, GX, open ? pane : 0);
  const slide = { x: (canvasW - contentW) / 2 - shift + GX, w: slideW };
  const paneBox = { x: canvasW - pane, w: pane };
  const footerRight = open ? pane + 16 : FOOTER_RIGHT_WITH_BUBBLE;
  const footer = { x: canvasW - footerRight - FOOTER_MAX_W, w: FOOTER_MAX_W };
  const bubble = open ? null : { x: canvasW - BUBBLE.right - BUBBLE.size, w: BUBBLE.size };
  return {
    canvasW,
    canvasH,
    pane,
    mode,
    scale,
    slide,
    slideH: SLIDE_H * scale,
    paneBox,
    footer,
    bubble,
  };
}

const widths: number[] = [];
for (let w = 1024; w <= 2560; w += 32) widths.push(w);
const heights: number[] = [];
for (let h = 700; h <= 1440; h += 20) heights.push(h);
const sizes = widths.flatMap((w) => heights.map((h) => [w, h] as const));

describe("shell rules, swept over 1024-2560 x 700-1440", () => {
  test("the pane is fluid, between its readable minimum and its maximum", () => {
    let prev = 0;
    for (const w of widths) {
      const p = paneWidth(w);
      expect(p).toBeGreaterThanOrEqual(PANE_MIN);
      expect(p).toBeLessThanOrEqual(PANE_MAX);
      expect(p).toBeGreaterThanOrEqual(prev);
      expect(p - PANE_TEXT_INSET).toBeGreaterThanOrEqual(READABLE_LINE);
      prev = p;
    }
  });

  test("the slide fits what is left of the canvas: inside it, and tight on one side", () => {
    for (const [w, h] of sizes) {
      const l = layout(w, h, false);
      const roomW = l.canvasW - (l.mode === "docked" ? l.pane : 0) - GX * 2;
      const roomH = l.canvasH - GY * 2;
      expect(l.slide.w).toBeLessThanOrEqual(roomW + 0.5);
      expect(l.slideH).toBeLessThanOrEqual(roomH + 0.5);
      expect(Math.min(roomW - l.slide.w, roomH - l.slideH)).toBeLessThan(1);
    }
  });

  test("opening or closing never re-fits the slide; it only recentres, by at most half the pane plus air", () => {
    for (const [w, h] of sizes) {
      const closed = layout(w, h, false);
      const open = layout(w, h, true);
      expect(open.slide.w).toBe(closed.slide.w);
      expect(Math.abs(open.slide.x - closed.slide.x)).toBeLessThanOrEqual(closed.pane / 2 + 16);
    }
  });

  test("reserved whenever the slide beside the pane stays usable; overlay only below that", () => {
    for (const [w, h] of sizes) {
      const l = layout(w, h, true);
      const beside = fitScale(l.canvasW - l.pane, l.canvasH);
      const usable = Math.min(MIN_DOCKED_SCALE, fitScale(l.canvasW, l.canvasH));
      expect(l.mode).toBe(beside >= usable - 1e-9 ? "docked" : "overlay");
      // Every screen in the sweep is wide enough to reserve.
      expect(l.mode).toBe("docked");
      if (l.mode === "docked") {
        // Reserved: the open pane never lies over the slide.
        expect(l.slide.x + l.slide.w).toBeLessThanOrEqual(l.paneBox.x - GX + 0.5);
      } else {
        // Overlay: the slide keeps its full fit and moves as far left as its margin allows.
        expect(l.scale).toBe(fitScale(l.canvasW, l.canvasH));
        expect(l.slide.x).toBeCloseTo(GX, 0);
      }
    }
  });

  test("narrower than the sweep, the pane overlays and the slide keeps its full fit", () => {
    for (const w of [880, 920, 960]) {
      const l = layout(w, 700, true);
      expect(l.mode).toBe("overlay");
      expect(l.scale).toBe(fitScale(l.canvasW, l.canvasH));
      expect(layout(w, 700, false).slide.w).toBe(l.slide.w);
    }
  });

  test("the bubble, the zoom row and the pane never collide", () => {
    for (const [w, h] of sizes) {
      for (const open of [false, true]) {
        const l = layout(w, h, open);
        expect(l.footer.x).toBeGreaterThanOrEqual(GX);
        if (l.bubble) expect(overlaps(l.footer, l.bubble)).toBe(false);
        if (open) expect(overlaps(l.footer, l.paneBox)).toBe(false);
      }
    }
  });
});
