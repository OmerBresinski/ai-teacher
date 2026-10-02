/**
 * Integration: the Google round trip against the real test database, with Google's token endpoint
 * stubbed on `globalThis.fetch` (TEACH-311, ADR 0008 amendment of 2026-09-27). No credentials and
 * no network: the id token is an unsigned JWT, which better-auth's Google `getUserInfo` only
 * decodes. Skips visibly when the database is unreachable.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createDocument, forWorkspace } from "@tj/db";
import { cookieHeaderFromResponse, withTestDb } from "@tj/db/testing";
import type { WorkspaceId } from "@tj/domain";
import { generatedLesson } from "@tj/domain/documents/fixtures";
import { createApp } from "./app";
import { type AuthEnv, createAuth } from "./auth/auth";
import { CaptureMailSender, extractFirstUrl } from "./mail";
import { captureLogger, silentLogger, TEST_ENV, verifyUrlFromEmailLink } from "./test-helpers";

const t = await withTestDb({ max: 4 });
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping google auth db tests: ${t.reason}`);

const BASE = "http://localhost:3001";
const WEB = "http://localhost:5173";
const ERROR_CALLBACK = `${WEB}/sign-in?redirect=%2F`;
const GOOGLE_ISSUER = "https://accounts.google.com";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const AUTH_ENV: AuthEnv = {
  ...TEST_ENV,
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789",
  BETTER_AUTH_URL: BASE,
  COOKIE_DOMAIN: undefined,
  COOKIE_SAMESITE: "lax",
  GOOGLE_CLIENT_ID: "test-google-id",
  GOOGLE_CLIENT_SECRET: "test-google-secret",
  MICROSOFT_CLIENT_ID: undefined,
  MICROSOFT_CLIENT_SECRET: undefined,
};

/** The id token claims better-auth reads from Google. */
interface GoogleProfile {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture: string;
}

const ADA: GoogleProfile = {
  sub: "g-1",
  email: "new@example.test",
  email_verified: true,
  name: "Ada Google",
  picture: "https://lh3.googleusercontent.com/a/x",
};

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** Three well-formed parts: a malformed token throws outside the redirect path (a 500). */
function unsignedIdToken(profile: GoogleProfile): string {
  const iat = Math.floor(Date.now() / 1000);
  const claims = { iss: GOOGLE_ISSUER, aud: AUTH_ENV.GOOGLE_CLIENT_ID, iat, exp: iat + 3600 };
  return `${base64url({ alg: "RS256", typ: "JWT" })}.${base64url({ ...claims, ...profile })}.sig`;
}

const realFetch = globalThis.fetch;

/** Google's token endpoint answers with `profile`'s id token; any other fetch is a test bug. */
function stubGoogleTokenEndpoint(profile: GoogleProfile): string[] {
  const seen: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    seen.push(url);
    if (url !== GOOGLE_TOKEN_ENDPOINT) return new Response("unexpected fetch", { status: 500 });
    return Response.json({
      access_token: "google-access-token",
      refresh_token: "google-refresh-token",
      id_token: unsignedIdToken(profile),
      expires_in: 3600,
      token_type: "Bearer",
      scope: "openid email profile",
    });
  }) as typeof globalThis.fetch;
  return seen;
}

