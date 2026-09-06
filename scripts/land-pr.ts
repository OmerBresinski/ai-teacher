#!/usr/bin/env bun
// bun run land <pr-number> [--no-deploy] [--no-smoke] [--timeout-min <n>]
//
// Lands a reviewed pull request without making the main agent poll CI or deploys one turn at a
// time. It refuses to make review-thread decisions: resolve or explicitly defer those first.

import { parseArgs } from "node:util";
import { $ } from "bun";
import { ExitCode, runMain, UserFacingError } from "./lib/exit";
import { log } from "./lib/log";
import { ROOT } from "./lib/paths";

const VERCEL_PROJECT = "teaching-journey-web";
const VERCEL_SCOPE = "omerbresinskis-projects";
const RAILWAY_PROJECT = "a79752e1-8bf5-41d0-b832-f1b64aaf6d2f";
const RAILWAY_SERVICES = ["api", "worker"] as const;
const UNKNOWN_RETRIES = 10;
const UNKNOWN_DELAY_MS = 6_000;
const DEPLOY_POLL_MS = 15_000;
const NO_DEPLOYMENT_WAIT_MS = 90_000;
const DEFAULT_TIMEOUT_MIN = 20;
const MAX_REBASE_ROUNDS = 2;
/** Review-thread pages of 100 fetched before giving up. */
const MAX_THREAD_PAGES = 10;

export interface CommandResult {
  exitCode: number;
  stdout: string;
}

export type RailwayService = (typeof RAILWAY_SERVICES)[number];

export interface LandPrDeps {
  gh(args: string[]): Promise<CommandResult>;
  git(args: string[]): Promise<CommandResult>;
  vercelLs(): Promise<CommandResult>;
  railwayList(service: RailwayService): Promise<CommandResult>;
  smoke(): Promise<CommandResult>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export interface LandPrOptions {
  deploy?: boolean;
  smoke?: boolean;
  timeoutMin?: number;
}

export interface CheckSummary {
  ok: true;
  status: string;
}

export interface LandPrSummary {
  pr: number;
  mergedAs: string;
  ci: CheckSummary;
  vercel: CheckSummary;
  railway: Record<RailwayService, CheckSummary>;
  smoke: CheckSummary;
  ok: true;
}

interface PrState {
  mergeStateStatus: string;
  headRefName: string;
  headRefOid: string;
  state: string;
  isDraft: boolean;
}

interface RailwayDeployment {
  id: string | null;
  status: string | null;
}

interface ParsedLandPrArgs {
  pr: number;
  options: Required<LandPrOptions>;
}

function output(result: CommandResult): string {
  return result.stdout.trim();
}

function requireSuccess(result: CommandResult, command: string): void {
  if (result.exitCode !== ExitCode.Ok) {
    const detail = output(result);
    throw new UserFacingError(`${command} failed.${detail === "" ? "" : `\n${detail}`}`);
  }
}

function parseJson(value: string, description: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new UserFacingError(`Could not parse ${description} from GitHub or Railway.`);
  }
}

export function unresolvedThreadCount(graphqlJson: unknown): number {
  const parsed =
    typeof graphqlJson === "string" ? parseJson(graphqlJson, "review threads") : graphqlJson;
  if (typeof parsed !== "object" || parsed === null) return 0;

  const nodes = (
    parsed as {
      data?: { repository?: { pullRequest?: { reviewThreads?: { nodes?: unknown[] } } } };
    }
  ).data?.repository?.pullRequest?.reviewThreads?.nodes;
  return Array.isArray(nodes)
    ? nodes.filter(
        (node) =>
          typeof node === "object" &&
          node !== null &&
          (node as { isResolved?: unknown }).isResolved === false,
      ).length
    : 0;
}

export function railwayDeploymentStatus(json: string): string | null {
  return railwayDeployment(json).status;
}

function railwayDeployment(json: string): RailwayDeployment {
  const parsed = parseJson(json, "Railway deployment") as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) return { id: null, status: null };
  const first = parsed[0];
  if (typeof first !== "object" || first === null) return { id: null, status: null };
  const deployment = first as { id?: unknown; status?: unknown };
  return {
    id: typeof deployment.id === "string" ? deployment.id : null,
    status: typeof deployment.status === "string" ? deployment.status : null,
  };
}

