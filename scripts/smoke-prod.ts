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
import { ExitCode, runMain } from "./lib/exit";
import { log } from "./lib/log";

export const PRODUCTION_API = "https://api-production-903f.up.railway.app";
export const PRODUCTION_WEB_ORIGIN = "https://teaching-journey-web.vercel.app";

export interface SmokeCase {
  name: string;
  method?: string;
  path: string;
  headers?: Record<string, string>;
  expect: number;
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
      path: "/me/greeting",
      headers: { "Sec-Fetch-Site": "cross-site" },
      expect: 403,
    },
    {
      name: "preflight from the app origin",
      method: "OPTIONS",
      path: "/jobs/ai-ping",
      headers: { Origin: webOrigin, "Access-Control-Request-Method": "POST" },
      expect: 204,
    },
  ];
}

export interface SmokeResult extends SmokeCase {
  actual: number | string;
  ok: boolean;
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
        return { ...c, actual: res.status, ok: res.status === c.expect };
      } catch (err) {
        return { ...c, actual: err instanceof Error ? err.message : String(err), ok: false };
      }
    }),
  );
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      api: { type: "string", default: PRODUCTION_API },
      "web-origin": { type: "string", default: PRODUCTION_WEB_ORIGIN },
    },
  });
  const api = (values.api ?? PRODUCTION_API).replace(/\/$/, "");
  const webOrigin = values["web-origin"] ?? PRODUCTION_WEB_ORIGIN;

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
