import { describe, expect, test } from "bun:test";
import { DIAGRAM_SAMPLES } from "../diagrams/samples";
import { getTheme } from "../themes";
import {
  capacityOf,
  FIT_THEMES,
  filler,
  GROUPS,
  headingCap,
  VARIANTS,
  variantSlide,
} from "./capacity";
import { type BlockSlide, layoutBlocks, RECIPE_IDS, recipeFaults, type Stage } from "./index";

const STAGES: Stage[] = ["ks1", "ks2", "ks3", "ks4", "ks5"];
/** Variants the catalogue says do not fit at a key stage even with short words. */
const UNAVAILABLE: Record<string, Stage[]> = {
  "stack:lead+5points": ["ks1"],
  "stack:4questions+instruction": ["ks1"],
  "stack:lead+points+callout": ["ks1"],
  "stack:table2x4": ["ks1", "ks2"],
  "stack:table3x3": ["ks1"],
  "stack:table3x4": ["ks1", "ks2"],
  "stack:table4x3": ["ks1"],
  "question-options:3+picture": ["ks1"],
};

const head = (s: Stage) =>
  filler(Math.min(...FIT_THEMES.map((t) => headingCap(getTheme(t, s), s))), 3);

describe("every recipe at its maximum content", () => {
  test("covers all eight recipes", () => {
    expect(new Set(VARIANTS.map((v) => v.recipe))).toEqual(new Set(RECIPE_IDS));
  });
  for (const v of VARIANTS)
    for (const s of STAGES) {
      const off = UNAVAILABLE[v.id]?.includes(s);
      test(`${v.id} ${s}${off ? " (not offered)" : ""}`, () => {
        const h = head(s);
        const n = capacityOf(v, s, h);
        if (off) return;
        expect(n).toBeGreaterThan(0);
        for (const t of FIT_THEMES) {
          const r = layoutBlocks(variantSlide(v, n, h), getTheme(t, s), s);
          expect({ t, faults: r.faults, over: r.over, fits: r.fits, step: r.step }).toEqual({
            t,
            faults: [],
            over: [],
            fits: true,
            step: 0,
          });
        }
      });
    }
});

describe("over capacity", () => {
  test("a third more words steps down once or reports, never throws", () => {
    for (const v of VARIANTS)
      for (const s of ["ks1", "ks3"] as Stage[]) {
        const n = Math.max(20, Math.round(capacityOf(v, s, head(s)) * 1.33));
        for (const t of FIT_THEMES) {
          const r = layoutBlocks(variantSlide(v, n, head(s)), getTheme(t, s), s);
          expect(r.slide.elements.length).toBeGreaterThan(0);
          if (!r.fits) expect(r.over.length).toBeGreaterThan(0);
        }
      }
  });
});

describe("never throws", () => {
  const theme = getTheme("splash", "ks2");
  const junk: unknown[] = [
    undefined,
    null,
    {},
    { recipe: "nonsense", blocks: "x" },
    { recipe: "stack", blocks: [] },
    { recipe: "stack", blocks: [{ type: "heading" }] },
    { recipe: "media-right", blocks: [{ type: "heading", text: "Hi" }] },
    { recipe: "big-media", blocks: [{ type: "diagram", diagram: { kind: "nope" } }] },
    { recipe: "compare", blocks: [{ type: "card" }, { type: "card", label: 3, text: null }] },
    {
      recipe: "sequence",
      blocks: [{ type: "picture-sequence", items: [null, {}, { caption: 4 }] }],
    },
    { recipe: "question-options", blocks: [{ type: "options", items: [] }] },
    {
      recipe: "stack",
      blocks: [{ type: "table", header: [], rows: [[], ["a", "b", "c", "d", "e"]] }],
    },
    { recipe: "title", blocks: [{ type: "picture", picture: { src: "x", aspect: -2 } }] },
    {
      recipe: "media-left",
      blocks: [
        { type: "heading", text: "x".repeat(400) },
        { type: "points", items: Array.from({ length: 12 }, () => "y ".repeat(80)) },
        { type: "diagram", diagram: DIAGRAM_SAMPLES["flow-cycle"] },
      ],
    },
  ];
  for (const [k, input] of junk.entries())
    test(`junk ${k}`, () => {
      const r = layoutBlocks(input as BlockSlide, theme, "ks2");
      expect(r.slide).toBeDefined();
      expect(Array.isArray(r.slide.elements)).toBe(true);
    });

  test("a wrong recipe falls back to the one the blocks suit", () => {
    const r = layoutBlocks(
      {
        recipe: "stack",
        blocks: [
          { type: "heading", text: "Which animal eats only plants?" },
          { type: "question", text: "Which of these is a herbivore?" },
          { type: "options", items: ["A lion", "A cow", "A shark"] },
        ],
      },
      theme,
      "ks2",
    );
    expect(r.recipe).toBe("question-options");
    expect(r.faults.length).toBeGreaterThan(0);
  });

  test("recipeFaults is empty for a well-formed media slide", () => {
    expect(
      recipeFaults("media-right", [
        { type: "heading", text: "h" },
        { type: "text", text: "t" },
        { type: "picture", picture: { src: "" } },
      ]),
    ).toEqual([]);
  });

  test("every stage group is covered", () => {
    expect(Object.values(GROUPS).flat().sort()).toEqual([...STAGES].sort());
  });
});