function stripAnsi(value: string): string {
  const escapeCharacter = String.fromCharCode(27);
  return value.replace(new RegExp(`${escapeCharacter}\\[[0-?]*[ -/]*[@-~]`, "g"), "");
}

/** Returns the first Production deployment status from Vercel's human-readable table. */
export function parseVercelProduction(tableText: string): string | null {
  const lines = stripAnsi(tableText)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const headerIndex = lines.findIndex(
    (line) => line.includes("Status") && line.includes("Environment"),
  );
  if (headerIndex === -1) return null;

  const header = lines[headerIndex];
  if (header === undefined) return null;
  const headers = header.split(/\s{2,}/);
  const environmentIndex = headers.indexOf("Environment");
  const statusIndex = headers.indexOf("Status");
  if (environmentIndex === -1 || statusIndex === -1) return null;

  for (const line of lines.slice(headerIndex + 1)) {
    const columns = line.split(/\s{2,}/);
    if (columns[environmentIndex] !== "Production") continue;
    const status = columns[statusIndex];
    // The CLI prefixes the status with a coloured marker ("● Ready", "● Error"); keep the word.
    return status === undefined ? null : status.replace(/^[^A-Za-z]+/, "").trim();
  }
  return null;
}

function parsePrState(json: string): PrState {
  const parsed = parseJson(json, "pull request state");
  if (typeof parsed !== "object" || parsed === null) {
    throw new UserFacingError("Could not parse pull request state from GitHub.");
  }
  const state = parsed as Partial<PrState>;
  if (
    typeof state.mergeStateStatus !== "string" ||
    typeof state.headRefName !== "string" ||
    typeof state.headRefOid !== "string" ||
    typeof state.state !== "string" ||
    typeof state.isDraft !== "boolean"
  ) {
    throw new UserFacingError("GitHub returned an incomplete pull request state.");
  }
  return state as PrState;
}

async function reviewThreadCount(pr: number, deps: LandPrDeps): Promise<number> {
  const repoResult = await deps.gh([
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "-q",
    ".nameWithOwner",
  ]);
  requireSuccess(repoResult, "Could not identify the GitHub repository");
  const [owner, name] = output(repoResult).split("/");
  if (owner === undefined || name === undefined) {
    throw new UserFacingError("Could not identify the GitHub repository.");
  }

  let unresolved = 0;
  let cursor: string | null = null;
  for (let page = 0; page < MAX_THREAD_PAGES; page++) {
    const after = cursor === null ? "" : `,after:"${cursor}"`;
    const query = `{repository(owner:"${owner}",name:"${name}"){pullRequest(number:${pr}){reviewThreads(first:100${after}){pageInfo{hasNextPage endCursor}nodes{id isResolved}}}}}`;
    const result = await deps.gh(["api", "graphql", "-f", `query=${query}`]);
    requireSuccess(result, "Could not read review threads");
    const json = output(result);
    unresolved += unresolvedThreadCount(json);
    const pageInfo = reviewThreadsPageInfo(json);
    if (!pageInfo.hasNextPage || pageInfo.endCursor === null) return unresolved;
    cursor = pageInfo.endCursor;
  }
  throw new UserFacingError(
    `PR #${pr} has more than ${MAX_THREAD_PAGES * 100} review threads; refusing to guess.`,
  );
}

export function reviewThreadsPageInfo(graphqlJson: unknown): {
  hasNextPage: boolean;
  endCursor: string | null;
} {
  const parsed =
    typeof graphqlJson === "string" ? parseJson(graphqlJson, "review threads") : graphqlJson;
  const pageInfo = (
    parsed as {
      data?: {
        repository?: {
          pullRequest?: {
            reviewThreads?: { pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } };
          };
        };
      };
    } | null
  )?.data?.repository?.pullRequest?.reviewThreads?.pageInfo;
  return {
    hasNextPage: pageInfo?.hasNextPage === true,
    endCursor: typeof pageInfo?.endCursor === "string" ? pageInfo.endCursor : null,
  };
}

