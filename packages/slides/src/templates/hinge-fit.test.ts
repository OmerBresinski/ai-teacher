import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HINGE_CARD_LINES, hingeCardFit, hingeCardLines, sample } from "./fit-table";

/*
 * HEART1 R3 s6: the writer's fit table offered 3-across KS2 hinge options 100 characters, while
 * options of 36 characters already wrapped to 4 lines in a narrow column. The table's hinge caps
 * are now what the cards hold at full body size in HINGE_CARD_LINES lines, on every theme of the
 * group, beside a stem at its own cap. This holds the table (the writer's schema caps under
 * slot-fill) to the renderer.
 */
type Variant = {
  counts: { options: number };
  stem: number;
  chars: number;
  ceiling: number;
  limit: { item: number };
};
const TABLE = JSON.parse(
  readFileSync(join(import.meta.dir, "../../../generation/src/writer/fit-table.gen.json"), "utf8"),
) as { groups: Record<string, { layouts: { hinge: { variants: Variant[] } } }> };
describe("hinge option caps match what the cards hold", () => {
  for (const [g, grp] of Object.entries(TABLE.groups))
    for (const v of grp.layouts.hinge.variants) {
      const k = v.counts.options;
      test(`${g}, ${k} options: options at the cap stay at full size in ${HINGE_CARD_LINES} lines`, () => {
        const options = Array.from({ length: k }, (_, i) => sample(v.limit.item, i * 3 + 1));
        expect(hingeCardLines(g as never, options, sample(v.stem))).toBeLessThanOrEqual(
          HINGE_CARD_LINES,
        );
        expect(v.ceiling).toBe(v.limit.item);
        expect(v.chars).toBeLessThanOrEqual(v.limit.item);
      });
      test(`${g}, ${k} options: the cap is the measured budget, not a guess`, () => {
        expect(v.limit.item).toBe(hingeCardFit(g as never, k, v.stem));
      });
    }

  test("R3 s6: three 36-character options on KS2 wrap past the card budget and the cap", () => {
    const options = [
      "It always carries oxygen-rich blood.",
      "It carries blood away from the heart.",
      "It carries blood towards the heart.",
    ];
    const stem = "Why is the vessel taking blood from the heart to the lungs an artery?";
    expect(hingeCardLines("KS2", options, stem)).toBeGreaterThan(HINGE_CARD_LINES);
    const cap = TABLE.groups.KS2?.layouts.hinge.variants.find((v) => v.counts.options === 3);
    for (const o of options) expect(o.length).toBeGreaterThan(cap?.limit.item ?? 0);
  });
});
