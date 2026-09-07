#!/usr/bin/env bun
// bun run eval:schema
//
// The free half of the eval set (ADR 0025 §23): every eval brief through the real pipeline on
// the scripted fake (`scriptedPipelineAi`, fixtures only, no network), then `checkLesson` over
// the result. Exercises the recipes, materialise and the schema checks on real geometry for
// eight different briefs. Runs in CI's `test` job on every PR.
//
//   exit 0  every brief produced a lesson with zero `error` schema findings
//   exit 1  at least one did not (the table names the brief and the checks)

import { createBudget } from "@tj/ai";
import { checkLesson, type Finding } from "@tj/domain/documents";
import { scriptedPipelineAi } from "../src/testing";
import { evalBriefs } from "./briefs";
import { type BriefResult, runBrief } from "./run-brief";

export interface SchemaEvalRow {
  result: BriefResult;
  /** The `error` schema findings on the final documents, by check name (or the failure's name). */
  errors: string[];
}

/** Run the schema half over the fake; exported so a test can drive it with its own fixtures. */
export async function runSchemaEval(
  briefs = evalBriefs(),
  makeAi: () => Parameters<typeof runBrief>[1]["ai"] = () => scriptedPipelineAi(),
): Promise<SchemaEvalRow[]> {
  const rows: SchemaEvalRow[] = [];
  for (const brief of briefs) {
    const budget = createBudget({ capUsd: 5, capTokens: 5_000_000 });
    const run = await runBrief(brief, { ai: makeAi(), budget });
    const errors = run.result.ok
      ? schemaErrors(checkLesson(run.lesson, run.worksheet))
      : [run.result.error ?? "failed"];
    rows.push({ result: run.result, errors });
  }
  return rows;
}

/** The `error` findings' check names, deduplicated, in order of first appearance. */
export function schemaErrors(findings: Finding[]): string[] {
  return [...new Set(findings.filter((f) => f.severity === "error").map((f) => f.check))];
}

export function formatSchemaTable(rows: SchemaEvalRow[]): string {
  const lines = [
    "| brief | slides | blocks | schema errors | schema score | ms |",
    "| --- | ---: | ---: | --- | ---: | ---: |",
  ];
  for (const { result, errors } of rows) {
    lines.push(
      `| ${result.id} | ${result.slides} | ${result.blocks} | ${errors.length === 0 ? "none" : errors.join(", ")} | ${result.scores?.schema ?? "-"} | ${result.durationMs} |`,
    );
  }
  return lines.join("\n");
}

if (import.meta.main) {
  const rows = await runSchemaEval();
  console.log(formatSchemaTable(rows));
  const failed = rows.filter((row) => row.errors.length > 0);
  if (failed.length > 0) {
    console.error(
      `\neval:schema: ${failed.length} of ${rows.length} briefs have error findings: ${failed
        .map((row) => `${row.result.id} (${row.errors.join(", ")})`)
        .join("; ")}`,
    );
    process.exit(1);
  }
  console.log(`\neval:schema: ${rows.length} briefs, 0 error findings`);
}
