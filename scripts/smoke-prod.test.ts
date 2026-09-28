import { describe, expect, test } from "bun:test";
import { PRODUCTION_API, runSmoke, SMOKE_TARGETS, siteSmokeCases, smokeCases } from "./smoke-prod";

const WEB = "https://app.example.test";

/** A fake api that behaves like the deployed guards should. */
function fakeApi(): typeof fetch {
  return (async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const origin = headers.get("origin");
    const crossSite = headers.get("sec-fetch-site") === "cross-site";
    if (url.pathname === "/health") return new Response("ok", { status: 200 });
    if (url.pathname.startsWith("/mail-assets/")) {
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    if (init?.method === "OPTIONS" && origin === WEB) {
      const wantsHeaders = headers.get("access-control-request-headers") ?? "";
      if (!wantsHeaders.includes("content-type")) return new Response(null, { status: 204 });
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": WEB,
          "access-control-allow-credentials": "true",
          "access-control-allow-headers": "Content-Type, x-request-id, Last-Event-ID",
        },
      });
    }
    if (origin !== null && origin !== WEB) return new Response("forbidden", { status: 403 });
    if (origin === null && crossSite) return new Response("forbidden", { status: 403 });
    if (
      url.pathname === "/auth/sign-in/magic-link" &&
      typeof init?.body === "string" &&
      new TextEncoder().encode(init.body).byteLength > 64 * 1024
    ) {
      return new Response("too large", { status: 413 });
    }
    // TEACH-31: better-auth answers 404 PROVIDER_NOT_FOUND for a provider it has no credentials for.
    if (url.pathname === "/auth/sign-in/social") {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      return body.provider === "google"
        ? Response.json({ url: "https://accounts.google.com/o/oauth2/v2/auth", redirect: false })
        : Response.json({ code: "PROVIDER_NOT_FOUND" }, { status: 404 });
    }
    // TEACH-223: the anonymous sign-in kill switch answers 403 while the flag is off.
    if (url.pathname === "/auth/sign-in/anonymous") {
      return Response.json({ error: { code: "anonymous_disabled" } }, { status: 403 });
    }
    // TEACH-81: the dev-only ping routes answer 404 before the session guard in production.
    if (url.pathname === "/jobs/ai-ping" || url.pathname === "/jobs/ping") {
      return new Response("not found", { status: 404 });
    }
    return new Response("unauthorized", { status: 401 });
  }) as typeof fetch;
}

describe("smoke-prod", () => {
  test("every case passes against a correctly guarded api", async () => {
    const results = await runSmoke("https://api.example.test", smokeCases(WEB), fakeApi());
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.length).toBe(27);
  });

  test("catches the 2026-09-05 regression: cross-site header rejected despite allowed Origin", async () => {
    const broken: typeof fetch = (async (input, init) => {
      const headers = new Headers(init?.headers);
      if (headers.get("sec-fetch-site") === "cross-site") return new Response("", { status: 403 });
      return fakeApi()(input, init);
    }) as typeof fetch;
    const results = await runSmoke("https://api.example.test", smokeCases(WEB), broken);
    const failed = results.filter((r) => !r.ok).map((r) => r.path);
    expect(failed).toEqual([
      "/me",
      "/events",
      "/jobs/0192f7a0-0000-7000-8000-000000000042/events",
      "/documents/0192f7a0-0000-7000-8000-000000000042",
      "/jobs/ai-ping",
      "/lessons",
      "/briefs/parse",
      "/lessons/0192f7a0-0000-7000-8000-000000000042/cascade",
      "/images/search?q=river",
      "/images/pick",
      "/images/report",
      "/sources",
      "/auth/sign-in/magic-link",
      "/auth/sign-in/social",
    ]);
  });

  test("the google case fails when production has no google credentials (TEACH-31)", async () => {
    const noGoogle: typeof fetch = (async (input, init) => {
      if (new URL(String(input)).pathname === "/auth/sign-in/social") {
        return Response.json({ code: "PROVIDER_NOT_FOUND" }, { status: 404 });
      }
      return fakeApi()(input, init);
    }) as typeof fetch;
    const results = await runSmoke("https://api.example.test", smokeCases(WEB), noGoogle);
    const failed = results.filter((r) => !r.ok);
    expect(failed.map((r) => [r.path, r.actual])).toEqual([["/auth/sign-in/social", 404]]);
  });

  test("the multipart case sends a real FormData and no manual Content-Type (ADR 0027 §5)", async () => {
    const seen: { contentType: string | null; isForm: boolean }[] = [];
    const spy: typeof fetch = (async (input, init) => {
      if (String(input).endsWith("/sources")) {
        seen.push({
          contentType: new Headers(init?.headers).get("content-type"),
          isForm: init?.body instanceof FormData,
        });
      }
      return fakeApi()(input, init);
    }) as typeof fetch;
    await runSmoke("https://api.example.test", smokeCases(WEB), spy);
    expect(seen).toHaveLength(2);
    for (const s of seen) {
      expect(s.isForm).toBe(true);
      expect(s.contentType).toBeNull();
    }
  });

  test("a 204 preflight without CORS allow headers fails the case", async () => {
    const noCors: typeof fetch = (async (input, init) => {
      if (init?.method === "OPTIONS") return new Response(null, { status: 204 });
      return fakeApi()(input, init);
    }) as typeof fetch;
    const results = await runSmoke("https://api.example.test", smokeCases(WEB), noCors);
    const failed = results.filter((r) => !r.ok);
    expect(failed.map((r) => r.method)).toEqual(["OPTIONS"]);
    expect(String(failed[0]?.actual)).toContain("access-control-allow-origin=<missing>");
  });

  test("a network error is reported as a failed case, not a crash", async () => {
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const results = await runSmoke("https://api.example.test", smokeCases(WEB), down);
    expect(results.every((r) => !r.ok && r.actual === "ECONNREFUSED")).toBe(true);
  });
});

