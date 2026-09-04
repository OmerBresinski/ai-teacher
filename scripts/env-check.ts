#!/usr/bin/env bun
// bun run env:check [--pr <n>] [--fix] [--strict]
//
// Compares the variable NAMES present on the providers with `infra/env.contract.ts`:
//   - Railway: `railway variable list --json --service api|worker [--environment pr-<n>]`
//   - Vercel:  `vercel env ls production|preview --json` (falls back to parsing the table)
// Values returned by the CLIs are dropped at the parsing boundary; nothing here prints one.
//
// A provider that is unreachable (CLI missing, `railway` not linked / no project, `vercel` not
// linked) is reported in one sentence and skipped. Exit 1 when any reachable target drifts;
// `--strict` also fails on skipped targets. `--fix` prints the commands (with placeholders) that
// would reconcile each target — it never executes them.

import { $ } from "bun";
import {
  buildTargets,
  compareNames,
  formatReport,
  parseRailwayVariablesJson,
  parseVercelEnvJson,
  parseVercelEnvTable,
  railwayUnavailableReason,
  type Target,
  type TargetReport,
} from "./lib/env-check";
import { ExitCode, runMain, UserFacingError } from "./lib/exit";
import { colour } from "./lib/log";
import { ROOT } from "./lib/paths";

interface Options {
  pr?: number;
  fix: boolean;
  strict: boolean;
}

export function parseArgs(argv: string[]): Options {
  const options: Options = { fix: false, strict: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fix") options.fix = true;
    else if (arg === "--strict") options.strict = true;
    else if (arg === "--pr") {
      const value = argv[i + 1];
      if (!value || !/^\d+$/.test(value)) {
        throw new UserFacingError("--pr needs a pull request number", ExitCode.Usage);
      }
      options.pr = Number(value);
      i += 1;
    } else {
      throw new UserFacingError(
        `Unknown option: ${arg}\nUsage: bun run env:check [--pr <n>] [--fix] [--strict]`,
        ExitCode.Usage,
      );
    }
  }
  return options;
}

type Outcome = { kind: "report"; report: TargetReport } | { kind: "skipped"; reason: string };

async function readRailway(target: Target): Promise<Outcome> {
  const cliPresent = Bun.which("railway") !== null;
  if (!cliPresent) {
    return { kind: "skipped", reason: railwayUnavailableReason(false, "", "", 0) ?? "" };
  }
  const envArgs = target.environment === "production" ? [] : ["--environment", target.environment];
  const result = await $`railway variable list --json --service ${target.service} ${envArgs}`
    .cwd(ROOT)
    .quiet()
    .nothrow();
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  const reason = railwayUnavailableReason(true, stdout, stderr, result.exitCode);
  if (reason) return { kind: "skipped", reason };
  const names = parseRailwayVariablesJson(stdout) ?? [];
  return { kind: "report", report: compareNames(target, names) };
}

async function readVercel(target: Target): Promise<Outcome> {
  if (Bun.which("vercel") === null) {
    return {
      kind: "skipped",
      reason: "Vercel: `vercel` CLI not installed — skipping (see infra/README.md)",
    };
  }
  const environment = target.environment as "production" | "preview";
  const json = await $`vercel env ls ${environment} --json`.cwd(ROOT).quiet().nothrow();
  const jsonOut = json.stdout.toString();
  const jsonErr = json.stderr.toString();
  if (
    /not linked|vercel link|No project|Please run/i.test(`${jsonOut}\n${jsonErr}`) &&
    json.exitCode !== 0
  ) {
    return {
      kind: "skipped",
      reason:
        "Vercel: project not linked — skipping (`vercel link --yes --project teaching-journey-web`, see infra/README.md)",
    };
  }
  if (/not authorized|login|credentials/i.test(jsonErr) && json.exitCode !== 0) {
    return { kind: "skipped", reason: "Vercel: not logged in — skipping (`vercel login`)" };
  }
  let names = json.exitCode === 0 ? parseVercelEnvJson(jsonOut, environment) : null;
  if (names === null) {
    // Older CLI without --json: parse the table (names column only).
    const table = await $`vercel env ls ${environment}`.cwd(ROOT).quiet().nothrow();
    if (table.exitCode !== 0) {
      return {
        kind: "skipped",
        reason: `Vercel: \`vercel env ls\` failed (exit ${table.exitCode}) — skipping`,
      };
    }
    names = parseVercelEnvTable(table.stdout.toString(), environment);
  }
  return { kind: "report", report: compareNames(target, names) };
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  console.log(colour.bold("env:check — provider variable names vs infra/env.contract.ts"));
  console.log(colour.dim("names only; values are never read into this output\n"));

  let drift = 0;
  let skipped = 0;
  for (const target of buildTargets(options)) {
    const outcome =
      target.provider === "railway" ? await readRailway(target) : await readVercel(target);
    if (outcome.kind === "skipped") {
      skipped += 1;
      console.log(`skip  ${outcome.reason} [${target.service} / ${target.environment}]`);
      continue;
    }
    const lines = formatReport(outcome.report, options.fix);
    if (outcome.report.missing.length > 0 || outcome.report.extra.length > 0) drift += 1;
    for (const line of lines) console.log(line.startsWith("DRIFT") ? colour.red(line) : line);
  }

  console.log("");
  if (drift > 0) {
    console.error(
      colour.red(colour.bold(`env:check: ${drift} target(s) drift from the contract.`)),
    );
    if (!options.fix)
      console.error("Re-run with --fix to print the reconciling commands (placeholders only).");
    return ExitCode.Failure;
  }
  if (skipped > 0 && options.strict) {
    console.error(
      colour.red(colour.bold(`env:check --strict: ${skipped} target(s) could not be read.`)),
    );
    return ExitCode.Failure;
  }
  console.log(
    colour.green(
      colour.bold(`env:check: no drift${skipped > 0 ? ` (${skipped} target(s) skipped)` : ""}.`),
    ),
  );
  return ExitCode.Ok;
}

if (import.meta.main) await runMain(main);
