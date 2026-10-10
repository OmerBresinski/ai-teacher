import { afterAll, describe, expect, test } from "bun:test";
import { modelBodyRect } from "@tj/slides/templates";
import { getTheme } from "@tj/slides/themes";
import { grownTextFault, libraryDiagram, overlappingWords, placedTypeSize } from "./fill";
import { drawLibraryModel, endDrawThread } from "./guard";
import { inspectDrawnSvg, kit, loadModel } from "./render";

/*
 * Label floor (flag `libraryLabelFloor`): a model's type tokens grow until its smallest words
 * show at 18 pt where the slide places it; then the overlap check runs, and words that split,
 * stack or leave the model fall back. Over all 202 presets at a body box: 100 pass before,
 * 174 with the floor (steps/s10-library/RESULTS.md).
 */
afterAll(() => endDrawThread());
const theme = getTheme("splash", "ks2" as never);
const preset = async (id: string, i: number) => {
  const m = await loadModel(id);
  return { ...(m?.presets[i]?.params ?? {}) } as Record<string, unknown>;
};
const ask = (model: string, heading: string) => ({
  key: "d",
  model,
  intent: "",
  words: "",
  heading: "",
  caption: "",
  yearGroup: "Year 5",
  lesson: "x",
  labelOverlap: true,
  place: modelBodyRect(heading, "Look at each part and say what it does.", theme, "ks2" as never),
});

describe("label floor", () => {
  test("a drawing at a type scale carries it, and its words read back that much larger", async () => {
    const p = (await kit()).withDefaults(
      (await loadModel("water_cycle"))?.params ?? { properties: {} },
      await preset("water_cycle", 0),
    );
    const a = await drawLibraryModel("water_cycle", p);
    const b = await drawLibraryModel("water_cycle", p, { typeScale: 1.2 });
    expect(b.svg).toContain('data-fs-scale="1.2"');
    const fa = Math.min(...inspectDrawnSvg(a.svg).words.map((w) => w.fs));
    const fb = Math.min(...inspectDrawnSvg(b.svg).words.map((w) => w.fs));
    expect(fb / fa).toBeGreaterThan(1.15);
  });
  test("water cycle: under 18 pt without the floor, drawn at >= 18 pt with no overlaps with it", async () => {
    const a = ask("water_cycle", "Where does rain come from?");
    const fill = async () => preset("water_cycle", 0);
    const before = await libraryDiagram(a, fill);
    expect(before.ok).toBe(false);
    if (!before.ok) expect(before.reason).toContain("floor");
    const after = await libraryDiagram({ ...a, labelFloor: true }, fill);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(placedTypeSize(after.drawing.svg, a.place).minPt).toBeGreaterThanOrEqual(17.99);
      expect(overlappingWords(after.drawing.svg)).toEqual([]);
    }
  });
  test("the D52 heart: grown, its key splits 'Oxygen-poor' across lines, so it falls back", async () => {
    const FILL = { detail: "double", showBody: true, carries: { oxygen: true, food: true } };
    const a = { ...ask("heart_circulation", "Follow the blood"), panelsOff: true };
    const r = await libraryDiagram({ ...a, labelFloor: true }, async () => FILL);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("split");
    const p = (await kit()).withDefaults(
      (await loadModel("heart_circulation"))?.params ?? { properties: {} },
      { ...FILL, showPulse: false },
    );
    const base = await drawLibraryModel("heart_circulation", p);
    const grown = await drawLibraryModel("heart_circulation", p, { typeScale: 1.342 });
    expect(grownTextFault(base.svg, base.svg)).toBeUndefined();
    expect(grownTextFault(base.svg, grown.svg)).toContain("split");
  });
});
