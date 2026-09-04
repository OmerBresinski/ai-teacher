#!/usr/bin/env bun
// bun run env:generate [--check]
//
// Writes everything derived from `infra/env.contract.ts`: every `.env.example`, `docs/env.md` and
// `.gitleaks.toml`. `--check` writes nothing; it exits 1 with a per-file summary when any output
// on disk differs from what the contract renders (CI `quality` job, lefthook pre-commit).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderAll } from "./lib/env-render";
import { ExitCode, runMain, UserFacingError } from "./lib/exit";
import { colour, log } from "./lib/log";
import { ROOT } from "./lib/paths";

export interface FileDrift {
  path: string;
  /** `missing` when the file does not exist on disk. */
  reason: "missing" | "differs";
  /** 1-based line of the first difference (when `differs`). */
  line?: number;
  expectedLine?: string;
  actualLine?: string;
}

/** Pure: where does `actual` first diverge from `expected`? `null` when identical. */
export function firstDifference(
  expected: string,
  actual: string,
): { line: number; expectedLine: string; actualLine: string } | null {
  if (expected === actual) return null;
  const a = expected.split("\n");
  const b = actual.split("\n");
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i])
      return { line: i + 1, expectedLine: a[i] ?? "<eof>", actualLine: b[i] ?? "<eof>" };
  }
  return { line: n, expectedLine: "<eof>", actualLine: "<eof>" };
}

export async function checkOutputs(root: string): Promise<FileDrift[]> {
  const drift: FileDrift[] = [];
  for (const [relPath, expected] of renderAll()) {
    const abs = path.join(root, relPath);
    let actual: string;
    try {
      actual = await readFile(abs, "utf8");
    } catch {
      drift.push({ path: relPath, reason: "missing" });
      continue;
    }
    const diff = firstDifference(expected, actual);
    if (diff) drift.push({ path: relPath, reason: "differs", ...diff });
  }
  return drift;
}

export async function writeOutputs(
  root: string,
): Promise<{ written: string[]; unchanged: string[] }> {
  const written: string[] = [];
  const unchanged: string[] = [];
  for (const [relPath, content] of renderAll()) {
    const abs = path.join(root, relPath);
    const current = await readFile(abs, "utf8").catch(() => null);
    if (current === content) {
      unchanged.push(relPath);
      continue;
    }
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    written.push(relPath);
  }
  return { written, unchanged };
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const unknown = args.filter((a) => a !== "--check");
  if (unknown.length > 0) {
    throw new UserFacingError(
      `Unknown option(s): ${unknown.join(" ")}\nUsage: bun run env:generate [--check]`,
      ExitCode.Usage,
    );
  }

  if (check) {
    const drift = await checkOutputs(ROOT);
    if (drift.length === 0) {
      log.ok("env:generate --check: every generated file matches infra/env.contract.ts");
      return ExitCode.Ok;
    }
    console.error(
      colour.red(colour.bold(`env:generate --check: ${drift.length} file(s) out of date`)),
    );
    for (const d of drift) {
      if (d.reason === "missing") console.error(`  ${d.path}: missing`);
      else {
        console.error(`  ${d.path}: differs at line ${d.line}`);
        console.error(`    expected: ${d.expectedLine}`);
        console.error(`    actual:   ${d.actualLine}`);
      }
    }
    console.error(
      "Run `bun run env:generate` and commit the result (edit infra/env.contract.ts, not the outputs).",
    );
    return ExitCode.Failure;
  }

  const { written, unchanged } = await writeOutputs(ROOT);
  for (const p of written) log.ok(`wrote ${p}`);
  for (const p of unchanged) log.info(`${p} unchanged`);
  return ExitCode.Ok;
}

if (import.meta.main) await runMain(main);
