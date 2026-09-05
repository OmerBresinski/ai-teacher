#!/usr/bin/env bun
// bun run smoke:prod [--api <url>] [--web-origin <origin>]
//
// Black-box smoke check of the deployed api, run after every Railway deploy (AGENTS.md step 4).
// It sends the exact request shapes a browser produces so a regression in the request guards
// (CORS, CSRF, session) cannot ship silently — the 2026-09-05 incident was a CSRF guard that
// returned 403 to every legitimate request because production web and api are different sites.
//
//   exit 0  every case returned the expected status
//   exit 1  at least one did not (the table says which)
//
// Defaults are production; PR environments can be probed with --api / --web-origin.

import { parseArgs } from "node:util";
import { ExitCode, runMain, UserFacingError } from "./lib/exit";
import { log } from "./lib/log";

export const PRODUCTION_API = "https://api-production-903f.up.railway.app";
export const PRODUCTION_WEB_ORIGIN = "https://teaching-journey-web.vercel.app";

export interface SmokeCase {
  name: string;
  method?: string;
  path: string;
  headers?: Record<string, string>;
  expect: number;
  /** Response headers that must be present with exactly this value. */
  expectHeaders?: Record<string, string>;
}

/**
 * Every case is unauthenticated on purpose: the point is that the guards answer with the right
 * *kind* of refusal. 401 means the request reached `requireSession` — the CSRF guard let it in.
 */
export function smokeCases(webOrigin: string): SmokeCase[] {
  const browser = { Origin: webOrigin, "Sec-Fetch-Site": "cross-site" };
  return [
    { name: "health is public", path: "/health", expect: 200 },
    {
      name: "app origin reaches the session guard (browser is cross-site until TEACH-30)",
      path: "/me",
      headers: browser,
      expect: 401,
    },
    {
      name: "app origin, POST JSON, reaches the session guard",
      method: "POST",
      path: "/jobs/ai-ping",
      headers: { ...browser, "Content-Type": "application/json" },
      expect: 401,
    },
    {
      name: "foreign origin is rejected",
      path: "/me",
      headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
      expect: 403,
    },
    {
      name: "cross-site request with no Origin (img-tag style) is rejected",
      path: "/me",
      headers: { "Sec-Fetch-Site": "cross-site" },
      expect: 403,
    },
    {
      // The full exchange the JSON POST above triggers; 204 alone would pass while the browser
      // still blocks the request for a missing/wrong allow header.
      name: "preflight from the app origin allows the JSON POST with credentials",
      method: "OPTIONS",
      path: "/jobs/ai-ping",
      headers: {
        Origin: webOrigin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
      expect: 204,
      expectHeaders: {
        "access-control-allow-origin": webOrigin,
        "access-control-allow-credentials": "true",
      },
    },
  ];
}

export interface SmokeResult extends SmokeCase {
  /** Status code, or a description of what went wrong (network error, missing header). */
  actual: number | string;
  ok: boolean;
}

function headerMismatch(res: Response, want: Record<string, string> | undefined): string | null {
  for (const [name, value] of Object.entries(want ?? {})) {
    const got = res.headers.get(name);
    if (got !== value) return `${res.status} but ${name}=${got ?? "<missing>"} (want ${value})`;
  }
  return null;
}

export async function runSmoke(
  api: string,
  cases: SmokeCase[],
  fetchImpl: typeof fetch = fetch,
): Promise<SmokeResult[]> {
  return Promise.all(
    cases.map(async (c) => {
      try {
        const res = await fetchImpl(`${api}${c.path}`, {
          method: c.method ?? "GET",
          headers: c.headers,
          body: c.method === "POST" ? "{}" : undefined,
          redirect: "manual",
        });
        if (res.status !== c.expect) return { ...c, actual: res.status, ok: false };
        const mismatch = headerMismatch(res, c.expectHeaders);
        return mismatch
          ? { ...c, actual: mismatch, ok: false }
          : { ...c, actual: res.status, ok: true };
      } catch (err) {
        return { ...c, actual: err instanceof Error ? err.message : String(err), ok: false };
      }
    }),
  );
}

async function main(): Promise<number> {
  let values: { api?: string; "web-origin"?: string };
  try {
    values = parseArgs({
      options: {
        api: { type: "string", default: PRODUCTION_API },
        "web-origin": { type: "string", default: PRODUCTION_WEB_ORIGIN },
      },
    }).values;
  } catch (err) {
    throw new UserFacingError(
      `${err instanceof Error ? err.message : String(err)}\nUsage: bun run smoke:prod [--api <url>] [--web-origin <origin>]`,
      ExitCode.Usage,
    );
  }
  const api = (values.api ?? PRODUCTION_API).replace(/\/$/, "");
  const webOrigin = values["web-origin"] ?? PRODUCTION_WEB_ORIGIN;
  for (const [flag, value] of [
    ["--api", api],
    ["--web-origin", webOrigin],
  ] as const) {
    if (!URL.canParse(value))
      throw new UserFacingError(`${flag} is not a URL: ${value}`, ExitCode.Usage);
  }

  log.step(`Smoke-checking ${api} as ${webOrigin}`);
  const results = await runSmoke(api, smokeCases(webOrigin));
  for (const r of results) {
    const line = `${r.method ?? "GET"} ${r.path} -> ${r.actual} (want ${r.expect}) — ${r.name}`;
    if (r.ok) log.ok(line);
    else log.fail(line);
  }
  const failed = results.filter((r) => !r.ok).length;
  if (failed > 0) {
    log.error(`${failed} of ${results.length} smoke cases failed. Do not mark the deploy green.`);
    return ExitCode.Failure;
  }
  log.ok(`All ${results.length} smoke cases passed.`);
  return ExitCode.Ok;
}

if (import.meta.main) await runMain(main);
