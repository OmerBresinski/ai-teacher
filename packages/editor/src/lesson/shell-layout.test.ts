import { describe, expect, test } from "bun:test";
import { MIN_DOCKED_SCALE, paneMode, paneWidth, slideScale } from "./shell-layout";

/*
 * The shell rules' pure functions pinned to known values (ruling 187). The real editor is swept
 * across window sizes in the browser by `apps/web/e2e/editor-shell.spec.ts`.
 */
describe("shell rules (ruling 187)", () => {
  test("the pane is clamp(304, 20vw + 64, 420)", () => {
    expect(paneWidth(1024)).toBe(304);
    expect(paneWidth(1200)).toBe(304);
    expect(paneWidth(1440)).toBe(352);
    expect(paneWidth(1780)).toBe(420);
    expect(paneWidth(2560)).toBe(420);
  });

  test("reserved while the slide beside the pane keeps scale 0.65; overlay below that", () => {
    expect(MIN_DOCKED_SCALE).toBe(0.65);
    // 1440 x 900 with layout A's chrome: canvas 1392 x 764.
    expect(paneMode(1392, 764, 352)).toBe("docked");
    // 1024 x 768: canvas 976 x 632; beside a 304 pane the slide is 640 wide, scale 0.667.
    expect(paneMode(976, 632, 304)).toBe("docked");
    // 960 x 700: canvas 912 x 564; beside the pane it would be 576 wide (0.6), so overlay.
    expect(paneMode(912, 564, 304)).toBe("overlay");
  });

  test("a short window loses nothing to the pane, so it stays reserved", () => {
    // 1280 x 500: the height already limits the slide below 0.65.
    expect(paneMode(1232, 364, 320)).toBe("docked");
  });

  test("the slide's scale is the same open or closed (no re-fit) and fits what is left", () => {
    expect(slideScale(1392, 764, 352)).toBeCloseTo((1392 - 352 - 32) / 960, 5);
    expect(slideScale(912, 564, 304)).toBeCloseTo((564 - 152) / 540, 5);
  });
});