describeDb("auth (Google sign-in, token endpoint stubbed)", () => {
  if (!t.ok) return;
  const db = t.db;
  const mail = new CaptureMailSender();
  const authLog = captureLogger();
  const auth = createAuth({ env: AUTH_ENV, db, mail, logger: authLog.logger });
  const app = createApp({ env: TEST_ENV, db, logger: silentLogger, auth });

  afterAll(() => db.close());
  beforeEach(async () => {
    await db.truncateTenantTables();
    mail.clear();
    authLog.lines.length = 0;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /**
   * `POST /auth/sign-in/social` as the web sends it, from a browser holding `browser`'s cookies if
   * given; returns the state and the browser's cookies with the state cookie added.
   */
  async function startGoogleSignIn(browser?: string) {
    const res = await app.request(`${BASE}/auth/sign-in/social`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: WEB,
        ...(browser ? { cookie: browser } : {}),
      },
      body: JSON.stringify({
        provider: "google",
        callbackURL: `${WEB}/`,
        errorCallbackURL: ERROR_CALLBACK,
        disableRedirect: true,
      }),
    });
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    const state = new URL(url).searchParams.get("state");
    if (!state) throw new Error("no state in the Google authorization URL");
    const cookie = [browser, cookieHeaderFromResponse(res)].filter(Boolean).join("; ");
    expect(cookie).toContain("tj.state=");
    return { state, cookie };
  }

  function googleCallback(query: URLSearchParams, cookie: string) {
    return app.request(`${BASE}/auth/callback/google?${query}`, {
      headers: { cookie },
      redirect: "manual",
    });
  }

  /** Start, let Google answer with `profile`, and follow the callback without redirecting. */
  async function signInWithGoogle(profile: GoogleProfile, browser?: string) {
    const { state, cookie } = await startGoogleSignIn(browser);
    const seen = stubGoogleTokenEndpoint(profile);
    const res = await googleCallback(new URLSearchParams({ code: "c", state }), cookie);
    expect(seen).toEqual([GOOGLE_TOKEN_ENDPOINT]);
    return res;
  }

  /** A magic-link user, created the way production creates one (`name: ""`). */
  async function signInWithMagicLink(email: string): Promise<string> {
    const sent = await app.request(`${BASE}/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: WEB },
      body: JSON.stringify({ email, callbackURL: `${WEB}/` }),
    });
    expect(sent.status).toBe(200);
    const link = verifyUrlFromEmailLink(extractFirstUrl(mail.last?.text ?? ""), BASE);
    expect((await app.request(link, { redirect: "manual" })).status).toBe(302);
    const user = await userByEmail(email);
    if (!user) throw new Error(`no user for ${email}`);
    expect(user.name).toBe("");
    return user.id;
  }

  async function userByEmail(email: string) {
    const [row] = await db.sql<
      { id: string; name: string; image: string | null; email_verified: boolean }[]
    >`select id, name, image, email_verified from users where email = ${email}`;
    return row;
  }
  async function accountsOf(userId: string) {
    const rows = await db.sql<
      {
        provider_id: string;
        issuer: string;
        account_id: string;
        access_token: string | null;
        refresh_token: string | null;
        id_token: string | null;
      }[]
    >`select provider_id, issuer, account_id, access_token, refresh_token, id_token
      from accounts where user_id = ${userId}`;
    return [...rows];
  }
  async function workspaceCount(userId: string) {
    const [row] = await db.sql<{ c: string }[]>`
      select count(*)::text as c from workspaces where owner_user_id = ${userId}`;
    return Number(row?.c);
  }
  function googleAccount(accountId: string) {
    return {
      provider_id: "google",
      issuer: GOOGLE_ISSUER,
      account_id: accountId,
      access_token: null,
      refresh_token: null,
      id_token: null,
    };
  }

  test("a new Google user gets a user, a personal Workspace and an accounts row with no tokens", async () => {
    const res = await signInWithGoogle(ADA);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${WEB}/`);
    const cookie = cookieHeaderFromResponse(res);
    expect(cookie).toContain("tj.session_token=");

    const user = await userByEmail(ADA.email);
    expect(user).toMatchObject({ name: "Ada Google", image: ADA.picture, email_verified: true });
    const userId = user?.id ?? "";
    expect(await workspaceCount(userId)).toBe(1);
    expect(await accountsOf(userId)).toEqual([googleAccount("g-1")]);

    // The session is a real one: requireSession resolves it to the new Workspace.
    const me = await app.request(`${BASE}/me`, { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { id: string } }).user.id).toBe(userId);
  });

  test("TEACH-224 row 2: a new Google account in the visitor's browser takes the lesson", async () => {
    const anon = await app.request(`${BASE}/auth/sign-in/anonymous`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: WEB },
      body: "{}",
    });
    const anonCookie = cookieHeaderFromResponse(anon);
    const visitor = (await (
      await app.request(`${BASE}/me`, { headers: { cookie: anonCookie } })
    ).json()) as { user: { id: string }; workspaceId: string };
    const lesson = await createDocument(
      forWorkspace(db.unsafeDb, visitor.workspaceId as WorkspaceId),
      "lesson",
      generatedLesson(),
    );

    const res = await signInWithGoogle(ADA, anonCookie);
    expect(res.status).toBe(302);
    const cookie = cookieHeaderFromResponse(res);
    const userId = (await userByEmail(ADA.email))?.id ?? "";
    const me = await app.request(`${BASE}/me`, { headers: { cookie } });
    expect(((await me.json()) as { workspaceId: string }).workspaceId).toBe(visitor.workspaceId);
    expect(await workspaceCount(userId)).toBe(1);
    expect(await workspaceCount(visitor.user.id)).toBe(0);
    const doc = await app.request(`${BASE}/documents/${lesson.id}`, { headers: { cookie } });
    expect(doc.status).toBe(200);
    const claims = authLog.lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.msg === "anonymous workspace claim");
    expect(claims).toEqual([
      expect.objectContaining({
        claim: "claimed",
        via: "link",
        anonymousUserId: visitor.user.id,
        userId,
      }),
    ]);
  });

  test("a verified Google email links to the magic-link user and copies name and photo once", async () => {
    const userId = await signInWithMagicLink("ml@example.test");

    const res = await signInWithGoogle({ ...ADA, sub: "g-2", email: "ml@example.test" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${WEB}/`);
    expect(cookieHeaderFromResponse(res)).toContain("tj.session_token=");

    expect(await userByEmail("ml@example.test")).toEqual({
      id: userId,
      name: "Ada Google",
      image: ADA.picture,
      email_verified: true,
    });
    expect(await workspaceCount(userId)).toBe(1);
    expect(await accountsOf(userId)).toEqual([googleAccount("g-2")]);
  });

  test("an unverified Google email does not link: account_not_linked on the errorCallbackURL", async () => {
    const userId = await signInWithMagicLink("ml@example.test");

    const res = await signInWithGoogle({
      ...ADA,
      sub: "g-3",
      email: "ml@example.test",
      email_verified: false,
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toStartWith(ERROR_CALLBACK);
    expect(new URL(location).searchParams.get("error")).toBe("account_not_linked");
    expect(cookieHeaderFromResponse(res)).not.toContain("tj.session_token=");

    expect(await accountsOf(userId)).toEqual([]);
    expect((await userByEmail("ml@example.test"))?.name).toBe("");
  });

  test("a later Google sign-in changes neither name nor photo and still stores no tokens", async () => {
    expect((await signInWithGoogle(ADA)).status).toBe(302);
    const userId = (await userByEmail(ADA.email))?.id ?? "";

    const again = await signInWithGoogle({
      ...ADA,
      name: "Changed",
      picture: "https://lh3.googleusercontent.com/a/changed",
    });
    expect(again.status).toBe(302);
    expect(again.headers.get("location")).toBe(`${WEB}/`);

    expect(await userByEmail(ADA.email)).toMatchObject({
      id: userId,
      name: "Ada Google",
      image: ADA.picture,
    });
    expect(await accountsOf(userId)).toEqual([googleAccount("g-1")]);
  });

  test("a cancelled consent (error=access_denied) returns to the errorCallbackURL", async () => {
    const { state, cookie } = await startGoogleSignIn();
    const seen = stubGoogleTokenEndpoint(ADA);

    const res = await googleCallback(
      new URLSearchParams({ error: "access_denied", state }),
      cookie,
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toStartWith(ERROR_CALLBACK);
    expect(new URL(location).searchParams.get("error")).toBe("access_denied");
    expect(seen).toEqual([]);
    expect(await userByEmail(ADA.email)).toBeUndefined();
  });

  test("a callback without state lands on the web's /sign-in, not the api's error page", async () => {
    const res = await googleCallback(new URLSearchParams({ code: "c" }), "");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${WEB}/sign-in?error=state_not_found`);
  });
});
