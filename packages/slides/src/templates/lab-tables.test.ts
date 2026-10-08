import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTheme } from "../themes";
import { measureTemplate, TEMPLATE_DOCS } from "./capacity";
import { measureFit } from "./fit-table";
import { measure, slotLimitsSource } from "./slot-limits";

/*
 * base4's writer prompts and slot limits are pinned to the lab's tables, so the port's capacities
 * must equal lab/ab's exactly (TEACH-110 part a). The fixtures are lab/ab (46570198) regenerations:
 * `lab/bakeoff/catalogue.ts` (every template, KS1 and KS2 on Splash, KS3-5 on Studio),
 * `lab/bakeoff/fit-table.ts` (every template on every theme of each stage group) and
 * `lab/bakeoff/slot-limits.ts` (master's committed `diagrams/slot-limits.gen.ts`, byte-identical).
 * Slow: the fit table lays every template out thousands of times.
 */
const read = (f: string) => readFileSync(join(import.meta.dir, f), "utf8");
const STAGES = [
  { key: "KS1", stage: "ks1", theme: "splash" },
  { key: "KS2", stage: "ks2", theme: "splash" },
  { key: "KS3-5", stage: "ks3", theme: "studio" },
] as const;

describe("capacities equal the lab's pinned tables", () => {
  test("catalogue: every template's capacity at every stage", () => {
    const lab = JSON.parse(read("fixtures/lab-capacity.json")) as {
      templates: { id: string; capacity: unknown }[];
    };
    const port = TEMPLATE_DOCS.map((doc) => ({
      id: doc.id,
      capacity: Object.fromEntries(
        STAGES.map(({ key, stage, theme }) => [key, measureTemplate(doc, getTheme(theme), stage)]),
      ),
    }));
    expect(JSON.parse(JSON.stringify(port))).toEqual(lab.templates);
  }, 120_000);

  test("fit table: every template on every theme and stage group", () => {
    expect(JSON.parse(JSON.stringify(measureFit()))).toEqual(
      JSON.parse(read("fixtures/lab-fit.json")),
    );
  }, 600_000);

  test("slot limits: the generated table is byte-identical", () => {
    expect(slotLimitsSource(measure())).toBe(read("../diagrams/slot-limits.gen.ts"));
  }, 300_000);
});
