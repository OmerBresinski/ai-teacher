import { describe, expect, test } from "bun:test";
import { materialiseSlide, type SlideSpec } from "@tj/slides";
import { withDiagramKept } from "./repair";

const meta = { model: "test", promptVersion: "generate-slide.v26" } as never;
let n = 0;
const ids = () => `id${++n}`;
const before: SlideSpec = {
  kind: "content",
  heading: "Water moves round a cycle",
  body: "Water keeps moving between sea, air and land. The sun heats it, so it rises as vapour.",
  diagram: "Cycle: evaporation → condensation → precipitation → collection, arrows clockwise",
  factRefs: ["k1"],
};

describe("generate-slide v26: a repair keeps the slide's diagram", () => {
  test("the placeholder's instruction returns when the repaired spec has none", () => {
    const slide = materialiseSlide(before, "classic", meta, ids);
    const { diagram: _d, ...repaired } = before as SlideSpec & { diagram?: string };
    expect(withDiagramKept(repaired as SlideSpec, slide)).toMatchObject({
      diagram: (before as { diagram: string }).diagram,
    });
  });

  test("a typed diagram from the repair wins, and 'none' is dropped", () => {
    const slide = materialiseSlide(before, "classic", meta, ids);
    const typed = { ...before, diagram: "Sequence: sea → vapour → cloud" } as SlideSpec;
    expect(withDiagramKept(typed, slide)).toMatchObject({
      diagram: "Sequence: sea → vapour → cloud",
    });
    const none = { ...before, diagram: "none" } as SlideSpec;
    const plain = materialiseSlide(
      { ...before, diagram: undefined } as SlideSpec,
      "classic",
      meta,
      ids,
    );
    expect("diagram" in withDiagramKept(none, plain)).toBe(false);
  });
});
