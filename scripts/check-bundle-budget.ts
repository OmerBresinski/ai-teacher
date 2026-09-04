#!/usr/bin/env bun
// bun run check:bundle-budget [--manifest <path>] [--dist <dir>] [--json] [--markdown-out <file>]
//
// Enforces the initial-load bundle budget of the web app (F18-R05: 250 KB gzipped). Reads the
// Vite manifest, walks every `isEntry` chunk and its static `imports` (not `dynamicImports`,
// which are lazy routes), gzips the JS and CSS files and prints a Markdown table.
//
//   exit 0  total <= warn threshold (default 200 KB), or the manifest is missing (TEACH-21)
//   exit 0  warn  < total <= budget  (prints a WARN line)
//   exit 1  total > budget (default 250 KB)
//
// Overrides: BUNDLE_BUDGET_KB, BUNDLE_WARN_KB.

import path from "node:path";
import { ExitCode } from "./lib/exit";

export interface ManifestChunk {
  file: string;
  src?: string;
  name?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
  assets?: string[];
}

export type Manifest = Record<string, ManifestChunk>;

export interface FileSize {
  file: string;
  raw: number;
  gzip: number;
}

export interface BudgetReport {
  files: FileSize[];
  totalRaw: number;
  totalGzip: number;
  warnKb: number;
  budgetKb: number;
  status: "ok" | "warn" | "fail";
}

export const DEFAULT_MANIFEST = path.join("apps", "web", "dist", ".vite", "manifest.json");
export const DEFAULT_BUDGET_KB = 250;
export const DEFAULT_WARN_KB = 200;
export const SKIP_MESSAGE =
  "Bundle budget: skipped — apps/web/dist/.vite/manifest.json not found (TEACH-21)";

/**
 * Files that make up the initial load: every `isEntry` chunk, the chunks reachable through
 * static `imports` (transitively) and the CSS attached to each of those chunks.
 * `dynamicImports` are deliberately excluded — they are code-split routes loaded on demand.
 */
export function collectInitialFiles(manifest: Manifest): string[] {
  const files = new Set<string>();
  const seen = new Set<string>();

  const visit = (key: string): void => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) return;
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const dep of chunk.imports ?? []) visit(dep);
  };

  for (const [key, chunk] of Object.entries(manifest)) {
    if (chunk.isEntry) visit(key);
  }
  return [...files].sort();
}

export async function measureFiles(distDir: string, files: string[]): Promise<FileSize[]> {
  const sizes: FileSize[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await Bun.file(path.join(distDir, file)).arrayBuffer());
    sizes.push({ file, raw: bytes.byteLength, gzip: Bun.gzipSync(bytes).byteLength });
  }
  return sizes;
}

export function readThreshold(name: string, fallback: number, env = process.env): number {
  const value = env[name];
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number of KB, got "${value}"`);
  }
  return parsed;
}

export function buildReport(files: FileSize[], warnKb: number, budgetKb: number): BudgetReport {
  const totalRaw = files.reduce((sum, f) => sum + f.raw, 0);
  const totalGzip = files.reduce((sum, f) => sum + f.gzip, 0);
  const totalKb = totalGzip / 1024;
  const status = totalKb > budgetKb ? "fail" : totalKb > warnKb ? "warn" : "ok";
  return { files, totalRaw, totalGzip, warnKb, budgetKb, status };
}

export function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function toMarkdown(report: BudgetReport): string {
  const rows = report.files
    .map((f) => `| \`${f.file}\` | ${formatKb(f.raw)} | ${formatKb(f.gzip)} |`)
    .join("\n");
  const label = { ok: "OK", warn: "WARN", fail: "FAIL" }[report.status];
  return [
    `### Bundle budget — ${label}`,
    "",
    `Initial load of \`apps/web\` (entry chunks + static imports + CSS), gzipped.`,
    "",
    "| File | Raw | Gzip |",
    "| ---- | --- | ---- |",
    rows,
    `| **Total** | **${formatKb(report.totalRaw)}** | **${formatKb(report.totalGzip)}** |`,
    "",
    `Warn at ${report.warnKb} KB, fail at ${report.budgetKb} KB (gzip). ` +
      "Override with `BUNDLE_WARN_KB` / `BUNDLE_BUDGET_KB`.",
    "",
  ].join("\n");
}

export interface CliOptions {
  manifest: string;
  dist: string | null;
  json: boolean;
  markdownOut: string | null;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    manifest: DEFAULT_MANIFEST,
    dist: null,
    json: false,
    markdownOut: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case "--manifest":
        options.manifest = next();
        break;
      case "--dist":
        options.dist = next();
        break;
      case "--json":
        options.json = true;
        break;
      case "--markdown-out":
        options.markdownOut = next();
        break;
      default:
        throw new Error(
          `Unknown option: ${arg}\nUsage: bun run check:bundle-budget [--manifest <path>] [--dist <dir>] [--json] [--markdown-out <file>]`,
        );
    }
  }
  return options;
}

/** Vite writes the manifest to `<dist>/.vite/manifest.json`; derive `<dist>` from it. */
export function distFromManifest(manifestPath: string): string {
  const dir = path.dirname(manifestPath);
  return path.basename(dir) === ".vite" ? path.dirname(dir) : dir;
}

export async function run(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  out: (line: string) => void = console.log,
): Promise<number> {
  const options = parseArgs(argv);
  const manifestFile = Bun.file(options.manifest);
  if (!(await manifestFile.exists())) {
    out(SKIP_MESSAGE);
    if (options.markdownOut) await Bun.write(options.markdownOut, `${SKIP_MESSAGE}\n`);
    return ExitCode.Ok;
  }

  const manifest = (await manifestFile.json()) as Manifest;
  const dist = options.dist ?? distFromManifest(options.manifest);
  const files = await measureFiles(dist, collectInitialFiles(manifest));
  const report = buildReport(
    files,
    readThreshold("BUNDLE_WARN_KB", DEFAULT_WARN_KB, env),
    readThreshold("BUNDLE_BUDGET_KB", DEFAULT_BUDGET_KB, env),
  );

  const markdown = toMarkdown(report);
  if (options.markdownOut) await Bun.write(options.markdownOut, markdown);
  if (options.json) {
    out(JSON.stringify(report, null, 2));
  } else {
    out(markdown);
  }

  const total = formatKb(report.totalGzip);
  if (report.status === "fail") {
    out(`Bundle budget: FAIL — ${total} gzip exceeds the ${report.budgetKb} KB budget`);
    return ExitCode.Failure;
  }
  if (report.status === "warn") {
    out(`Bundle budget: WARN — ${total} gzip is above the ${report.warnKb} KB warning line`);
  } else {
    out(`Bundle budget: OK — ${total} gzip`);
  }
  return ExitCode.Ok;
}

if (import.meta.main) {
  try {
    process.exit(await run(process.argv.slice(2)));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(ExitCode.Usage);
  }
}
