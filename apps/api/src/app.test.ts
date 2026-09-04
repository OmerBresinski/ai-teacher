import { describe, expect, test } from "bun:test";
import { HTTPException } from "hono/http-exception";
import pino from "pino";
import { createApp } from "./app";
import type { ErrorEnvelope } from "./errors";

const errorBody = (res: Response) => res.json() as Promise<ErrorEnvelope>;

import { fakeSql, silentLogger, TEST_ENV, TEST_ENV_NO_SHIM, testApp } from "./test-helpers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("GET /hello", () => {
  test("200 with a greeting", async () => {
    const res = await testApp().request("/hello?name=x");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Hello, x" });
  });

  test("400 validation_failed with fields when name is empty", async () => {
    const res = await testApp().request("/hello?name=");
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.fields).toEqual(["name"]);
    expect(body.error.retryable).toBe(false);
    expect(body.error.requestId).toMatch(UUID_RE);
    expect(body.error.message).not.toMatch(/\d{3}|stack|Error/);
  });

  test("400 validation_failed when name is missing", async () => {
    const res = await testApp().request("/hello");
    expect(res.status).toBe(400);
    expect((await errorBody(res)).error.fields).toEqual(["name"]);
  });
});

describe("boot warnings", () => {
  test("warns when production has opted in to console mail", () => {
    const lines: string[] = [];
    const logger = pino(
      { level: "trace" },
      {
        write(line) {
          lines.push(line);
        },
      },
    );
    createApp({
      env: { ...TEST_ENV_NO_SHIM, NODE_ENV: "production" },
      db: fakeSql(true),
      logger,
    });
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] ?? "") as { level: number; msg: string };
    expect(line.level).toBe(40);
    expect(line.msg).toBe(
      "ALLOW_CONSOLE_MAIL_IN_PRODUCTION=1: magic-link sign-in URLs are printed to this log. Remove the variable once a real MailSender (TEACH-29) is configured.",
    );
  });

  test("warns when the workspace header shim is enabled", () => {
    const lines: string[] = [];
    const logger = pino(
      { level: "trace" },
      {
        write(line) {
          lines.push(line);
        },
      },
    );
    createApp({ env: TEST_ENV, db: fakeSql(true), logger });
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] ?? "") as { level: number; msg: string };
    expect(line.level).toBe(40);
    expect(line.msg).toContain("ALLOW_WORKSPACE_HEADER_SHIM");
  });
});

describe("GET /health", () => {
  test("503 envelope with retryable: true when the database is down", async () => {
    const res = await testApp(fakeSql(false)).request("/health");
    expect(res.status).toBe(503);
    const body = await errorBody(res);
    expect(body.error).toMatchObject({
      code: "service_unavailable",
      retryable: true,
      message: "The database is unreachable.",
    });
    expect(body.error.requestId).toMatch(UUID_RE);
  });

  test("200 with a fake sql that resolves", async () => {
    const res = await testApp(fakeSql(true)).request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: "up" });
  });
});

describe("request id", () => {
  test("echoes x-request-id when provided", async () => {
    const res = await testApp().request("/hello?name=x", { headers: { "x-request-id": "abc-1" } });
    expect(res.headers.get("x-request-id")).toBe("abc-1");
  });

  test("generates a UUID otherwise", async () => {
    const res = await testApp().request("/hello?name=x");
    expect(res.headers.get("x-request-id")).toMatch(UUID_RE);
  });

  test("is present on error responses (header and body)", async () => {
    const res = await testApp().request("/nope", { headers: { "x-request-id": "err-7" } });
    expect(res.headers.get("x-request-id")).toBe("err-7");
    expect((await errorBody(res)).error.requestId).toBe("err-7");
  });
});

describe("CORS", () => {
  const preflight = (origin: string) =>
    testApp().request("/hello", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "content-type",
      },
    });

  test("allowed origin gets ACAO + credentials", async () => {
    const res = await preflight("http://localhost:5173");
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(res.headers.get("Access-Control-Max-Age")).toBe("600");
  });

  test("disallowed origin gets no CORS headers", async () => {
    const res = await preflight("https://evil.example");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  test("origin matching a WEB_ORIGIN_PATTERNS glob is allowed (Vercel previews)", async () => {
    const ok = await preflight("https://teaching-journey-web-git-x-preview.example.test");
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://teaching-journey-web-git-x-preview.example.test",
    );
    expect(ok.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    const nested = await preflight("https://a.b-preview.example.test");
    expect(nested.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  test("simple request from an allowed origin is reflected", async () => {
    const res = await testApp().request("/hello?name=x", {
      headers: { Origin: "https://app.example.test" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.test");
    expect(res.headers.get("Vary")).toContain("Origin");
  });
});

describe("errors", () => {
  test("unknown route → 404 envelope", async () => {
    const res = await testApp().request("/does-not-exist");
    expect(res.status).toBe(404);
    const body = await errorBody(res);
    expect(body.error).toMatchObject({ code: "not_found", retryable: false });
    expect(body.error.requestId).toMatch(UUID_RE);
  });

  test("thrown Error → 500 envelope with a generic message", async () => {
    const app = createApp({ env: TEST_ENV, db: fakeSql(true), logger: silentLogger });
    app.get("/boom", () => {
      throw new Error("secret database password leaked");
    });
    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    const body = await errorBody(res);
    expect(body.error.code).toBe("internal_error");
    expect(body.error.message).not.toContain("secret");
    expect(body.error.message).toBe("Something went wrong on our side. Please try again.");
    expect(res.headers.get("x-request-id")).toMatch(UUID_RE);
  });

  test("HTTPException → its status and mapped code", async () => {
    const app = createApp({ env: TEST_ENV, db: fakeSql(true), logger: silentLogger });
    app.get("/forbidden", () => {
      throw new HTTPException(403, { message: "You cannot edit this Journey." });
    });
    app.get("/teapot", () => {
      throw new HTTPException(418);
    });
    const forbidden = await app.request("/forbidden");
    expect(forbidden.status).toBe(403);
    expect((await errorBody(forbidden)).error).toMatchObject({
      code: "forbidden",
      message: "You cannot edit this Journey.",
      retryable: false,
    });
    const teapot = await app.request("/teapot");
    expect(teapot.status).toBe(418);
    expect((await errorBody(teapot)).error.code).toBe("http_error");
  });

  test("security headers are set", async () => {
    const res = await testApp().request("/hello?name=x");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
  });
});
