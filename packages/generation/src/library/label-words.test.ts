import { afterAll, describe, expect, test } from "bun:test";
import { grownTextFault, libraryDiagram, WHOLE_WORD_STEP, WORDS_SPLIT } from "./fill";
import { drawLibraryModel, endDrawThread } from "./guard";
import { kit, loadModel } from "./render";

/*
 * TEACH-239 part b (C7), the label-word split rule (figure gold finding 1): growing a model's type
 * for the label floor broke "Reception" mid-word on the y2 "my life" timeline at 1.15. A grown
 * size that splits a word steps down by 0.05 until every word is whole, never falling back.
 */
afterAll(() => endDrawThread());

const myLife = async () => {
  const m = await loadModel("timeline");
  const i = m?.presets.findIndex((p) => /life/i.test(JSON.stringify(p).slice(0, 200))) ?? -1;
  return {
    m,
    params: (await kit()).withDefaults(m?.params ?? { properties: {} }, {
      ...(m?.presets[Math.max(0, i)]?.params ?? {}),
    } as Record<string, unknown>),
    raw: { ...(m?.presets[Math.max(0, i)]?.params ?? {}) } as Record<string, unknown>,
  };
};

describe("label floor: whole words", () => {
  test("the step is 0.05 and a word split is named as such", () => {
    expect(WHOLE_WORD_STEP).toBe(0.05);
    expect(grownTextFault("<svg></svg>", "<svg></svg>")).toBeUndefined();
  });
  test("a wide timeline grown for the floor keeps every word whole", async () => {
    const { params, raw } = await myLife();
    const base = await drawLibraryModel("timeline", params);
    const r = await libraryDiagram(
      {
        key: "d",
        model: "timeline",
        intent: "",
        words: "",
        heading: "",
        caption: "",
        yearGroup: "Year 2",
        lesson: "x",
        labelFloor: true,
        // The figure slide's stage for a 3.4:1 model at KS1, on the 960 grid.
        place: { x: 64, y: 140, w: 832, h: 245 },
      } as never,
      async () => raw,
    );
    if (r.ok) expect(grownTextFault(base.svg, r.drawing.svg)).not.toBe(WORDS_SPLIT);
    else expect(r.reason).not.toContain("split");
  });
});
