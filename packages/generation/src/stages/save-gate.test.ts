import { describe, expect, test } from "bun:test";
import type { SlideSpec } from "@tj/slides";
import { memoryLogger } from "../testing";
import { saveGate } from "./save-gate";

/* The save gate: every generated slide is checked and logged, never rewritten. */

const depsWith = () => {
  const { lines, logger } = memoryLogger();
  return { lines, deps: { logger } };
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
    saveGate(spec as SlideSpec, 3, deps);
    const [line, ...rest] = logged(lines);
    expect(rest).toEqual([]);
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
    const body = Array.from({ length: 30 }, () => "Water moves up the stem to the leaves.").join(
      " ",
    );
    const spec = { kind: "content", factRefs: ["k1"], heading: "Too much", body };
    saveGate(spec as SlideSpec, 0, deps);
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

  test("a fault in the check logs one warning and costs nothing else", () => {
    const { lines, deps } = depsWith();
    const spec = { kind: "content", factRefs: ["k1"], heading: "Roots", body: "Roots." };
    expect(() =>
      saveGate(spec as SlideSpec, 2, deps, () => {
        throw new Error("ruler broke");
      }),
    ).not.toThrow();
    const [line, ...rest] = logged(lines);
    expect(rest).toEqual([]);
    expect(line).toMatchObject({ msg: "save gate failed", level: 40, stage: "generate", index: 2 });
    expect(line.fits).toBeUndefined();
  });
});
