import { describe, expect, test } from "bun:test";
import { runSmoke, smokeCases } from "./smoke-prod";

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
    return new Response("unauthorized", { status: 401 });
  }) as typeof fetch;
}

describe("smoke-prod", () => {
  test("every case passes against a correctly guarded api", async () => {
    const results = await runSmoke("https://api.example.test", smokeCases(WEB), fakeApi());
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.length).toBe(19);
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
      "/jobs/ai-ping",
      "/lessons",
      "/lessons/0192f7a0-0000-7000-8000-000000000042/cascade",
      "/images/search?q=river",
      "/images/pick",
      "/images/report",
      "/sources",
    ]);
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
