#!/usr/bin/env bun
// bun packages/generation/eval/judge-blind.ts --runs <results/lab/np1-*> [--out <label>] [--judge <model id>]
//   [--seed 42] [--cap 1] [--dry-run] [--no-addendum]
//
// The blind judge for np1. Takes lab run directories (each with result.json, lesson.json and,
// when present, worksheet.json), shuffles them with a seeded permutation, gives each a blind id,
// and asks a Claude-family judge (default the experiment's `models.judge`, anthropic/claude-sonnet-5
// on the gateway; refused with a report when it is not priced or the gateway key is absent) to
// score each one with the 15 Sept rubric (`rubric-prompt.ts`, reused AS IS) plus the addendum
// (`packs/prompts.ts` judge-addendum: added claims not in the facts, wrong facts — a STUB until
// the prompt-engineer writes it). The judge sees the brief, the facts and the deck text; never a
// label, an arm or a pack. The key (blind id → run) is written to `key.json` beside the scores
// and joined only in REPORT.md after every call has been made.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Writable } from "node:stream";
import { createAi, createBudget, PRICES } from "@tj/ai";
import type { Lesson, Worksheet } from "@tj/domain/documents";
import pino from "pino";
import { z } from "zod";
import { callStructured } from "../src/call";
import { factsBlock } from "../src/prompts/shared";
import type { PipelineDeps } from "../src/types";
import { loadExperiment } from "./experiments/np1";
import { createLedger, meteringAi } from "./ledger";
import {
  assertNoStubs,
  isStub,
  type JudgeAddendumOutput,
  JudgeAddendumOutputSchema,
  judgeAddendumPrompt,
} from "./packs/prompts";
import {
  RUBRIC_DIMENSIONS,
  type RubricOutput,
  RubricOutputSchema,
  rubricJudgePrompt,
} from "./rubric-prompt";
import { judgeImages, rubricJudgeInput, rubricMean } from "./scorers";

export interface RunToJudge {
  dir: string;
  label: string;
  brief: string;
  arm: string | null;
  executed: boolean;
  lesson: Lesson;
  worksheet?: Worksheet | undefined;
}

