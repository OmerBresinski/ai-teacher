import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import { createAi } from "@tj/ai";
import { createFakeAi } from "@tj/ai/testing";
import { FALLBACK_GREETING, newId, type WorkspaceId } from "@tj/domain";
import pino from "pino";
import { createApp } from "../app";
import { fakeSql, TEST_ENV } from "../test-helpers";
import { WORKSPACE_HEADER } from "../workspace";

const workspaceId = newId<WorkspaceId>();

function createMemoryLogger() {
  const lines: string[] = [];
  const logger = pino(
    { level: "info" },
    new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    }),
  );
  return { lines, logger };
}

function greetingRequest(app: ReturnType<typeof createApp>, query = "") {
  return app.request(`/me/greeting${query}`, { headers: { [WORKSPACE_HEADER]: workspaceId } });
}

describe("GET /me/greeting", () => {
  test("returns a model greeting with no-store and content-free model telemetry", async () => {
    const { lines, logger } = createMemoryLogger();
    const app = createApp({
      env: TEST_ENV,
      db: fakeSql(true),
      logger,
      ai: createFakeAi({
        logger,
        text: "Fresh coffee, fresh lesson plans.",
        usage: { inputTokens: 40, outputTokens: 9 },
      }),
    });

    const res = await greetingRequest(app, "?weekday=Friday");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({
      text: "Fresh coffee, fresh lesson plans.",
      source: "model",
    });

    const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(
      records.filter((record) => (record.ai as { class?: string } | undefined)?.class === "small"),
    ).toHaveLength(1);
    const serialized = lines.join("");
    expect(serialized).not.toContain("Fresh coffee");
    expect(serialized).not.toContain("school teacher");
  });

  test("returns fallback when AI is unconfigured", async () => {
    const app = createApp({
      env: TEST_ENV,
      db: fakeSql(true),
      ai: createAi({}),
    });
    const res = await greetingRequest(app);
    expect(await res.json()).toEqual({ text: FALLBACK_GREETING, source: "fallback" });
  });

  test("returns fallback when AI is absent", async () => {
    const app = createApp({ env: TEST_ENV, db: fakeSql(true) });
    const res = await greetingRequest(app);
    expect(await res.json()).toEqual({ text: FALLBACK_GREETING, source: "fallback" });
  });

  test("falls back without logging provider content", async () => {
    const { lines, logger } = createMemoryLogger();
    const app = createApp({
      env: TEST_ENV,
      db: fakeSql(true),
      logger,
      ai: createFakeAi({ logger, error: new Error("private provider body") }),
    });

    const res = await greetingRequest(app);
    expect(await res.json()).toEqual({ text: FALLBACK_GREETING, source: "fallback" });
    const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const warns = records.filter((record) => record.level === 40 && record.greeting === "fallback");
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ aiErrorCode: "provider" });
    const serialized = lines.join("");
    expect(serialized).not.toContain("private provider body");
    expect(serialized).not.toContain("school teacher");
  });

  test("sanitises a quoted exclamatory completion", async () => {
    const app = createApp({
      env: TEST_ENV,
      db: fakeSql(true),
      ai: createFakeAi({ text: '  "Hello there, Ada!"  ' }),
    });
    const res = await greetingRequest(app);
    expect(await res.json()).toEqual({ text: "Hello there, Ada.", source: "model" });
  });

  test("falls back for empty completion text", async () => {
    const app = createApp({
      env: TEST_ENV,
      db: fakeSql(true),
      ai: createFakeAi({ text: "   " }),
    });
    const res = await greetingRequest(app);
    expect(await res.json()).toEqual({ text: FALLBACK_GREETING, source: "fallback" });
  });

  test("rejects an invalid weekday", async () => {
    const app = createApp({ env: TEST_ENV, db: fakeSql(true) });
    const res = await greetingRequest(app, "?weekday=Funday");
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toMatchObject({
      error: { code: "validation_failed", fields: ["weekday"] },
    });
  });

  test("does not call the model after the Workspace limit is reached", async () => {
    const { lines, logger } = createMemoryLogger();
    const app = createApp({
      env: TEST_ENV,
      db: fakeSql(true),
      logger,
      ai: createFakeAi({ logger, usage: { inputTokens: 2, outputTokens: 1 } }),
      rateLimit: { limit: 2, windowMs: 60_000 },
    });

    expect((await greetingRequest(app)).status).toBe(200);
    expect((await greetingRequest(app)).status).toBe(200);
    const logCountBeforeLimitedRequest = lines.length;

    const limited = await greetingRequest(app);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(await limited.json()).toMatchObject({
      error: { code: "rate_limited", retryable: true },
    });

    const laterRecords = lines
      .slice(logCountBeforeLimitedRequest)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(laterRecords.filter((record) => record.ai !== undefined)).toEqual([]);
  });

  test("requires a session", async () => {
    const app = createApp({ env: TEST_ENV, db: fakeSql(true) });
    const res = await app.request("/me/greeting");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "unauthorized" } });
  });
});

describe("GET /me", () => {
  test("requires a session", async () => {
    const app = createApp({ env: TEST_ENV, db: fakeSql(true) });
    const res = await app.request("/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "unauthorized" } });
  });
});
