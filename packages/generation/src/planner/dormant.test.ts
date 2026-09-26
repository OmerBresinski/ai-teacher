import { describe, expect, test } from "bun:test";

/*
 * TEACH-91: the planner's entry points are exported but no job runs them. TEACH-93 wires the
 * worker to them behind a flag and deletes this test.
 */
const ENTRY = /\b(runPlannedLessonPipeline|planFromObjectives)\b/;

describe("the planner is dormant (TEACH-91)", () => {
  test("neither workflow.ts nor the worker names its entry points", async () => {
    const root = `${import.meta.dir}/../../../..`;
    const files = [`${root}/packages/generation/src/workflow.ts`];
    for await (const path of new Bun.Glob("**/*.ts").scan(`${root}/apps/worker/src`)) {
      files.push(`${root}/apps/worker/src/${path}`);
    }
    expect(files.length).toBeGreaterThan(1);
    const offenders: string[] = [];
    for (const file of files) if (ENTRY.test(await Bun.file(file).text())) offenders.push(file);
    expect(offenders).toEqual([]);
  });
});
