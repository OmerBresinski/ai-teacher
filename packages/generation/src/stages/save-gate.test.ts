import { describe, expect, test } from "bun:test";
import type { SlideSpec } from "@tj/slides";
import { memoryLogger } from "../testing";
import type { PipelineDeps } from "../types";
import { saveGate } from "./generate";

/* The save gate: every generated slide is checked and logged, never rewritten. */

const depsWith = () => {
  const { lines, logger } = memoryLogger();
  return { lines, deps: { logger } as unknown as PipelineDeps };
};
const logged = (lines: string[]) => lines.map((l) => JSON.parse(l));

describe("saveGate", () => {
  test("a slide that fits on every theme logs one info line", () => {
    const { lines, deps } = depsWith();
    const spec = {
      kind: "content",
      factRefs: ["k1"],
      heading: "Roots",
      body: "Roots take in water.",
    };
    expect(saveGate(spec as SlideSpec, 3, deps)).toBe(true);
    const [line] = logged(lines);
    expect(line).toMatchObject({
      msg: "save gate",
      level: 30,
      stage: "generate",
      index: 3,
      kind: "content",
      fits: true,
    });
    expect(line.failing).toBeUndefined();
  });

  test("a slide that does not fit logs a warning naming the themes, as counts only", () => {
    const { lines, deps } = depsWith();
    const body = Array.from({ length: 14 }, () => "Water moves up the stem to the leaves.").join(
      " ",
    );
    const spec = { kind: "content", factRefs: ["k1"], heading: "Too much", body };
    expect(saveGate(spec as SlideSpec, 0, deps)).toBe(false);
    const [line] = logged(lines);
    expect(line).toMatchObject({ msg: "save gate", level: 40, fits: false });
    expect(line.failing.length).toBeGreaterThan(0);
    expect(Object.keys(line.failing[0]).sort()).toEqual([
      "answers",
      "lane",
      "overflow",
      "overlaps",
      "steps",
      "theme",
    ]);
    // Never content in a log line.
    expect(JSON.stringify(line)).not.toContain("Water moves");
  });
});
