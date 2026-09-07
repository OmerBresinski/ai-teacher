#!/usr/bin/env bun
// bun run land <pr-number> [--no-deploy] [--no-smoke] [--timeout-min <n>]
//
// Lands a reviewed pull request without making the main agent poll CI or deploys one turn at a
// time. It refuses to make review-thread decisions: resolve or explicitly defer those first.
//
// Every wait is bounded by --timeout-min (default 20) and every state change is logged with a
// timestamp, so a log read later says where the time went. The merge happens as soon as the
// required checks are green; a deploy that outlives the watch is reported in the summary (exit 1)
// rather than hiding the fact that the PR is already merged.

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
/** Wait between polls while a queued CI run has not yet been attached to the PR. */
const PENDING_CHECKS_DELAY_MS = 15_000;
/** Wait between reads of the required checks while at least one is still running. */
const CI_POLL_MS = 15_000;
const DEPLOY_POLL_MS = 15_000;
const NO_DEPLOYMENT_WAIT_MS = 90_000;
const DEFAULT_TIMEOUT_MIN = 20;
const MAX_REBASE_ROUNDS = 2;
/** Review-thread pages of 100 fetched before giving up. */
const MAX_THREAD_PAGES = 10;

export interface CommandResult {
  exitCode: number;
  stdout: string;
  /** Present for commands whose failure message matters (gh writes its errors here). */
  stderr?: string;
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
  ok: boolean;
  status: string;
}

export interface LandPrSummary {
  pr: number;
  mergedAs: string;
  ci: CheckSummary;
  vercel: CheckSummary;
  railway: Record<RailwayService, CheckSummary>;
  smoke: CheckSummary;
  /** False when the PR merged but a deploy did not finish in time; the statuses say which. */
  ok: boolean;
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
    const detail = `${result.stderr ?? ""}\n${result.stdout}`.trim();
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

/** The first Production row of `vercel ls`: its status and the deployment URL that identifies it. */
export function parseVercelProductionRow(
  tableText: string,
): { status: string; deployment: string | null } | null {
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

  const deploymentIndex = headers.indexOf("Deployment");
  for (const line of lines.slice(headerIndex + 1)) {
    const columns = line.split(/\s{2,}/);
    if (columns[environmentIndex] !== "Production") continue;
    const status = columns[statusIndex];
    if (status === undefined) return null;
    // The CLI prefixes the status with a coloured marker ("● Ready", "● Error"); keep the word.
    return {
      status: status.replace(/^[^A-Za-z]+/, "").trim(),
      deployment: deploymentIndex === -1 ? null : (columns[deploymentIndex] ?? null),
    };
  }
  return null;
}

/** Returns the first Production deployment status from Vercel's human-readable table. */
export function parseVercelProduction(tableText: string): string | null {
  return parseVercelProductionRow(tableText)?.status ?? null;
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

/** One row of `gh pr checks --json name,bucket,state`. */
interface RequiredCheck {
  name: string;
  /** gh's verdict: pass | fail | pending | skipping | cancel. */
  bucket: string;
  state: string;
}

/** Null when gh did not answer with a JSON array at all; the caller must not read that as green. */
export function parseRequiredChecks(json: string): RequiredCheck[] | null {
  const parsed = parseJson(json, "required checks");
  if (!Array.isArray(parsed)) return null;
  return parsed.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const check = row as { name?: unknown; bucket?: unknown; state?: unknown };
    return [
      {
        name: typeof check.name === "string" ? check.name : "unnamed check",
        bucket: typeof check.bucket === "string" ? check.bucket : "pending",
        state: typeof check.state === "string" ? check.state : "UNKNOWN",
      },
    ];
  });
}

export type CiVerdict =
  | { kind: "green" }
  | { kind: "pending"; names: string[] }
  | { kind: "failed"; detail: string };

/** gh buckets that satisfy branch protection; anything else keeps the wait going or fails it. */
const GREEN_BUCKETS = new Set(["pass", "skipping"]);
const FAILED_BUCKETS = new Set(["fail", "cancel"]);

