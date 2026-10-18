import { afterAll, describe, expect, test } from "bun:test";
import { drawLibraryModel, endDrawThread } from "./guard";
import { kit, loadModel } from "./render";

/*
 * 18 Oct loop1b y3 lesson: a division's whole ("12 counters") stepped down under the sentence row
 * to y 670, past the drawing's foot (660, kit layout.js GRID.foot), so the crop cut it off. Every
 * line of words ends by the last content line, GRID.bottom 640.
 */
afterAll(() => endDrawThread());

// The saved lesson's params (verify/loop1b/r2 doc.json, the sharing slide).
const SHARE = {
  layout: "groups",
  groups: 2,
  size: 6,
  object: "counter",
  division: "sharing",
  title: "Equal groups",
  remainder: 0,
  countSteps: true,
  addition: true,
  turn: false,
  showFacts: false,
  text: {},
};

const baselines = (svg: string) =>
  [...svg.matchAll(/<text\b[^>]*\by="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)].map((m) => ({
    y: Number(m[1]),
    words: (m[2] ?? "").replace(/<[^>]+>/g, ""),
  }));

describe("equal groups: a division's words stay above the foot", () => {
  for (const division of ["sharing", "grouping"])
    test(`${division}: the sentence and the whole under it end by 640`, async () => {
      const m = await loadModel("equal_groups");
      const d = await drawLibraryModel(
        "equal_groups",
        (await kit()).withDefaults(m?.params ?? { properties: {} }, { ...SHARE, division }),
      );
      const lines = baselines(d.svg);
      expect(lines.some((l) => l.words.includes("12 counters"))).toBe(true);
      for (const l of lines) expect({ ...l, y: Math.min(l.y, 640) }).toEqual(l);
    });
});
