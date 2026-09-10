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
    // The facts serve and check the extra objective (or the facts schema refuses them, TEACH-211),
    // through a key idea and a question that no outline entry references — so the plan parses and
    // the coverage check is what fails.
    const extra = FIXTURES.planSkeleton.learningObjectives.length;
    const first = FIXTURES.planFacts.keyIdeas[0];
    const firstQ = FIXTURES.planFacts.questions[0];
    if (!first || !firstQ) throw new Error("fixture");
    const planFacts = {
      ...FIXTURES.planFacts,
      keyIdeas: [
        ...FIXTURES.planFacts.keyIdeas,
        {
          ...first,
          statement: "Another idea",
          objectiveRefs: [{ type: "objective" as const, index: extra }],
        },
      ],
      questions: [
        ...FIXTURES.planFacts.questions,
        {
          ...firstQ,
          stem: "Another question?",
          objectiveRefs: [{ type: "objective" as const, index: extra }],
        },
      ],
    };
    const rows = await runSchemaEval([brief], () =>
      scriptedPipelineAi({
        overrides: {
          [PLAN_INDEX]: JSON.stringify(skeleton),
          [PLAN_INDEX + 1]: JSON.stringify(planFacts),
        },
      }),
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
