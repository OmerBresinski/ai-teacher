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
    undoSplit: () => void calls.push("undo-split"),
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
  test("a split that leaves faults in any part is undone before the drop", () => {
    const r = run({
      faults: [["overlap: a and b"], ["part 2: overlap: c and d"], []],
      visuals: true,
      split: true,
    });
    expect(r.outcome).toBe("dropped-visual");
    expect(r.calls).toEqual(["split", "undo-split", "drop"]);
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
  // TEACH-251 part s: the other layout that keeps the visual comes before a split or a drop.
  test("a layout switch that clears the faults keeps the visual; one that does not is undone", () => {
    const calls: string[] = [];
    const steps = (afterSwitch: string[]) => {
      let k = 0;
      const seq = [["clipped: lead runs off"], afterSwitch, []];
      return layoutGate({
        faults: () => seq[Math.min(k++, seq.length - 1)] ?? [],
        switchLayout: () => calls.push("switch") > 0,
        undoSwitch: () => void calls.push("undo-switch"),
        dropVisuals: () => calls.push("drop") > 0,
        undoDrop: () => void calls.push("undo"),
        split: () => calls.push("split") < 0,
        undoSplit: () => void calls.push("undo-split"),
      });
    };
    expect(steps([]).outcome).toBe("switched");
    expect(calls).toEqual(["switch"]);
    calls.length = 0;
    expect(steps(["clipped: still"]).outcome).toBe("dropped-visual");
    expect(calls).toEqual(["switch", "undo-switch", "split", "drop"]);
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

describe("clipped: what bleeds by design and what is clipped (TEACH-247 part af)", () => {
  const { checkSlide } = require("./checks") as typeof import("./checks");
  const faults = (elements: unknown[]) =>
    checkSlide({
      index: 0,
      slide: { elements } as never,
      over: [],
      questions: [],
      answers: undefined,
      notesChecked: false,
      words: "",
    }).faults.filter((f) => f.startsWith("clipped:"));
  const doc = (t: string) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
  });
  test("a wordless surface ground running to the foot is not clipped", () => {
    expect(
      faults([{ type: "shape", name: "surface:field-b", x: 661, y: 147, w: 299, h: 414 }]),
    ).toEqual([]);
  });
  test("a surface carrying words past the edge is clipped", () => {
    expect(
      faults([
        { type: "shape", name: "surface:badge", x: 940, y: 520, w: 41, h: 41, doc: doc("3") },
      ]),
    ).toHaveLength(1);
  });
  test("a picture bleeding a little is not clipped; one mostly off the slide is", () => {
    expect(faults([{ type: "image", x: 480, y: 0, w: 500, h: 540 }])).toEqual([]);
    expect(faults([{ type: "image", x: 800, y: 0, w: 400, h: 540 }])).toHaveLength(1);
  });
});