async function waitForCi(pr: number, deps: LandPrDeps): Promise<void> {
  log.step(`Waiting for CI on PR #${pr}`);
  const watched = await deps.gh(["pr", "checks", String(pr), "--watch", "--fail-fast"]);
  if (watched.exitCode === ExitCode.Ok) return;

  const checks = await deps.gh(["pr", "checks", String(pr)]);
  const failingChecks = output(checks);
  throw new UserFacingError(
    `CI failed for PR #${pr}${failingChecks === "" ? "" : `\n${failingChecks}`}`,
  );
}

async function prState(pr: number, deps: LandPrDeps): Promise<PrState> {
  const result = await deps.gh([
    "pr",
    "view",
    String(pr),
    "--json",
    "mergeStateStatus,headRefName,headRefOid,state,isDraft",
    "-q",
    ".",
  ]);
  requireSuccess(result, `Could not read PR #${pr}`);
  return parsePrState(output(result));
}

async function rebaseBranch(state: PrState, deps: LandPrDeps): Promise<void> {
  for (const args of [
    ["fetch", "origin"],
    ["checkout", state.headRefName],
    ["rebase", "origin/master"],
    ["push", "--force-with-lease"],
  ]) {
    const result = await deps.git(args);
    requireSuccess(result, `git ${args.join(" ")}`);
  }
}

async function blockedMessage(pr: number, deps: LandPrDeps): Promise<string> {
  const result = await deps.gh([
    "pr",
    "view",
    String(pr),
    "--json",
    "statusCheckRollup",
    "-q",
    ".statusCheckRollup",
  ]);
  requireSuccess(result, `Could not read status checks for PR #${pr}`);
  const parsed = parseJson(output(result), "status checks");
  const checks = Array.isArray(parsed) ? parsed : [];
  const details = checks
    .filter(
      (check): check is { name?: unknown; conclusion?: unknown; status?: unknown } =>
        typeof check === "object" && check !== null,
    )
    .map((check) => {
      const name = typeof check.name === "string" ? check.name : "unnamed check";
      const state =
        typeof check.conclusion === "string"
          ? check.conclusion
          : typeof check.status === "string"
            ? check.status
            : "UNKNOWN";
      return `${name}: ${state}`;
    });
  return `PR #${pr} is blocked: a required check or review is still missing.${
    details.length === 0 ? "" : `\n${details.join("\n")}`
  }`;
}

async function preMergeDeployments(
  deps: LandPrDeps,
): Promise<Record<RailwayService, string | null>> {
  const records = await Promise.all(
    RAILWAY_SERVICES.map(async (service) => {
      const result = await deps.railwayList(service);
      requireSuccess(result, `Could not read Railway ${service} deployments`);
      return [service, railwayDeployment(output(result)).id] as const;
    }),
  );
  return Object.fromEntries(records) as Record<RailwayService, string | null>;
}

async function watchDeploys(
  preMergeIds: Record<RailwayService, string | null>,
  timeoutMin: number,
  deps: LandPrDeps,
): Promise<{ vercel: CheckSummary; railway: Record<RailwayService, CheckSummary> }> {
  const startedAt = deps.now();
  let vercel: CheckSummary | null = null;
  const railway: Partial<Record<RailwayService, CheckSummary>> = {};

  while (deps.now() - startedAt <= timeoutMin * 60_000) {
    if (vercel === null) {
      const result = await deps.vercelLs();
      requireSuccess(result, "Could not read Vercel deployments");
      const status = parseVercelProduction(output(result));
      if (status === "Error")
        throw new UserFacingError("Vercel Production deployment failed (Error).");
      if (status === "Ready") vercel = { ok: true, status };
    }

    for (const service of RAILWAY_SERVICES) {
      if (railway[service] !== undefined) continue;
      const result = await deps.railwayList(service);
      requireSuccess(result, `Could not read Railway ${service} deployments`);
      const deployment = railwayDeployment(output(result));
      const elapsed = deps.now() - startedAt;
      if (deployment.id === preMergeIds[service]) {
        if (elapsed >= NO_DEPLOYMENT_WAIT_MS) {
          railway[service] = { ok: true, status: "SKIPPED (no new deployment)" };
        }
        continue;
      }
      if (deployment.status === "SUCCESS" || deployment.status === "SKIPPED") {
        railway[service] = { ok: true, status: deployment.status };
      } else if (deployment.status === "FAILED" || deployment.status === "CRASHED") {
        throw new UserFacingError(
          `Railway ${service} deployment ${deployment.status}.\nrailway logs -p ${RAILWAY_PROJECT} -e production -s ${service} --build`,
        );
      }
    }

    if (vercel !== null && RAILWAY_SERVICES.every((service) => railway[service] !== undefined)) {
      return {
        vercel,
        railway: railway as Record<RailwayService, CheckSummary>,
      };
    }
    await deps.sleep(DEPLOY_POLL_MS);
  }
  throw new UserFacingError(
    `Timed out waiting for production deploys after ${timeoutMin} minute(s).`,
  );
}

