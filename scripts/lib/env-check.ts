/**
 * Pure pieces of `bun run env:check`: parse provider CLI output into variable NAMES, compare them
 * with `infra/env.contract.ts` and render fix commands with placeholders. Values that the CLIs
 * return are discarded at the parsing boundary and never reach a report string.
 */
import {
  type EnvVar,
  envVar,
  type RailwayEnvironment,
  railwayNames,
  type VercelEnvironment,
  vercelNames,
} from "../../infra/env.contract";

export type ProviderName = "railway" | "vercel";

export interface Target {
  provider: ProviderName;
  /** `api` / `worker` for Railway; the Vercel project for Vercel. */
  service: string;
  /** `production`, `pr-<n>` (Railway) or `production` / `preview` (Vercel). */
  environment: string;
  expected: string[];
}

export interface TargetReport extends Target {
  /** Names the contract expects that the provider does not have. */
  missing: string[];
  /** Names the provider has that the contract does not list for this target. */
  extra: string[];
}

/** Which Railway variables are the platform's own and never in the contract. */
const RAILWAY_BUILTIN_RE = /^RAILWAY_/;

/** `railway variable list --json` prints `{ "NAME": "value", ... }` — keep the keys only. */
export function parseRailwayVariablesJson(text: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  return Object.keys(parsed)
    .filter((k) => !RAILWAY_BUILTIN_RE.test(k))
    .sort();
}

/**
 * Why a Railway target could not be read, as one plain sentence — or `null` when the output looks
 * like a real variable listing. Exit codes are unreliable (the CLI exits 0 for "not linked").
 */
export function railwayUnavailableReason(
  cliPresent: boolean,
  stdout: string,
  stderr: string,
  exitCode: number,
): string | null {
  if (!cliPresent) return "Railway: `railway` CLI not installed — skipping (see infra/README.md)";
  const combined = `${stdout}\n${stderr}`;
  if (/no linked project|railway link/i.test(combined)) {
    return "Railway: not linked — skipping (see infra/README.md)";
  }
  if (
    /not logged in|unauthorized|login/i.test(combined) &&
    parseRailwayVariablesJson(stdout) === null
  ) {
    return "Railway: not logged in — skipping (`railway login`, see infra/README.md)";
  }
  if (/project not found|no project|could not find/i.test(combined)) {
    return "Railway: no project — skipping (run infra/railway/provision.sh, see infra/README.md)";
  }
  if (/service .* not found|environment .* not found|not found/i.test(combined) && exitCode !== 0) {
    return "Railway: service or environment not found — skipping (see infra/README.md)";
  }
  if (parseRailwayVariablesJson(stdout) === null) {
    return `Railway: unreadable CLI output (exit ${exitCode}) — skipping (see infra/README.md)`;
  }
  return null;
}

/** `vercel env ls <env> --json` prints `{ envs: [{ key, target: [...] , ... }] }`. */
export function parseVercelEnvJson(text: string, environment: VercelEnvironment): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const envs = (parsed as { envs?: unknown })?.envs;
  if (!Array.isArray(envs)) return null;
  const names = new Set<string>();
  for (const e of envs) {
    if (typeof e !== "object" || e === null) continue;
    const { key, target } = e as { key?: unknown; target?: unknown };
    if (typeof key !== "string") continue;
    const targets = Array.isArray(target)
      ? target.map(String)
      : typeof target === "string"
        ? [target]
        : [];
    if (targets.length === 0 || targets.includes(environment)) names.add(key);
  }
  return [...names].sort();
}

/**
 * Fallback for a CLI without `--json`: the human table
 *
 *   name          value        type    environments    created
 *   VITE_APP_ENV  eyJ2IjoidjI… Config  Preview         43m ago
 *
 * Only the first column is kept; the rest (which includes a value prefix) is discarded.
 */
