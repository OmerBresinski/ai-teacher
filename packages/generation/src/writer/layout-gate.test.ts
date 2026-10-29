import { describe, expect, test } from "bun:test";
import { LAYOUT_FAULT, layoutGate } from "./layout-gate";

/* TEACH-247 part af: the order of the layout gate's fallbacks and when each is undone. */
const run = (o: { faults: string[][]; split: boolean }) => {
  const calls: string[] = [];
  let k = 0;
  const r = layoutGate({
    faults: () => o.faults[Math.min(k++, o.faults.length - 1)] ?? [],
    split: () => (calls.push("split"), o.split),
    undoSplit: () => void calls.push("undo-split"),
  });
  return { ...r, calls };
};

describe("layout gate (TEACH-247 part af)", () => {
  test("a clean slide is left alone", () => {
    expect(run({ faults: [[]], split: true })).toEqual({ outcome: "clean", faults: [], calls: [] });
  });
  test("a split that clears the faults keeps the visual", () => {
    const r = run({ faults: [["overflow: x"], []], split: true });
    expect(r.outcome).toBe("split");
    expect(r.calls).toEqual(["split"]);
  });
  test("a split that leaves faults in any part is undone and the faults reported", () => {
    const r = run({
      faults: [["overlap: a and b"], ["part 2: overlap: c and d"], ["overlap: a and b"]],
      split: true,
    });
    expect(r).toEqual({
      outcome: "left",
      faults: ["overlap: a and b"],
      calls: ["split", "undo-split"],
    });
  });
  test("what nothing fixes is reported, never hidden", () => {
    const r = run({ faults: [["clipped: x runs off the slide"]], split: false });
    expect(r).toEqual({
      outcome: "left",
      faults: ["clipped: x runs off the slide"],
      calls: ["split"],
    });
  });
  // TEACH-247 part cb (Plants s3, replay v5): a fault nothing clears never costs the slide its
  // visual. The gate has no step that drops one, and keeps it when it reports the fault.
  test("a picture overlap no step clears keeps the picture and is reported", () => {
    const r = run({
      faults: [['overlap: "What do plants need to grow?" over a picture']],
      split: false,
    });
    expect(r.outcome).toBe("left");
    expect(r.calls).not.toContain("drop");
  });
  // TEACH-251 part s: the other layout that keeps the visual comes before a split.
  test("a layout switch that clears the faults keeps the visual; one that does not is undone", () => {
    const calls: string[] = [];
    const steps = (afterSwitch: string[]) => {
      let k = 0;
      const seq = [["clipped: lead runs off"], afterSwitch, afterSwitch];
      return layoutGate({
        faults: () => seq[Math.min(k++, seq.length - 1)] ?? [],
        switchLayout: () => calls.push("switch") > 0,
        undoSwitch: () => void calls.push("undo-switch"),
        split: () => calls.push("split") < 0,
        undoSplit: () => void calls.push("undo-split"),
      });
    };
    expect(steps([]).outcome).toBe("switched");
    expect(calls).toEqual(["switch"]);
    calls.length = 0;
    expect(steps(["clipped: still"]).outcome).toBe("left");
    expect(calls).toEqual(["switch", "undo-switch", "split"]);
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
