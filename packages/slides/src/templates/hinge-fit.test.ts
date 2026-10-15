import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTheme } from "../themes";
import { HINGE_OPTIONS, hingeCardLines, measureHingeCards, sample } from "./fit-table";
import { layoutTemplate, type TemplateInput } from "./index";

const GROUP_THEMES = {
  KS1: ["paper", "crayon"],
  KS2: ["paper", "studio"],
  "KS3-5": ["paper", "exam-hall"],
} as const;
const GROUP_STAGE = { KS1: "ks1", KS2: "ks2", "KS3-5": "ks3" } as const;

/*
 * HEART1 R3 s6: the lab's fit table offered 3-across KS2 hinge options 100 characters, while
 * options of 36 characters already wrapped to 4 lines in a narrow column. `measureHingeCards`
 * measures what the cards hold at full body size; `hinge-cards.gen.json` is its output, and a
 * writer bundle opts in to it (`fitTable({ hingeCards: true })`).
 */
const FILE = join(import.meta.dir, "../../../generation/src/writer/hinge-cards.gen.json");
const TABLE = JSON.parse(readFileSync(FILE, "utf8")) as ReturnType<typeof measureHingeCards>;

describe("hinge caps by card", () => {
  /*
   * TEACH-256 part b: the hinge is re-laid (question as title, cards on a sand stage). The writer's
   * card table stays at master's values until the writer offer (TEACH-110 part v, E1) takes the
   * new measured caps (`hinge-capacity.json`); options at these caps are the renderer's to fit
   * (step down, close up, flag), never to clip.
   */
  test("the writer's card table is master's, frozen until E1", () => {
    expect(TABLE.groups.KS2?.options["3"]).toBe(30);
    expect(Object.keys(measureHingeCards().groups)).toEqual(Object.keys(TABLE.groups));
  });

  for (const [g, row] of Object.entries(TABLE.groups)) {
    test(`${g}: a row for 2, 3 and 4 options`, () => {
      expect(Object.keys(row.options).map(Number)).toEqual([...HINGE_OPTIONS]);
      for (const n of Object.values(row.options)) expect(n).toBeGreaterThanOrEqual(20);
    });
    for (const k of HINGE_OPTIONS)
      test(`${g}, ${k} options at the cap: drawn on the slide at or over the floor, never clipped`, () => {
        const item = row.options[String(k)] ?? 0;
        const options = Array.from({ length: k }, (_, i) => sample(item, i * 3 + 1));
        for (const th of GROUP_THEMES[g as keyof typeof GROUP_THEMES] ?? []) {
          const r = layoutTemplate(
            {
              template: "hinge",
              heading: "Check",
              stem: sample(row.stem),
              options,
            } as TemplateInput,
            getTheme(th),
            GROUP_STAGE[g as keyof typeof GROUP_STAGE],
          );
          for (const e of r.slide.elements) {
            expect(e.y + e.h).toBeLessThanOrEqual(540);
            if (e.name === "Option text")
              expect(
                (e as { style?: { fontSize?: number } }).style?.fontSize ?? 0,
              ).toBeGreaterThanOrEqual(20);
          }
          expect(hingeCardLines).toBeFunction();
        }
      });
  }
});
