import { describe, expect, test } from "bun:test";
import { getTheme } from "../themes";
import { inputFor, TEMPLATE_DOCS } from "./capacity";
import catalogue from "./catalogue.json";
import { EXTRA_FITS, FIT_STAGES, measureExtraFits } from "./fits-extra";
import gen from "./fits-extra.gen.json";
import { layoutTemplate, type Stage } from "./index";

/*
 * The writer's extra Fits rows (#431, `clarity`) are measured, never typed: the generated table is
 * what `measureExtraFits` measures now, each cell fits at its value and is over at value + 2 (240 is
 * the measuring ceiling), and every layout's line width is the catalogue's.
 */
type Gen = { stages: ReturnType<typeof measureExtraFits> };
const G = gen as unknown as Gen;
type Cat = {
  templates: { id: string; capacity: Record<string, { charsPerLine: { body: number } }> }[];
};

describe("extra Fits rows", () => {
  test("the generated table is current (re-run scripts/fits-extra.ts if not)", () => {
    expect(measureExtraFits()).toEqual(G.stages);
  });

  test("each layout's line width is the catalogue's", () => {
    for (const { key } of FIT_STAGES)
      for (const [layout, { template }] of Object.entries(EXTRA_FITS)) {
        const cat = (catalogue as Cat).templates.find((t) => t.id === template);
        expect(G.stages[key]?.[layout]?.charsPerLine).toBe(
          cat?.capacity[key]?.charsPerLine.body as number,
        );
      }
  });

  for (const { key, stage, theme } of FIT_STAGES)
    for (const [layout, { template, variants }] of Object.entries(EXTRA_FITS))
      test(`${layout} ${key}: every cell fits at its value and is over just above it (0: nothing fits)`, () => {
        const doc = TEMPLATE_DOCS.find((d) => d.id === template);
        if (!doc) throw new Error(template);
        variants.forEach((v, i) => {
          const value = G.stages[key]?.[layout]?.variants[i]?.maxCharsPerItem ?? 0;
          const over = (n: number) =>
            layoutTemplate(inputFor(doc, v, n), getTheme(theme), stage as Stage, { fullSize: true })
              .over;
          // 0: nothing fits (a count no stage of this group's schema offers with a picture).
          if (value === 0) {
            expect(over(2).length).toBeGreaterThan(0);
            return;
          }
          expect(over(value)).toEqual([]);
          if (value < 240) expect(over(value + 2).length).toBeGreaterThan(0);
        });
      });
});
