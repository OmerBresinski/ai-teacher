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
    if (init?.method === "OPTIONS" && origin === WEB) return new Response(null, { status: 204 });
    if (origin !== null && origin !== WEB) return new Response("forbidden", { status: 403 });
    if (origin === null && crossSite) return new Response("forbidden", { status: 403 });
    return new Response("unauthorized", { status: 401 });
  }) as typeof fetch;
}

describe("smoke-prod", () => {
  test("every case passes against a correctly guarded api", async () => {
    const results = await runSmoke("https://api.example.test", smokeCases(WEB), fakeApi());
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.length).toBe(6);
  });

  test("catches the 2026-09-05 regression: cross-site header rejected despite allowed Origin", async () => {
    const broken: typeof fetch = (async (input, init) => {
      const headers = new Headers(init?.headers);
      if (headers.get("sec-fetch-site") === "cross-site") return new Response("", { status: 403 });
      return fakeApi()(input, init);
    }) as typeof fetch;
    const results = await runSmoke("https://api.example.test", smokeCases(WEB), broken);
    const failed = results.filter((r) => !r.ok).map((r) => r.path);
    expect(failed).toEqual(["/me", "/jobs/ai-ping"]);
  });

  test("a network error is reported as a failed case, not a crash", async () => {
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const results = await runSmoke("https://api.example.test", smokeCases(WEB), down);
    expect(results.every((r) => !r.ok && r.actual === "ECONNREFUSED")).toBe(true);
  });
});