export async function landPr(
  pr: number,
  options: LandPrOptions,
  deps: LandPrDeps,
): Promise<LandPrSummary> {
  const deploy = options.deploy ?? true;
  const runSmoke = options.smoke ?? true;
  const timeoutMin = options.timeoutMin ?? DEFAULT_TIMEOUT_MIN;
  let rebaseRounds = 0;
  let unknownRetries = 0;
  let state: PrState;

  while (true) {
    await waitForCi(pr, deps);
    const unresolved = await reviewThreadCount(pr, deps);
    if (unresolved > 0) {
      throw new UserFacingError(
        `PR #${pr} has ${unresolved} unresolved review thread(s); resolve them (or reply with the Tech debt ticket id) before landing.`,
      );
    }

    state = await prState(pr, deps);
    if (state.state !== "OPEN") throw new UserFacingError(`PR #${pr} is ${state.state}, not open.`);
    if (state.isDraft) throw new UserFacingError(`PR #${pr} is a draft and cannot be landed.`);
    if (state.mergeStateStatus === "BEHIND") {
      if (rebaseRounds >= MAX_REBASE_ROUNDS) {
        throw new UserFacingError(
          `PR #${pr} remained BEHIND after ${MAX_REBASE_ROUNDS} rebase rounds.`,
        );
      }
      rebaseRounds += 1;
      log.step(`Rebasing ${state.headRefName} onto origin/master`);
      await rebaseBranch(state, deps);
      continue;
    }
    if (state.mergeStateStatus === "DIRTY") {
      throw new UserFacingError(`PR #${pr} has merge conflicts.`);
    }
    if (state.mergeStateStatus === "BLOCKED") {
      throw new UserFacingError(await blockedMessage(pr, deps));
    }
    if (state.mergeStateStatus === "UNKNOWN") {
      if (unknownRetries >= UNKNOWN_RETRIES) {
        throw new UserFacingError(`GitHub did not compute a merge state for PR #${pr} in time.`);
      }
      unknownRetries += 1;
      await deps.sleep(UNKNOWN_DELAY_MS);
      continue;
    }
    if (state.mergeStateStatus !== "CLEAN") {
      throw new UserFacingError(`PR #${pr} cannot be merged: ${state.mergeStateStatus}.`);
    }
    break;
  }

  const preMergeIds = deploy
    ? await preMergeDeployments(deps)
    : ({ api: null, worker: null } satisfies Record<RailwayService, string | null>);
  log.step(`Squash-merging PR #${pr}`);
  requireSuccess(
    await deps.gh(["pr", "merge", String(pr), "--squash", "--delete-branch"]),
    "Merge",
  );
  const mergeCommit = await deps.gh([
    "pr",
    "view",
    String(pr),
    "--json",
    "mergeCommit",
    "-q",
    ".mergeCommit.oid",
  ]);
  requireSuccess(mergeCommit, `Could not read the merge commit for PR #${pr}`);
  const mergedAs = output(mergeCommit);
  if (mergedAs === "")
    throw new UserFacingError(`GitHub did not return a merge commit for PR #${pr}.`);

  const deployment = deploy
    ? await watchDeploys(preMergeIds, timeoutMin, deps)
    : {
        vercel: { ok: true, status: "skipped" } as CheckSummary,
        railway: {
          api: { ok: true, status: "skipped" } as CheckSummary,
          worker: { ok: true, status: "skipped" } as CheckSummary,
        } as Record<RailwayService, CheckSummary>,
      };
  let smoke: CheckSummary = { ok: true, status: "skipped" };
  if (runSmoke) {
    log.step("Running production smoke check");
    requireSuccess(await deps.smoke(), "Production smoke check");
    smoke = { ok: true, status: "passed" };
  }

  return {
    pr,
    mergedAs,
    ci: { ok: true, status: "passed" },
    vercel: deployment.vercel,
    railway: deployment.railway,
    smoke,
    ok: true,
  };
}

