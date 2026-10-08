import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTheme } from "../themes";
import { inputFor, measureTemplate, TEMPLATE_DOCS } from "./capacity";
import catalogue from "./catalogue.json";
import { measureFit } from "./fit-table";
import { layoutTemplate, type Stage } from "./index";
import { measure, slotLimitsSource } from "./slot-limits";

/*
 * base4's writer prompts and slot limits are pinned to the lab's tables, so the port's capacities
 * must equal lab/ab's exactly (TEACH-110 part a). The fixtures are lab/ab (46570198) regenerations:
 * `catalogue.json` (`lab/bakeoff/catalogue.ts`: every template, KS1 and KS2 on Splash, KS3-5 on
 * Studio), `fixtures/lab-fit.json` (`lab/bakeoff/fit-table.ts`: every template on every theme of
 * each stage group) and `fixtures/lab-slot-limits.txt` (`lab/bakeoff/slot-limits.ts`).
 *
 * By default about 20 catalogue cells are spot-checked (fits at the lab's value, over at value + 2).
 * `LAB_FULL=1 bun test src/templates/lab-tables.test.ts` recomputes all three tables (about 3 min).
 */
const read = (f: string) => readFileSync(join(import.meta.dir, f), "utf8");
const STAGES = [
  { key: "KS1", stage: "ks1", theme: "splash" },
  { key: "KS2", stage: "ks2", theme: "splash" },
  { key: "KS3-5", stage: "ks3", theme: "studio" },
] as const;
type Cat = {
  templates: {
    id: string;
    capacity: Record<string, { variants: { label: string; maxCharsPerItem: number }[] }>;
  }[];
};
const LAB = catalogue as Cat;
const FULL = process.env.LAB_FULL === "1";

describe("capacities equal the lab's pinned tables (spot check)", () => {
  const cells = TEMPLATE_DOCS.flatMap((doc) =>
    STAGES.flatMap(({ key, stage, theme }) =>
      doc.variants.map((v) => {
        const lab = LAB.templates
          .find((t) => t.id === doc.id)
          ?.capacity[key]?.variants.find((x) => x.label === v.label);
        return { doc, v, key, stage, theme, value: lab?.maxCharsPerItem ?? -1 };
      }),
    ),
  ).filter((c) => c.value >= 2 && c.value <= 238);
  // Every k-th cell: about 20, spread over templates and stages.
  const k = Math.max(1, Math.floor(cells.length / 20));
  const picked = cells.filter((_, i) => i % k === 0);

  test("the catalogue fixture covers every template and stage", () => {
    expect(LAB.templates.map((t) => t.id)).toEqual(TEMPLATE_DOCS.map((d) => d.id));
    for (const t of LAB.templates)
      expect(Object.keys(t.capacity)).toEqual(STAGES.map((s) => s.key));
    expect(picked.length).toBeGreaterThanOrEqual(18);
  });

  for (const { doc, v, key, stage, theme, value } of picked)
    test(`${doc.id} ${key} "${v.label}": fits at ${value}, over at ${value + 2}`, () => {
      const over = (n: number) =>
        layoutTemplate(inputFor(doc, v, n), getTheme(theme), stage as Stage, { fullSize: true })
          .over;
      expect(over(value)).toEqual([]);
      expect(over(value + 2).length).toBeGreaterThan(0);
    });
});

describe.if(FULL)("capacities equal the lab's pinned tables (LAB_FULL=1)", () => {
  test("catalogue: every template's capacity at every stage", () => {
    const port = TEMPLATE_DOCS.map((doc) => ({
      id: doc.id,
      capacity: Object.fromEntries(
        STAGES.map(({ key, stage, theme }) => [key, measureTemplate(doc, getTheme(theme), stage)]),
      ),
    }));
    expect(JSON.parse(JSON.stringify(port))).toEqual(LAB.templates);
  }, 120_000);

  test("fit table: every template on every theme and stage group", () => {
    expect(JSON.parse(JSON.stringify(measureFit()))).toEqual(
      JSON.parse(read("fixtures/lab-fit.json")),
    );
  }, 600_000);

  test("slot limits: byte-identical to the lab's", () => {
    expect(slotLimitsSource(measure())).toBe(read("fixtures/lab-slot-limits.txt"));
  }, 300_000);
});
