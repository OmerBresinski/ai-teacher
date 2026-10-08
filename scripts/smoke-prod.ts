#!/usr/bin/env bun
// bun run smoke:prod [--target dayback|bresinski] [--api <url>] [--web-origin <origin>] [--site <origin>]
//
// Black-box smoke check of the deployed api, run after every Railway deploy (AGENTS.md step 4).
// It sends the exact request shapes a browser produces so a regression in the request guards
// (CORS, CSRF, session) cannot ship silently — the 2026-09-05 incident was a CSRF guard that
// returned 403 to every legitimate request because production web and api are different sites.
//
//   exit 0  every case returned the expected status
//   exit 1  at least one did not (the table says which)
//
// Defaults are production; PR environments can be probed with --api / --web-origin. `--target`
// picks a set of production origins: `dayback` (the default since the TEACH-78 cutover) or the
// legacy `bresinski` origins. `--site` adds the marketing-site cases (dayback.app: 200, real 404,
// crawl files, www and legacy /homepage redirects).

import { parseArgs } from "node:util";
import { ExitCode, runMain, UserFacingError } from "./lib/exit";
import { log } from "./lib/log";

export const SMOKE_TARGETS = {
  bresinski: { api: "https://api.bresinski.org", webOrigin: "https://app.bresinski.org" },
  dayback: { api: "https://api.dayback.app", webOrigin: "https://teach.dayback.app" },
} as const;
export type SmokeTarget = keyof typeof SMOKE_TARGETS;
/** The default target: production has served the dayback origins since the TEACH-78 cutover. */
export const DEFAULT_TARGET: SmokeTarget = "dayback";
export const PRODUCTION_API = SMOKE_TARGETS[DEFAULT_TARGET].api;
export const PRODUCTION_WEB_ORIGIN = SMOKE_TARGETS[DEFAULT_TARGET].webOrigin;
/** Per-request ceiling: a hung origin must fail the smoke check, not park `bun run land`. */
export const REQUEST_TIMEOUT_MS = 15_000;

