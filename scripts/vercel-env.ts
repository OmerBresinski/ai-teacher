#!/usr/bin/env bun
/**
 * Vercel build-time environment for `apps/web` (TEACH-25, ADR 0010).
 *
 * Vercel builds every branch with the *Preview* environment's variables, but the API a preview
 * should talk to is the Railway PR environment for the same pull request (`pr-<number>`). That
 * URL is only known at build time (`VERCEL_GIT_PULL_REQUEST_ID`), so this script resolves
 * `VITE_API_URL` / `VITE_APP_ENV` and either
 *
 *   bun scripts/vercel-env.ts print                 # prints `export VAR=value` lines
 *   bun scripts/vercel-env.ts exec <command...>     # runs <command> with the resolved vars set
 *
 * (Subcommands rather than `--`: Bun strips the first `--` from `process.argv`.)
 *
 * Resolution (pure, see `resolveWebEnv`):
 *   - `VERCEL_ENV=production`  → `VITE_APP_ENV=production`, `VITE_API_URL` must already be set
 *     (the project's Production variable — `https://api.<domain>`).
 *   - otherwise (preview/development) → `VITE_APP_ENV=preview`; `VITE_API_URL` =
 *       1. `VITE_API_URL` when the Preview scope sets one explicitly (manual override), else
 *       2. `RAILWAY_PR_API_URL_TEMPLATE` with `{pr}` replaced by the PR number, when both exist, else
 *       3. `VITE_API_URL_FALLBACK` (a long-lived staging/production API), else
 *       4. error — a production build refuses a relative `VITE_API_URL` (apps/web/src/env.ts).
 *
 * The Railway pattern is *not* hard-coded: infra/README.md marks it "confirm after the first PR
 * deploy", so it lives in the Preview variable `RAILWAY_PR_API_URL_TEMPLATE`
 * (e.g. `https://api-pr-{pr}.up.railway.app`). Nothing here is a secret.
 *
 * Only `VITE_*` variables reach the bundle; turbo.json lists them under `@tj/web#build.env` so
 * the remote cache key changes with them.
 */

import { ExitCode, runMain, UserFacingError } from "./lib/exit";

export interface VercelBuildInputs {
  /** `production` | `preview` | `development` — set by Vercel on every build. */
  VERCEL_ENV?: string;
  /** Pull request number as a string, set by Vercel for PR builds only. */
  VERCEL_GIT_PULL_REQUEST_ID?: string;
  /** Explicit API origin (Production variable, or a Preview override). */
  VITE_API_URL?: string;
  /** `https://api-pr-{pr}.up.railway.app` — `{pr}` is replaced by the PR number. */
  RAILWAY_PR_API_URL_TEMPLATE?: string;
  /** Used for previews without a PR number (branch pushes) or without a template. */
  VITE_API_URL_FALLBACK?: string;
}

export interface ResolvedWebEnv {
  VITE_APP_ENV: "preview" | "production";
  VITE_API_URL: string;
  /** Which rule produced `VITE_API_URL` (for the build log). */
  source: "explicit" | "railway-pr-template" | "fallback";
}

const PR_PLACEHOLDER = "{pr}";

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** `https://api-pr-{pr}.up.railway.app` + `"42"` → `https://api-pr-42.up.railway.app`. */
export function railwayPrApiUrl(template: string, prNumber: string): string {
  if (!template.includes(PR_PLACEHOLDER)) {
    throw new UserFacingError(
      `RAILWAY_PR_API_URL_TEMPLATE must contain "${PR_PLACEHOLDER}" (got "${template}").`,
    );
  }
  if (!/^\d+$/.test(prNumber)) {
    throw new UserFacingError(`VERCEL_GIT_PULL_REQUEST_ID must be a number (got "${prNumber}").`);
  }
  const url = template.replaceAll(PR_PLACEHOLDER, prNumber);
  if (!isAbsoluteHttpUrl(url)) {
    throw new UserFacingError(`RAILWAY_PR_API_URL_TEMPLATE does not produce a URL: "${url}".`);
  }
  return url;
}

/** Pure resolution of the web build env from Vercel's system variables + project variables. */
export function resolveWebEnv(input: VercelBuildInputs): ResolvedWebEnv {
  const explicit = nonEmpty(input.VITE_API_URL);
  const vercelEnv = nonEmpty(input.VERCEL_ENV) ?? "preview";

  if (vercelEnv === "production") {
    if (!explicit || !isAbsoluteHttpUrl(explicit)) {
      throw new UserFacingError(
        "Production build: set VITE_API_URL (absolute https URL of the API) in the Vercel " +
          `project's Production environment (got "${explicit ?? ""}").`,
      );
    }
    return { VITE_APP_ENV: "production", VITE_API_URL: explicit, source: "explicit" };
  }

  if (explicit) {
    if (!isAbsoluteHttpUrl(explicit)) {
      throw new UserFacingError(
        `Preview build: VITE_API_URL must be an absolute http(s) URL (got "${explicit}"). ` +
          "Unset it to derive the Railway PR URL, or set VITE_API_URL_FALLBACK.",
      );
    }
    return { VITE_APP_ENV: "preview", VITE_API_URL: explicit, source: "explicit" };
  }

  const template = nonEmpty(input.RAILWAY_PR_API_URL_TEMPLATE);
  const pr = nonEmpty(input.VERCEL_GIT_PULL_REQUEST_ID);
  if (template && pr) {
    return {
      VITE_APP_ENV: "preview",
      VITE_API_URL: railwayPrApiUrl(template, pr),
      source: "railway-pr-template",
    };
  }

  const fallback = nonEmpty(input.VITE_API_URL_FALLBACK);
  if (fallback && isAbsoluteHttpUrl(fallback)) {
    return { VITE_APP_ENV: "preview", VITE_API_URL: fallback, source: "fallback" };
  }

  throw new UserFacingError(
    "Preview build: no API origin. Set RAILWAY_PR_API_URL_TEMPLATE (with {pr}) and build from a " +
      "pull request, or set VITE_API_URL_FALLBACK / VITE_API_URL in the Vercel Preview environment.",
  );
}

/** POSIX single-quote so the value is safe to `eval` (`'` → `'\''`). */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function toExportLines(env: ResolvedWebEnv): string {
  return [
    `export VITE_APP_ENV=${shellQuote(env.VITE_APP_ENV)}`,
    `export VITE_API_URL=${shellQuote(env.VITE_API_URL)}`,
  ].join("\n");
}

const USAGE = "usage: bun scripts/vercel-env.ts print | exec <command...>";

async function main(): Promise<number> {
  const [subcommand = "print", ...command] = process.argv.slice(2);
  const resolved = resolveWebEnv(process.env as VercelBuildInputs);

  if (subcommand === "print" && command.length === 0) {
    console.log(toExportLines(resolved));
    return ExitCode.Ok;
  }
  if (subcommand !== "exec" || command.length === 0) {
    throw new UserFacingError(USAGE, ExitCode.Usage);
  }

  console.error(
    `vercel-env: VITE_APP_ENV=${resolved.VITE_APP_ENV} VITE_API_URL=${resolved.VITE_API_URL} ` +
      `(${resolved.source})`,
  );
  const child = Bun.spawn(command, {
    stdio: ["inherit", "inherit", "inherit"],
    env: {
      ...process.env,
      VITE_APP_ENV: resolved.VITE_APP_ENV,
      VITE_API_URL: resolved.VITE_API_URL,
    },
  });
  return await child.exited;
}

if (import.meta.main) {
  await runMain(main);
}
