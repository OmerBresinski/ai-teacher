/**
 * TEACH-222 rows 4–6 without a database: the anonymous guard's default-deny allow-list, and a
 * sweep of every write route the app registers so a new route cannot open to anonymous users
 * without being listed.
 */
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createApp } from "../app";
import type { AppEnv, SessionUser } from "../context";
import { silentLogger, TEST_ENV } from "../test-helpers";
import { anonymousGuard, isAnonymousAllowed } from "./anonymous-guard";

const ID = "0b5c3a52-5d0f-4a4e-9a55-3f7f0d2c1e11";

function guarded(user: Partial<SessionUser> | undefined) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    if (user) c.set("user", user as SessionUser);
    await next();
  });
  app.use("*", anonymousGuard());
  app.all("*", (c) => c.json({ ok: true }, 200));
  return app;
}

const REFUSED: Array<[string, string]> = [
  ["PUT", `/documents/${ID}`],
  ["POST", "/documents"],
  ["DELETE", `/documents/${ID}`],
  ["POST", `/documents/${ID}/restore`],
  ["POST", `/lessons/${ID}/worksheet`],
  ["POST", `/lessons/${ID}/regenerate`],
  ["POST", `/lessons/${ID}/cascade`],
  ["POST", "/sources"],
  ["DELETE", `/sources/${ID}`],
  ["POST", "/briefs/parse"],
  ["POST", "/images/pick"],
  ["POST", "/images/report"],
  ["POST", "/jobs/ping"],
];

const ALLOWED: Array<[string, string]> = [
  ["POST", "/lessons"],
  ["POST", `/lessons/${ID}/plan`],
  ["POST", `/lessons/${ID}/generate`],
  ["POST", `/jobs/${ID}/cancel`],
  ["GET", `/documents/${ID}`],
  ["GET", "/documents"],
  ["GET", "/events"],
  ["GET", `/files/${ID}/images/a.png`],
  ["GET", "/me"],
  ["GET", `/lessons/${ID}/worksheets`],
];

describe("anonymousGuard", () => {
  test.each(REFUSED)("anonymous %s %s → 403 sign_in_required", async (method, path) => {
    const res = await guarded({ id: "anon", isAnonymous: true }).request(path, { method });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: {
        code: "sign_in_required",
        message: "Sign in to edit, export and save.",
        retryable: false,
      },
    });
  });

  test.each(ALLOWED)("anonymous %s %s passes", async (method, path) => {
    const res = await guarded({ id: "anon", isAnonymous: true }).request(path, { method });
    expect(res.status).toBe(200);
  });

  test.each(REFUSED)("signed-in %s %s is untouched", async (method, path) => {
    const res = await guarded({ id: "teacher", isAnonymous: false }).request(path, { method });
    expect(res.status).toBe(200);
  });

  test("no user (the dev header shim) is untouched", async () => {
    const res = await guarded(undefined).request(`/documents/${ID}`, { method: "PUT" });
    expect(res.status).toBe(200);
  });

  test("a trailing slash does not change the answer", () => {
    expect(isAnonymousAllowed("POST", "/lessons/")).toBe(true);
    expect(isAnonymousAllowed("POST", `/lessons/${ID}/worksheet/`)).toBe(false);
    expect(isAnonymousAllowed("POST", `/lessons/${ID}/plan/extra`)).toBe(false);
  });

  test("every write route the app registers is refused except the four allowed", () => {
    const app = createApp({ env: TEST_ENV, db: {} as never, logger: silentLogger });
    const writes = app.routes
      .filter((r) => !["GET", "HEAD", "OPTIONS", "ALL"].includes(r.method))
      .filter((r) => !r.path.startsWith("/auth") && !r.path.startsWith("/__test"))
      .map((r) => `${r.method} ${r.path}`);
    const allowed = [...new Set(writes)].filter((w) => {
      const [method, path] = w.split(" ") as [string, string];
      return isAnonymousAllowed(method, path.replaceAll(/:[a-zA-Z]+/g, ID));
    });
    expect(allowed.sort()).toEqual([
      "POST /jobs/:id/cancel",
      "POST /lessons",
      "POST /lessons/:id/generate",
      "POST /lessons/:id/plan",
    ]);
    // Sanity: the sweep saw the refused ones too.
    expect(writes).toContain("PUT /documents/:id");
    expect(writes).toContain("POST /lessons/:id/worksheet");
  });
});
