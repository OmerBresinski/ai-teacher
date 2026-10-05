import { describe, expect, it } from "bun:test";
import { getTheme } from "../themes";
import { drawnFill, sparseDrawing } from ".";
import { DIAGRAM_SAMPLES } from "./samples";

/* lab/cand: a big diagram that leaves most of its full-width zone empty is sparse. */
const FULL = { w: 844, h: 258 };
const studio = getTheme("studio");
const chick = {
  kind: "flow",
  alt: "A chick grows into a hen.",
  layout: "chain",
  steps: [
    { label: "Small, fluffy chick", arrow: "Grows" },
    { label: "Bigger, feathered young chicken", arrow: "Grows" },
    { label: "Adult hen" },
  ],
};

describe("drawn fill of a big diagram", () => {
  it("a 3-box chain fills little of the full zone and is sparse", () => {
    const f = drawnFill(chick, studio, FULL) ?? 1;
    expect(f).toBeLessThan(0.3);
    expect(sparseDrawing(chick, studio, FULL)).toBe(true);
  });
  it("a cycle, a line graph and a timeline fill it and are not", () => {
    for (const k of ["flow-cycle", "line-graph-heating", "timeline", "particles"]) {
      const s = DIAGRAM_SAMPLES[k];
      expect(sparseDrawing(s, studio, FULL)).toBe(false);
    }
  });
  it("a kind whose shapes the probe cannot see is never called sparse", () => {
    expect(sparseDrawing(DIAGRAM_SAMPLES.pie, studio, FULL)).toBe(false);
    expect(sparseDrawing({ kind: "nope" }, studio, FULL)).toBe(false);
  });
});
