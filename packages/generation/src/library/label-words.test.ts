import { afterAll, describe, expect, test } from "bun:test";
import { grownTextFault, WHOLE_WORD_STEP, WORDS_SPLIT, wholeWordDrawing } from "./fill";
import { drawLibraryModel, endDrawThread } from "./guard";
import { kit, loadModel } from "./render";

/*
 * TEACH-239 part b (C7), the label-word split rule (figure gold finding 1): growing the y2 "my
 * life" timeline's type to 1.15 for the label floor breaks "Reception" mid-word. A grown size that
 * splits a word steps down by 0.05 until every word is whole; a failed redraw keeps the base
 * drawing, so split words never ship.
 */
afterAll(() => endDrawThread());

const myLife = async () => {
  const m = await loadModel("timeline");
  const raw = m?.presets.find((p) => (p as { id?: string }).id === "y2-my-life")?.params ?? {};
  return (await kit()).withDefaults(m?.params ?? { properties: {} }, { ...raw } as never);
};

describe("label floor: whole words", () => {
  test("the y2 timeline really splits a word at 1.15, and steps down to whole words", async () => {
    const p = await myLife();
    const base = await drawLibraryModel("timeline", p);
    const grown = await drawLibraryModel("timeline", p, { typeScale: 1.15 });
    expect(grownTextFault(base.svg, grown.svg)).toBe(WORDS_SPLIT);
    const splits = (svg: string) => grownTextFault(base.svg, svg) === WORDS_SPLIT;
    const r = await wholeWordDrawing(grown, 1.15, base, splits, (ts) =>
      drawLibraryModel("timeline", p, { typeScale: ts }),
    );
    expect(splits(r.drawing.svg)).toBe(false);
    expect(r.scale).toBeLessThan(1.15);
    expect(r.scale).toBeGreaterThanOrEqual(1);
    expect(Math.round(((1.15 - r.scale) / WHOLE_WORD_STEP) * 1000) % 1000).toBe(0);
  });

  test("a redraw that fails keeps the base drawing, never the split one", async () => {
    const base = { svg: "base" };
    const r = await wholeWordDrawing(
      { svg: "split" },
      1.3,
      base,
      (svg) => svg === "split",
      async () => "it did not draw",
    );
    expect(r).toEqual({ drawing: base, scale: 1 });
  });

  test("back at the kit's size the base drawing is kept", async () => {
    const base = { svg: "base" };
    const r = await wholeWordDrawing(
      { svg: "split" },
      1.05,
      base,
      () => true,
      async () => ({
        svg: "split",
      }),
    );
    expect(r).toEqual({ drawing: base, scale: 1 });
  });
});