export interface SmokeCase {
  name: string;
  method?: string;
  /** Absolute origin for this case when it is not the api (the marketing-site cases). */
  origin?: string;
  path: string;
  headers?: Record<string, string>;
  /**
   * A request body other than the `{}` every POST sends by default — a `FormData` for the
   * multipart routes. Built per call so a `FormData` is never reused; when set, no `Content-Type`
   * is added by hand so `fetch` writes the multipart boundary the way a browser does.
   */
  body?: () => FormData | string;
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
      // Email clients fetch the button arrow with no cookie and no Origin; Apple Mail renders it
      // from another origin, so CORP must not be `same-origin` here (it is everywhere else).
      name: "mail asset is public and embeddable",
      path: "/mail-assets/arrow-up-right.png",
      expect: 200,
      expectHeaders: { "content-type": "image/png" },
    },
    {
      name: "app origin reaches the session guard (even when marked cross-site)",
      path: "/me",
      headers: browser,
      expect: 401,
    },
    {
      name: "workspace event stream requires a current session",
      path: "/events",
      headers: { ...browser, Accept: "text/event-stream" },
      expect: 401,
    },
    {
      name: "job event reconnect requires a current session before replay",
      path: "/jobs/0192f7a0-0000-7000-8000-000000000042/events",
      headers: { ...browser, Accept: "text/event-stream", "Last-Event-ID": "1" },
      expect: 401,
    },
    {
      // TEACH-223/243: anonymous sign-in is always on, behind Turnstile. Without a token the
      // captcha plugin answers 400 before a user exists; a 200 here means anyone can mint a user.
      name: "anonymous sign-in without a Turnstile token is refused (400)",
      method: "POST",
      path: "/auth/sign-in/anonymous",
      headers: { ...browser, "Content-Type": "application/json" },
      expect: 400,
    },
    {
      // TEACH-249: the same request from a foreign page. The CSRF guard covers the protected
      // paths, not `/auth/*`, and better-auth checks Origin only when a cookie is sent, so Turnstile
      // is what refuses it (ADR 0008 amendment of 2026-10-02, item 8). A 200 means any site can
      // mint anonymous users; a 403 with another code means an origin check now answers first, so
      // update this case. The limits in `app.ts` run before Turnstile: both anonymous cases answer
      // 403 anonymous_capacity once today's cap is reached, and 429 rate_limited once the address
      // the api resolves for this machine has reached ANONYMOUS_SIGNINS_PER_IP_DAILY (TEACH-257).
      // Spends a second of better-auth's three `/sign-in/anonymous` requests per 10 s.
      name: "foreign origin anonymous sign-in is refused by Turnstile (400), not by origin",
      method: "POST",
      path: "/auth/sign-in/anonymous",
      headers: {
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
        "Content-Type": "application/json",
      },
      expect: 400,
    },
    // TEACH-222
    {
      // The anonymous guard runs after the session guard: without a session a save is 401. A 403
      // here (sign_in_required, or a CSRF refusal) means the guard order changed.
      name: "app origin, PUT /documents JSON, reaches the session guard before the anonymous guard",
      method: "PUT",
      path: "/documents/0192f7a0-0000-7000-8000-000000000042",
      headers: { ...browser, "Content-Type": "application/json" },
      expect: 401,
    },
    {
      // TEACH-81 (audit F05): the diagnostic ping routes are not mounted in production. The 404
      // comes before the session guard, so a 401 here means the dev-only routes are back.
      name: "dev-only ping route is absent in production (404, not 401)",
      method: "POST",
      path: "/jobs/ai-ping",
      headers: { ...browser, "Content-Type": "application/json" },
      expect: 404,
    },
    {
      // The first browser-facing POST that creates data and ends in a model call (ADR 0024 §6, §15):
      // the same shape as the ai-ping case, so a guard regression on the new prefix shows here.
      name: "app origin, POST /lessons JSON, reaches the session guard",
      method: "POST",
      path: "/lessons",
      headers: { ...browser, "Content-Type": "application/json" },
      expect: 401,
    },
    {
      // ADR 0029 item 13: the brief parse is the first browser-facing POST under `/briefs`; it
      // ends in a model call, so the guard pair on the new prefix must answer before any spend.
      name: "app origin, POST /briefs/parse JSON, reaches the session guard",
      method: "POST",
      path: "/briefs/parse",
      headers: { ...browser, "Content-Type": "application/json" },
      expect: 401,
    },
    {
      // ADR 0025 §18: the proposal routes live under the guarded `/lessons/*` prefix with a path
      // parameter; a guard that matched only the exact `/lessons` would let this through.
      name: "app origin, POST /lessons/:id/cascade JSON, reaches the session guard",
      method: "POST",
      path: "/lessons/0192f7a0-0000-7000-8000-000000000042/cascade",
      headers: { ...browser, "Content-Type": "application/json" },
      expect: 401,
    },
    {
      // TEACH-97: the edit pane streams its answer. A browser POSTs JSON and accepts
      // `text/event-stream`; that shape must meet the same guard pair before any stream opens.
      name: "app origin, POST /lessons/:id/edit streamed (SSE), reaches the session guard",
      method: "POST",
      path: "/lessons/0192f7a0-0000-7000-8000-000000000042/edit",
      headers: { ...browser, "Content-Type": "application/json", Accept: "text/event-stream" },
      expect: 401,
    },
    {
      // Images project: the Pexels proxy is browser-facing, so the new prefix needs the same
      // guard pair as every other browser-facing route (root AGENTS.md step 4).
      name: "app origin, GET /images/search, reaches the session guard",
      path: "/images/search?q=river",
      headers: browser,
      expect: 401,
    },
    {
      // Images pick route (TEACH-157): same guard pair for the new POST prefix.
      name: "app origin, POST /images/pick JSON, reaches the session guard",
      method: "POST",
      path: "/images/pick",
      headers: { ...browser, "Content-Type": "application/json" },
      expect: 401,
    },
    {
      name: "foreign origin POST /images/pick is rejected before the session guard",
      method: "POST",
      path: "/images/pick",
      headers: {
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
        "Content-Type": "application/json",
      },
      expect: 403,
    },
    {
      name: "app origin, POST /images/report JSON, reaches the session guard",
      method: "POST",
      path: "/images/report",
      headers: { ...browser, "Content-Type": "application/json" },
      expect: 401,
    },
    {
      name: "foreign origin POST /images/report is rejected before the session guard",
      method: "POST",
      path: "/images/report",
      headers: {
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
        "Content-Type": "application/json",
      },
      expect: 403,
    },
    {
      // ADR 0027 §5: the first multipart route. The body is a real FormData with a one-byte file
      // part — the shape a browser drop zone produces — and no manual Content-Type.
      name: "app origin, POST /sources multipart, reaches the session guard",
      method: "POST",
      path: "/sources",
      headers: browser,
      body: pdfUploadBody,
      expect: 401,
    },
    {
      name: "foreign origin POST /sources is rejected before the session guard",
      method: "POST",
      path: "/sources",
      headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
      body: pdfUploadBody,
      expect: 403,
    },
    {
      name: "foreign origin GET /images/search is rejected before the session guard",
      path: "/images/search?q=river",
      headers: {
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
      },
      expect: 403,
    },
    {
      name: "foreign origin POST /lessons/:id/cascade is rejected before the session guard",
      method: "POST",
      path: "/lessons/0192f7a0-0000-7000-8000-000000000042/cascade",
      headers: {
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
        "Content-Type": "application/json",
      },
      expect: 403,
    },
    {
      name: "foreign origin POST /briefs/parse is rejected before the session guard",
      method: "POST",
      path: "/briefs/parse",
      headers: {
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
        "Content-Type": "application/json",
      },
      expect: 403,
    },
    {
      name: "foreign origin POST /lessons is rejected before the session guard",
      method: "POST",
      path: "/lessons",
      headers: {
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
        "Content-Type": "application/json",
      },
      expect: 403,
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
      // Malformed JSON contains no address and cannot send mail even if the byte guard regresses.
      name: "auth rejects an oversized body before parsing or mail delivery",
      method: "POST",
      path: "/auth/sign-in/magic-link",
      headers: { ...browser, "Content-Type": "application/json" },
      body: () => "x".repeat(64 * 1024 + 1),
      expect: 413,
    },
    {
      // 404 PROVIDER_NOT_FOUND means the api has no GOOGLE_CLIENT_ID/SECRET, and every teacher who
      // clicks "Continue with Google" is told it is not set up (TEACH-31). `disableRedirect` only
      // makes the answer `{ url, redirect: false }`; no browser follows it. Spends one of the three
      // `/sign-in*` requests better-auth's rate limiter allows per 10 s.
      name: "google sign-in is configured in production",
      method: "POST",
      path: "/auth/sign-in/social",
      headers: { ...browser, "Content-Type": "application/json" },
      body: () =>
        JSON.stringify({ provider: "google", callbackURL: `${webOrigin}/`, disableRedirect: true }),
      expect: 200,
    },
    {
      // CORS runs before routing, so a preflight is answered for any path — including one that is
      // not mounted (TEACH-81). What this asserts is the allow headers a credentialed JSON POST
      // needs; 204 alone would pass while the browser still blocks the request.
      name: "preflight from the app origin carries the credentialed JSON POST allow headers",
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
    // TEACH-243
    {
      // Turnstile gates magic-link sign-in: without an `x-captcha-response` token the captcha
      // plugin answers 400 MISSING_RESPONSE before any mail is sent. A 200 means anyone can make
      // the api email any address. The address is on a reserved TLD, so nothing is delivered even
      // if the gate regresses. Spends one of better-auth's three `/sign-in*` requests per 10 s.
      name: "magic-link sign-in without a Turnstile token is refused (400)",
      method: "POST",
      path: "/auth/sign-in/magic-link",
      headers: { ...browser, "Content-Type": "application/json" },
      body: () => JSON.stringify({ email: "smoke@example.invalid", callbackURL: `${webOrigin}/` }),
      expect: 400,
    },
  ];
}