export function formatLandPrSummary(summary: LandPrSummary): string {
  return [
    `land-pr: PR #${summary.pr} merged as ${summary.mergedAs}`,
    `  ci: ${summary.ci.status}`,
    `  vercel: ${summary.vercel.status}`,
    `  railway api: ${summary.railway.api.status}`,
    `  railway worker: ${summary.railway.worker.status}`,
    `  smoke: ${summary.smoke.status}`,
  ].join("\n");
}

export function parseLandPrArgs(argv: string[]): ParsedLandPrArgs {
  let values: { "no-deploy"?: boolean; "no-smoke"?: boolean; "timeout-min"?: string };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        "no-deploy": { type: "boolean", default: false },
        "no-smoke": { type: "boolean", default: false },
        "timeout-min": { type: "string", default: String(DEFAULT_TIMEOUT_MIN) },
      },
    }));
  } catch (error) {
    throw new UserFacingError(
      `${error instanceof Error ? error.message : String(error)}\nUsage: bun run land <pr-number> [--no-deploy] [--no-smoke] [--timeout-min <n>]`,
      ExitCode.Usage,
    );
  }

  const prValue = positionals[0];
  const pr = Number(prValue);
  const timeoutMin = Number(values["timeout-min"]);
  if (
    positionals.length !== 1 ||
    !Number.isSafeInteger(pr) ||
    pr <= 0 ||
    !Number.isFinite(timeoutMin) ||
    timeoutMin <= 0
  ) {
    throw new UserFacingError(
      "Usage: bun run land <pr-number> [--no-deploy] [--no-smoke] [--timeout-min <n>]",
      ExitCode.Usage,
    );
  }
  return {
    pr,
    options: { deploy: !values["no-deploy"], smoke: !values["no-smoke"], timeoutMin },
  };
}

function shellResult(result: {
  exitCode: number | undefined;
  stdout: Uint8Array;
  stderr?: Uint8Array;
}): CommandResult {
  return { exitCode: result.exitCode ?? ExitCode.Failure, stdout: result.stdout.toString() };
}

/** `vercel ls` writes its deployment table to stderr; return both streams as one text. */
function shellResultWithStderr(result: {
  exitCode: number | undefined;
  stdout: Uint8Array;
  stderr: Uint8Array;
}): CommandResult {
  return {
    exitCode: result.exitCode ?? ExitCode.Failure,
    stdout: `${result.stdout.toString()}\n${result.stderr.toString()}`,
  };
}

function realDeps(): LandPrDeps {
  return {
    gh: async (args) => shellResult(await $`gh ${args}`.cwd(ROOT).quiet().nothrow()),
    git: async (args) => shellResult(await $`git ${args}`.cwd(ROOT).quiet().nothrow()),
    vercelLs: async () =>
      shellResultWithStderr(
        await $`vercel ls ${VERCEL_PROJECT} --scope ${VERCEL_SCOPE}`.cwd(ROOT).quiet().nothrow(),
      ),
    railwayList: async (service) =>
      shellResult(
        await $`railway deployment list -p ${RAILWAY_PROJECT} -e production -s ${service} --json`
          .cwd(ROOT)
          .quiet()
          .nothrow(),
      ),
    smoke: async () => shellResult(await $`bun run smoke:prod`.cwd(ROOT).quiet().nothrow()),
    sleep: (ms) => Bun.sleep(ms),
    now: () => Date.now(),
  };
}

async function main(): Promise<number> {
  const { pr, options } = parseLandPrArgs(process.argv.slice(2));
  const summary = await landPr(pr, options, realDeps());
  console.log(formatLandPrSummary(summary));
  return ExitCode.Ok;
}

if (import.meta.main) await runMain(main);
