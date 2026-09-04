#!/usr/bin/env bun
/**
 * Verifies that every agent skill listed in docs/agent-skills.md is installed in the canonical
 * layout (TEACH-27, TEACH-28 / ADR 0017). Run with `bun run skills:check`.
 *
 * The doc's skill table carries an explicit `Path` column with one or more repo-relative
 * directories (backtick-quoted, comma-separated) of the form `<location>/.agents/skills/<name>`.
 * For each one:
 *   (a) `<location>/.agents/skills/<name>` must be a real directory containing `SKILL.md`;
 *   (b) `<location>/.claude/skills/<name>` must exist, be a symlink with a RELATIVE target, and
 *       resolve to (a);
 *   (c) `<location>/.opencode/skills/<name>`, if present, must likewise be a relative symlink
 *       to (a).
 * Exit code is non-zero when any skill is missing or its layout is wrong; offenders are named
 * on stderr with a plain message.
 *
 * Self-contained on purpose: TEACH-18 owns `scripts/lib/` and the `doctor` script.
 */

import { existsSync, lstatSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface SkillEntry {
  /** Skill name as written in the doc's `Skill` column (backticks stripped). */
  skill: string;
  /** Repo-relative directory that must contain `SKILL.md`. */
  path: string;
}

export type LayoutStatus =
  | { ok: true }
  | {
      ok: false;
      /** Repo-relative path of the offending entry. */
      path: string;
      /** Plain-language reason, without the path. */
      reason: string;
    };

export interface SkillCheckResult {
  entry: SkillEntry;
  /** Absolute path of the `SKILL.md` that was looked for. */
  skillFile: string;
  present: boolean;
  layout: LayoutStatus;
}

export const DEFAULT_DOC = "docs/agent-skills.md";
export const CANONICAL_DIR = ".agents";
/** Variant directories that must be relative symlinks to the canonical copy. */
export const VARIANT_DIRS: ReadonlyArray<{ dir: string; required: boolean }> = [
  { dir: ".claude", required: true },
  { dir: ".opencode", required: false },
];
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

/** Splits `<location>/.agents/skills/<name>` into its parts, or `null` if not in that shape. */
export function parseCanonicalPath(path: string): { location: string; name: string } | null {
  const m = /^(.+?)\/\.agents\/skills\/([^/]+)\/?$/.exec(path.replace(/\\/g, "/"));
  if (!m?.[1] || !m[2]) return null;
  return { location: m[1], name: m[2] };
}

function lstatOrNull(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function realpathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function toPosix(path: string): string {
  return path.split("\\").join("/");
}

/**
 * Checks the on-disk layout of one skill entry (ADR 0017): a real canonical directory under
 * `.agents/skills/` plus relative symlinks from `.claude/skills/` (required) and
 * `.opencode/skills/` (only if present).
 */
export function checkLayout(entry: SkillEntry, rootDir: string): LayoutStatus {
  const parts = parseCanonicalPath(entry.path);
  if (!parts) {
    return {
      ok: false,
      path: entry.path,
      reason: `path is not of the form <location>/${CANONICAL_DIR}/skills/<name>`,
    };
  }

  const canonicalRel = toPosix(join(parts.location, CANONICAL_DIR, "skills", parts.name));
  const canonicalAbs = resolve(rootDir, canonicalRel);
  const canonicalStat = lstatOrNull(canonicalAbs);
  if (!canonicalStat) {
    return { ok: false, path: canonicalRel, reason: "canonical skill directory is missing" };
  }
  if (canonicalStat.isSymbolicLink()) {
    return {
      ok: false,
      path: canonicalRel,
      reason: "canonical skill directory is a symlink; it must be a real directory",
    };
  }
  if (!canonicalStat.isDirectory()) {
    return { ok: false, path: canonicalRel, reason: "canonical skill path is not a directory" };
  }
  if (!existsSync(join(canonicalAbs, SKILL_FILE))) {
    return { ok: false, path: canonicalRel, reason: `canonical directory lacks ${SKILL_FILE}` };
  }
  const canonicalReal = realpathOrNull(canonicalAbs);

  for (const variant of VARIANT_DIRS) {
    const linkRel = toPosix(join(parts.location, variant.dir, "skills", parts.name));
    const linkAbs = resolve(rootDir, linkRel);
    const linkStat = lstatOrNull(linkAbs);

    if (!linkStat) {
      if (!variant.required) continue;
      return {
        ok: false,
        path: linkRel,
        reason: `missing; expected a relative symlink to ${canonicalRel}`,
      };
    }
    if (!linkStat.isSymbolicLink()) {
      const kind = linkStat.isDirectory() ? "real directory" : "real file";
      return {
        ok: false,
        path: linkRel,
        reason: `${kind} where a relative symlink to ${canonicalRel} was expected`,
      };
    }

    const target = readlinkSync(linkAbs);
    if (isAbsolute(target)) {
      return {
        ok: false,
        path: linkRel,
        reason: `absolute symlink target (${target}); must be relative (${toPosix(
          relative(dirname(linkAbs), canonicalAbs),
        )})`,
      };
    }

    const resolvedReal = realpathOrNull(resolve(dirname(linkAbs), target));
    if (!resolvedReal) {
      return {
        ok: false,
        path: linkRel,
        reason: `broken symlink (target ${target} does not exist)`,
      };
    }
    if (!statSync(resolvedReal).isDirectory()) {
      return { ok: false, path: linkRel, reason: `symlink target ${target} is not a directory` };
    }
    if (canonicalReal && resolvedReal !== canonicalReal) {
      return {
        ok: false,
        path: linkRel,
        reason: `symlink target ${target} does not resolve to ${canonicalRel}`,
      };
    }
  }

  return { ok: true };
}

/** Checks each entry's `SKILL.md` and layout on disk, relative to `rootDir`. */
export function checkEntries(entries: SkillEntry[], rootDir: string): SkillCheckResult[] {
  return entries.map((entry) => {
    const skillFile = resolve(rootDir, entry.path, SKILL_FILE);
    return {
      entry,
      skillFile,
      present: existsSync(skillFile),
      layout: checkLayout(entry, rootDir),
    };
  });
}

export async function checkSkills(docPath: string, rootDir: string): Promise<SkillCheckResult[]> {
  const markdown = await readFile(docPath, "utf8");
  return checkEntries(parseSkillTable(markdown), rootDir);
}

/** One-line, plain description of a layout failure, naming the offending path. */
export function formatLayoutFailure(result: SkillCheckResult): string {
  if (result.layout.ok) return "ok";
  return `${result.layout.path}: ${result.layout.reason}`;
}

/** Renders results as a fixed-width table for the terminal. */
export function formatResults(results: SkillCheckResult[]): string {
  const rows = results.map((r) => [
    r.present ? (r.layout.ok ? "ok" : "FAIL") : "MISSING",
    r.entry.skill,
    r.entry.path,
    r.layout.ok
      ? "ok"
      : r.layout.path === r.entry.path
        ? r.layout.reason
        : `${r.layout.path}: ${r.layout.reason}`,
  ]);
  const header = ["status", "skill", "path", "layout"];
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
  const badLayout = results.filter((r) => r.present && !r.layout.ok);
  if (missing.length === 0 && badLayout.length === 0) {
    console.log(`\nAll ${results.length} skill installs present with canonical layout (ADR 0017).`);
    return 0;
  }

  if (missing.length > 0) {
    console.error(`\n${missing.length} missing skill(s):`);
    for (const r of missing) {
      console.error(`  - ${r.entry.skill} (expected ${r.entry.path}/${SKILL_FILE})`);
    }
  }
  if (badLayout.length > 0) {
    console.error(`\n${badLayout.length} skill layout violation(s) (ADR 0017):`);
    for (const r of badLayout) {
      console.error(`  - ${r.entry.skill}: ${formatLayoutFailure(r)}`);
    }
  }
  console.error(
    "\nRe-install with the commands in docs/agent-skills.md; never copy or hand-edit skill dirs.",
  );
  return 1;
}

if (import.meta.main) {
  process.exit(await main());
}