/**
 * Reduce one read of the required checks to a verdict. gh's `--required` filter already dropped
 * the non-required Vercel contexts; `skipping` (a path-filtered job) satisfies branch protection.
 * `cancel` is final: on the head commit it means someone stopped the run, and a superseded run
 * lives on the previous commit, which gh never reads. Only a non-empty list in which every row is
 * green is green: an empty list or a bucket this script does not know is pending, never a merge.
 */
export function ciVerdict(checks: RequiredCheck[]): CiVerdict {
  const failed = checks.filter((check) => FAILED_BUCKETS.has(check.bucket));
  if (failed.length > 0) {
    return {
      kind: "failed",
      detail: failed.map((check) => `${check.name}: ${check.state}`).join("\n"),
    };
  }
  const pending = checks
    .filter((check) => !GREEN_BUCKETS.has(check.bucket))
    .map((check) => check.name);
  if (checks.length === 0 || pending.length > 0) return { kind: "pending", names: pending };
  return { kind: "green" };
}

/**
 * Wait for the checks branch protection requires — and only those. Vercel's preview check is not
 * required, and while the Hobby plan is rate-limited it fails within seconds of every push; with
 * it in the set, `--fail-fast` reported "CI failed" before a single required job had finished and
 * every landing fell back to a human watching `gh pr checks` (PRs #122–#125).
 *
 * This polls `gh pr checks --json` itself rather than delegating to `--watch`: the watch has no
 * timeout, logs nothing a later reader can date, and returns the moment the rollup holds no
 * pending row — including right after a push, when the queued run has not attached yet and gh
 * answers "no checks reported". Here every read is stamped, "no checks reported" counts as
 * pending, and the whole wait is bounded by the caller's deadline.
 */
async function waitForCi(pr: number, deadline: number, deps: LandPrDeps): Promise<void> {
  log.step(`Waiting for required CI checks on PR #${pr}`);
  let lastPending: string | null = null;
  while (true) {
    const read = await deps.gh([
      "pr",
      "checks",
      String(pr),
      "--required",
      "--json",
      "name,bucket,state",
    ]);
    const verdict = requiredChecksVerdict(read);
    if (verdict.kind === "green") {
      log.timed("all required checks passed");
      return;
    }
    if (verdict.kind === "failed") {
      throw new UserFacingError(`CI failed for PR #${pr}\n${verdict.detail}`);
    }
    const pending =
      verdict.names.length === 0 ? "(no checks attached yet)" : verdict.names.join(", ");
    if (pending !== lastPending) {
      log.timed(`waiting on: ${pending}`);
      lastPending = pending;
    }
    const remainingMs = deadline - deps.now();
    if (remainingMs <= 0) {
      throw new UserFacingError(
        `CI for PR #${pr} was still running at the deadline; still pending: ${pending}`,
      );
    }
    await deps.sleep(Math.min(CI_POLL_MS, remainingMs));
  }
}

function requiredChecksVerdict(read: CommandResult): CiVerdict {
  if (read.exitCode === ExitCode.Ok) {
    const checks = parseRequiredChecks(output(read));
    if (checks === null) {
      throw new UserFacingError(`gh pr checks did not return a JSON array:\n${output(read)}`);
    }
    return ciVerdict(checks);
  }
  const message = `${read.stderr ?? ""}\n${read.stdout}`;
  // Both come from gh's populateStatusChecks and mean the run has not attached to the PR yet.
  if (/no (required )?checks reported/.test(message)) return { kind: "pending", names: [] };
  throw new UserFacingError(`Could not read required checks.\n${message.trim()}`);
}

