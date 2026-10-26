import { describe, expect, test } from "bun:test";
import { LAYOUT_FAULT, layoutGate } from "./layout-gate";

/* TEACH-247 part af: the order of the layout gate's fallbacks and when each is undone. */
const run = (o: { faults: string[][]; visuals: boolean; split: boolean }) => {
  const calls: string[] = [];
  let k = 0;
  const r = layoutGate({
    faults: () => o.faults[Math.min(k++, o.faults.length - 1)] ?? [],
    dropVisuals: () => (calls.push("drop"), o.visuals),
    undoDrop: () => void calls.push("undo"),
    split: () => (calls.push("split"), o.split),
  });
  return { ...r, calls };
};

describe("layout gate (TEACH-247 part af)", () => {
  test("a clean slide is left alone", () => {
    expect(run({ faults: [[]], visuals: true, split: true })).toEqual({
      outcome: "clean",
      faults: [],
      calls: [],
    });
  });
  test("a split that clears the faults keeps the visual", () => {
    const r = run({ faults: [["overflow: x"], []], visuals: true, split: true });
    expect(r.outcome).toBe("split");
    expect(r.calls).toEqual(["split"]);
  });
  test("no split: dropping the visual that clears the faults is kept", () => {
    const r = run({ faults: [["overlap: a over a picture"], []], visuals: true, split: false });
    expect(r.outcome).toBe("dropped-visual");
    expect(r.calls).toEqual(["split", "drop"]);
  });
  test("a drop that does not clear is undone and the faults are reported", () => {
    const r = run({ faults: [["overflow: x"]], visuals: true, split: false });
    expect(r.outcome).toBe("left");
    expect(r.calls).toEqual(["split", "drop", "undo"]);
  });
  test("what nothing fixes is reported, never hidden", () => {
    const r = run({ faults: [["clipped: x runs off the slide"]], visuals: false, split: false });
    expect(r).toEqual({
      outcome: "left",
      faults: ["clipped: x runs off the slide"],
      calls: ["split", "drop"],
    });
  });
  test("only layout faults go through the gate", () => {
    for (const f of ["overlap: a and b", "clipped: x", "off-slide: x"])
      expect(LAYOUT_FAULT.test(f)).toBe(true);
    for (const f of [
      "overflow: myth.fact",
      "dangling: look",
      "duplicate: s3",
      "diagram: no room",
      "unanswered: 1",
    ])
      expect(LAYOUT_FAULT.test(f)).toBe(false);
  });
});
