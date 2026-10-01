/**
 * Integration (TEACH-243): Cloudflare Turnstile on `POST /auth/sign-in/magic-link` and
 * `POST /auth/sign-in/anonymous` through better-auth's captcha plugin, against the real test
 * database (skips visibly when unreachable). Cloudflare's siteverify is stubbed by intercepting
 * `fetch` for its URL, so nothing leaves the machine.
 */
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { cookieHeaderFromResponse, withTestDb } from "@tj/db/testing";
import { createApp } from "./app";
import { type AuthEnv, createAuth } from "./auth/auth";
import { CAPTCHA_ENDPOINTS, CAPTCHA_HEADER, captchaPlugins } from "./auth/captcha";
import { CaptureMailSender } from "./mail";
import { silentLogger, TEST_ENV } from "./test-helpers";

const t = await withTestDb({ max: 4 });
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping auth captcha db tests: ${t.reason}`);

const BASE = "http://localhost:3001";
const WEB = "http://localhost:5173";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Cloudflare's documented always-pass test secret. */
const PASS_SECRET = "1x0000000000000000000000000000000AA";

const AUTH_ENV: AuthEnv = {
  ...TEST_ENV,
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789",
  BETTER_AUTH_URL: BASE,
  COOKIE_DOMAIN: undefined,
  COOKIE_SAMESITE: "lax",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  MICROSOFT_CLIENT_ID: undefined,
  MICROSOFT_CLIENT_SECRET: undefined,
  TURNSTILE_SECRET_KEY: PASS_SECRET,
};

test("captchaPlugins: nothing without a secret, both sign-in endpoints with one", () => {
  expect(captchaPlugins({ TURNSTILE_SECRET_KEY: undefined })).toEqual([]);
  const [plugin, ...rest] = captchaPlugins({ TURNSTILE_SECRET_KEY: PASS_SECRET });
  expect(rest).toEqual([]);
  expect(plugin?.id).toBe("captcha");
  expect((plugin as { options?: unknown }).options).toMatchObject({
    provider: "cloudflare-turnstile",
    secretKey: PASS_SECRET,
    endpoints: ["/sign-in/anonymous", "/sign-in/magic-link"],
  });
  expect(CAPTCHA_ENDPOINTS).not.toContain("/sign-in/social");
});

describeDb("Turnstile on sign-in (captcha plugin)", () => {
  if (!t.ok) return;
  const db = t.db;
  const mail = new CaptureMailSender();
  const auth = createAuth({ env: AUTH_ENV, db, mail, logger: silentLogger });
  const app = createApp({
    env: TEST_ENV,
    db,
    logger: silentLogger,
    auth,
  });

  /** What the stub answers; `"down"` makes siteverify unreachable. */
  let verdict: "pass" | "fail" | "down" = "pass";
  const verified: { secret: string; response: string }[] = [];
  const realFetch = globalThis.fetch;
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

  beforeEach(async () => {
    await db.truncateTenantTables();
    mail.clear();
    verdict = "pass";
    verified.length = 0;
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.startsWith(SITEVERIFY)) return realFetch(input, init);
      verified.push(JSON.parse(String(init?.body)) as { secret: string; response: string });
      if (verdict === "down") return new Response("unavailable", { status: 503 });
      const body =
        verdict === "pass"
          ? { success: true, hostname: "localhost", "error-codes": [] }
          : { success: false, "error-codes": ["invalid-input-response"] };
      return Response.json(body);
    }) as typeof fetch);
  });
  afterEach(() => fetchSpy.mockRestore());
  afterAll(() => db.close());

  function post(path: string, body: unknown, token?: string) {
    return app.request(`${BASE}/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: WEB,
        ...(token === undefined ? {} : { [CAPTCHA_HEADER]: token }),
      },
      body: JSON.stringify(body),
    });
  }
  const magicLink = (token?: string) =>
    post("/sign-in/magic-link", { email: "ada@example.test", callbackURL: `${WEB}/` }, token);
  const anonymous = (token?: string) => post("/sign-in/anonymous", {}, token);
  async function usersCount() {
    return Number((await db.sql`select count(*)::text as c from users`)[0]?.c);
  }

  test("row 1: magic link without a token → 400 MISSING_RESPONSE, no mail, siteverify not called", async () => {
    const res = await magicLink();
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "MISSING_RESPONSE" });
    expect(mail.last).toBeUndefined();
    expect(verified).toEqual([]);
  });

  test("row 2: magic link with a token siteverify rejects → 403 VERIFICATION_FAILED, no mail", async () => {
    verdict = "fail";
    const res = await magicLink("forged-token");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "VERIFICATION_FAILED" });
    expect(mail.last).toBeUndefined();
    expect(verified).toEqual([expect.objectContaining({ response: "forged-token" })]);
  });

  test("row 3: magic link with a valid token → 200 and the mail is sent as today", async () => {
    const res = await magicLink("XXXX.DUMMY.TOKEN.XXXX");
    expect(res.status).toBe(200);
    expect(mail.last?.to).toBe("ada@example.test");
    expect(verified).toEqual([
      expect.objectContaining({ secret: PASS_SECRET, response: "XXXX.DUMMY.TOKEN.XXXX" }),
    ]);
  });

  test("row 4: anonymous sign-in → 400 without a token (no user), 200 with one", async () => {
    const missing = await anonymous();
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ code: "MISSING_RESPONSE" });
    expect(cookieHeaderFromResponse(missing)).not.toContain("tj.session_token=");

    verdict = "fail";
    const failed = await anonymous("forged-token");
    expect(failed.status).toBe(403);
    expect(await usersCount()).toBe(0);

    verdict = "pass";
    const ok = await anonymous("XXXX.DUMMY.TOKEN.XXXX");
    expect(ok.status).toBe(200);
    expect(cookieHeaderFromResponse(ok)).toContain("tj.session_token=");
    expect(await usersCount()).toBe(1);
  });

  test("the daily cap answers before Turnstile: cap 0 → 403 anonymous_capacity, no siteverify", async () => {
    const full = createApp({
      env: { ...TEST_ENV, ANONYMOUS_LESSONS_DAILY_CAP: 0 },
      db,
      logger: silentLogger,
      auth,
    });
    const res = await full.request(`${BASE}/auth/sign-in/anonymous`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: WEB, [CAPTCHA_HEADER]: "t" },
      body: "{}",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "anonymous_capacity" } });
    expect(verified).toEqual([]);
    expect(await usersCount()).toBe(0);
  });

  test("the per-IP ceiling counts sign-ins: refused Turnstile attempts do not use it up", async () => {
    const strict = createApp({
      env: { ...TEST_ENV, ANONYMOUS_SIGNINS_PER_IP_DAILY: 1 },
      db,
      logger: silentLogger,
      auth,
    });
    const fromSchool = (token?: string) =>
      strict.request(`${BASE}/auth/sign-in/anonymous`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: WEB,
          "x-forwarded-for": "192.0.2.61",
          ...(token === undefined ? {} : { [CAPTCHA_HEADER]: token }),
        },
        body: "{}",
      });
    for (let i = 0; i < 3; i++) expect((await fromSchool()).status).toBe(400);
    verdict = "fail";
    expect((await fromSchool("forged-token")).status).toBe(403);

    verdict = "pass";
    const ok = await fromSchool("XXXX.DUMMY.TOKEN.XXXX");
    expect(ok.status).toBe(200);
    const over = await fromSchool("XXXX.DUMMY.TOKEN.XXXX");
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: { code: "rate_limited" } });
    expect(await usersCount()).toBe(1);
  });

  test("row 5: Google sign-in is not gated", async () => {
    const res = await post("/sign-in/social", {
      provider: "google",
      callbackURL: `${WEB}/`,
      disableRedirect: true,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { url: string }).url).toStartWith("https://accounts.google.com/");
    expect(verified).toEqual([]);
  });

  test("siteverify unreachable → 500, no mail (fails closed)", async () => {
    verdict = "down";
    const res = await magicLink("XXXX.DUMMY.TOKEN.XXXX");
    expect(res.status).toBe(500);
    expect(mail.last).toBeUndefined();
  });

  test("a trailing slash or other casing cannot skip the check", async () => {
    for (const path of ["/sign-in/magic-link/", "/sign-in//magic-link"]) {
      const res = await post(path, { email: "ada@example.test", callbackURL: `${WEB}/` });
      expect([400, 404]).toContain(res.status);
      expect(mail.last).toBeUndefined();
    }
  });
});