describe("siteSmokeCases (TEACH-78)", () => {
  const SITE = "https://dayback.app";
  const TEACH = "https://teach.dayback.app";

  /** A fake marketing site + app host that behaves like the configured projects should. */
  const fakeSite: typeof fetch = (async (input) => {
    const url = new URL(String(input));
    if (url.host === "www.dayback.app") {
      return new Response(null, {
        status: 308,
        headers: { location: `${SITE}${url.pathname}${url.search}` },
      });
    }
    if (url.origin === TEACH && url.pathname.startsWith("/homepage/")) {
      return new Response(null, {
        status: 308,
        headers: { location: `${SITE}/${url.pathname.slice("/homepage/".length)}` },
      });
    }
    if (url.origin === SITE && ["/", "/robots.txt", "/sitemap.xml"].includes(url.pathname)) {
      return new Response("ok", { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  test("the configured site passes every case", async () => {
    const results = await runSmoke(
      "https://api.unused.test",
      siteSmokeCases(SITE, TEACH),
      fakeSite,
    );
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results.map((r) => `${r.origin}${r.path}`)).toContain(
      "https://www.dayback.app/privacy/?from=smoke",
    );
  });

  test("an SPA fallback (200 for everything) fails the 404 case", async () => {
    const spa = (async () =>
      new Response("<div id=root>", { status: 200 })) as unknown as typeof fetch;
    const results = await runSmoke("https://api.unused.test", siteSmokeCases(SITE, TEACH), spa);
    expect(results.find((r) => r.path === "/no-such-page/")?.ok).toBe(false);
  });

  test("a www redirect that drops the query fails", async () => {
    const lossy = (async (input) => {
      const url = new URL(String(input));
      return url.host === "www.dayback.app"
        ? new Response(null, { status: 308, headers: { location: `${SITE}${url.pathname}` } })
        : fakeSite(input);
    }) as typeof fetch;
    const results = await runSmoke("https://api.unused.test", siteSmokeCases(SITE, TEACH), lossy);
    expect(results.find((r) => r.origin === "https://www.dayback.app")?.ok).toBe(false);
  });
});

describe("SMOKE_TARGETS", () => {
  test("default stays on the live origins until the cutover; dayback is exact and https", () => {
    expect(PRODUCTION_API).toBe("https://api.bresinski.org");
    expect(SMOKE_TARGETS.dayback).toEqual({
      api: "https://api.dayback.app",
      webOrigin: "https://teach.dayback.app",
    });
  });
});
