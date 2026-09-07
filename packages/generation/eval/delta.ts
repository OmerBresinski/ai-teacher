#!/usr/bin/env bun
// bun packages/generation/eval/delta.ts <results.json> [master-results.json]
//
// Renders the PR comment for a paid eval run (ADR 0025 §23): the totals table and, when the last
// `master` run's results are given, a delta line per column (`now − master`). Reads only the
// results files, which carry no content (ADR 0015). Used by .github/workflows/eval.yml.

import { readFile } from "node:fs/promises";
import type { EvalResults, EvalTotals } from "./run";

export const COMMENT_MARKER = "<!-- tj-eval-results -->";

const COLUMNS: { key: keyof EvalTotals; label: string; unit: "usd" | "ms" | "n" }[] = [
  { key: "costUsd", label: "cost", unit: "usd" },
  { key: "meanDurationMs", label: "mean duration", unit: "ms" },
  { key: "p50FirstSlideMs", label: "p50 first slide", unit: "ms" },
  { key: "calls", label: "calls", unit: "n" },
  { key: "inputTokens", label: "input tokens", unit: "n" },
  { key: "outputTokens", label: "output tokens", unit: "n" },
];

const format = (value: number | null | undefined, unit: "usd" | "ms" | "n"): string => {
  if (value === null || value === undefined) return "-";
  if (unit === "usd") return `$${value.toFixed(4)}`;
  if (unit === "ms") return `${Math.round(value)} ms`;
  return String(value);
};

const formatDelta = (
  now: number | null | undefined,
  then: number | null | undefined,
  unit: "usd" | "ms" | "n",
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
    const value = t[column.key] as number | null | undefined;
    if (master) {
      const then = master.totals[column.key] as number | null | undefined;
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
    "| brief | ok | ms | first slide | slides | cost | errors | schema | model |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const b of now.briefs) {
    lines.push(
      `| ${b.id} | ${b.ok ? "yes" : `no (${b.error})`} | ${b.durationMs} | ${b.firstSlideMs ?? "-"} | ${b.slides} | ${format(b.costUsd, "usd")} | ${b.findings.error} | ${b.scores?.schema ?? "-"} | ${b.scores?.modelFindings ?? "-"} |`,
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
