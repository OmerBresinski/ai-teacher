import { describe, expect, test } from "bun:test";

/*
 * TEACH-90: the planner modules ship dormant. Nothing production runs may import them until the
 * stage changes (TEACH-91) and the switch (TEACH-93) land. TEACH-91 deletes this test.
 */
const PLANNER =
  /from\s+"(?:\.\.?\/)+(?:planner\/|outline-from-facts|merge-objective-facts|outline-feasibility|numeric-check|objectives-check)/;
const PRODUCTION = ["stages/**/*.ts", "worksheet/**/*.ts", "workflow.ts", "index.ts"];

describe("planner modules are dormant (TEACH-90)", () => {
  test("no stage, worksheet, workflow or package entry imports them", async () => {
    const src = `${import.meta.dir}/..`;
    const offenders: string[] = [];
    for (const pattern of PRODUCTION) {
      for await (const path of new Bun.Glob(pattern).scan(src)) {
        if (path.endsWith(".test.ts")) continue;
        if (PLANNER.test(await Bun.file(`${src}/${path}`).text())) offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });
});
