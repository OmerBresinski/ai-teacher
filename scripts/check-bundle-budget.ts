#!/usr/bin/env bun
// bun run check:bundle-budget [--manifest <path>] [--dist <dir>] [--json] [--markdown-out <file>]
//                             [--chunk <name>=<kb>]...
//
// Enforces the bundle budgets of the web app. Reads the Vite manifest and:
//
// 1. Initial load (F18-R05: 250 KB gzipped) — every `isEntry` chunk and its static `imports`
//    (not `dynamicImports`, which are lazy routes), JS and CSS gzipped, printed as a Markdown table.
// 2. Route chunks (ADR 0022 §8, TEACH-113) — for each entry of `BUNDLE_CHUNK_BUDGETS`, the route's
//    chunk plus everything its static imports pull in *beyond the initial load*, JS and CSS gzipped,
//    against a ceiling pinned from measurement + 20%. Font files are assets, not code, and are not
//    counted. `--chunk lesson-editor=10` overrides one ceiling for a scratch run.
// 3. Click-loaded libraries (ADR 0023 §4, ADR 0028) — `CLICK_LOADED_CHUNKS` must never be reached
//    through a static import: the exporters, and gsap (loaded only via `apps/web/src/lib/gsap.ts`'s
//    `loadGsap()`).
//
//   exit 0  total <= warn threshold (default 200 KB), or the manifest is missing (TEACH-21)
//   exit 0  warn  < total <= budget  (prints a WARN line)
//   exit 1  total > budget (default 250 KB), a route chunk over its ceiling, a budgeted route with
//           no chunk in the manifest, or an exporter leak
//
// Overrides: BUNDLE_BUDGET_KB, BUNDLE_WARN_KB, --chunk.

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

/**
 * Chunks that must only ever be reached through `dynamicImports` (ADR 0023 §4, TEACH-111 row 8;
 * ADR 0028, TEACH-310): the exporter libraries and the `@tj/editor/export` modules that wrap them,
 * plus gsap. A key is matched against the manifest's source path; `pptxgenjs`, `docx` and `gsap`
 * are their own vendor chunks, `modern-screenshot` is folded into `export/png.ts`'s.
 */
export const CLICK_LOADED_CHUNKS: readonly RegExp[] = [
  /node_modules\/(\.bun\/)?pptxgenjs/,
  /node_modules\/(\.bun\/)?modern-screenshot/,
  /node_modules\/(\.bun\/)?docx@/,
  /node_modules\/(\.bun\/)?gsap@/,
  /packages\/editor\/src\/export\/pptx\.ts$/,
  /packages\/editor\/src\/export\/png\.ts$/,
  /packages\/editor\/src\/export\/docx\.ts$/,
];

/**
 * Every click-loaded chunk that some other chunk imports *statically* (or that is an entry),
 * as `"<importer> -> <chunk>"` lines. Empty when the exporters are correctly split: reached only
 * through `dynamicImports`, so no route pays for them.
 */
export function findClickLoadedLeaks(
  manifest: Manifest,
  patterns: readonly RegExp[] = CLICK_LOADED_CHUNKS,
): string[] {
  const guarded = new Set(
    Object.keys(manifest).filter((key) => patterns.some((pattern) => pattern.test(key))),
  );
  const leaks: string[] = [];
  for (const key of guarded) {
    if (manifest[key]?.isEntry) leaks.push(`entry -> ${key}`);
  }
  for (const [importer, chunk] of Object.entries(manifest)) {
    for (const dep of chunk.imports ?? []) {
      if (guarded.has(dep) && !guarded.has(importer)) leaks.push(`${importer} -> ${dep}`);
    }
  }
  return leaks.sort();
}

/**
 * Per-route ceilings (ADR 0022 §8, amended by TEACH-113). `match` is tested against the manifest
 * key (the source path); the budget is the gzipped JS + CSS the route adds over the initial load.
 * Pinned at measured + 20% on 2026-09-13 — the measured column is in `apps/web/README.md`
 * "Bundle budget". Re-pin (and update that table) when a PR deliberately moves one.
 */
