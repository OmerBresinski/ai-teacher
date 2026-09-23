#!/usr/bin/env bun
// bun packages/generation/eval/cost-report.ts [--runs <results/lab/np1-*…>] [--packs <results/packs/*…>]
//   [--judge <results/judge/<label>>] [--uses 10,100,1000] [--accept-mean 3.5 --accept-correctness 4]
//   [--estimate]
//
// The np1 cost report: per lesson arm, cost per ACCEPTED lesson — hot (the arm's own calls, every
// attempt counted, failed and incomplete included) and cold (plus the pack's build cost, write +
// link + checks, amortised over N uses) — latency, and the break-even number of uses (pack build
// cost ÷ saving per reuse against the live arm). `accepted` is a rule Greg sets, applied
// structurally to the blind judge's scores: mean ≥ --accept-mean and correctness ≥
// --accept-correctness (defaults printed). `--estimate` builds the same table from the
// experiment file's estimates before any run exists.

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  type Experiment,
  expectedSpend,
  type LessonArm,
  loadExperiment,
  runBriefs,
} from "./experiments/np1";
import type { BlindKeyEntry, BlindScore } from "./judge-blind";
import type { LedgerJson } from "./ledger";
import { RUBRIC_DIMENSIONS } from "./rubric-prompt";
import { rubricMean } from "./scorers";

export interface RunRow {
  label: string;
  brief: string;
  arm: LessonArm;
  executed: boolean;
  complete: boolean;
  accepted: boolean | null;
  usd: number;
  durationMs: number;
}

export interface PackRow {
  id: string;
  topic: string;
  arm: string;
  usd: number;
}

export interface AcceptRule {
  mean: number;
  correctness: number;
}

export const DEFAULT_ACCEPT: AcceptRule = { mean: 3.5, correctness: 4 };

/** Accepted, by the rule, from a blind score; `null` when the run was not judged. */
export function acceptedBy(score: BlindScore | undefined, rule: AcceptRule): boolean | null {
  if (!score?.rubric) return null;
  const d = score.rubric.dimensions;
  const mean = rubricMean(
    Object.fromEntries(RUBRIC_DIMENSIONS.map((x) => [x, d[x].score])) as never,
  );
  return mean !== null && mean >= rule.mean && d.correctness.score >= rule.correctness;
}

export interface ArmSummary {
  arm: LessonArm;
  attempts: number;
  executed: number;
  complete: number;
  accepted: number;
  judged: number;
  /** Every attempt's cost. */
  usd: number;
  hotPerAccepted: number | null;
  meanLatencyMs: number | null;
  medianLatencyMs: number | null;
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? null) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};

export function summariseArm(arm: LessonArm, rows: RunRow[]): ArmSummary {
  const mine = rows.filter((r) => r.arm === arm);
  const accepted = mine.filter((r) => r.accepted === true).length;
  const usd = mine.reduce((s, r) => s + r.usd, 0);
  const lat = mine.filter((r) => r.executed).map((r) => r.durationMs);
  return {
    arm,
    attempts: mine.length,
    executed: mine.filter((r) => r.executed).length,
    complete: mine.filter((r) => r.complete).length,
    accepted,
    judged: mine.filter((r) => r.accepted !== null).length,
    usd,
    hotPerAccepted: accepted > 0 ? usd / accepted : null,
    meanLatencyMs: lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : null,
    medianLatencyMs: median(lat),
  };
}

/** Cold cost per accepted lesson: hot plus the pack build amortised over `uses` lessons. */
export function coldPerAccepted(
  summary: ArmSummary,
  packBuildUsd: number,
  uses: number,
): number | null {
  if (summary.hotPerAccepted === null || uses <= 0) return null;
  return summary.hotPerAccepted + packBuildUsd / uses;
}

