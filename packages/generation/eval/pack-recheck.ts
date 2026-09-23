#!/usr/bin/env bun
// bun packages/generation/eval/pack-recheck.ts --topic <id> --arm <arm> [--cap 0.10] [--only luna|sol] [--fresh] [--sections sec1,sec3]
//
// Re-runs the two blind checkers on a pack already written by `pack-author.ts`, for every section
// whose report has no verdict list from that checker (a failed or budget-refused check). The pack
// is not rewritten; the window is rebuilt from the section's recorded sentence ids. The report is
// updated in place (the run's original kept as report.run1.json), the recheck's ledger written to
// ledger-recheck.json, and calls appended to calls.jsonl. Live calls need `railway run --`.
//
// --fresh: re-check EVERY section with the current pack-check prompt (a new version's verdicts on
// an unchanged pack). report.json is left alone; the verdicts go to report.<prompt version>.json
// (only the checkers re-run have a list; the rest are null) and each run's ledger to
// ledger-recheck.<prompt version>.<time>.json. A second --fresh run resumes that report, filling
// only the sections still null (a budget-refused call). --sections limits either mode to those ids.

import { copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createBudget } from "@tj/ai";
import { callStructured } from "../src/call";
import { loadExperiment } from "./experiments/np1";
import { createLedger } from "./ledger";
import {
  type AuthorReport,
  checkInputFor,
  depsFor,
  MAX_OUTPUT_TOKENS_PACK,
  routedAi,
} from "./pack-author";
import { assertNoStubs, PackCheckOutputSchema, packCheckPrompt } from "./packs/prompts";
import { type Pack, PackSchema } from "./packs/schema";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const exp = loadExperiment();
const topicId = arg("topic");
const arm = arg("arm");
const only = arg("only");
const fresh = process.argv.includes("--fresh");
const sectionIds = arg("sections")?.split(",");
const topic = exp.topics.find((t) => t.id === topicId);
if (!topic || !arm) {
  console.error("usage: pack-recheck.ts --topic <id> --arm <arm> [--cap usd] [--only luna|sol]");
  process.exit(2);
}
assertNoStubs([packCheckPrompt]);
const packPath = join(import.meta.dir, "packs", `${topic.id}.${arm}.json`);
const outDir = join(import.meta.dir, "results", "packs", `${topic.id}.${arm}`);
const pack: Pack = PackSchema.parse(await Bun.file(packPath).json());
const sourceReport = join(outDir, "report.json");
const reportPath = fresh ? join(outDir, `report.${packCheckPrompt.version}.json`) : sourceReport;
const resumed = fresh && (await Bun.file(reportPath).exists());
const report = (await Bun.file(resumed ? reportPath : sourceReport).json()) as AuthorReport & {
  durationMs?: number;
};
const ledgerPath = join(
  outDir,
  fresh ? `ledger-recheck.${packCheckPrompt.version}.${Date.now()}.json` : "ledger-recheck.json",
);
if (fresh) {
  if (!resumed) for (const r of report.sections) r.checks = { luna: null, sol: null };
} else {
  const run1 = join(outDir, "report.run1.json");
  if (!(await Bun.file(run1).exists())) await copyFile(sourceReport, run1);
}

const ledger = createLedger({ run: `recheck-${topic.id}-${arm}` });
const budget = createBudget({ capUsd: Number(arg("cap") ?? 0.1), capTokens: 2_000_000 });
const signal = new AbortController().signal;
const record = join(outDir, "calls.jsonl");
const env = { AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY };
const checkers = {
  luna: depsFor(routedAi(env, exp.models.checkerLuna ?? "", ledger, record), budget, signal),
  sol: depsFor(routedAi(env, exp.models.checkerSol ?? "", ledger, record), budget, signal),
} as const;

const sentenceById = new Map(pack.sources.flatMap((s) => s.sentences.map((x) => [x.id, x])));
const started = Date.now();
for (const section of pack.sections) {
  const r = report.sections.find((x) => x.id === section.id);
  if (!r || (sectionIds && !sectionIds.includes(section.id))) continue;
  const window = section.sentenceIds.map((id) => {
    const s = sentenceById.get(id);
    if (!s) throw new Error(`${section.id} cites ${id}, not in the pack's sources`);
    return s;
  });
  const input = checkInputFor(topic, section.outcome, section.facts, window);
  const wanted = (["luna", "sol"] as const).filter(
    (k) => r.checks[k] === null && (!only || only === k),
  );
  if (wanted.length === 0) continue;
  const t0 = Date.now();
  await Promise.all(
    wanted.map(async (k) => {
      try {
        const res = await callStructured({
          deps: checkers[k],
          stage: "plan",
          cls: "standard",
          effort: "low",
          prompt: packCheckPrompt,
          input,
          schema: PackCheckOutputSchema,
          maxOutputTokens: MAX_OUTPUT_TOKENS_PACK.check,
        });
        r.checks[k] = res.output.verdicts;
        const tag = `${section.id}: checker${k === "luna" ? "Luna" : "Sol"} failed`;
        report.status.incomplete = report.status.incomplete.filter((m) => !m.startsWith(tag));
        console.log(
          `${section.id} ${k}: ${res.output.verdicts.length} verdicts, ${res.attempts} attempt(s)`,
        );
      } catch (error) {
        console.log(
          `${section.id} ${k}: failed again: ${error instanceof Error ? error.message : error}`,
        );
      }
    }),
  );
  r.timings.checkMs = Date.now() - t0;
}
// A fresh recheck keeps the author run's status: it re-runs a subset of checkers by design.
if (!fresh)
  report.status.complete =
    report.status.incomplete.length === 0 && report.sections.length === topic.sections.length;
await writeFile(
  reportPath,
  JSON.stringify(
    {
      ...report,
      ...(fresh ? { checkPrompt: packCheckPrompt.version } : {}),
      recheckDurationMs: Date.now() - started,
    },
    null,
    2,
  ),
);
await writeFile(ledgerPath, JSON.stringify(ledger.toJSON(), null, 2));
console.log(
  `complete ${report.status.complete}; incomplete: ${report.status.incomplete.join("; ") || "none"}`,
);
console.log(`\n${ledger.markdown()}`);
