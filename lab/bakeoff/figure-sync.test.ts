// chalkie-gap Y5-B (b3-r2-1 y5 slide 7): the repair rewrote "⅗ of 20" to "⅗ of 30 = 18" and the
// bar kept its whole of 20. The input and output below are that run's repair.jsonl line, verbatim.
import { describe, expect, test } from "bun:test";
import { getTheme } from "../../packages/slides/src/themes";
import { setAbArm } from "./ab/arms";
import { type LibDeps, libDiagram } from "./ab/lib";
import { armT } from "./arm-t";
import {
  barModelParams,
  figureTextMismatch,
  fractionsOf,
  numbersIn,
  rederiveFigure,
  specKey,
  syncFigure,
} from "./figure-sync";

type J = Record<string, unknown>;
const BEFORE: J = {
  template: "equation-hero",
  heading: "Find ⅗ of 20",
  lead: null,
  formula: "20 ÷ 5 × 3 = 12",
  points: ["One fifth: 20 ÷ 5 = 4", "Three fifths: 4 × 3 = 12", "⅗ of 20 is 12."],
  figure: {
    kind: "bar-model",
    shows: "Twenty split into five equal parts, with three parts selected.",
    alt: "A bar of twenty has five parts of four; three parts are shaded.",
    title: null,
    bars: [
      { label: null, whole: 20, parts: 5, values: null, shaded: 3, unknown: "none", unit: null },
    ],
    combined: null,
  },
};
const REPAIRED: J = {
  template: "equation-hero",
  heading: "Find ⅗ of 30",
  lead: null,
  formula: "30 ÷ 5 × 3 = 18",
  points: ["One fifth: 30 ÷ 5 = 6", "Three fifths: 6 × 3 = 18", "⅗ of 30 is 18."],
  figure: {
    kind: "bar-model",
    shows: "Thirty split into five equal parts, with three parts selected.",
    labels: [],
  },
};

describe("figure numbers against the slide's words", () => {
  test("numbers and fraction-of phrases are read from the words", () => {
    expect(numbersIn("⅗ of 30 = 18")).toEqual([3, 5, 30, 18]);
    expect(fractionsOf("Find ⅗ of 30. Then 3/4 of £24.")).toEqual([
      { n: 3, d: 5, N: 30 },
      { n: 3, d: 4, N: 24 },
    ]);
  });
  test("the y5 s7 case: the old bar of 20 beside the repaired words is a mismatch", () => {
    expect(figureTextMismatch(BEFORE.figure, BEFORE)).toBeUndefined();
    expect(figureTextMismatch(BEFORE.figure, REPAIRED)).toContain("draws 20");
  });
  test("the drawer's form (total label, parts array) is read too", () => {
    const drawn = {
      kind: "bar-model",
      bars: [{ total: "20", parts: Array(5).fill({ value: 1, label: "4" }) }],
    };
    expect(figureTextMismatch(drawn, REPAIRED)).toContain("draws 20");
    expect(
      figureTextMismatch({ ...drawn, bars: [{ ...drawn.bars[0], total: "30" }] }, REPAIRED),
    ).toBeUndefined();
  });
  test("the right bars on that deck's other slides pass (s9 ¾ of 24, s10 £30)", () => {
    const s9 = {
      heading: "Which number do we divide by?",
      points: ["Correct order: 24 ÷ 4 = 6, then 6 × 3 = 18."],
      figure: { kind: "bar-model", bars: [{ whole: 24, parts: 4, shaded: 3 }] },
    };
    expect(figureTextMismatch(s9.figure, s9)).toBeUndefined();
    const s10 = {
      heading: "How much does Asha spend?",
      points: ["Asha has £30. She spends ⅖ of it on a book.", "Asha spends £12."],
      figure: { kind: "bar-model", bars: [{ whole: 30, parts: 5, shaded: 2, unit: "£" }] },
    };
    expect(figureTextMismatch(s10.figure, s10)).toBeUndefined();
  });
  test("a slide with no numbers in its words is not judged", () => {
    expect(figureTextMismatch(BEFORE.figure, { heading: "One equal part" })).toBeUndefined();
  });
  test("a library bar_model's params are checked the same way", () => {
    const lib = {
      libDrawn: {
        model: "bar_model",
        params: { type: "fraction", amount: 20, fraction: { n: 3, d: 5 } },
      },
    };
    expect(figureTextMismatch(lib, REPAIRED)).toContain("draws 20");
  });
});

