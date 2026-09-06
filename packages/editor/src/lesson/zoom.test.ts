import { describe, expect, test } from "bun:test";
import { nextStep } from "../kit/ZoomControl";
import { stepZoom, ZOOM_STEPS } from "./Canvas";

/* Row 14: the zoom shortcuts walk `ZOOM_STEPS`, from a fit that sits between stops as well. */

describe("stepZoom", () => {
  test("from a stop, one stop in either direction, clamped at the ends", () => {
    expect(stepZoom(1, 1)).toBe(1.5);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(8, 1)).toBe(8);
    expect(stepZoom(0.1, -1)).toBe(0.1);
  });

  test("from between stops (a fit), the nearest stop in that direction — never skipping one", () => {
    expect(stepZoom(0.72, 1)).toBe(0.75);
    expect(stepZoom(0.72, -1)).toBe(0.5);
    expect(stepZoom(1.14, 1)).toBe(1.5);
    expect(stepZoom(1.14, -1)).toBe(1);
    expect(stepZoom(0.05, -1)).toBe(0.1);
    expect(stepZoom(9, 1)).toBe(8);
  });

  test("is the ZoomControl's own step over the same stops", () => {
    for (const z of [0.3, 0.75, 1.9, 5]) {
      expect(stepZoom(z, 1)).toBe(nextStep(ZOOM_STEPS, z, 1));
      expect(stepZoom(z, -1)).toBe(nextStep(ZOOM_STEPS, z, -1));
    }
  });
});
