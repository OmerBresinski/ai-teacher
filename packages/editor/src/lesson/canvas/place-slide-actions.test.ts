import { describe, expect, test } from "bun:test";
import {
  type Box,
  CHROME_EDGE,
  CHROME_GAP,
  CHROME_MIN_TOP,
  placeSlideActions,
} from "./place-slide-actions";

/*
 * Screen-space placement of the slide action pill and the Question / Answer tabs (TeachDeck
 * `lib/__tests__/slide-actions.test.ts` "slide action placement" / "question tab placement",
 * TEACH-113 gap analysis). Pure: the rules are checked without a DOM; `editor.spec.ts` "fidelity"
 * checks the pill never rides nearer the top than 72px on a real page.
 */

const PILL = { w: 140, h: 32 };
const VIEWPORT = { w: 1440, h: 900 };

/** Do the two rects share a pixel? The pill covering the bar is exactly this. */
const intersects = (a: Box, b: Box) =>
  a.left < b.left + b.width &&
  a.left + a.width > b.left &&
  a.top < b.top + b.height &&
  a.top + a.height > b.top;

const rect = (left: number, top: number, size = PILL): Box => ({
  left,
  top,
  width: size.w,
  height: size.h,
});

describe("slide action placement", () => {
  test("right-aligns to the slide frame, in the band above it", () => {
    const slide = { left: 300, top: 200, width: 800, height: 450 };
    expect(placeSlideActions({ slide, pill: PILL, viewport: VIEWPORT })).toEqual(
      rect(300 + 800 - PILL.w, 200 - CHROME_GAP - PILL.h),
    );
  });

  test("clamps to the viewport when the slide runs past its right edge", () => {
    const slide = { left: 200, top: 300, width: 1400, height: 700 };
    const { left } = placeSlideActions({ slide, pill: PILL, viewport: VIEWPORT });
    expect(left).toBe(VIEWPORT.w - CHROME_EDGE - PILL.w);
  });

  test("drops inside the frame when the slide top is under the top bar, never above CHROME_MIN_TOP", () => {
    // 100 - 10 - 32 = 58 is under the 72px floor, so the band above the slide is out.
    const slide = { left: 300, top: 100, width: 800, height: 2000 };
    expect(placeSlideActions({ slide, pill: PILL, viewport: VIEWPORT })).toEqual(
      rect(300 + 800 - PILL.w, 100 + CHROME_GAP),
    );
    // Scrolled further under the bar, the in-frame corner would sit in the top bar's shadow:
    // the floor wins (TeachDeck's `floating-chrome-v2.ts` floor; `editor.spec.ts` "fidelity").
    const under = { left: 300, top: 44, width: 800, height: 2000 };
    expect(placeSlideActions({ slide: under, pill: PILL, viewport: VIEWPORT })).toEqual(
      rect(300 + 800 - PILL.w, CHROME_MIN_TOP),
    );
  });

  test("never rides over the top bar", () => {
    const slide = { left: 300, top: -400, width: 800, height: 2000 };
    const { top } = placeSlideActions({ slide, pill: PILL, viewport: VIEWPORT });
    expect(top).toBe(CHROME_MIN_TOP);
  });

  test("stacks above the contextual toolbar when the bar is in the way", () => {
    const slide = { left: 500, top: 300, width: 400, height: 225 };
    // A bar wider than the slide, centred on it: it reaches the pill's corner.
    const avoid = { left: 400, top: 250, width: 600, height: 40 };
    const placed = placeSlideActions({ slide, pill: PILL, viewport: VIEWPORT, avoid });
    expect(placed).toEqual(rect(500 + 400 - PILL.w, 250 - CHROME_GAP - PILL.h));
    expect(intersects(placed, avoid)).toBe(false);
  });

  test("drops inside the frame when the band above the toolbar has no room", () => {
    const slide = { left: 500, top: 120, width: 400, height: 225 };
    const avoid = { left: 400, top: 70, width: 600, height: 40 };
    const placed = placeSlideActions({ slide, pill: PILL, viewport: VIEWPORT, avoid });
    expect(placed).toEqual(rect(500 + 400 - PILL.w, 120 + CHROME_GAP));
    expect(intersects(placed, avoid)).toBe(false);
  });

  /**
   * The geometry measured at 400% zoom: a 3840x2160 frame whose top has scrolled up under the
   * top bar, with the slide toolbar centred inside it. Both pieces of chrome used to fall back
   * into the frame's top-right corner, and the pill covered the bar.
   */
  test("clears the toolbar when the slide top is under the top bar as well", () => {
    const slide = { left: 305, top: 86, width: 3840, height: 2160 };
    const avoid = { left: 1090, top: 96, width: 342, height: 40 };
    const placed = placeSlideActions({ slide, pill: PILL, viewport: VIEWPORT, avoid });
    expect(intersects(placed, avoid)).toBe(false);
    // Above the bar would be 54, inside the top bar's floor; so it goes under the bar instead.
    expect(placed).toEqual(
      rect(VIEWPORT.w - CHROME_EDGE - PILL.w, avoid.top + avoid.height + CHROME_GAP),
    );
    expect(placed.top).toBeGreaterThanOrEqual(CHROME_MIN_TOP);
  });

  test("ignores a toolbar that is nowhere near", () => {
    const slide = { left: 300, top: 300, width: 800, height: 450 };
    const avoid = { left: 300, top: 250, width: 200, height: 40 };
    const placed = placeSlideActions({ slide, pill: PILL, viewport: VIEWPORT, avoid });
    expect(placed).toEqual(rect(300 + 800 - PILL.w, 300 - CHROME_GAP - PILL.h));
    expect(intersects(placed, avoid)).toBe(false);
  });

  test("an empty or null avoid list is the same as none", () => {
    const slide = { left: 300, top: 200, width: 800, height: 450 };
    const plain = placeSlideActions({ slide, pill: PILL, viewport: VIEWPORT });
    expect(placeSlideActions({ slide, pill: PILL, viewport: VIEWPORT, avoid: null })).toEqual(
      plain,
    );
    expect(placeSlideActions({ slide, pill: PILL, viewport: VIEWPORT, avoid: [null] })).toEqual(
      plain,
    );
    expect(
      placeSlideActions({
        slide,
        pill: PILL,
        viewport: VIEWPORT,
        avoid: { left: 0, top: 0, width: 0, height: 0 },
      }),
    ).toEqual(plain);
  });
});

