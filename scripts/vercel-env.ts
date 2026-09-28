#!/usr/bin/env bun
/**
 * Vercel build-time environment for `apps/web` (TEACH-25, ADR 0010).
 *
 * Vercel builds every branch with the *Preview* environment's variables, but the API a preview
 * should talk to is the Railway PR environment for the same pull request (`ai-teacher-pr-<number>`). That
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
 *
 * The marketing project (dayback.app, root `homepage/`, TEACH-78) uses the `site` subcommand, which
 * appends the homepage build flags resolved by `resolveSiteArgs` to the command:
 *
 *   bun scripts/vercel-env.ts site print               # prints the flags
 *   bun scripts/vercel-env.ts site exec <command...>   # runs <command> <flags...>
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

/**
 * Cloudflare's published always-pass Turnstile site key (visible widget). A preview that talks to
 * its Railway PR api builds with it, because that api runs the matching test secret
 * (`withPrEnvironmentDefaults` in apps/api/src/env.ts, TEACH-223). Production and previews on
 * another api keep whatever `VITE_TURNSTILE_SITE_KEY` Vercel holds.
 */
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";

/** Extra `VITE_*` values a resolved build gets beyond `VITE_APP_ENV` / `VITE_API_URL`. */
export function turnstileOverride(env: ResolvedWebEnv): Record<string, string> {
  return env.source === "railway-pr-template"
    ? { VITE_TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY }
    : {};
}

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

/** `https://api-ai-teacher-pr-{pr}.up.railway.app` + `"42"` → `https://api-ai-teacher-pr-42.up.railway.app`. */
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

export interface SiteBuildInputs {
  VERCEL_ENV?: string;
  /** Public origin of the marketing site (`https://dayback.app`): canonicals, sitemap. */
  SITE_URL?: string;
  /** Application origin the hero hands a topic to (`https://teach.dayback.app`). */
  SITE_APP_URL?: string;
  /** `1` lets a production build be indexed. Unset = noindex. */
  SITE_INDEXING?: string;
  /** `1` lets a production build show stand-in example lessons (never indexable). */
  SITE_ALLOW_PROVISIONAL?: string;
}

function httpsOrigin(name: string, value: string | undefined): string {
  const trimmed = nonEmpty(value);
  if (!trimmed || !isAbsoluteHttpUrl(trimmed) || !trimmed.startsWith("https://")) {
    throw new UserFacingError(
      `Site build: ${name} must be an absolute https URL (got "${trimmed ?? ""}").`,
    );
  }
  return trimmed.replace(/\/$/, "");
}

/**
 * Homepage build flags (`homepage/config.mjs`) for the marketing project. Production needs both
 * origins, and is indexable or shows stand-in examples only when told so explicitly. Both may be
 * set: the stand-in examples then stay noindex and out of the sitemap while every other page is
 * indexed. Every other environment is noindex and may show the stand-ins.
 */
export function resolveSiteArgs(input: SiteBuildInputs): string[] {
  const production = (nonEmpty(input.VERCEL_ENV) ?? "preview") === "production";
  const args = ["--base=/"];
  if (production || nonEmpty(input.SITE_URL)) {
    args.push(`--site=${httpsOrigin("SITE_URL", input.SITE_URL)}`);
  }
  if (production || nonEmpty(input.SITE_APP_URL)) {
    args.push(`--app=${httpsOrigin("SITE_APP_URL", input.SITE_APP_URL)}`);
  }
  if (!production) return [...args, "--allow-provisional"];
  const indexing = nonEmpty(input.SITE_INDEXING) === "1";
  const provisional = nonEmpty(input.SITE_ALLOW_PROVISIONAL) === "1";
  if (indexing) args.push("--index");
  if (provisional) args.push("--allow-provisional");
  return args;
}

/** POSIX single-quote so the value is safe to `eval` (`'` → `'\''`). */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function toExportLines(env: ResolvedWebEnv): string {
  return [
    `export VITE_APP_ENV=${shellQuote(env.VITE_APP_ENV)}`,
    `export VITE_API_URL=${shellQuote(env.VITE_API_URL)}`,
    ...Object.entries(turnstileOverride(env)).map(([k, v]) => `export ${k}=${shellQuote(v)}`),
  ].join("\n");
}

const USAGE = "usage: bun scripts/vercel-env.ts [site] print | [site] exec <command...>";

async function site(args: string[]): Promise<number> {
  const [mode = "print", ...command] = args;
  const flags = resolveSiteArgs(process.env as SiteBuildInputs);
  if (mode === "print" && command.length === 0) {
    console.log(flags.join(" "));
    return ExitCode.Ok;
  }
  if (mode !== "exec" || command.length === 0) throw new UserFacingError(USAGE, ExitCode.Usage);
  console.error(`vercel-env site: ${flags.join(" ")}`);
  const child = Bun.spawn([...command, ...flags], { stdio: ["inherit", "inherit", "inherit"] });
  return await child.exited;
}

async function main(): Promise<number> {
  const [subcommand = "print", ...command] = process.argv.slice(2);
  if (subcommand === "site") return await site(command);
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
      ...turnstileOverride(resolved),
    },
  });
  return await child.exited;
}

if (import.meta.main) {
  await runMain(main);
}