/**
 * The marketing site (TEACH-78): a static page, a real 404 rather than an SPA fallback, crawl
 * files, `www` folded into the apex in one redirect that keeps path and query, and the app's legacy
 * `/homepage/*` sent to the public page. Needs no session and touches no api.
 */
export function siteSmokeCases(site: string, webOrigin: string): SmokeCase[] {
  const apex = new URL(site);
  const www = `${apex.protocol}//www.${apex.host}`;
  const origin = apex.origin;
  return [
    { name: "site home is a static page", origin, path: "/", expect: 200 },
    { name: "an unknown site path is a real 404", origin, path: "/no-such-page/", expect: 404 },
    { name: "robots.txt is published", origin, path: "/robots.txt", expect: 200 },
    { name: "sitemap.xml is published", origin, path: "/sitemap.xml", expect: 200 },
    {
      name: "www redirects once to the apex, keeping path and query",
      origin: www,
      path: "/privacy/?from=smoke",
      expect: 308,
      expectHeaders: { location: `${origin}/privacy/?from=smoke` },
    },
    {
      name: "the app's legacy /homepage page redirects once to the public page",
      origin: webOrigin,
      path: "/homepage/privacy/",
      expect: 308,
      expectHeaders: { location: `${origin}/privacy/` },
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

/** One byte that is not a PDF: the guards answer before any parsing would. */
function pdfUploadBody(): FormData {
  const form = new FormData();
  form.set("file", new File([new Uint8Array([0x25])], "a.pdf", { type: "application/pdf" }));
  return form;
}

export async function runSmoke(
  api: string,
  cases: SmokeCase[],
  fetchImpl: typeof fetch = fetch,
): Promise<SmokeResult[]> {
  return Promise.all(
    cases.map(async (c) => {
      try {
        const res = await fetchImpl(`${c.origin ?? api}${c.path}`, {
          method: c.method ?? "GET",
          headers: c.headers,
          body: c.body ? c.body() : c.method === "POST" ? "{}" : undefined,
          redirect: "manual",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
  let values: { target?: string; api?: string; "web-origin"?: string; site?: string };
  const usage =
    "Usage: bun run smoke:prod [--target dayback|bresinski] [--api <url>] [--web-origin <origin>] [--site <origin>]";
  try {
    values = parseArgs({
      options: {
        target: { type: "string", default: DEFAULT_TARGET },
        api: { type: "string" },
        "web-origin": { type: "string" },
        site: { type: "string" },
      },
    }).values;
  } catch (err) {
    throw new UserFacingError(
      `${err instanceof Error ? err.message : String(err)}\n${usage}`,
      ExitCode.Usage,
    );
  }
  const targetName = values.target ?? DEFAULT_TARGET;
  if (!Object.hasOwn(SMOKE_TARGETS, targetName)) {
    throw new UserFacingError(`--target must be dayback or bresinski\n${usage}`, ExitCode.Usage);
  }
  const target = SMOKE_TARGETS[targetName as SmokeTarget];
  const api = (values.api ?? target.api).replace(/\/$/, "");
  const webOrigin = values["web-origin"] ?? target.webOrigin;
  for (const [flag, value] of [
    ["--api", api],
    ["--web-origin", webOrigin],
    ["--site", values.site ?? api],
  ] as const) {
    if (!URL.canParse(value))
      throw new UserFacingError(`${flag} is not a URL: ${value}`, ExitCode.Usage);
  }
  const cases = [
    ...smokeCases(webOrigin),
    ...(values.site ? siteSmokeCases(values.site, webOrigin) : []),
  ];

  log.step(`Smoke-checking ${api} as ${webOrigin}`);
  const results = await runSmoke(api, cases);
  for (const r of results) {
    const line = `${r.method ?? "GET"} ${r.origin ?? ""}${r.path} -> ${r.actual} (want ${r.expect}) — ${r.name}`;
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
