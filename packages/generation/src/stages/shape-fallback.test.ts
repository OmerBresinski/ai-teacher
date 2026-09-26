import { describe, expect, test } from "bun:test";
import { materialiseSlide, type SlideSpec } from "@tj/slides";
import type { PipelineDeps } from "../types";
import { logShapeFallback } from "./shared";

const meta = { promptVersion: "t", model: "m", at: "2026-09-26T00:00:00.000Z" };
const long = (n: number) =>
  Array.from({ length: n }, (_, i) => `word${i} photosynthesis chlorophyll`).join(" ");

describe("a shape the slide could not place is a metric, not a retry", () => {
  test("logged once by shape; a placed shape logs nothing", () => {
    const lines: [unknown, string][] = [];
    const logger = {
      info: (o: unknown, m: string) => lines.push([o, m]),
    } as unknown as PipelineDeps["logger"];
    const fits: SlideSpec = {
      kind: "content",
      factRefs: [],
      heading: "The water cycle",
      body: "Water moves in a loop.",
      steps: ["Evaporation", "Condensation", "Precipitation", "Collection"],
    };
    expect(
      logShapeFallback(logger, "generate", 3, fits, materialiseSlide(fits, "chalk", meta)),
    ).toBe(undefined);
    const over = { ...fits, steps: [long(4), long(4), long(4), long(4)] };
    expect(logShapeFallback(logger, "repair", 5, over, materialiseSlide(over, "chalk", meta))).toBe(
      "sequence",
    );
    expect(lines).toEqual([
      [
        { stage: "repair", metric: "shape-fallback", shape: "sequence", index: 5 },
        "shape fallback",
      ],
    ]);
  });
});
