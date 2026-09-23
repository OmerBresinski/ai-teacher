#!/usr/bin/env bun
// bun packages/generation/eval/bakeoff/blind.ts --runs <dirA> <dirB> <dirC> --seed <n> [--lab <dir>]
//
// Anonymises contestants' run directories for scoring. Each run's `results.json` is reduced to the
// item outputs and per-call numbers, everything identifying is dropped (prompt path, sha256,
// contestant id, run directory, start time), and the runs are assigned labels A, B, C … by a
// seeded shuffle. The key (label → run dir) goes to `<lab>/scoring/key.json`, which the judge is
// never given; the anonymised sets go to `<lab>/scoring/blind/<task>-<set>/<label>.json`.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { seededShuffle } from "./metrics";
import type { ItemResult, RunFile } from "./run";

export const LABELS = "ABCDEFGH";

export interface BlindItem {
  id: string;
  ok: boolean;
  output?: unknown;
  attempts: number;
  schemaFailures: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs: number;
  /** Failure class only — never the message, which could carry a path or the prompt version. */
  error?: "schema" | "timeout" | "budget" | "other";
}

export function errorClass(message: string): NonNullable<BlindItem["error"]> {
  if (/did not produce a valid/.test(message)) return "schema";
  if (/timeout/i.test(message)) return "timeout";
  if (/budget/i.test(message)) return "budget";
  return "other";
}

export interface BlindSet {
  label: string;
  task: string;
  set: string;
  items: BlindItem[];
}

/** The fields of a result that survive anonymisation, in a fixed order. */
export function stripItem(item: ItemResult): BlindItem {
  const out: BlindItem = {
    id: item.id,
    ok: item.ok,
    attempts: item.attempts,
    schemaFailures: item.schemaFailures,
    latencyMs: item.latencyMs,
  };
  if (item.output !== undefined) out.output = item.output;
  if (item.inputTokens !== undefined) out.inputTokens = item.inputTokens;
  if (item.outputTokens !== undefined) out.outputTokens = item.outputTokens;
  if (item.costUsd !== undefined) out.costUsd = item.costUsd;
  if (item.error !== undefined) out.error = errorClass(item.error);
  return out;
}

export interface BlindResult {
  key: {
    seed: number;
    task: string;
    set: string;
    assignments: { label: string; runDir: string; promptFile: string; promptSha256: string }[];
  };
  sets: BlindSet[];
}

/** Pure: the key and the anonymised sets for a list of runs (already read). */
export function blind(runs: { dir: string; file: RunFile }[], seed: number): BlindResult {
  if (runs.length === 0) throw new Error("no runs");
  const task = runs[0]?.file.task as string;
  const set = runs[0]?.file.set as string;
  for (const r of runs) {
    if (r.file.task !== task || r.file.set !== set)
      throw new Error(`${r.dir} is ${r.file.task}/${r.file.set}, expected ${task}/${set}`);
  }
  const order = seededShuffle(runs, seed);
  const assignments = order.map((r, i) => ({
    label: LABELS[i] as string,
    runDir: r.dir,
    promptFile: r.file.promptFile,
    promptSha256: r.file.promptSha256,
  }));
  const sets = order.map((r, i) => ({
    label: LABELS[i] as string,
    task,
    set,
    items: [...r.file.items].sort((a, b) => a.id.localeCompare(b.id)).map(stripItem),
  }));
  // Belt and braces: nothing identifying may survive in the anonymised text.
  const forbidden = runs.flatMap((r) => [
    r.dir,
    r.file.promptFile,
    r.file.promptSha256,
    basename(r.dir),
  ]);
  const text = JSON.stringify(sets);
  for (const f of forbidden)
    if (f && text.includes(f)) throw new Error(`anonymised output still contains "${f}"`);
  return { key: { seed, task, set, assignments }, sets };
}

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

if (import.meta.main) {
  const i = process.argv.indexOf("--runs");
  const dirs: string[] = [];
  for (
    let k = i + 1;
    i !== -1 && k < process.argv.length && !process.argv[k]?.startsWith("--");
    k++
  )
    dirs.push(resolve(process.argv[k] as string));
  const seed = Number(arg("seed"));
  const lab = resolve(
    arg("lab") ??
      "/Users/gregwallace/Documents/experiments/ai-teacher/scratchpad/quality-prd/lab/pe-bakeoff",
  );
  if (dirs.length < 2 || !Number.isInteger(seed)) {
    console.error("usage: blind.ts --runs <dirA> <dirB> [<dirC> …] --seed <n> [--lab <dir>]");
    process.exit(2);
  }
  const runs = [];
  for (const dir of dirs)
    runs.push({
      dir,
      file: JSON.parse(await readFile(join(dir, "results.json"), "utf8")) as RunFile,
    });
  const result = blind(runs, seed);
  const blindDir = join(lab, "scoring", "blind", `${result.key.task}-${result.key.set}`);
  await mkdir(blindDir, { recursive: true });
  for (const s of result.sets)
    await writeFile(join(blindDir, `${s.label}.json`), `${JSON.stringify(s, null, 2)}\n`);
  // One key per task/set, merged into scoring/key.json so a second task's blinding does not lose the first.
  const keyPath = join(lab, "scoring", "key.json");
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await readFile(keyPath, "utf8"));
  } catch {}
  existing[`${result.key.task}-${result.key.set}`] = result.key;
  await writeFile(keyPath, `${JSON.stringify(existing, null, 2)}\n`);
  console.log(
    `wrote ${result.sets.length} anonymised sets to ${blindDir}; key in ${keyPath} (do not give the judge this path)`,
  );
}
