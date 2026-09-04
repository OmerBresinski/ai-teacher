/**
 * `GET /__test/last-magic-link` — the TEACH-22 capture route and its safety gate. No database:
 * `fakeSql` and a `CaptureMailSender` are enough.
 */
import { describe, expect, test } from "bun:test";
import { createApp } from "../app";
import { type Env, parseEnv } from "../env";
import { CaptureMailSender } from "../mail";
import { fakeSql, silentLogger, TEST_ENV } from "../test-helpers";
import { testRoutesEnabled } from "./test-routes";

const LINK = "http://localhost:3001/auth/magic-link/verify?token=abc&callbackURL=%2F";

function appWith(env: { NODE_ENV?: Env["NODE_ENV"]; ENABLE_TEST_ROUTES?: string }) {
  const mail = new CaptureMailSender();
  const app = createApp({
    env: { ...TEST_ENV, ...env },
    db: fakeSql(true),
    logger: silentLogger,
    testMail: mail,
  });
  return { app, mail };
}

describe("testRoutesEnabled", () => {
  test("requires NODE_ENV=test AND ENABLE_TEST_ROUTES=1", () => {
    expect(testRoutesEnabled({ NODE_ENV: "test", ENABLE_TEST_ROUTES: "1" })).toBe(true);
    expect(testRoutesEnabled({ NODE_ENV: "test", ENABLE_TEST_ROUTES: undefined })).toBe(false);
    expect(testRoutesEnabled({ NODE_ENV: "development", ENABLE_TEST_ROUTES: "1" })).toBe(false);
    expect(testRoutesEnabled({ NODE_ENV: "production", ENABLE_TEST_ROUTES: "1" })).toBe(false);
  });

  test("env.ts refuses ENABLE_TEST_ROUTES in production at boot", () => {
    const result = parseEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://x:y@localhost:5432/z",
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789",
      ENABLE_TEST_ROUTES: "1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        variable: "ENABLE_TEST_ROUTES",
        message: "Cannot be set when NODE_ENV=production",
      });
    }
  });
});

describe("GET /__test/last-magic-link", () => {
  test("is not mounted without the flag, even when a capture sender is passed", async () => {
    const { app } = appWith({});
    const res = await app.request("/__test/last-magic-link?email=t@example.test");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });

  test("is not mounted outside NODE_ENV=test", async () => {
    const { app } = appWith({ NODE_ENV: "development", ENABLE_TEST_ROUTES: "1" });
    const res = await app.request("/__test/last-magic-link?email=t@example.test");
    expect(res.status).toBe(404);
  });

  test("returns the last link sent to that address (case-insensitive), 404 before any", async () => {
    const { app, mail } = appWith({ ENABLE_TEST_ROUTES: "1" });

    const none = await app.request("/__test/last-magic-link?email=t@example.test");
    expect(none.status).toBe(404);
    expect(((await none.json()) as { error: { message: string } }).error.message).toBe(
      "No magic link has been sent to that address.",
    );

    await mail.send({ to: "other@example.test", subject: "s", text: `Open ${LINK}-other` });
    await mail.send({ to: "T@Example.test", subject: "s", text: `Hi\n\n${LINK}\n\nbye` });

    const res = await app.request("/__test/last-magic-link?email=t@example.test");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "T@Example.test", url: LINK });
  });

  test("validates the email query parameter", async () => {
    const { app } = appWith({ ENABLE_TEST_ROUTES: "1" });
    const res = await app.request("/__test/last-magic-link?email=nope");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; fields: string[] } };
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.fields).toEqual(["email"]);
  });
});

describe("CaptureMailSender forwarding", () => {
  test("records and forwards to the wrapped sender", async () => {
    const inner = new CaptureMailSender();
    const outer = new CaptureMailSender(inner);
    await outer.send({ to: "a@example.test", subject: "s", text: LINK });
    expect(outer.lastFor("A@example.test")?.text).toBe(LINK);
    expect(inner.last?.to).toBe("a@example.test");
  });
});
