import { afterAll, describe, expect, test } from "bun:test";
import { overlappingWords } from "./fill";
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

/*
 * Review (18 Oct): the row rises 30 but the stage gives up only 16, so common shapes keep theirs.
 * Each case: every line ends by 640, no words overlap, the count labels sit clear of the sentence
 * row, and a remainder's words stay above it.
 */
const CASES: [string, Record<string, unknown>][] = [
  ["12 ÷ 2 in groups of 2", { groups: 6, size: 2, division: "grouping" }],
  ["12 ÷ 3 in groups of 3", { groups: 4, size: 3, division: "grouping" }],
  ["20 shared by 4", { groups: 4, size: 5, division: "sharing" }],
  ["24 ÷ 4 in groups of 4", { groups: 6, size: 4, division: "grouping" }],
  ["12 shared by 2", { groups: 2, size: 6, division: "sharing" }],
  ["14 ÷ 4 r 2 in groups of 4", { groups: 3, size: 4, remainder: 2, division: "grouping" }],
];
const draw = async (p: Record<string, unknown>) => {
  const m = await loadModel("equal_groups");
  return (
    await drawLibraryModel(
      "equal_groups",
      (await kit()).withDefaults(m?.params ?? { properties: {} }, { ...SHARE, ...p }),
    )
  ).svg;
};

describe("equal groups: a division's sentence row clears the stage", () => {
  for (const [name, p] of CASES)
    test(name, async () => {
      const svg = await draw(p);
      const lines = baselines(svg);
      const sentence = Math.max(...lines.filter((l) => l.words.includes("÷")).map((l) => l.y));
      for (const l of lines) expect(l.y).toBeLessThanOrEqual(640);
      expect(overlappingWords(svg)).toEqual([]);
      // The count labels (running totals) end well above the sentence's capitals.
      const counts = lines.filter((l) => /^\d+$/.test(l.words.trim())).map((l) => l.y);
      expect(Math.max(...counts)).toBeLessThanOrEqual(sentence - 60);
      // A remainder's words stay above the row (the slot's own limit, the row less 56).
      const left = lines.filter((l) => l.words.includes("left over"));
      if (p.remainder) expect(left.length).toBeGreaterThan(0);
      for (const l of left) expect(l.y).toBeLessThanOrEqual(sentence - 56);
    });

  test("12 shared by 2 keeps two rows of three in each group", async () => {
    const svg = await draw({ groups: 2, size: 6, division: "sharing" });
    // Each group's ring: two rows of three are about 1.4 times as wide as tall; one row of six, 4.
    const rings = [
      ...svg.matchAll(/<rect\b[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"[^>]*\brx=/g),
    ];
    expect(rings.length).toBe(2);
    for (const r of rings) expect(Number(r[1]) / Number(r[2])).toBeLessThan(2);
  });
});
