/** Unit tests for `/jobs/*` and `/events` that need no database: 503 without pg-boss, seam errors. */
import { describe, expect, test } from "bun:test";
import { newId, type WorkspaceId } from "@tj/domain";
import { createApp } from "../app";
import { fakeSql, silentLogger, TEST_ENV, testApp } from "../test-helpers";
import { WORKSPACE_HEADER } from "../workspace";

const app = testApp();
const ws = newId<WorkspaceId>();

async function body(res: Response) {
  return (await res.json()) as {
    error: { code: string; fields?: string[]; retryable?: boolean };
  };
}

function limitedApp() {
  return createApp({
    env: TEST_ENV,
    db: fakeSql(true),
    logger: silentLogger,
    rateLimit: { limit: 2, windowMs: 60_000 },
  });
}

function aiPing(app: ReturnType<typeof createApp>, workspaceId?: WorkspaceId) {
  return app.request("/jobs/ai-ping", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(workspaceId ? { [WORKSPACE_HEADER]: workspaceId } : {}),
    },
    body: JSON.stringify({}),
  });
}

describe("without a jobs context", () => {
  test("POST /jobs/ping → 503 service_unavailable", async () => {
    const res = await app.request("/jobs/ping", {
      method: "POST",
      headers: { "content-type": "application/json", [WORKSPACE_HEADER]: ws },
      body: JSON.stringify({ message: "hi" }),
    });
    expect(res.status).toBe(503);
    expect((await body(res)).error.code).toBe("service_unavailable");
  });

  test("POST /jobs/ai-ping applies defaults before the runtime check", async () => {
    const res = await app.request("/jobs/ai-ping", {
      method: "POST",
      headers: { "content-type": "application/json", [WORKSPACE_HEADER]: ws },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(503);
    expect((await body(res)).error.code).toBe("service_unavailable");
  });

  test("POST /jobs/ai-ping rejects a text/plain body before the runtime check", async () => {
    const res = await app.request("/jobs/ai-ping", {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        Origin: "https://app.example.test",
        [WORKSPACE_HEADER]: ws,
      },
      body: "x=1",
    });
    expect(res.status).toBe(400);
    const b = await body(res);
    expect(b.error.code).toBe("validation_failed");
    expect(b.error.fields).toEqual(["(body)"]);
  });

  test("POST /jobs/ping rejects a form body before the runtime check", async () => {
    const res = await app.request("/jobs/ping", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        Origin: "https://app.example.test",
        [WORKSPACE_HEADER]: ws,
      },
      body: "message=hi",
    });
    expect(res.status).toBe(400);
    const b = await body(res);
    expect(b.error.code).toBe("validation_failed");
    expect(b.error.fields).toEqual(["(body)"]);
  });

  test("POST /jobs/ping accepts application/json with parameters", async () => {
    const res = await app.request("/jobs/ping", {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        Origin: "https://app.example.test",
        [WORKSPACE_HEADER]: ws,
      },
      body: JSON.stringify({ message: "hi" }),
    });
    expect(res.status).toBe(503);
    expect((await body(res)).error.code).toBe("service_unavailable");
  });

  test("POST /jobs/ai-ping rejects an unknown model class", async () => {
    const res = await app.request("/jobs/ai-ping", {
      method: "POST",
      headers: { "content-type": "application/json", [WORKSPACE_HEADER]: ws },
      body: JSON.stringify({ class: "huge" }),
    });
    expect(res.status).toBe(400);
    expect((await body(res)).error.code).toBe("validation_failed");
  });

  test("GET /events → 503", async () => {
    const res = await app.request("/events", { headers: { [WORKSPACE_HEADER]: ws } });
    expect(res.status).toBe(503);
  });

  test("invalid body is rejected before the runtime check (400 validation_failed)", async () => {
    const res = await app.request("/jobs/ping", {
      method: "POST",
      headers: { "content-type": "application/json", [WORKSPACE_HEADER]: ws },
      body: JSON.stringify({ message: "", extra: 1 }),
    });
    expect(res.status).toBe(400);
    const b = await body(res);
    expect(b.error.code).toBe("validation_failed");
    expect(b.error.fields).toEqual(["message", "(root)"]); // strict: unknown key → root
  });

  test("non-uuid job id → 400 validation_failed", async () => {
    const res = await app.request("/jobs/not-a-uuid/cancel", {
      method: "POST",
      headers: { [WORKSPACE_HEADER]: ws },
    });
    expect(res.status).toBe(400);
    expect((await body(res)).error.fields).toEqual(["id"]);
  });
});

describe("AI request rate limit", () => {
  test("allows the limit, then returns 429 with Retry-After and isolates Workspaces", async () => {
    const app = limitedApp();
    const firstWorkspace = newId<WorkspaceId>();
    const secondWorkspace = newId<WorkspaceId>();

    expect((await aiPing(app, firstWorkspace)).status).toBe(503);
    expect((await aiPing(app, firstWorkspace)).status).toBe(503);

    const limited = await aiPing(app, firstWorkspace);
    expect(limited.status).toBe(429);
    expect((await body(limited)).error).toMatchObject({ code: "rate_limited", retryable: true });
    const retryAfter = Number(limited.headers.get("Retry-After"));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);

    expect((await aiPing(app, secondWorkspace)).status).toBe(503);
  });

  test("does not limit non-AI job routes", async () => {
    const app = limitedApp();
    const workspaceId = newId<WorkspaceId>();

    for (let index = 0; index < 3; index += 1) {
      const res = await app.request("/jobs/ping", {
        method: "POST",
        headers: { "content-type": "application/json", [WORKSPACE_HEADER]: workspaceId },
        body: JSON.stringify({ message: "hi" }),
      });
      expect(res.status).toBe(503);
    }
  });

  test("runs after the session guard", async () => {
    const res = await aiPing(limitedApp());
    expect(res.status).toBe(401);
    expect((await body(res)).error.code).toBe("unauthorized");
  });
});

describe("workspace seam (header shim outside production)", () => {
  test("missing header → 401 unauthorized", async () => {
    const res = await app.request("/events");
    expect(res.status).toBe(401);
    expect((await body(res)).error.code).toBe("unauthorized");
  });

  test("POST /jobs/ai-ping without a session → 401 unauthorized", async () => {
    const res = await app.request("/jobs/ai-ping", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    expect((await body(res)).error.code).toBe("unauthorized");
  });

  test("malformed header → 400 bad_request", async () => {
    const res = await app.request("/events", { headers: { [WORKSPACE_HEADER]: "nope" } });
    expect(res.status).toBe(400);
    expect((await body(res)).error.code).toBe("bad_request");
  });
});
