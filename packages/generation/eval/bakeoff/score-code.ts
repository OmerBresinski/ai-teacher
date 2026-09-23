#!/usr/bin/env bun
// bun packages/generation/eval/bakeoff/score-code.ts --blind <lab>/scoring/blind/<task>-<set> [--lab <dir>]
//
// The code-only scores over one anonymised directory (`blind.ts` output): every `<label>.json`
// in it is scored against the fixed labels (select) or the section inputs (rewrite), never against
// each other, and never with a model. Writes `<blindDir>/code-scores.json` and prints one table.
//
//   select   precision / recall of matches vs `scoring/select-labels.json`; the verdict classes the
//            brief ranks (wrong card, full-should-be-partial/none, partial-should-be-none, missed);
//            whether `missing` names Z's concept; schema failures; cost; latency.
//   rewrite  verbatim overlap per fact (longest shared word run vs every input sentence, flagged at
//            >= 8); evidence ids valid; schema failures; cost; latency.
//
// The two model-based scores are NOT here — see `support-checker.ts` and `rubric-judge.ts`: their
// prompts are written separately, and this file only says what each receives.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { BlindSet } from "./blind";
import {
  type RewriteScore,
  type SelectLabel,
  type SelectScore,
  scoreRewrite,
  scoreSelect,
} from "./metrics";
import { loadItems } from "./run";
import type { RewriteOutput, SetName, Task } from "./schemas";

export interface LabelScore {
  label: string;
  items: number;
  ok: number;
  schemaFailures: number;
  costUsd: number;
  meanLatencyMs: number;
  select?: SelectScore;
  rewrite?: {
    perItem: Record<string, RewriteScore>;
    facts: number;
    flaggedOverlap: number;
    invalidEvidenceFacts: number;
  };
}

export function scoreSet(
  set: BlindSet,
  ctx: { labels?: Record<string, SelectLabel>; sentences?: Record<string, string> },
): LabelScore {
  const base: LabelScore = {
    label: set.label,
    items: set.items.length,
    ok: set.items.filter((i) => i.ok).length,
    schemaFailures: set.items.reduce((s, i) => s + i.schemaFailures, 0),
    costUsd: set.items.reduce((s, i) => s + (i.costUsd ?? 0), 0),
    meanLatencyMs: set.items.length
      ? Math.round(set.items.reduce((s, i) => s + i.latencyMs, 0) / set.items.length)
      : 0,
  };
  if (set.task === "select") {
    if (!ctx.labels) throw new Error("select needs labels");
    return { ...base, select: scoreSelect(set.items, ctx.labels) };
  }
  if (!ctx.sentences) throw new Error("rewrite needs the section inputs");
  const perItem: Record<string, RewriteScore> = {};
  for (const item of set.items) {
    if (!item.ok || !item.output) continue;
    const block = ctx.sentences[item.id];
    if (!block) throw new Error(`no section input for ${item.id}`);
    perItem[item.id] = scoreRewrite(item.output as RewriteOutput, block);
  }
  const rows = Object.values(perItem);
  return {
    ...base,
    rewrite: {
      perItem,
      facts: rows.reduce((s, r) => s + r.facts, 0),
      flaggedOverlap: rows.reduce((s, r) => s + r.flaggedOverlap, 0),
      invalidEvidenceFacts: rows.reduce((s, r) => s + r.invalidEvidenceFacts, 0),
    },
  };
}

export function formatTable(scores: LabelScore[]): string {
  const pct = (v: number | null) => (v === null ? "-" : `${(v * 100).toFixed(0)}%`);
  if (scores[0]?.select) {
    const L = [
      "| label | ok | schema fails | precision | recall | wrong card | full→partial | full→none | partial→none | partial→full | missed | missing named | cost | mean ms |",
      "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ];
    for (const s of scores) {
      const v = s.select as SelectScore;
      L.push(
        `| ${s.label} | ${s.ok}/${s.items} | ${s.schemaFailures} | ${pct(v.precision)} | ${pct(v.recall)} | ${v.verdicts["wrong-card"]} | ${v.verdicts["full-should-be-partial"]} | ${v.verdicts["full-should-be-none"]} | ${v.verdicts["partial-should-be-none"]} | ${v.verdicts["partial-should-be-full"]} | ${v.verdicts.missed} | ${v.missingNamed}/${v.missingChecked} | $${s.costUsd.toFixed(4)} | ${s.meanLatencyMs} |`,
      );
    }
    return L.join("\n");
  }
  const L = [
    "| label | ok | schema fails | facts | overlap ≥ 8 | invalid evidence | cost | mean ms |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const s of scores) {
    const r = s.rewrite;
    L.push(
      `| ${s.label} | ${s.ok}/${s.items} | ${s.schemaFailures} | ${r?.facts ?? "-"} | ${r?.flaggedOverlap ?? "-"} | ${r?.invalidEvidenceFacts ?? "-"} | $${s.costUsd.toFixed(4)} | ${s.meanLatencyMs} |`,
    );
  }
  return L.join("\n");
}

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

if (import.meta.main) {
  const blindDir = resolve(arg("blind") ?? "");
  const lab = resolve(
    arg("lab") ??
      "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd/lab/pe-bakeoff",
  );
  if (!blindDir) {
    console.error("usage: score-code.ts --blind <dir> [--lab <dir>]");
    process.exit(2);
  }
  const files = (await readdir(blindDir)).filter((f) => /^[A-H]\.json$/.test(f)).sort();
  const sets: BlindSet[] = [];
  for (const f of files) sets.push(JSON.parse(await readFile(join(blindDir, f), "utf8")));
  if (sets.length === 0) throw new Error(`no <label>.json in ${blindDir}`);
  const task = sets[0]?.task as Task;
  const set = sets[0]?.set as SetName;
  const ctx: Parameters<typeof scoreSet>[1] = {};
  if (task === "select") {
    if (set !== "test") throw new Error("labels exist for the test set only");
    ctx.labels = JSON.parse(await readFile(join(lab, "scoring", "select-labels.json"), "utf8"));
  } else {
    ctx.sentences = Object.fromEntries(
      (await loadItems(lab, "rewrite", set)).map((i) => [i.id, i.values.sentences as string]),
    );
  }
  const scores = sets.map((s) => scoreSet(s, ctx));
  await writeFile(join(blindDir, "code-scores.json"), `${JSON.stringify(scores, null, 2)}\n`);
  console.log(formatTable(scores));
  console.log(`\nwrote ${join(blindDir, "code-scores.json")}`);
}
