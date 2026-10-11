import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HINGE_CARD_LINES,
  HINGE_OPTIONS,
  HINGE_STEM_LINES,
  hingeCardLines,
  measureHingeCards,
  sample,
} from "./fit-table";

/*
 * HEART1 R3 s6: the lab's fit table offered 3-across KS2 hinge options 100 characters, while
 * options of 36 characters already wrapped to 4 lines in a narrow column. `measureHingeCards`
 * measures what the cards hold at full body size; `hinge-cards.gen.json` is its output, and a
 * writer bundle opts in to it (`fitTable({ hingeCards: true })`).
 */
const FILE = join(import.meta.dir, "../../../generation/src/writer/hinge-cards.gen.json");
const TABLE = JSON.parse(readFileSync(FILE, "utf8")) as ReturnType<typeof measureHingeCards>;

describe("hinge caps by card", () => {
  test("the generated file is what the generator measures (regenerating changes nothing)", () => {
    expect(measureHingeCards()).toEqual(TABLE);
  });

  for (const [g, row] of Object.entries(TABLE.groups)) {
    test(`${g}: a row for 2, 3 and 4 options`, () => {
      expect(Object.keys(row.options).map(Number)).toEqual([...HINGE_OPTIONS]);
      for (const n of Object.values(row.options)) expect(n).toBeGreaterThanOrEqual(20);
    });
    for (const k of HINGE_OPTIONS)
      test(`${g}, ${k} options: options at the cap stay full size in ${HINGE_CARD_LINES} lines`, () => {
        const item = row.options[String(k)] ?? 0;
        const options = Array.from({ length: k }, (_, i) => sample(item, i * 3 + 1));
        expect(hingeCardLines(g as never, options, sample(row.stem))).toBeLessThanOrEqual(
          HINGE_CARD_LINES,
        );
        expect(hingeCardLines(g as never, options, sample(row.stem), "Stem")).toBeLessThanOrEqual(
          HINGE_STEM_LINES,
        );
      });
  }

  test("R3 s6: three 36-character options on KS2 now read on one line each, within the cap", () => {
    const options = [
      "It always carries oxygen-rich blood.",
      "It carries blood away from the heart.",
      "It carries blood towards the heart.",
    ];
    const stem = "Why is the vessel taking blood from the heart to the lungs an artery?";
    // TEACH-75 part D: three sentence options stack as full-width rows instead of three narrow cards.
    expect(hingeCardLines("KS2", options, stem)).toBe(1);
    for (const o of options)
      expect(o.length).toBeLessThanOrEqual(TABLE.groups.KS2?.options["3"] ?? 0);
  });
});
