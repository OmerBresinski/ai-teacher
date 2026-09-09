import { describe, expect, test } from "bun:test";
import { FIXTURES, PLAN_INDEX, pipelineScript, scriptedPipelineAi } from "../src/testing";
import { evalBriefs } from "./briefs";
import { formatSchemaTable, runSchemaEval, schemaErrors } from "./schema";

/* The free half (ADR 0025 §23): fixtures through the real pipeline for every brief, then checkLesson. */

describe("eval:schema", () => {
  test("every brief produces a lesson with zero error findings on the fixtures", async () => {
    const rows = await runSchemaEval();
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(row.errors, row.result.id).toEqual([]);
      expect(row.result.ok).toBe(true);
      expect(row.result.slides).toBeGreaterThan(2);
      expect(row.result.blocks).toBeGreaterThan(0);
      expect(row.result.scores?.schema).toBe(1);
    }
    expect(formatSchemaTable(rows)).toContain("| y8-science-particles | ");
  }, 20_000);

  test("the schema half never asks the judge: no rubric, and no call beyond the pipeline's own", async () => {
    const [brief] = evalBriefs();
    if (!brief) throw new Error("briefs");
    const ai = scriptedPipelineAi();
    const rows = await runSchemaEval([brief], () => ai);
    expect(rows[0]?.result.scores?.rubric).toBeNull();
    expect(rows[0]?.result.judge).toBeNull();
    expect(ai.calls.length).toBeLessThanOrEqual(pipelineScript().length);
    expect(ai.calls.some((c) => c.modelClass === "frontier")).toBe(false);
  });

  test("a fixture whose plan names an objective nothing covers fails, naming the brief and the check", async () => {
    const [brief] = evalBriefs();
    if (!brief) throw new Error("briefs");
    const skeleton = {
      ...FIXTURES.planSkeleton,
      learningObjectives: [
        ...FIXTURES.planSkeleton.learningObjectives,
        { text: "An objective no slide or block teaches" },
      ],
    };
    const rows = await runSchemaEval([brief], () =>
      scriptedPipelineAi({ overrides: { [PLAN_INDEX]: JSON.stringify(skeleton) } }),
    );
    expect(rows[0]?.result.id).toBe(brief.id);
    expect(rows[0]?.errors).toEqual(["objective-coverage"]);
    expect(rows[0]?.result.scores?.schema).toBeLessThan(1);
  });

  test("schemaErrors lists error check names once each, ignoring warnings", () => {
    expect(
      schemaErrors([
        { check: "timing", severity: "warning", target: {}, message: "" },
        { check: "question-answer", severity: "error", target: { slideId: "a" }, message: "" },
        { check: "question-answer", severity: "error", target: { slideId: "b" }, message: "" },
        { check: "objective-coverage", severity: "error", target: { factId: "o" }, message: "" },
      ]),
    ).toEqual(["question-answer", "objective-coverage"]);
  });
});
