/** Unit tests for `/jobs/*` and `/events` that need no database: 503 without pg-boss, seam errors. */
import { describe, expect, test } from "bun:test";
import { newId, type WorkspaceId } from "@tj/domain";
import { testApp } from "../test-helpers";
import { WORKSPACE_HEADER } from "../workspace";

const app = testApp();
const ws = newId<WorkspaceId>();

async function body(res: Response) {
  return (await res.json()) as { error: { code: string; fields?: string[] } };
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
