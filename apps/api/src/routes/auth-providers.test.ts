import { describe, expect, test } from "bun:test";
import type { DbHandle } from "@tj/db";
import { createApp } from "../app";
import { type Auth, type AuthEnv, createAuth } from "../auth/auth";
import { fakeSql, silentLogger, TEST_ENV } from "../test-helpers";

const mail = { send: async () => {} };
/** better-auth's drizzle adapter only looks at the handle when a query runs; none does here. */
const idleDb = {} as DbHandle["unsafeDb"];

const NO_PROVIDERS: AuthEnv = {
  ...TEST_ENV,
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789",
  BETTER_AUTH_URL: "http://localhost:3001",
  COOKIE_DOMAIN: undefined,
  COOKIE_SAMESITE: "lax",
  GOOGLE_CLIENT_ID: undefined,
  GOOGLE_CLIENT_SECRET: undefined,
  MICROSOFT_CLIENT_ID: undefined,
  MICROSOFT_CLIENT_SECRET: undefined,
};

function authWith(env: Partial<AuthEnv>): Auth {
  return createAuth({
    env: { ...NO_PROVIDERS, ...env },
    db: { sql: fakeSql(true).sql, unsafeDb: idleDb },
    mail,
    logger: silentLogger,
  });
}

describe("GET /auth-providers", () => {
  test("reports Microsoft when its credentials are set", async () => {
    const auth = authWith({ MICROSOFT_CLIENT_ID: "id", MICROSOFT_CLIENT_SECRET: "secret" });
    const app = createApp({ env: TEST_ENV, db: fakeSql(true), logger: silentLogger, auth });
    const res = await app.request("/auth-providers");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ google: false, microsoft: true });
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
  });

  test("reports Google alone, and neither without credentials", async () => {
    const google = authWith({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" });
    const none = authWith({});
    for (const [auth, expected] of [
      [google, { google: true, microsoft: false }],
      [none, { google: false, microsoft: false }],
    ] as const) {
      const app = createApp({ env: TEST_ENV, db: fakeSql(true), logger: silentLogger, auth });
      expect(await (await app.request("/auth-providers")).json()).toEqual(expected);
    }
  });

  test("needs no session, and says nothing is on when auth is not mounted", async () => {
    const app = createApp({ env: TEST_ENV, db: fakeSql(true), logger: silentLogger });
    const res = await app.request("/auth-providers");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ google: false, microsoft: false });
  });
});