/** Uses needed before the pack pays for itself against the live arm; `null` when there is no saving. */
export function breakEvenUses(
  packBuildUsd: number,
  livePerAccepted: number | null,
  armPerAccepted: number | null,
): number | null {
  if (livePerAccepted === null || armPerAccepted === null) return null;
  const saving = livePerAccepted - armPerAccepted;
  return saving > 0 ? Math.ceil(packBuildUsd / saving) : null;
}

export function reportMarkdown(
  exp: Experiment,
  rows: RunRow[],
  packs: PackRow[],
  uses: number[],
  rule: AcceptRule,
): string {
  const arms = exp.lessonArms.map((a) => summariseArm(a, rows));
  const live = arms.find((a) => a.arm === "live");
  // The pack build the lesson arms relied on: the lesson pack arm's packs over the run topics.
  const build = packs.filter((p) => p.arm === exp.packArmForLessons).reduce((s, p) => s + p.usd, 0);
  const L: string[] = [];
  L.push(
    `accept rule: rubric mean ≥ ${rule.mean} and correctness ≥ ${rule.correctness} (a decision, not a finding)`,
  );
  L.push(
    `pack build cost (${exp.packArmForLessons}, ${packs.filter((p) => p.arm === exp.packArmForLessons).length} packs, write + link + both checkers): $${build.toFixed(4)}`,
  );
  L.push(
    "",
    "| arm | attempts | executed | complete | judged | accepted | USD (all attempts) | hot $/accepted | " +
      uses.map((u) => `cold $/accepted @${u} uses`).join(" | ") +
      " | break-even uses | mean s | median s |",
  );
  L.push(
    `|---|---:|---:|---:|---:|---:|---:|---:|${uses.map(() => "---:").join("|")}|---:|---:|---:|`,
  );
  const f = (v: number | null, d = 4) => (v === null ? "-" : v.toFixed(d));
  for (const a of arms) {
    const packArm = a.arm !== "live";
    L.push(
      `| ${a.arm} | ${a.attempts} | ${a.executed} | ${a.complete} | ${a.judged} | ${a.accepted} | $${a.usd.toFixed(4)} | ${f(a.hotPerAccepted)} | ${uses.map((u) => (packArm ? f(coldPerAccepted(a, build, u)) : f(a.hotPerAccepted))).join(" | ")} | ${packArm ? (breakEvenUses(build, live?.hotPerAccepted ?? null, a.hotPerAccepted) ?? "no saving") : "-"} | ${f(a.meanLatencyMs === null ? null : a.meanLatencyMs / 1000, 1)} | ${f(a.medianLatencyMs === null ? null : a.medianLatencyMs / 1000, 1)} |`,
    );
  }
  if (packs.length) {
    L.push("", "| pack | topic | arm | build USD |", "|---|---|---|---:|");
    for (const p of packs) L.push(`| ${p.id} | ${p.topic} | ${p.arm} | $${p.usd.toFixed(4)} |`);
  }
  return L.join("\n");
}

/* ------------------------------------ loading results ------------------------------------ */

const ResultSchema = z.object({
  label: z.string(),
  brief: z.string(),
  status: z.object({ executed: z.boolean(), complete: z.boolean() }),
  durationMs: z.number(),
  ledger: z.object({ lesson: z.object({ usd: z.number().nullable() }) }),
  experiment: z
    .object({ arm: z.enum(["live", "grounded", "packed"]) })
    .nullable()
    .optional(),
});

export async function loadRunRow(
  dir: string,
  judged: Map<string, BlindScore>,
  rule: AcceptRule,
): Promise<RunRow | null> {
  const r = ResultSchema.parse(JSON.parse(await readFile(join(dir, "result.json"), "utf8")));
  if (!r.experiment) return null;
  return {
    label: r.label,
    brief: r.brief,
    arm: r.experiment.arm,
    executed: r.status.executed,
    complete: r.status.complete,
    accepted: acceptedBy(judged.get(r.label), rule),
    usd: r.ledger.lesson.usd ?? 0,
    durationMs: r.durationMs,
  };
}