export interface ChunkBudget {
  name: string;
  match: RegExp;
  budgetKb: number;
}

export const BUNDLE_CHUNK_BUDGETS: readonly ChunkBudget[] = [
  { name: "lesson-editor", match: /src\/routes\/lesson-editor\.page\.tsx$/, budgetKb: 241 },
  { name: "lesson-present", match: /src\/routes\/lesson-present\.page\.tsx$/, budgetKb: 109 },
  { name: "lesson-view", match: /src\/routes\/lesson-viewer\.page\.tsx$/, budgetKb: 91 },
  { name: "lesson-print", match: /src\/routes\/lesson-print\.page\.tsx$/, budgetKb: 51 },
  { name: "worksheet-editor", match: /src\/routes\/worksheet-editor\.page\.tsx$/, budgetKb: 187 },
  { name: "worksheet-print", match: /src\/routes\/worksheet-print\.page\.tsx$/, budgetKb: 36 },
];

/**
 * The files a route chunk adds over the initial load: the chunk itself, every chunk reachable
 * through static `imports`, and their CSS — minus anything the initial load already ships.
 * `dynamicImports` (the click-loaded exporters, nested lazy pieces) are excluded, as for the
 * initial load.
 */
export function collectChunkFiles(manifest: Manifest, key: string, initial: Set<string>): string[] {
  const files = new Set<string>();
  const seen = new Set<string>();
  const visit = (k: string): void => {
    if (seen.has(k)) return;
    seen.add(k);
    const chunk = manifest[k];
    if (!chunk) return;
    if (!initial.has(chunk.file)) files.add(chunk.file);
    for (const css of chunk.css ?? []) if (!initial.has(css)) files.add(css);
    for (const dep of chunk.imports ?? []) visit(dep);
  };
  visit(key);
  return [...files].sort();
}

export interface ChunkReport {
  name: string;
  /** The manifest key the budget matched, or null when no chunk did. */
  key: string | null;
  files: FileSize[];
  totalGzip: number;
  budgetKb: number;
  status: "ok" | "fail" | "missing";
}

/** Every budgeted route measured against its ceiling. A budget that matches nothing is `missing`. */
export async function measureChunks(
  manifest: Manifest,
  distDir: string,
  budgets: readonly ChunkBudget[],
): Promise<ChunkReport[]> {
  const initial = new Set(collectInitialFiles(manifest));
  const reports: ChunkReport[] = [];
  for (const budget of budgets) {
    const key = Object.keys(manifest).find((k) => budget.match.test(k)) ?? null;
    if (key === null) {
      reports.push({
        name: budget.name,
        key,
        files: [],
        totalGzip: 0,
        budgetKb: budget.budgetKb,
        status: "missing",
      });
      continue;
    }
    const files = await measureFiles(distDir, collectChunkFiles(manifest, key, initial));
    const totalGzip = files.reduce((sum, f) => sum + f.gzip, 0);
    reports.push({
      name: budget.name,
      key,
      files,
      totalGzip,
      budgetKb: budget.budgetKb,
      status: totalGzip / 1024 > budget.budgetKb ? "fail" : "ok",
    });
  }
  return reports;
}

/** `--chunk <name>=<kb>` overrides applied over the pinned table; an unknown name is a usage error. */
export function applyChunkOverrides(
  budgets: readonly ChunkBudget[],
  overrides: Record<string, number>,
): ChunkBudget[] {
  for (const name of Object.keys(overrides)) {
    if (!budgets.some((b) => b.name === name)) {
      throw new Error(
        `--chunk ${name}: no such chunk budget (known: ${budgets.map((b) => b.name).join(", ")})`,
      );
    }
  }
  return budgets.map((b) => {
    const kb = overrides[b.name];
    return kb === undefined ? b : { ...b, budgetKb: kb };
  });
}

