import { afterAll, describe, expect, test } from "bun:test";
import { libraryDiagram, overlappingWords } from "./fill";
import { drawLibraryModel, endDrawThread } from "./guard";
import { kit, loadModel } from "./render";

/*
 * Library turn-on step 3 (diagrams-09, flag `libraryLabelOverlap`): on D52 Alib y5 s5 "Find 3/5
 * of 35" the fractions model printed the group count "7" over "3/5 of 35 = 21". The still's words
 * are read back as the drawer reads its own labels; words over words fall back to the drawer.
 */
afterAll(() => endDrawThread());

// The recorded fill (d52 Alib y5 calls.jsonl) and slide.
const FILL = {
  operation: "of",
  representation: "set",
  fractions: [{ value: "3/5" }],
  whole: "35 counters",
  amount: 35,
  things: "counters",
};
const ask = {
  key: "diagram",
  model: "fractions",
  intent: "Show 3/5 of an amount of 35 counters in five equal groups of seven, three shaded.",
  words: "Find ⅗ of 35\nDivide into 5 equal groups; take 3: 35 ÷ 5 = 7, then 7 × 3 = 21.",
  heading: "Find ⅗ of 35",
  caption: "Divide into 5 equal groups; take 3: 35 ÷ 5 = 7, then 7 × 3 = 21.",
  yearGroup: "Year 5",
  lesson: "Maths: fractions of amounts",
};

describe("label overlap on library stills (diagrams-09)", () => {
  test("the recorded fill draws a 7 over the 35 (found by the text-box reading)", async () => {
    const m = await loadModel("fractions");
    const d = await drawLibraryModel(
      "fractions",
      (await kit()).withDefaults(m?.params ?? { properties: {} }, FILL),
    );
    const o = overlappingWords(d.svg);
    expect(o.map(([a, b]) => `${a}|${b}`)).toContain("7|35");
  });
  test("flag off it ships (the register's bad outcome); flag on it falls back", async () => {
    expect((await libraryDiagram(ask, async () => FILL)).ok).toBe(true);
    const r = await libraryDiagram({ ...ask, labelOverlap: true }, async () => FILL);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("overlap");
  });
  test("stacked words and a heart without overlaps are not overlaps", async () => {
    const m = await loadModel("counting_subitising");
    const p = (await kit()).withDefaults(
      m?.params ?? { properties: {} },
      m?.presets[1]?.params ?? {},
    );
    expect(overlappingWords((await drawLibraryModel("counting_subitising", p)).svg)).toEqual([]);
    const h = await drawLibraryModel("heart_circulation", { showPulse: false });
    expect(overlappingWords(h.svg)).toEqual([]);
  });
});
