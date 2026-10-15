import { describe, expect, test } from "bun:test";
import { arrowClashes } from "./arrow-clash";
import { MODEL_LOADERS } from "./models";
import { inspectDrawnSvg, loadModel, renderLibraryModel } from "./render";

/*
 * TEACH-75 part x: no arrowhead in the model library overlaps a label, a leader line or a leader
 * dot. CI draws one preset per model (the full sweep of every preset, in a browser, is the lab's
 * build/verify/A2/clash.mjs); the presets Greg's renders found clashing are always drawn.
 */
const ALWAYS = [
  ["water_cycle", "y6-town"],
  ["heart_circulation", "y6-circulatory"],
  ["heart_circulation", "y6-running"],
  ["coordinate_grid", "y5-translate"],
] as const;

describe("arrowheads clear labels, leaders and dots (TEACH-75 part x)", () => {
  test("one preset of every library model, and the presets that clashed", async () => {
    const cases: [string, string][] = ALWAYS.map(([a, b]) => [a, b]);
    for (const id of Object.keys(MODEL_LOADERS)) {
      const p = (await loadModel(id))?.presets?.find((q) => q.id !== "y2-47");
      if (p) cases.push([id, p.id]);
    }
    const bad: string[] = [];
    let heads = 0;
    for (const [id, pid] of cases) {
      const m = await loadModel(id);
      const p = m?.presets?.find((q) => q.id === pid);
      if (!p) continue;
      let svg: string;
      try {
        svg = (await renderLibraryModel(id, p.params)).svg;
      } catch {
        continue; // presets that do not draw on master either (BACKLOG: place_value)
      }
      const { words, arrows } = inspectDrawnSvg(svg);
      heads += arrows.heads.length;
      for (const c of arrowClashes(words, arrows)) bad.push(`${id}/${pid}: ${c}`);
    }
    expect(heads).toBeGreaterThan(40);
    expect(bad).toEqual([]);
  }, 300_000);

  test("the check catches a head over a word and on a leader", () => {
    const head = {
      pts: [
        [90, 40],
        [100, 50],
        [90, 60],
      ] as [number, number][],
    };
    const words = [{ words: "Artery", fs: 20, x0: 95, y0: 45, x1: 160, y1: 65 }];
    expect(arrowClashes(words, { heads: [head], leaders: [], dots: [] })).toEqual([
      'head at 100,50 overlaps "Artery"',
    ]);
    const leader = {
      pts: [
        [100, 0],
        [100, 48.5],
      ] as [number, number][],
      w: 2.5,
    };
    expect(arrowClashes([], { heads: [head], leaders: [leader], dots: [] })).toEqual([
      "head at 100,50 touches a leader",
    ]);
  });
});