describe("question tab placement", () => {
  const tabs = { w: 190, h: 40 };

  test("left-aligns to the slide frame, in the same band as the pill", () => {
    const slide = { left: 300, top: 200, width: 800, height: 450 };
    const start = placeSlideActions({ slide, pill: tabs, viewport: VIEWPORT, align: "start" });
    const end = placeSlideActions({ slide, pill: tabs, viewport: VIEWPORT });
    expect(start.left).toBe(300);
    expect(end.left).toBe(300 + 800 - tabs.w);
    expect(start.top).toBe(end.top);
  });

  test("clamps to the viewport when the slide runs past its left edge", () => {
    const slide = { left: -200, top: 300, width: 1800, height: 700 };
    const { left } = placeSlideActions({ slide, pill: tabs, viewport: VIEWPORT, align: "start" });
    expect(left).toBe(CHROME_EDGE);
  });

  test("keeps clear of the contextual toolbar on its own side", () => {
    const slide = { left: 500, top: 300, width: 400, height: 225 };
    const avoid = { left: 400, top: 250, width: 600, height: 40 };
    const { top } = placeSlideActions({
      slide,
      pill: tabs,
      viewport: VIEWPORT,
      avoid,
      align: "start",
    });
    expect(top).toBe(250 - CHROME_GAP - tabs.h);
  });

  /**
   * The geometry measured at 25% zoom: a 240px frame, narrower than the two bars hanging off its
   * ends put together. Both picked the band above the slide and the same y, and the tabs ran
   * 732..930 while the pill ran 835..972.
   */
  test("the pill gives way when the frame is too narrow for both bars", () => {
    const slide = { left: 732, top: 404, width: 240, height: 135 };
    const pill = { w: 137, h: 40 };
    const measured = { w: 198, h: 40 };

    const placedTabs = placeSlideActions({
      slide,
      pill: measured,
      viewport: VIEWPORT,
      align: "start",
    });
    expect([placedTabs.left, placedTabs.left + placedTabs.width]).toEqual([732, 930]);

    // What it used to do: the same band, the same top, 95px of overlap.
    const alone = placeSlideActions({ slide, pill, viewport: VIEWPORT });
    expect([alone.left, alone.left + alone.width]).toEqual([835, 972]);
    expect(alone.top).toBe(placedTabs.top);
    expect(intersects(alone, placedTabs)).toBe(true);

    // Told about the tabs, it stacks over them instead.
    const placed = placeSlideActions({ slide, pill, viewport: VIEWPORT, avoid: [placedTabs] });
    expect(intersects(placed, placedTabs)).toBe(false);
    expect(placed.top).toBe(placedTabs.top - CHROME_GAP - pill.h);
    expect(placed.left).toBe(835);
  });

  test("the pill clears the toolbar and the tabs together", () => {
    const slide = { left: 732, top: 404, width: 240, height: 135 };
    const pill = { w: 137, h: 40 };
    const placedTabs = placeSlideActions({
      slide,
      pill: { w: 198, h: 40 },
      viewport: VIEWPORT,
      align: "start",
    });
    // A toolbar in the band the pill would otherwise stack into.
    const toolbar = { left: 700, top: placedTabs.top - CHROME_GAP - 40, width: 300, height: 40 };
    const placed = placeSlideActions({
      slide,
      pill,
      viewport: VIEWPORT,
      avoid: [toolbar, placedTabs],
    });
    expect(intersects(placed, placedTabs)).toBe(false);
    expect(intersects(placed, toolbar)).toBe(false);
  });
});