export async function loadPackRow(dir: string): Promise<PackRow> {
  const ledger = JSON.parse(await readFile(join(dir, "ledger.json"), "utf8")) as LedgerJson;
  const report = JSON.parse(await readFile(join(dir, "report.json"), "utf8")) as {
    topic: string;
    arm: string;
  };
  return {
    id: `${report.topic}.${report.arm}`,
    topic: report.topic,
    arm: report.arm,
    usd: ledger.all.usd ?? 0,
  };
}

/** Blind scores joined back to labels through the key. */
export async function loadJudged(dir: string): Promise<Map<string, BlindScore>> {
  const key = JSON.parse(await readFile(join(dir, "key.json"), "utf8")) as BlindKeyEntry[];
  const scores = JSON.parse(await readFile(join(dir, "scores.json"), "utf8")) as BlindScore[];
  const byBlind = new Map(scores.map((s) => [s.blind, s]));
  const out = new Map<string, BlindScore>();
  for (const k of key) {
    const s = byBlind.get(k.blind);
    if (s) out.set(k.label, s);
  }
  return out;
}

/** The table the estimates imply (every lesson accepted, each pack arm's build from the spend lines). */
export function estimatedRows(exp: Experiment): { rows: RunRow[]; packs: PackRow[] } {
  const { lines } = expectedSpend(exp);
  const briefs = runBriefs(exp);
  const rows: RunRow[] = [];
  for (const arm of exp.lessonArms) {
    const line = lines.find((l) => l.item.startsWith(`lessons ${arm}`));
    const per = line ? line.usd / line.calls : 0;
    for (const brief of briefs)
      for (let r = 1; r <= exp.repeats; r++)
        rows.push({
          label: `np1-${arm}-${brief}-r${r}`,
          brief,
          arm,
          executed: true,
          complete: true,
          accepted: true,
          usd: per,
          durationMs: 75_000,
        });
  }
  const packs: PackRow[] = exp.authoringArms.map((arm) => ({
    id: `all.${arm}`,
    topic: "(all run topics)",
    arm,
    usd: lines
      .filter(
        (l) =>
          l.item.includes(` ${arm}`) && (l.item.startsWith("author") || l.item.startsWith("check")),
      )
      .reduce((s, l) => s + l.usd, 0),
  }));
  return { rows, packs };
}

function args(name: string): string[] {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return [];
  const out: string[] = [];
  for (let j = i + 1; j < process.argv.length && !process.argv[j]?.startsWith("--"); j++)
    out.push(process.argv[j] as string);
  return out;
}

if (import.meta.main) {
  const exp = loadExperiment();
  const uses = (args("uses")[0] ?? "10,100,1000").split(",").map(Number);
  const rule: AcceptRule = {
    mean: Number(args("accept-mean")[0] ?? DEFAULT_ACCEPT.mean),
    correctness: Number(args("accept-correctness")[0] ?? DEFAULT_ACCEPT.correctness),
  };
  if (process.argv.includes("--estimate")) {
    const { rows, packs } = estimatedRows(exp);
    console.log(
      "# np1 cost report (ESTIMATE from experiments/np1.json; every lesson assumed accepted)",
      "",
    );
    console.log(reportMarkdown(exp, rows, packs, uses, rule));
    process.exit(0);
  }
  const judgeDir = args("judge")[0];
  const judged = judgeDir ? await loadJudged(resolve(judgeDir)) : new Map<string, BlindScore>();
  const rows = (
    await Promise.all(args("runs").map((d) => loadRunRow(resolve(d), judged, rule)))
  ).filter((r): r is RunRow => r !== null);
  const packs = await Promise.all(args("packs").map((d) => loadPackRow(resolve(d))));
  console.log(
    `# np1 cost report (${rows.length} runs, ${packs.length} packs, ${judged.size} judged)`,
    "",
  );
  console.log(reportMarkdown(exp, rows, packs, uses, rule));
}