export function chunksToMarkdown(reports: ChunkReport[]): string {
  const label = { ok: "OK", fail: "FAIL", missing: "MISSING" };
  const rows = reports
    .map(
      (r) =>
        `| \`${r.name}\` | ${r.key ? formatKb(r.totalGzip) : "—"} | ${r.budgetKb} KB | ${label[r.status]} |`,
    )
    .join("\n");
  return [
    "### Route chunk budgets (ADR 0022 §8)",
    "",
    "Gzipped JS + CSS each route adds over the initial load (static imports; fonts excluded).",
    "",
    "| Route | Gzip | Ceiling | Status |",
    "| ----- | ---- | ------- | ------ |",
    rows,
    "",
  ].join("\n");
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
  /** `--chunk <name>=<kb>`, by name. */
  chunkOverrides: Record<string, number>;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    manifest: DEFAULT_MANIFEST,
    dist: null,
    json: false,
    markdownOut: null,
    chunkOverrides: {},
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
      case "--chunk": {
        const spec = next();
        const eq = spec.indexOf("=");
        const name = eq === -1 ? "" : spec.slice(0, eq);
        const kb = Number(spec.slice(eq + 1));
        if (!name || !Number.isFinite(kb) || kb <= 0) {
          throw new Error(`--chunk expects <name>=<kb> with a positive number, got "${spec}"`);
        }
        options.chunkOverrides[name] = kb;
        break;
      }
      default:
        throw new Error(
          `Unknown option: ${arg}\nUsage: bun run check:bundle-budget [--manifest <path>] [--dist <dir>] [--json] [--markdown-out <file>] [--chunk <name>=<kb>]...`,
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
  chunkBudgets: readonly ChunkBudget[] = BUNDLE_CHUNK_BUDGETS,
): Promise<number> {
  const options = parseArgs(argv);
  const budgets = applyChunkOverrides(chunkBudgets, options.chunkOverrides);
  const manifestFile = Bun.file(options.manifest);
  if (!(await manifestFile.exists())) {
    out(SKIP_MESSAGE);
    if (options.markdownOut) await Bun.write(options.markdownOut, `${SKIP_MESSAGE}\n`);
    return ExitCode.Ok;
  }

  const manifest = (await manifestFile.json()) as Manifest;
  const leaks = findClickLoadedLeaks(manifest);
  if (leaks.length > 0) {
    const lines = leaks.map((leak) => `  ${leak}`).join("\n");
    const message = `Click-loaded chunks must load on click only (ADR 0023 §4, ADR 0028); statically imported by:\n${lines}`;
    out(message);
    if (options.markdownOut) await Bun.write(options.markdownOut, `${message}\n`);
    return ExitCode.Failure;
  }
  const dist = options.dist ?? distFromManifest(options.manifest);
  const files = await measureFiles(dist, collectInitialFiles(manifest));
  const report = buildReport(
    files,
    readThreshold("BUNDLE_WARN_KB", DEFAULT_WARN_KB, env),
    readThreshold("BUNDLE_BUDGET_KB", DEFAULT_BUDGET_KB, env),
  );
  const chunks = await measureChunks(manifest, dist, budgets);

  const markdown = chunks.length
    ? `${toMarkdown(report)}\n${chunksToMarkdown(chunks)}`
    : toMarkdown(report);
  if (options.markdownOut) await Bun.write(options.markdownOut, markdown);
  if (options.json) {
    out(JSON.stringify({ ...report, chunks }, null, 2));
  } else {
    out(markdown);
  }

  let failed = false;
  for (const chunk of chunks) {
    if (chunk.status === "missing") {
      out(
        `Chunk budget: FAIL — no chunk in the manifest matches \`${chunk.name}\`; re-pin the budget`,
      );
      failed = true;
    } else if (chunk.status === "fail") {
      out(
        `Chunk budget: FAIL — \`${chunk.name}\` is ${formatKb(chunk.totalGzip)} gzip, over its ${chunk.budgetKb} KB ceiling`,
      );
      failed = true;
    }
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
  return failed ? ExitCode.Failure : ExitCode.Ok;
}

if (import.meta.main) {
  try {
    process.exit(await run(process.argv.slice(2)));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(ExitCode.Usage);
  }
}
