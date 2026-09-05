import { describe, expect, test } from "bun:test";
import { newId, type WorkspaceId } from "@tj/domain";
import { CROSS_SITE_MESSAGE } from "./csrf";
import { testApp } from "./test-helpers";
import { WORKSPACE_HEADER } from "./workspace";

const app = testApp();
const workspaceId = newId<WorkspaceId>();
const jsonHeaders = { "content-type": "application/json", [WORKSPACE_HEADER]: workspaceId };

async function error(res: Response) {
  return (await res.json()) as { error: { code: string; message: string } };
}

function aiPing(headers: Record<string, string>) {
  return app.request("/jobs/ai-ping", {
    method: "POST",
    headers: { ...jsonHeaders, ...headers },
    body: JSON.stringify({}),
  });
}

describe("rejectCrossSiteRequests", () => {
  test("rejects a foreign Origin without emitting CORS headers", async () => {
    const res = await aiPing({ Origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect((await error(res)).error).toMatchObject({
      code: "forbidden",
      message: CROSS_SITE_MESSAGE,
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  test("allows an exact allow-listed Origin through to the handler", async () => {
    expect((await aiPing({ Origin: "https://app.example.test" })).status).toBe(503);
  });

  test("allows an Origin matching WEB_ORIGIN_PATTERNS through to the handler", async () => {
    expect((await aiPing({ Origin: "https://x-preview.example.test" })).status).toBe(503);
  });

  test("uses Referer when Origin is absent", async () => {
    const res = await aiPing({ Referer: "https://evil.example/page" });
    expect(res.status).toBe(403);
    expect((await error(res)).error.code).toBe("forbidden");
  });

  test("allows requests without Origin or Referer through to the handler", async () => {
    expect((await aiPing({})).status).toBe(503);
  });

  test("allows an allowed Origin even when the browser marks the request cross-site", async () => {
    // Production today: web on *.vercel.app, api on *.up.railway.app — every request is cross-site.
    const res = await aiPing({
      Origin: "https://app.example.test",
      "Sec-Fetch-Site": "cross-site",
    });
    expect(res.status).toBe(503);
  });

  test("allows an allowed Referer fallback even when marked cross-site", async () => {
    const res = await aiPing({
      Referer: "https://app.example.test/page",
      "Sec-Fetch-Site": "cross-site",
    });
    expect(res.status).toBe(503);
  });

  test("rejects a cross-site request that carries no Origin or Referer", async () => {
    const res = await aiPing({ "Sec-Fetch-Site": "cross-site" });
    expect(res.status).toBe(403);
    expect((await error(res)).error.code).toBe("forbidden");
  });

  test("rejects the literal null Origin", async () => {
    const res = await aiPing({ Origin: "null" });
    expect(res.status).toBe(403);
    expect((await error(res)).error.code).toBe("forbidden");
  });

  test("rejects foreign GET requests to protected routes", async () => {
    const headers = { Origin: "https://evil.example", [WORKSPACE_HEADER]: workspaceId };
    const greeting = await app.request("/me/greeting", { headers });
    const events = await app.request("/events", { headers });
    expect(greeting.status).toBe(403);
    expect(events.status).toBe(403);
  });

  test("leaves public routes unguarded", async () => {
    expect(
      (await app.request("/health", { headers: { Origin: "https://evil.example" } })).status,
    ).toBe(200);
  });

  test("preserves allowed-origin CORS preflight handling", async () => {
    const res = await app.request("/jobs/ai-ping", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.example.test",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.test");
  });
});
