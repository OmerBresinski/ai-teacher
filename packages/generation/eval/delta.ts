#!/usr/bin/env bun
// bun packages/generation/eval/delta.ts <results.json> [master-results.json]
//
// Renders the PR comment for a paid eval run (ADR 0025 §23): the totals table and, when the last
// `master` run's results are given, a delta line per column (`now − master`). Reads only the
// results files, which carry no content (ADR 0015). Used by .github/workflows/eval.yml.

import { readFile } from "node:fs/promises";
import { RUBRIC_DIMENSIONS, type RubricDimension } from "./rubric-prompt";
import type { EvalResults, EvalTotals } from "./run";

export const COMMENT_MARKER = "<!-- tj-eval-results -->";

type Unit = "usd" | "ms" | "n" | "score";

/** One comment row: how to read it off the totals and how to print it. */
interface Column {
  label: string;
  unit: Unit;
  read: (t: EvalTotals) => number | null | undefined;
}

const RUBRIC_LABELS: Record<RubricDimension, string> = {
  correctness: "rubric: correctness",
  depth: "rubric: depth",
  pitch: "rubric: pitch",
  coherence: "rubric: coherence",
  questionQuality: "rubric: question quality",
  notes: "rubric: notes",
  worksheetValueAdd: "rubric: worksheet value-add",
  imageFit: "rubric: image fit",
  verbFit: "rubric: verb fit",
};

const COLUMNS: Column[] = [
  { label: "cost", unit: "usd", read: (t) => t.costUsd },
  { label: "judge cost", unit: "usd", read: (t) => t.judgeCostUsd },
  { label: "mean duration", unit: "ms", read: (t) => t.meanDurationMs },
  { label: "p50 plan", unit: "ms", read: (t) => t.p50PlanMs },
  { label: "p50 first slide", unit: "ms", read: (t) => t.p50FirstSlideMs },
  { label: "calls", unit: "n", read: (t) => t.calls },
  { label: "input tokens", unit: "n", read: (t) => t.inputTokens },
  { label: "output tokens", unit: "n", read: (t) => t.outputTokens },
  // Scores only, never the rationales (ADR 0015; project Decision 5).
  { label: "rubric mean", unit: "score", read: (t) => t.rubric?.mean },
  ...RUBRIC_DIMENSIONS.map(
    (d): Column => ({
      label: RUBRIC_LABELS[d],
      unit: "score",
      read: (t) => t.rubric?.dimensions[d],
    }),
  ),
];

const format = (value: number | null | undefined, unit: Unit): string => {
  if (value === null || value === undefined) return "-";
  if (unit === "usd") return `$${value.toFixed(4)}`;
  if (unit === "ms") return `${Math.round(value)} ms`;
  if (unit === "score") return value.toFixed(1);
  return String(value);
};

const formatDelta = (
  now: number | null | undefined,
  then: number | null | undefined,
  unit: Unit,
) => {
  if (now === null || now === undefined || then === null || then === undefined) return "-";
  const diff = now - then;
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "±";
  return `${sign}${format(Math.abs(diff), unit)}`;
};

/** The whole comment body, marker first so the workflow can find and update it. */
export function renderComment(now: EvalResults, master?: EvalResults): string {
  const t = now.totals;
  const errors = `${t.findings.error} errors / ${t.findings.warning} warnings`;
  const lines = [
    COMMENT_MARKER,
    `### Eval set — paid run on \`${now.sha.slice(0, 7)}\``,
    "",
    `${t.completed}/${t.briefs} briefs completed${t.failed ? `, ${t.failed} failed` : ""}${
      t.stoppedBy ? `, stopped at the ${t.stoppedBy} cap ($${now.capUsd.toFixed(2)})` : ""
    }; ${errors}. Models: ${now.models.frontier} / ${now.models.standard} / ${now.models.small}.`,
    "",
    master
      ? `| | this run | master \`${master.sha.slice(0, 7)}\` | delta |\n| --- | ---: | ---: | ---: |`
      : "| | this run |\n| --- | ---: |",
  ];
  for (const column of COLUMNS) {
    const value = column.read(t);
    if (master) {
      const then = column.read(master.totals);
      lines.push(
        `| ${column.label} | ${format(value, column.unit)} | ${format(then, column.unit)} | ${formatDelta(value, then, column.unit)} |`,
      );
    } else {
      lines.push(`| ${column.label} | ${format(value, column.unit)} |`);
    }
  }
  if (master) {
    const e = t.findings.error - master.totals.findings.error;
    lines.push(
      `| error findings | ${t.findings.error} | ${master.totals.findings.error} | ${e > 0 ? "+" : e < 0 ? "−" : "±"}${Math.abs(e)} |`,
    );
  } else {
    lines.push(`| error findings | ${t.findings.error} |`);
  }
  lines.push(
    "",
    "| brief | ok | ms | first slide | slides | cost | errors | schema | model | rubric |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const b of now.briefs) {
    lines.push(
      `| ${b.id} | ${b.ok ? "yes" : `no (${b.error})`} | ${b.durationMs} | ${b.firstSlideMs ?? "-"} | ${b.slides} | ${format(b.costUsd, "usd")} | ${b.findings.error} | ${b.scores?.schema ?? "-"} | ${b.scores?.modelFindings ?? "-"} | ${format(b.scores?.rubric?.mean, "score")} |`,
    );
  }
  if (!master) lines.push("", "_No `master` baseline artifact yet — no delta._");
  return lines.join("\n");
}

async function readResults(path: string): Promise<EvalResults> {
  return JSON.parse(await readFile(path, "utf8")) as EvalResults;
}

if (import.meta.main) {
  const [nowPath, masterPath] = process.argv.slice(2);
  if (!nowPath) {
    console.error(
      "usage: bun packages/generation/eval/delta.ts <results.json> [master-results.json]",
    );
    process.exit(2);
  }
  const now = await readResults(nowPath);
  const master = masterPath ? await readResults(masterPath).catch(() => undefined) : undefined;
  console.log(renderComment(now, master));
}
