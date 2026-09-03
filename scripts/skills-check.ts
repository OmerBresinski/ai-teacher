#!/usr/bin/env bun
/**
 * Verifies that every agent skill listed in docs/agent-skills.md is actually installed
 * (TEACH-27). Run with `bun run skills:check`.
 *
 * The doc's skill table carries an explicit `Path` column with one or more repo-relative
 * directories (backtick-quoted, comma-separated). Each directory must contain a `SKILL.md`.
 * Exit code is non-zero when any skill is missing; missing entries are named on stderr.
 *
 * Self-contained on purpose: TEACH-18 owns `scripts/lib/` and the `doctor` script.
 */
// TODO(TEACH-18): wire into bun run doctor

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface SkillEntry {
  /** Skill name as written in the doc's `Skill` column (backticks stripped). */
  skill: string;
  /** Repo-relative directory that must contain `SKILL.md`. */
  path: string;
}

export interface SkillCheckResult {
  entry: SkillEntry;
  /** Absolute path of the `SKILL.md` that was looked for. */
  skillFile: string;
  present: boolean;
}

export const DEFAULT_DOC = "docs/agent-skills.md";
const SKILL_FILE = "SKILL.md";

/** Splits a markdown table row into trimmed cells, dropping the outer pipes. */
export function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableRow(line: string): boolean {
  return line.trim().startsWith("|");
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function stripBackticks(text: string): string {
  return text.replace(/`/g, "").trim();
}

/** Extracts one or more repo-relative paths from a table cell such as `` `a/b`, `c/d` ``. */
export function parsePathCell(cell: string): string[] {
  const quoted = [...cell.matchAll(/`([^`]+)`/g)].map((m) => (m[1] ?? "").trim());
  const raw = quoted.length > 0 ? quoted : cell.split(",");
  return raw.map((p) => p.trim()).filter((p) => p.length > 0 && p !== "—" && p !== "-");
}

/**
 * Finds the skill table in the markdown (the first table whose header has both a `Skill`
 * and a `Path` column) and returns one entry per (skill, path) pair.
 */
export function parseSkillTable(markdown: string): SkillEntry[] {
  const lines = markdown.split(/\r?\n/);
  const entries: SkillEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!isTableRow(line)) continue;

    const header = splitRow(line).map((cell) => stripBackticks(cell).toLowerCase());
    const skillCol = header.indexOf("skill");
    const pathCol = header.findIndex((cell) => cell === "path" || cell === "paths");
    const separator = lines[i + 1];
    if (skillCol < 0 || pathCol < 0 || !separator || !isSeparatorRow(splitRow(separator))) {
      continue;
    }

    for (let j = i + 2; j < lines.length; j++) {
      const rowLine = lines[j] ?? "";
      if (!isTableRow(rowLine)) break;
      const cells = splitRow(rowLine);
      const skill = stripBackticks(cells[skillCol] ?? "");
      if (skill.length === 0) continue;
      for (const path of parsePathCell(cells[pathCol] ?? "")) {
        entries.push({ skill, path });
      }
    }
    return entries;
  }

  throw new Error("No skill table with `Skill` and `Path` columns found in the markdown.");
}

/** Checks each entry's `SKILL.md` on disk, relative to `rootDir`. */
export function checkEntries(entries: SkillEntry[], rootDir: string): SkillCheckResult[] {
  return entries.map((entry) => {
    const skillFile = resolve(rootDir, entry.path, SKILL_FILE);
    return { entry, skillFile, present: existsSync(skillFile) };
  });
}

export async function checkSkills(docPath: string, rootDir: string): Promise<SkillCheckResult[]> {
  const markdown = await readFile(docPath, "utf8");
  return checkEntries(parseSkillTable(markdown), rootDir);
}

/** Renders results as a fixed-width table for the terminal. */
export function formatResults(results: SkillCheckResult[]): string {
  const rows = results.map((r) => [r.present ? "ok" : "MISSING", r.entry.skill, r.entry.path]);
  const header = ["status", "skill", "path"];
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i]?.length ?? 0)),
  );
  const render = (row: string[]) => row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ");
  return [render(header), render(widths.map((w) => "-".repeat(w))), ...rows.map(render)].join("\n");
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const docArg = argv[0];
  const docPath = docArg ? resolve(rootDir, docArg) : join(rootDir, DEFAULT_DOC);

  const results = await checkSkills(docPath, rootDir);
  console.log(`Agent skills declared in ${DEFAULT_DOC}:\n`);
  console.log(formatResults(results));

  const missing = results.filter((r) => !r.present);
  if (missing.length > 0) {
    console.error(`\n${missing.length} missing skill(s):`);
    for (const r of missing) {
      console.error(`  - ${r.entry.skill} (expected ${r.entry.path}/${SKILL_FILE})`);
    }
    console.error("\nRe-install with the commands in docs/agent-skills.md.");
    return 1;
  }

  console.log(`\nAll ${results.length} skill installs present.`);
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