/** mulberry32: a small seeded PRNG so a shuffle is reproducible from its seed. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates with a seeded PRNG; returns the permuted copy. */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const rand = seeded(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export interface BlindKeyEntry {
  blind: string;
  label: string;
  brief: string;
  arm: string | null;
  dir: string;
}

/** Blind ids in shuffled order; the key is the only place the ids meet the labels. */
export function blindKey(runs: readonly RunToJudge[], seed: number): BlindKeyEntry[] {
  return shuffle(runs, seed).map((r, i) => ({
    blind: `L${String(i + 1).padStart(2, "0")}`,
    label: r.label,
    brief: r.brief,
    arm: r.arm,
    dir: r.dir,
  }));
}

/** A lab `result.json`; runs before the three statuses carry `ok` instead of `status`. */
export const ResultJsonSchema = z.object({
  label: z.string(),
  brief: z.string(),
  status: z.object({ executed: z.boolean() }).optional(),
  ok: z.boolean().optional(),
  experiment: z.object({ arm: z.string() }).nullable().optional(),
});

export async function loadRun(dir: string): Promise<RunToJudge> {
  const result = ResultJsonSchema.parse(
    JSON.parse(await readFile(join(dir, "result.json"), "utf8")),
  );
  const lesson = JSON.parse(await readFile(join(dir, "lesson.json"), "utf8")) as Lesson;
  const worksheet = await readFile(join(dir, "worksheet.json"), "utf8")
    .then((t) => JSON.parse(t) as Worksheet)
    .catch(() => undefined);
  return {
    dir,
    label: result.label,
    brief: result.brief,
    arm: result.experiment?.arm ?? null,
    executed: result.status?.executed ?? result.ok ?? false,
    lesson,
    worksheet,
  };
}

/** The deck as text for the addendum: slides, notes and worksheet blocks, in order. */
export function deckText(input: ReturnType<typeof rubricJudgeInput>): string {
  return [
    ...input.slides.map(
      (s) =>
        `[slide ${s.index}, ${s.kind}]\n${s.text}${s.notes ? `\nTeacher notes: ${s.notes}` : ""}`,
    ),
    ...(input.blocks.length
      ? ["Worksheet:", ...input.blocks.map((b) => `[${b.type}] ${b.text}`)]
      : []),
  ].join("\n");
}

export interface BlindScore {
  blind: string;
  rubric: RubricOutput | null;
  addendum: JudgeAddendumOutput | null;
  error?: string | undefined;
  durationMs: number;
}

/** Score one run: the rubric call as it stands, then the addendum. Never throws; the score says why. */
export async function judgeOne(
  run: RunToJudge,
  blind: string,
  deps: PipelineDeps,
  options: { addendum: boolean },
): Promise<BlindScore> {
  const started = Date.now();
  if (!run.executed || !run.lesson.facts)
    return { blind, rubric: null, addendum: null, error: "not executed", durationMs: 0 };
  const input = rubricJudgeInput({
    lesson: run.lesson,
    ...(run.worksheet ? { worksheet: run.worksheet } : {}),
  });
  let rubric: RubricOutput | null = null;
  let addendum: JudgeAddendumOutput | null = null;
  let error: string | undefined;
  try {
    const r = await callStructured({
      deps,
      stage: "evaluate",
      cls: "frontier",
      effort: "medium",
      prompt: rubricJudgePrompt,
      input,
      schema: RubricOutputSchema,
      maxOutputTokens: 1500,
      images: judgeImages(run.lesson),
    });
    rubric = r.output;
  } catch (e) {
    error = `rubric: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (options.addendum) {
    try {
      const a = await callStructured({
        deps,
        stage: "evaluate",
        cls: "frontier",
        effort: "medium",
        prompt: judgeAddendumPrompt,
        input: {
          topic: input.topic,
          factsText: factsBlock(input.facts),
          deckText: deckText(input),
        },
        schema: JudgeAddendumOutputSchema,
        maxOutputTokens: 900,
      });
      addendum = a.output;
    } catch (e) {
      error = `${error ? `${error}; ` : ""}addendum: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return { blind, rubric, addendum, error, durationMs: Date.now() - started };
}

/** The unblinded table: one row per run, scores by dimension, joined through the key. */
export function reportMarkdown(key: BlindKeyEntry[], scores: BlindScore[]): string {
  const byBlind = new Map(scores.map((s) => [s.blind, s]));
  const dims = [...RUBRIC_DIMENSIONS];
  const L = [
    `| blind | arm | brief | label | mean | ${dims.join(" | ")} | fidelity | wrongFacts | note |`,
    `|---|---|---|---|---:|${dims.map(() => "---:").join("|")}|---:|---:|---|`,
  ];
  for (const k of key) {
    const s = byBlind.get(k.blind);
    const d = s?.rubric?.dimensions;
    const mean = d
      ? rubricMean(Object.fromEntries(dims.map((x) => [x, d[x].score])) as never)
      : null;
    L.push(
      `| ${k.blind} | ${k.arm ?? "-"} | ${k.brief} | ${k.label} | ${mean ?? "-"} | ${dims.map((x) => d?.[x].score ?? "-").join(" | ")} | ${s?.addendum?.fidelity.score ?? "-"} | ${s?.addendum?.wrongFacts.score ?? "-"} | ${s?.error ?? ""} |`,
    );
  }
  // Per-arm means, the experiment's headline, computed only from judged rows.
  const arms = [...new Set(key.map((k) => k.arm ?? "-"))];
  L.push(
    "",
    "| arm | n judged | mean of means | correctness | fidelity | wrongFacts |",
    "|---|---:|---:|---:|---:|---:|",
  );
  for (const arm of arms) {
    const rows = key
      .filter((k) => (k.arm ?? "-") === arm)
      .map((k) => byBlind.get(k.blind))
      .filter((s): s is BlindScore => !!s?.rubric);
    const avg = (xs: (number | null | undefined)[]) => {
      const v = xs.filter((x): x is number => typeof x === "number");
      return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : "-";
    };
    L.push(
      `| ${arm} | ${rows.length} | ${avg(rows.map((s) => (s.rubric ? rubricMean(Object.fromEntries(dims.map((x) => [x, s.rubric?.dimensions[x].score ?? null])) as never) : null)))} | ${avg(rows.map((s) => s.rubric?.dimensions.correctness.score))} | ${avg(rows.map((s) => s.addendum?.fidelity.score))} | ${avg(rows.map((s) => s.addendum?.wrongFacts.score))} |`,
    );
  }
  return L.join("\n");
}

const EnvSchema = z.object({ AI_GATEWAY_API_KEY: z.string().optional() });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

if (import.meta.main) {
  const exp = loadExperiment();
  const runArgs = process.argv
    .slice(process.argv.indexOf("--runs") + 1)
    .filter((a) => !a.startsWith("--"));
  if (!process.argv.includes("--runs") || runArgs.length === 0) {
    console.error(
      "usage: judge-blind.ts --runs <dir…> [--out label] [--judge model] [--seed n] [--dry-run]",
    );
    process.exit(2);
  }
  const judgeId = arg("judge") ?? exp.models.judge ?? "anthropic/claude-sonnet-5";
  const seed = Number(arg("seed") ?? 42);
  const addendum = !flag("no-addendum");
  const runs = await Promise.all(runArgs.map((d) => loadRun(resolve(d))));
  const key = blindKey(runs, seed);
  const judgeable = runs.filter((r) => r.executed && r.lesson.facts).length;
  const t = exp.estimates.tokens;
  const p = PRICES[judgeId];
  const est = p
    ? (judgeable *
        ((t["rubric-judge"]?.in ?? 0) * p.inputPerMTok +
          (t["rubric-judge"]?.out ?? 0) * p.outputPerMTok) +
        (addendum
          ? judgeable *
            ((t["judge-addendum"]?.in ?? 0) * p.inputPerMTok +
              (t["judge-addendum"]?.out ?? 0) * p.outputPerMTok)
          : 0)) /
      1e6
    : null;
  console.log(
    `judge ${judgeId}${p ? "" : " (UNPRICED: not in PRICES; refused)"}; ${runs.length} runs, ${judgeable} judgeable, ${runs.length - judgeable} not executed (no judge call, no cost); seed ${seed}; calls ${judgeable * (addendum ? 2 : 1)}; expected spend ${est === null ? "-" : `$${est.toFixed(4)}`}`,
  );
  console.log(
    `rubric ${rubricJudgePrompt.version} (as is); addendum ${judgeAddendumPrompt.version}${isStub(judgeAddendumPrompt) ? " (STUB: refused live)" : ""}`,
  );
  if (flag("dry-run")) {
    console.log("blind order:", key.map((k) => k.blind).join(" "));
    process.exit(0);
  }
  if (!p) process.exit(2);
  const env = EnvSchema.parse(process.env);
  if (!env.AI_GATEWAY_API_KEY) {
    console.error("judge: AI_GATEWAY_API_KEY missing (run via `railway run --`)");
    process.exit(2);
  }
  if (addendum) assertNoStubs([judgeAddendumPrompt]);
  const outDir = join(import.meta.dir, "results", "judge", arg("out") ?? `np1-${Date.now()}`);
  await mkdir(outDir, { recursive: true });
  const ledger = createLedger({ run: basename(outDir) });
  const created = createAi(env, { route: () => judgeId });
  if (created.kind === "unconfigured") throw new Error("judge unconfigured");
  const ai = meteringAi(created, ledger, { stage: "judge" });
  const deps: PipelineDeps = {
    ai,
    budget: createBudget({ capUsd: Number(arg("cap") ?? 1), capTokens: 5_000_000 }),
    signal: new AbortController().signal,
    logger: pino({ level: "warn" }, new Writable({ write: (_c, _e, cb) => cb() })),
    now: () => new Date(),
    ids: () => "j",
    sources: async () => [],
    persist: async () => ({ updatedAt: new Date().toISOString() }),
    onProgress: async () => {},
    context: { lessonId: "judge", jobId: basename(outDir) },
  };
  // The key is written before any call, so a crash mid-way still leaves the mapping.
  await writeFile(join(outDir, "key.json"), JSON.stringify(key, null, 2));
  const byLabel = new Map(runs.map((r) => [r.label, r]));
  const scores: BlindScore[] = [];
  for (const k of key) {
    const run = byLabel.get(k.label);
    if (!run) continue;
    const s = await judgeOne(run, k.blind, deps, { addendum });
    scores.push(s);
    await writeFile(join(outDir, "scores.json"), JSON.stringify(scores, null, 2));
    process.stderr.write(
      `${k.blind} ${s.error ? `error: ${s.error}` : "scored"} (${s.durationMs} ms)\n`,
    );
  }
  await writeFile(join(outDir, "ledger.json"), JSON.stringify(ledger.toJSON(), null, 2));
  const report = `# Blind judge ${basename(outDir)}\n\njudge ${judgeId}; seed ${seed}; ${scores.filter((s) => s.rubric).length}/${runs.length} scored\n\n${reportMarkdown(key, scores)}\n\n## Cost\n\n${ledger.markdown()}\n`;
  await writeFile(join(outDir, "REPORT.md"), report);
  console.log(report);
}