describe("the repair redraws or drops, never keeps a stale figure", () => {
  test("y5 s7: the repaired stub takes the old spec, then is redrawn from the words as 30", () => {
    const r = syncFigure(BEFORE, REPAIRED);
    expect(r.action).toBe("redrawn");
    const f = r.slide.figure as J;
    expect(f.bars).toEqual([
      { label: null, whole: 30, parts: 5, values: null, shaded: 3, unknown: "none", unit: null },
    ]);
    expect(String(f.alt)).toBe("A bar of 30 split into 5 equal parts of 6; 3 parts are shaded.");
    expect(f.shows).toBe("Thirty split into five equal parts, with three parts selected.");
    expect(figureTextMismatch(f, r.slide)).toBeUndefined();
    // the redrawn spec is not the old drawing, so swapSlide does not carry the old visual
    const { shows: _a, ...oldSpec } = BEFORE.figure as J;
    const { shows: _b, ...newSpec } = f;
    expect(specKey(oldSpec)).not.toBe(specKey(newSpec));
  });
  test("a re-word that keeps the numbers keeps the figure, spec unchanged", () => {
    const reworded = { ...BEFORE, heading: "Three fifths of 20", figure: REPAIRED.figure };
    const r = syncFigure(BEFORE, reworded);
    expect(r.action).toBe("kept");
    const { shows: _a, ...oldSpec } = BEFORE.figure as J;
    const { shows: _b, ...newSpec } = r.slide.figure as J;
    expect(specKey(newSpec)).toBe(specKey(oldSpec));
  });
  test("words that cannot rebuild the bar drop it", () => {
    const two = {
      ...REPAIRED,
      heading: "⅗ of 30 and ¾ of 24",
      formula: "30 ÷ 5 × 3 = 18",
      points: ["¾ of 24 is 18."],
    };
    const r = syncFigure(BEFORE, two);
    expect(r.action).toBe("drop");
    expect(rederiveFigure(BEFORE.figure as J, two)).toBeUndefined();
  });
  test("a slide with no figure is left alone", () => {
    const { figure: _f, ...plain } = REPAIRED;
    expect(syncFigure(BEFORE, plain).action).toBe("none");
  });
});

describe("lib arm: a fraction-of-an-amount bar goes through library bar_model", () => {
  test("params are worked out in code from the writer's bar", () => {
    expect(barModelParams(BEFORE.figure as J)).toEqual({
      type: "fraction",
      amount: 20,
      fraction: { n: 3, d: 5 },
      unknown: "part",
    });
    const two = {
      kind: "bar-model",
      bars: [
        { whole: 12, parts: 3 },
        { whole: 8, parts: 2 },
      ],
    };
    expect(barModelParams(two)).toBeUndefined();
    expect(
      barModelParams({ kind: "bar-model", bars: [{ whole: 20, parts: 3, shaded: 1 }] }),
    ).toBeUndefined();
  });
  test("the writer's bar asks for the model only when the lib arm is on", () => {
    const slide = { ...BEFORE, template: "visual-text" };
    const ctx = { theme: getTheme("studio", "ks2"), stage: "ks2" } as never;
    setAbArm("lib");
    const on = armT.visuals!(slide, 6, ctx) as J[];
    setAbArm("base4");
    const off = armT.visuals!(slide, 6, ctx) as J[];
    setAbArm(undefined);
    expect(on[0]!.kind).toBe("model");
    expect((on[0]!.spec as J).model).toBe("bar_model");
    expect((on[0]!.spec as J).params).toEqual(barModelParams(BEFORE.figure as J));
    expect(((on[0]!.spec as J).writer as J).bars).toEqual((BEFORE.figure as J).bars);
    expect(off[0]!.kind).toBe("bar-model");
  });
  test("given params are checked and drawn with no fill call", async () => {
    let fills = 0;
    let drawn: J | undefined;
    const deps: LibDeps = {
      filler: async () => {
        fills++;
        return { out: null, usd: 0.001 };
      },
      render: async (_id, params) => {
        drawn = params;
        return { src: "data:image/png;base64,x", aspect: 2, warnings: [] };
      },
    };
    const params =
      barModelParams(REPAIRED.figure as J) ??
      barModelParams({
        kind: "bar-model",
        bars: [{ whole: 30, parts: 5, shaded: 3 }],
      });
    const r = await libDiagram(
      {
        key: "6:diagram",
        shows: "Thirty in five parts",
        words: "Find ⅗ of 30",
        yearGroup: "Year 5",
        spec: { model: "bar_model", intent: "⅗ of 30", params },
      },
      deps,
      () => {},
    );
    expect(fills).toBe(0);
    expect(r.usd).toBe(0);
    expect(r.libDrawn?.model).toBe("bar_model");
    expect((drawn as J).amount).toBe(30);
    expect(figureTextMismatch({ libDrawn: r.libDrawn }, REPAIRED)).toBeUndefined();
  });
});