export function parseVercelEnvTable(text: string, environment?: VercelEnvironment): string[] {
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((l) => /^\s*name\s+value\s+/i.test(l));
  if (headerIndex === -1) return [];
  const names: string[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const cells = line.trim().split(/\s{2,}/);
    const name = cells[0];
    if (!name || !/^[A-Z_][A-Z0-9_]*$/.test(name)) continue;
    if (environment) {
      const envCell = cells.find((c) => /production|preview|development/i.test(c)) ?? "";
      if (!envCell.toLowerCase().includes(environment)) continue;
    }
    names.push(name);
  }
  return [...new Set(names)].sort();
}

/** Contract-derived targets for one run. */
export function buildTargets(options: { pr?: number }): Target[] {
  const railwayEnvs: { name: string; kind: RailwayEnvironment }[] = [
    { name: "production", kind: "production" },
  ];
  if (options.pr !== undefined) railwayEnvs.push({ name: `pr-${options.pr}`, kind: "pr" });
  const targets: Target[] = [];
  for (const service of ["api", "worker"] as const) {
    for (const env of railwayEnvs) {
      targets.push({
        provider: "railway",
        service,
        environment: env.name,
        expected: railwayNames(service, env.kind),
      });
    }
  }
  for (const environment of ["production", "preview"] as const satisfies VercelEnvironment[]) {
    targets.push({
      provider: "vercel",
      service: "teaching-journey-web",
      environment,
      expected: vercelNames(environment),
    });
  }
  return targets;
}

/** Names only in, names only out. */
export function compareNames(target: Target, actual: string[]): TargetReport {
  const have = new Set(actual);
  const want = new Set(target.expected);
  return {
    ...target,
    missing: target.expected.filter((n) => !have.has(n)),
    extra: actual.filter((n) => !want.has(n)).sort(),
  };
}

function placeholder(v: EnvVar | undefined): string {
  if (!v) return "<value>";
  if (v.scope === "secret") return "<secret>";
  if (v.railwayValue) return v.railwayValue;
  if (v.format === "enum" && v.values?.[0]) return `<${v.values.join("|")}>`;
  return "<value>";
}

/** Exact commands (placeholders, never values) that would add every missing name. */
export function fixCommands(report: TargetReport): string[] {
  const out: string[] = [];
  for (const name of report.missing) {
    const v = envVar(name);
    if (report.provider === "railway") {
      const envFlag =
        report.environment === "production" ? "" : ` --environment ${report.environment}`;
      if (v?.scope === "secret") {
        out.push(
          `railway variable set ${name} --stdin --service ${report.service}${envFlag} --skip-deploys  < /path/to/secret`,
        );
      } else {
        out.push(
          `railway variable set --service ${report.service}${envFlag} --skip-deploys '${name}=${placeholder(v)}'`,
        );
      }
    } else {
      const sensitive = v?.scope === "secret" ? " --sensitive" : "";
      out.push(
        `vercel env add ${name} ${report.environment}${sensitive}   # then paste ${placeholder(v)}`,
      );
    }
  }
  for (const name of report.extra) {
    out.push(
      report.provider === "railway"
        ? `# not in the contract: railway variable delete ${name} --service ${report.service} --environment ${report.environment}   (or add it to infra/env.contract.ts)`
        : `# not in the contract: vercel env rm ${name} ${report.environment}   (or add it to infra/env.contract.ts)`,
    );
  }
  return out;
}

/** One report block; contains names only. */
export function formatReport(report: TargetReport, fix: boolean): string[] {
  const label = `${report.provider === "railway" ? "Railway" : "Vercel"} ${report.service} / ${report.environment}`;
  const lines: string[] = [];
  if (report.missing.length === 0 && report.extra.length === 0) {
    lines.push(`ok    ${label}: ${report.expected.length} expected name(s) present, none extra`);
    return lines;
  }
  lines.push(`DRIFT ${label}`);
  if (report.missing.length > 0) lines.push(`      missing: ${report.missing.join(", ")}`);
  if (report.extra.length > 0) lines.push(`      extra:   ${report.extra.join(", ")}`);
  if (fix) for (const cmd of fixCommands(report)) lines.push(`      ${cmd}`);
  return lines;
}