async function requireResolvedThreads(pr: number, deps: LandPrDeps): Promise<void> {
  const unresolved = await reviewThreadCount(pr, deps);
  if (unresolved > 0) {
    throw new UserFacingError(
      `PR #${pr} has ${unresolved} unresolved review thread(s); resolve them (or reply with the Tech debt ticket id) before landing.`,
    );
  }
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

/**
 * Rebase the PR's branch onto master and push. The worktree is put back on whatever it was on
 * before, whether the rebase succeeded or not: `land` is often run from a *different* branch (the
 * next piece of work), and a later `git rebase` typed there must not land on the PR's branch.
 * A rebase that stopped on conflicts is aborted before switching back, so the worktree is clean.
 */
async function rebaseBranch(state: PrState, deps: LandPrDeps): Promise<void> {
  const restore = await startingCheckout(state, deps);
  try {
    for (const args of [
      ["fetch", "origin"],
      ["checkout", state.headRefName],
      ["rebase", "origin/master"],
      ["push", "--force-with-lease"],
    ]) {
      const result = await deps.git(args);
      if (result.exitCode !== 0 && args[0] === "rebase") await deps.git(["rebase", "--abort"]);
      requireSuccess(result, `git ${args.join(" ")}`);
    }
  } finally {
    // Cleanup must never replace the error that brought us here: a failed restore is reported,
    // not thrown, so the rebase failure (if any) is the one the caller sees.
    if (restore) {
      const back = await deps
        .git(restore)
        .catch((): CommandResult => ({ exitCode: 1, stdout: "" }));
      if (back.exitCode !== 0) {
        log.warn(`Could not return to the starting checkout (git ${restore.join(" ")}).`);
      }
    }
  }
}

/**
 * The `git checkout` that puts the worktree back where it was, or null when it is already on the
 * PR's branch. A detached HEAD (`--show-current` prints nothing) is restored by commit.
 */
async function startingCheckout(state: PrState, deps: LandPrDeps): Promise<string[] | null> {
  const branch = await deps.git(["branch", "--show-current"]);
  requireSuccess(branch, "git branch --show-current");
  const name = output(branch).trim();
  if (name === state.headRefName) return null;
  if (name !== "") return ["checkout", name];
  const head = await deps.git(["rev-parse", "HEAD"]);
  requireSuccess(head, "git rev-parse HEAD");
  return ["checkout", "--detach", output(head).trim()];
}

/** One entry of `gh pr view --json statusCheckRollup`: a check run or a commit status context. */
interface StatusCheck {
  /** Check runs carry `name`; commit status contexts carry `context` instead. */
  name?: unknown;
  context?: unknown;
  conclusion?: unknown;
  status?: unknown;
  state?: unknown;
}

async function statusChecks(pr: number, deps: LandPrDeps): Promise<StatusCheck[]> {
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
  return Array.isArray(parsed)
    ? parsed.filter((check): check is StatusCheck => typeof check === "object" && check !== null)
    : [];
}

const FAILED_CONCLUSIONS = new Set([
  "FAILURE",
  "ERROR",
  "CANCELLED",
  "TIMED_OUT",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);

/**
 * True while a `BLOCKED` PR may still become mergeable on its own: nothing in the rollup has
 * failed. Right after a push GitHub reports `BLOCKED` with checks that are queued, that are
 * listed as a nameless placeholder, or that are simply absent while only Vercel's contexts have
 * arrived (observed on PRs #95 and #96) — `gh pr checks --watch` returns immediately in all three
 * cases. A rollup that is entirely green but still `BLOCKED` therefore means a required check has
 * not attached yet, and the caller waits (bounded by its deadline). A failed or errored check is
 * final and reported at once.
 */
export function hasPendingChecks(checks: StatusCheck[]): boolean {
  return !checks.some((check) => {
    const verdict =
      typeof check.conclusion === "string"
        ? check.conclusion
        : typeof check.state === "string"
          ? check.state
          : null;
    return verdict !== null && FAILED_CONCLUSIONS.has(verdict);
  });
}

function blockedMessage(pr: number, checks: StatusCheck[]): string {
  const details = checks.map((check) => {
    const name =
      typeof check.name === "string"
        ? check.name
        : typeof check.context === "string"
          ? check.context
          : "unnamed check";
    const state =
      typeof check.conclusion === "string"
        ? check.conclusion
        : typeof check.state === "string"
          ? check.state
          : typeof check.status === "string"
            ? check.status
            : "UNKNOWN";
    return `${name}: ${state}`;
  });
  return `PR #${pr} is blocked: a required check or review is still missing.${
    details.length === 0 ? "" : `\n${details.join("\n")}`
  }`;
}

interface PreMergeDeployments {
  railway: Record<RailwayService, string | null>;
  /** The Production deployment URL before the merge, so a new one can be told from the old. */
  vercel: string | null;
}

async function preMergeDeployments(deps: LandPrDeps): Promise<PreMergeDeployments> {
  const records = await Promise.all(
    RAILWAY_SERVICES.map(async (service) => {
      const result = await deps.railwayList(service);
      requireSuccess(result, `Could not read Railway ${service} deployments`);
      return [service, railwayDeployment(output(result)).id] as const;
    }),
  );
  const vercel = await deps.vercelLs();
  requireSuccess(vercel, "Could not read Vercel deployments");
  return {
    railway: Object.fromEntries(records) as Record<RailwayService, string | null>,
    vercel: parseVercelProductionRow(output(vercel))?.deployment ?? null,
  };
}

async function watchDeploys(
  preMerge: PreMergeDeployments,
  timeoutMin: number,
  deps: LandPrDeps,
): Promise<{ vercel: CheckSummary; railway: Record<RailwayService, CheckSummary> }> {
  const startedAt = deps.now();
  const preMergeIds = preMerge.railway;
  let vercel: CheckSummary | null = null;
  const railway: Partial<Record<RailwayService, CheckSummary>> = {};
  const seen: Record<string, string | null> = {};
  const note = (name: string, status: string | null): void => {
    if (seen[name] === status) return;
    seen[name] = status;
    log.timed(`${name}: ${status ?? "no deployment yet"}`);
  };

  const deployDeadline = startedAt + timeoutMin * 60_000;
  while (deps.now() <= deployDeadline) {
    if (vercel === null) {
      const result = await deps.vercelLs();
      requireSuccess(result, "Could not read Vercel deployments");
      const row = parseVercelProductionRow(output(result));
      note("vercel", row === null ? null : `${row.status} (${row.deployment ?? "?"})`);
      if (row?.status === "Error")
        throw new UserFacingError("Vercel Production deployment failed (Error).");
      if (row !== null && row.deployment !== null && row.deployment === preMerge.vercel) {
        // Nothing new after a merge to master means Vercel never started a build — the Hobby
        // plan's rate limit ("retry in 24 hours"). Waiting the full timeout would not change
        // that; report it and let the summary say the deploy is pending.
        if (deps.now() - startedAt >= NO_DEPLOYMENT_WAIT_MS) {
          vercel = { ok: true, status: "PENDING (no new deployment — rate limited?)" };
        }
      } else if (row?.status === "Canceled") {
        // The other face of the rate limit (seen 2026-09-07): Vercel *does* create a Production
        // deployment for the merge and cancels it after ~2 s. It is a new id, so the branch above
        // never fires, and `Canceled` is neither `Ready` nor `Error` — without this the watch
        // ran to its timeout on every land. The PR is merged and Railway is checked separately;
        // the web deploy catches up on the next successful build.
        vercel = { ok: true, status: "PENDING (Production deployment Canceled — rate limited?)" };
      } else if (row?.status === "Ready") {
        vercel = { ok: true, status: row.status };
      }
    }

    for (const service of RAILWAY_SERVICES) {
      if (railway[service] !== undefined) continue;
      const result = await deps.railwayList(service);
      requireSuccess(result, `Could not read Railway ${service} deployments`);
      const deployment = railwayDeployment(output(result));
      const elapsed = deps.now() - startedAt;
      const isNew = deployment.id !== preMergeIds[service];
      note(`railway ${service}`, isNew ? deployment.status : null);
      if (!isNew) {
        if (elapsed >= NO_DEPLOYMENT_WAIT_MS) {
          railway[service] = { ok: true, status: "SKIPPED (no new deployment)" };
        }
        continue;
      }
      if (deployment.status !== null && RAILWAY_DONE.has(deployment.status)) {
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
    const remainingMs = deployDeadline - deps.now();
    if (remainingMs <= 0) break;
    await deps.sleep(Math.min(DEPLOY_POLL_MS, remainingMs));
  }
  // The PR is already merged: a deploy that outlives the watch is reported, not thrown, so the
  // summary still names the merge commit and says exactly which deploy is unaccounted for.
  const timedOut = (name: string): CheckSummary => ({
    ok: false,
    status: `TIMED OUT after ${timeoutMin} min (last seen: ${seen[name] ?? "no deployment"})`,
  });
  return {
    vercel: vercel ?? timedOut("vercel"),
    railway: Object.fromEntries(
      RAILWAY_SERVICES.map((service) => [
        service,
        railway[service] ?? timedOut(`railway ${service}`),
      ]),
    ) as Record<RailwayService, CheckSummary>,
  };
}

/** Railway statuses that mean the deployment is live (or was correctly not rebuilt). */
const RAILWAY_DONE = new Set(["SUCCESS", "SKIPPED", "SLEEPING"]);

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
  const deadline = deps.now() + timeoutMin * 60_000;

  // Threads first: an unresolved thread is a decision for the caller, and finding out after a
  // six-minute CI wait wastes the wait. The check is repeated before the merge (cheap).
  await requireResolvedThreads(pr, deps);
  while (true) {
    await waitForCi(pr, deadline, deps);
    await requireResolvedThreads(pr, deps);

    state = await prState(pr, deps);
    log.timed(`merge state: ${state.mergeStateStatus}`);
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
      const checks = await statusChecks(pr, deps);
      if (!hasPendingChecks(checks)) throw new UserFacingError(blockedMessage(pr, checks));
      const remainingMs = deadline - deps.now();
      if (remainingMs <= 0) {
        throw new UserFacingError(
          `PR #${pr} still had pending checks after ${timeoutMin} min.\n${blockedMessage(pr, checks)}`,
        );
      }
      // Checks are queued but not yet attached to the PR, so `gh pr checks --watch` had nothing
      // to wait for. Give GitHub a moment (never past the deadline) and go round again.
      await deps.sleep(Math.min(PENDING_CHECKS_DELAY_MS, remainingMs));
      continue;
    }
    if (state.mergeStateStatus === "UNKNOWN") {
      const remainingMs = deadline - deps.now();
      if (unknownRetries >= UNKNOWN_RETRIES || remainingMs <= 0) {
        throw new UserFacingError(`GitHub did not compute a merge state for PR #${pr} in time.`);
      }
      unknownRetries += 1;
      await deps.sleep(Math.min(UNKNOWN_DELAY_MS, remainingMs));
      continue;
    }
    // UNSTABLE: a non-required check (Vercel's rate-limited preview) failed; the required set
    // passed in `waitForCi`, and GitHub allows the merge.
    if (state.mergeStateStatus !== "CLEAN" && state.mergeStateStatus !== "UNSTABLE") {
      throw new UserFacingError(`PR #${pr} cannot be merged: ${state.mergeStateStatus}.`);
    }
    break;
  }

  const preMerge: PreMergeDeployments = deploy
    ? await preMergeDeployments(deps)
    : { railway: { api: null, worker: null }, vercel: null };
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
    ? await watchDeploys(preMerge, timeoutMin, deps)
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
    ok:
      deployment.vercel.ok &&
      RAILWAY_SERVICES.every((service) => deployment.railway[service].ok) &&
      smoke.ok,
  };
}

export function formatLandPrSummary(summary: LandPrSummary): string {
  return [
    `land-pr: PR #${summary.pr} merged as ${summary.mergedAs}${summary.ok ? "" : " — a deploy did not finish in time"}`,
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
  return {
    exitCode: result.exitCode ?? ExitCode.Failure,
    stdout: result.stdout.toString(),
    stderr: result.stderr?.toString(),
  };
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
  return summary.ok ? ExitCode.Ok : ExitCode.Failure;
}

if (import.meta.main) await runMain(main);
