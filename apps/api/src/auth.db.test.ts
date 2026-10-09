/**
 * Integration: the magic-link flow end to end against the real test database (skips visibly when
 * unreachable). Cookies are captured from `Set-Cookie` and replayed by hand, as a browser would.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  spyOn,
  test,
} from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocument, forWorkspace, insertJobEvent } from "@tj/db";
import {
  cookieHeaderFromResponse,
  createTestUserWithWorkspace,
  issueSessionCookie,
  withTestDb,
} from "@tj/db/testing";
import { type JobId, newId, storageKey, type WorkspaceId } from "@tj/domain";
import { generatedLesson } from "@tj/domain/documents/fixtures";
import type { JobsContext } from "@tj/jobs";
import { LocalDiskStorage } from "@tj/storage";
import { createApp } from "./app";
import { type AuthEnv, createAuth } from "./auth/auth";
import { pendingClaimIdentifier } from "./auth/claim";
import { createPersonalWorkspace, logUsersWithoutWorkspace } from "./auth/workspace-hook";
import { SMALL_JSON_BODY_BYTES } from "./body-limits";
import { createEventsRuntime } from "./events/runtime";
import { CaptureMailSender, extractFirstUrl } from "./mail";
import {
  captureLogger,
  silentLogger,
  TEST_ENV,
  verifyUrlFromEmailLink,
  withFailingWorkspaceHandover,
} from "./test-helpers";

const t = await withTestDb({ max: 4 });
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping auth db tests: ${t.reason}`);

const BASE = "http://localhost:3001";
const WEB = "http://localhost:5173";

const AUTH_ENV: AuthEnv = {
  ...TEST_ENV,
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789",
  BETTER_AUTH_URL: BASE,
  COOKIE_DOMAIN: undefined,
  COOKIE_SAMESITE: "lax",
  GOOGLE_CLIENT_ID: undefined,
  GOOGLE_CLIENT_SECRET: undefined,
  MICROSOFT_CLIENT_ID: undefined,
  MICROSOFT_CLIENT_SECRET: undefined,
};

describeDb("auth (magic link, sessions, requireSession, personal workspace)", () => {
  if (!t.ok) return;
  const db = t.db;
  const mail = new CaptureMailSender();
  const auth = createAuth({ env: AUTH_ENV, db, mail, logger: silentLogger });
  const app = createApp({ env: TEST_ENV, db, logger: silentLogger, auth });

  afterAll(() => db.close());
  beforeEach(async () => {
    await db.truncateTenantTables();
    mail.clear();
  });

  /** Ask for a link as the web does; `cookie` is the asking browser's session, if any. */
  async function requestMagicLink(
    email: string,
    { target = app, cookie }: { target?: typeof app; cookie?: string } = {},
  ): Promise<string> {
    const res = await target.request(`${BASE}/auth/sign-in/magic-link`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: WEB,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({ email, callbackURL: `${WEB}/` }),
    });
    expect(res.status).toBe(200);
    const emailed = extractFirstUrl(mail.last?.text ?? "");
    if (!emailed) throw new Error("no magic link captured");
    expect(mail.last?.to).toBe(email);
    // The email opens the web confirm page, never the api verify endpoint (TEACH-246).
    expect(emailed.startsWith(`${WEB}/sign-in/confirm?token=`)).toBe(true);
    return verifyUrlFromEmailLink(emailed, BASE);
  }

  async function verificationCount() {
    return Number((await db.sql`select count(*)::text as c from verifications`)[0]?.c);
  }

  /** Follow the link once (no auto-redirect) and return `{ res, cookie }`. */
  async function followLink(link: string) {
    const res = await app.request(link, { redirect: "manual" });
    return { res, cookie: cookieHeaderFromResponse(res) };
  }

  async function usersCount() {
    return Number((await db.sql`select count(*)::text as c from users`)[0]?.c);
  }
  async function workspacesFor(userId: string) {
    return db.sql<{ id: string; name: string }[]>`
      select id, name from workspaces where owner_user_id = ${userId}`;
  }

  test("full flow: request link → verify → GET /me → rows exist → sign in again keeps one workspace", async () => {
    const email = "teacher@example.test";
    const link = await requestMagicLink(email);

    const { res: verify, cookie } = await followLink(link);
    expect(verify.status).toBe(302);
    expect(verify.headers.get("location")).toBe(`${WEB}/`);
    expect(cookie).toContain("tj.session_token=");

    const me = await app.request(`${BASE}/me`, { headers: { cookie } });
    expect(me.status).toBe(200);
    const body = (await me.json()) as { user: { id: string; email: string }; workspaceId: string };
    expect(body.user.email).toBe(email);
    expect(body.workspaceId).toMatch(/^[0-9a-f-]{36}$/);

    expect(await usersCount()).toBe(1);
    const ws = await workspacesFor(body.user.id);
    expect(ws).toHaveLength(1);
    expect(ws[0]).toEqual({ id: body.workspaceId, name: "Personal" });

    // Second sign-in for the same email: same user, still exactly one workspace.
    const { res: again, cookie: cookie2 } = await followLink(await requestMagicLink(email));
    expect(again.status).toBe(302);
    const me2 = await app.request(`${BASE}/me`, { headers: { cookie: cookie2 } });
    expect(((await me2.json()) as { workspaceId: string }).workspaceId).toBe(body.workspaceId);
    expect(await usersCount()).toBe(1);
    expect(await workspacesFor(body.user.id)).toHaveLength(1);

    // The magic link is single-use.
    const reused = await app.request(link, { redirect: "manual" });
    expect(reused.status).toBe(302);
    expect(reused.headers.get("location")).toContain("error=INVALID_TOKEN");
  });

  describe("mail scanners and the 15-minute expiry (TEACH-246)", () => {
    afterEach(() => setSystemTime());

    test("the emailed link is a static web page: sending it leaves the token unspent", async () => {
      await requestMagicLink("scanned@example.test");
      const emailed = extractFirstUrl(mail.last?.text ?? "") as string;
      expect(new URL(emailed).origin).toBe(WEB);
      // The api serves nothing at the confirm path, so a scanner's GET cannot reach the token.
      const scannerHit = await app.request(
        `${BASE}${new URL(emailed).pathname}${new URL(emailed).search}`,
      );
      expect(scannerHit.status).toBe(404);
      expect(await verificationCount()).toBe(1);
      // The teacher's click afterwards still signs in.
      const { res, cookie } = await followLink(verifyUrlFromEmailLink(emailed, BASE));
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`${WEB}/`);
      expect((await app.request(`${BASE}/me`, { headers: { cookie } })).status).toBe(200);
      expect(await verificationCount()).toBe(0);
    });

    test("a link clicked 14 minutes after sending still signs in", async () => {
      const sentAt = Date.now();
      const link = await requestMagicLink("late@example.test");
      setSystemTime(new Date(sentAt + 14 * 60_000));
      const { res, cookie } = await followLink(link);
      expect(res.headers.get("location")).toBe(`${WEB}/`);
      expect(cookie).toContain("tj.session_token=");
    });

    test("a link clicked 16 minutes after sending lands on the error callback", async () => {
      const sentAt = Date.now();
      const link = await requestMagicLink("expired@example.test");
      setSystemTime(new Date(sentAt + 16 * 60_000));
      const { res, cookie } = await followLink(link);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain("error=INVALID_TOKEN");
      expect(cookie).not.toContain("tj.session_token=");
      expect(await usersCount()).toBe(0);
    });
  });

  test("GET /me without a cookie → 401 envelope", async () => {
    const res = await app.request(`${BASE}/me`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: Record<string, unknown> };
    expect(body.error).toMatchObject({
      code: "unauthorized",
      message: "You need to sign in to do that.",
      retryable: false,
    });
    expect(typeof body.error.requestId).toBe("string");
  });

  test("an oversized magic-link body is refused before sending mail; valid login still works", async () => {
    const response = await app.request(`${BASE}/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: WEB },
      body: JSON.stringify({
        email: "bounded@example.test",
        callbackURL: `${WEB}/`,
        padding: "x".repeat(SMALL_JSON_BODY_BYTES),
      }),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "payload_too_large" } });
    expect(mail.last).toBeFalsy();
    const { res, cookie } = await followLink(await requestMagicLink("bounded@example.test"));
    expect(res.status).toBe(302);
    expect((await app.request(`${BASE}/me`, { headers: { cookie } })).status).toBe(200);
  });

  test("auth DB failure and library diagnostics never expose private marker arguments", async () => {
    const { logger, lines } = captureLogger();
    const safeAuth = createAuth({ env: AUTH_ENV, db, mail, logger });
    const safeApp = createApp({ env: TEST_ENV, db, logger, auth: safeAuth });
    const marker = "PRIVATE_AUTH_TOKEN_CANARY_282";
    const context = await safeAuth.$context;
    context.logger.error(marker, { token: marker, cause: new Error(marker) });
    const requested = await safeApp.request(`${BASE}/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: WEB },
      body: JSON.stringify({
        email: "safe-auth@example.test",
        name: `${marker}\u0000`,
        callbackURL: `${WEB}/`,
      }),
    });
    expect(requested.status).toBe(200);
    const link = verifyUrlFromEmailLink(extractFirstUrl(mail.last?.text ?? ""), BASE);
    const stderr: string[] = [];
    const consoleError = spyOn(console, "error").mockImplementation((...args) => {
      stderr.push(Bun.inspect(args));
    });
    let response: Response;
    try {
      response = await safeApp.request(link, { redirect: "manual" });
    } finally {
      consoleError.mockRestore();
    }
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(marker);
    expect(lines.join("")).not.toContain(marker);
    expect(stderr.join("")).not.toContain(marker);
    expect(lines.join("")).not.toContain(new URL(link).searchParams.get("token") as string);
    expect(lines.join("")).toContain("authentication event");
    expect(await usersCount()).toBe(0);
  });

  test("sign-out invalidates the session → GET /me 401", async () => {
    const { cookie } = await followLink(await requestMagicLink("out@example.test"));
    expect((await app.request(`${BASE}/me`, { headers: { cookie } })).status).toBe(200);

    const out = await app.request(`${BASE}/auth/sign-out`, {
      method: "POST",
      headers: { cookie, origin: WEB, "content-type": "application/json" },
      body: "{}",
    });
    expect(out.status).toBe(200);
    // Browser behaviour: sign-out clears the cookies → 401.
    const cleared = cookieHeaderFromResponse(out);
    expect(cleared).not.toContain("tj.session_token=");
    expect((await app.request(`${BASE}/me`, { headers: { cookie: cleared } })).status).toBe(401);
    // A misbehaving client replaying either the token alone or the complete cached cookie is
    // refused: protected routes always consult the authoritative session (TEACH-283).
    const tokenOnly = cookie.split("; ").find((p) => p.startsWith("tj.session_token=")) ?? "";
    expect((await app.request(`${BASE}/me`, { headers: { cookie: tokenOnly } })).status).toBe(401);
    expect((await app.request(`${BASE}/me`, { headers: { cookie } })).status).toBe(401);
  });

  test("deleting a session defeats the original signed cache cookie on reads and writes", async () => {
    const { cookie } = await followLink(await requestMagicLink("revoked-cache@example.test"));
    expect(cookie).toContain("tj.session_data=");
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
      query: { disableCookieCache: true },
    });
    if (!session) throw new Error("Missing signed session fixture");
    await db.sql`delete from sessions where id = ${session.session.id}`;
    // Prove this fixture contains a usable display cache, so the test would fail on the old guard.
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).not.toBeNull();
    expect((await app.request(`${BASE}/me`, { headers: { cookie } })).status).toBe(401);
    const write = await app.request(`${BASE}/documents`, {
      method: "POST",
      headers: { cookie, origin: WEB, "content-type": "application/json" },
      body: "{}",
    });
    expect(write.status).toBe(401);
  });

  test("an open signed-session stream closes after DB revocation and releases its slot", async () => {
    const { cookie } = await followLink(await requestMagicLink("revoked-stream@example.test"));
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
      query: { disableCookieCache: true },
    });
    if (!session) throw new Error("Missing session fixture");
    const me = await app.request(`${BASE}/me`, { headers: { cookie } });
    const { workspaceId } = (await me.json()) as { workspaceId: WorkspaceId };
    const runtime = createEventsRuntime({
      jobs: { db: db.unsafeDb } as JobsContext,
      logger: silentLogger,
      // Recheck the session every 200 ms instead of the production 15 s.
      config: { heartbeatMs: 50, pollMs: 50, authorizationTiming: { recheckMs: 200 } },
    });
    const streamingApp = createApp({
      env: TEST_ENV,
      db,
      auth,
      events: runtime,
      logger: silentLogger,
    });
    const jobId = newId() as JobId;
    await insertJobEvent(db.unsafeDb, {
      type: "started",
      workspaceId,
      jobId,
      at: new Date().toISOString(),
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await streamingApp.request(`${BASE}/events`, {
        headers: { cookie },
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      if (!response.body) throw new Error("Missing stream body");
      const reader = response.body.getReader();
      let text = "";
      const decoder = new TextDecoder();
      while (!text.includes("event: started")) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("Stream ended before replay");
        text += decoder.decode(chunk.value);
      }
      const revokedAt = Date.now();
      await db.sql`delete from sessions where id = ${session.session.id}`;
      expect((await app.request(`${BASE}/me`, { headers: { cookie } })).status).toBe(401);
      while (!(await reader.read()).done) {
        /* heartbeat frames until authorization expires */
      }
      expect(controller.signal.aborted).toBe(false);
      expect(Date.now() - revokedAt).toBeLessThan(5_000);
      // The body ends when the stream aborts; its `finally` releases the slot and unsubscribes a
      // tick later, so wait (briefly) for that rather than read it at once.
      for (let i = 0; i < 100 && runtime.openStreams(workspaceId) > 0; i++) await Bun.sleep(10);
      expect(runtime.openStreams(workspaceId)).toBe(0);
      expect(runtime.hub.size()).toBe(0);
    } finally {
      clearTimeout(timeout);
      controller.abort();
      await runtime.stop();
    }
  }, 35_000);

  test("protected prefixes /jobs/* and /events are guarded even before their routes exist", async () => {
    expect((await app.request(`${BASE}/jobs/abc`)).status).toBe(401);
    expect((await app.request(`${BASE}/events`)).status).toBe(401);
    // Public routes are untouched.
    expect((await app.request(`${BASE}/health`)).status).toBe(200);
  });

  test("COOKIE_DOMAIN sets Domain=…; unset leaves it out", async () => {
    const { cookie: _c, res } = await followLink(await requestMagicLink("dom@example.test"));
    for (const line of res.headers.getSetCookie()) expect(line).not.toMatch(/domain=/i);

    const scopedMail = new CaptureMailSender();
    const scoped = createApp({
      env: TEST_ENV,
      db,
      logger: silentLogger,
      auth: createAuth({
        // The api must be under the cookie domain, or `effectiveCookieDomain` drops it (TEACH-36).
        env: {
          ...AUTH_ENV,
          BETTER_AUTH_URL: "http://api.example.test:3001",
          COOKIE_DOMAIN: ".example.test",
        },
        db,
        mail: scopedMail,
        logger: silentLogger,
      }),
    });
    const r1 = await scoped.request(`${BASE}/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: WEB },
      body: JSON.stringify({ email: "dom2@example.test", callbackURL: `${WEB}/` }),
    });
    expect(r1.status).toBe(200);
    const link = verifyUrlFromEmailLink(extractFirstUrl(scopedMail.last?.text ?? ""), BASE);
    const r2 = await scoped.request(link, { redirect: "manual" });
    const sessionLine = r2.headers.getSetCookie().find((l) => l.startsWith("tj.session_token="));
    expect(sessionLine).toMatch(/Domain=\.example\.test/i);
  });

  test("COOKIE_SAMESITE=none → SameSite=None; Secure on the session cookie + boot warning", async () => {
    const warnings: string[] = [];
    const logger = {
      ...silentLogger,
      warn: (...args: unknown[]) => warnings.push(String(args.at(-1))),
    } as unknown as typeof silentLogger;
    const crossMail = new CaptureMailSender();
    const cross = createApp({
      env: TEST_ENV,
      db,
      logger: silentLogger,
      auth: createAuth({
        env: { ...AUTH_ENV, COOKIE_SAMESITE: "none" },
        db,
        mail: crossMail,
        logger,
      }),
    });
    expect(warnings.some((w) => w.startsWith("COOKIE_SAMESITE=none"))).toBe(true);
    const r1 = await cross.request(`${BASE}/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: WEB },
      body: JSON.stringify({ email: "cross@example.test", callbackURL: `${WEB}/` }),
    });
    expect(r1.status).toBe(200);
    const link = verifyUrlFromEmailLink(extractFirstUrl(crossMail.last?.text ?? ""), BASE);
    const r2 = await cross.request(link, { redirect: "manual" });
    const sessionLine = r2.headers
      .getSetCookie()
      .find((l) => /^(__Secure-)?tj\.session_token=/.test(l));
    expect(sessionLine).toMatch(/SameSite=None/i);
    expect(sessionLine).toMatch(/;\s*Secure/i);

    // Default (lax) in NODE_ENV=test: Lax and not Secure.
    const { res } = await followLink(await requestMagicLink("lax@example.test"));
    const laxLine = res.headers.getSetCookie().find((l) => l.startsWith("tj.session_token="));
    expect(laxLine).toMatch(/SameSite=Lax/i);
    expect(laxLine).not.toMatch(/;\s*Secure/i);
  });

  test("Google/Microsoft disabled without credentials: boot log + social sign-in rejected", async () => {
    const lines: string[] = [];
    const logger = {
      ...silentLogger,
      info: (...args: unknown[]) => lines.push(String(args.at(-1))),
    } as unknown as typeof silentLogger;
    const a = createAuth({ env: AUTH_ENV, db, mail, logger });
    expect(lines).toContain("Google sign-in disabled (no credentials)");
    expect(lines).toContain("Microsoft sign-in disabled (no credentials)");

    const res = await createApp({ env: TEST_ENV, db, logger: silentLogger, auth: a }).request(
      `${BASE}/auth/sign-in/social`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: WEB },
        body: JSON.stringify({ provider: "google", callbackURL: `${WEB}/` }),
      },
    );
    // The web shows "Google sign-in is not available" on exactly this answer (ADR 0008 item 6).
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code?: string }).code).toBe("PROVIDER_NOT_FOUND");
  });

  test("createPersonalWorkspace is idempotent; logUsersWithoutWorkspace counts and heals", async () => {
    const { userId, workspaceId } = await createTestUserWithWorkspace(db.unsafeDb);
    expect(await createPersonalWorkspace(db, userId)).toBe(workspaceId);
    expect(await workspacesFor(userId)).toHaveLength(1);

    // A user with no workspace (e.g. the hook failed): counted, then healed by requireSession.
    await db.sql`insert into users (id, name, email, email_verified, created_at, updated_at)
      values ('orphan', 'Orphan', 'orphan@example.test', true, now(), now())`;
    const warned: unknown[] = [];
    const logger = {
      ...silentLogger,
      warn: (...args: unknown[]) => warned.push(args[0]),
    } as unknown as typeof silentLogger;
    expect(await logUsersWithoutWorkspace(db, logger)).toBe(1);
    expect(warned[0]).toEqual({ count: 1 });

    const cookie = await issueSessionCookie(auth, "orphan");
    const me = await app.request(`${BASE}/me`, { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(await workspacesFor("orphan")).toHaveLength(1);
    expect(await logUsersWithoutWorkspace(db, silentLogger)).toBe(0);
  });

  test("@tj/db/testing factories: createTestUserWithWorkspace + issueSessionCookie", async () => {
    const { userId, workspaceId, email } = await createTestUserWithWorkspace(db.unsafeDb, {
      name: "Factory",
    });
    const cookie = await issueSessionCookie(auth, userId);
    expect(cookie).toContain("tj.session_token=");
    const me = await app.request(`${BASE}/me`, { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({
      user: { id: userId, email, name: "Factory", isAnonymous: false },
      workspaceId,
    });
  });

  // --- anonymous sessions (TEACH-223) -----------------------------------------------------------

  // No flag: anonymous sign-in is on with the default env (Greg, 28 Sep 2026).
  const anonApp = app;

  async function signInAnonymously(target = anonApp) {
    const res = await target.request(`${BASE}/auth/sign-in/anonymous`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: WEB },
      body: "{}",
    });
    return { res, cookie: cookieHeaderFromResponse(res) };
  }
  async function userRow(id: string) {
    return (
      await db.sql<{ id: string; is_anonymous: boolean }[]>`
        select id, is_anonymous from users where id = ${id}`
    )[0];
  }
  async function meBody(target: typeof app, cookie: string) {
    const res = await target.request(`${BASE}/me`, { headers: { cookie } });
    expect(res.status).toBe(200);
    return (await res.json()) as {
      user: { id: string; email: string; isAnonymous: boolean };
      workspaceId: string;
    };
  }

  test("anonymous sign-in → session cookie, is_anonymous row, personal workspace, /me isAnonymous", async () => {
    const { res, cookie } = await signInAnonymously();
    expect(res.status).toBe(200);
    expect(cookie).toContain("tj.session_token=");

    const me = await meBody(anonApp, cookie);
    expect(me.user.isAnonymous).toBe(true);
    expect(await userRow(me.user.id)).toEqual({ id: me.user.id, is_anonymous: true });
    const ws = await workspacesFor(me.user.id);
    expect([...ws]).toEqual([{ id: me.workspaceId, name: "Personal" }]);

    // better-auth 1.7.2's placeholder: a random local part on the reserved `.invalid` TLD, so it
    // can never clash with a teacher's address or receive mail.
    expect(me.user.email).toMatch(/^[a-z0-9]+@anonymous\.placeholder\.invalid$/);
  });

  test("anonymous user cannot delete itself: 400 DELETE_ANONYMOUS_USER_DISABLED", async () => {
    const { cookie } = await signInAnonymously();
    const { user } = await meBody(anonApp, cookie);
    const res = await anonApp.request(`${BASE}/auth/delete-anonymous-user`, {
      method: "POST",
      headers: { cookie, origin: WEB, "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "DELETE_ANONYMOUS_USER_DISABLED" });
    expect(await userRow(user.id)).toBeDefined();
    expect(await workspacesFor(user.id)).toHaveLength(1);
  });

  /**
   * Anonymous session, then the same browser completes a magic-link sign-in for a new email. The
   * verify request carries the anonymous cookie, which is what fires the plugin's link hook.
   */
  async function linkAnonymousToMagicLink(target: typeof app, email: string) {
    const { cookie: anonCookie } = await signInAnonymously(target);
    const anon = await meBody(target, anonCookie);
    const link = await requestMagicLink(email);
    const verify = await target.request(link, {
      redirect: "manual",
      headers: { cookie: anonCookie },
    });
    expect(verify.status).toBe(302);
    const cookie = cookieHeaderFromResponse(verify);
    expect(cookie).toContain("tj.session_token=");
    return { anon, cookie };
  }

  test("control: with the plugin default the same link deletes the anonymous user", async () => {
    // Proves the claim tests below exercise the plugin's link hook: flip the option on a separate
    // instance and the anonymous user is gone. Its Workspace survives only because `onLinkAccount`
    // ran first and handed it to the new account; for an existing account it would cascade away.
    const defaultAuth = createAuth({ env: AUTH_ENV, db, mail, logger: silentLogger });
    const plugin = defaultAuth.options.plugins.find((p) => p.id === "anonymous");
    if (!plugin?.options) throw new Error("anonymous plugin not registered");
    expect(plugin.options.disableDeleteAnonymousUser).toBe(true);
    plugin.options.disableDeleteAnonymousUser = false;
    const defaultApp = createApp({
      env: TEST_ENV,
      db,
      logger: silentLogger,
      auth: defaultAuth,
    });

    const { anon, cookie } = await linkAnonymousToMagicLink(defaultApp, "control@example.test");
    expect(await userRow(anon.user.id)).toBeUndefined();
    expect(await workspacesFor(anon.user.id)).toHaveLength(0);
    expect((await meBody(defaultApp, cookie)).workspaceId).toBe(anon.workspaceId);
  });

  // --- claim on sign-in (TEACH-224) -------------------------------------------------------------

  describe("claim on sign-in (TEACH-224)", () => {
    const claimLog = captureLogger();
    const storageRoot = mkdtempSync(join(tmpdir(), "tj-224-"));
    const storage = new LocalDiskStorage(storageRoot);
    const claimAuth = createAuth({ env: AUTH_ENV, db, mail, logger: claimLog.logger });
    const claimApp = createApp({
      env: TEST_ENV,
      db,
      logger: silentLogger,
      auth: claimAuth,
      storage,
    });

    afterAll(() => rmSync(storageRoot, { recursive: true, force: true }));
    beforeEach(() => {
      claimLog.lines.length = 0;
    });

    /** Browser 1: an anonymous session whose Workspace holds lesson L and one picture. */
    async function visitorWithLesson() {
      const { cookie } = await signInAnonymously(claimApp);
      const me = await meBody(claimApp, cookie);
      const ws = me.workspaceId as WorkspaceId;
      const lesson = await createDocument(
        forWorkspace(db.unsafeDb, ws),
        "lesson",
        generatedLesson(),
      );
      const key = storageKey(ws, "images", "a.png");
      await storage.put(key, new Uint8Array([1, 2, 3]), { contentType: "image/png" });
      return { cookie, userId: me.user.id, workspaceId: me.workspaceId, lessonId: lesson.id, key };
    }
    /** Open the verify URL as the confirm page's button does, from `cookie`'s browser if given. */
    async function verify(link: string, cookie?: string) {
      const res = await claimApp.request(link, {
        redirect: "manual",
        headers: cookie ? { cookie } : {},
      });
      expect(res.status).toBe(302);
      const signedIn = cookieHeaderFromResponse(res);
      expect(signedIn).toContain("tj.session_token=");
      return signedIn;
    }
    const get = (cookie: string, path: string) =>
      claimApp.request(`${BASE}${path}`, { headers: { cookie } });
    async function claimRows() {
      return [
        ...(await db.sql<{ identifier: string; value: string }[]>`
          select identifier, value from verifications where identifier like 'claim:%'`),
      ];
    }
    function logged(msg: string) {
      return claimLog.lines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((line) => line.msg === msg)
        .map(({ level, claim, via, anonymousUserId, userId }) => ({
          level,
          claim,
          via,
          anonymousUserId,
          userId,
        }));
    }
    const workspaceCount = async () =>
      Number((await db.sql`select count(*)::text as c from workspaces`)[0]?.c);
    const claimId = (email: string) => pendingClaimIdentifier(AUTH_ENV.BETTER_AUTH_SECRET, email);

    test("rows 1 and 8: a link opened in the visitor's browser hands the Workspace over", async () => {
      const a = await visitorWithLesson();
      // Asked for without the anonymous cookie, so no pending row: `onLinkAccount` alone claims.
      const link = await requestMagicLink("new-teacher@example.test", { target: claimApp });
      expect(await claimRows()).toEqual([]);

      const cookie = await verify(link, a.cookie);
      const n = await meBody(claimApp, cookie);
      expect(n.user.isAnonymous).toBe(false);
      expect(n.workspaceId).toBe(a.workspaceId);
      // N's own empty Workspace is gone; the anonymous user stays, owning nothing.
      expect(await workspaceCount()).toBe(1);
      expect(await workspacesFor(a.userId)).toHaveLength(0);
      expect(await userRow(a.userId)).toEqual({ id: a.userId, is_anonymous: true });

      expect((await get(cookie, `/documents/${a.lessonId}`)).status).toBe(200);
      expect((await get(cookie, `/files/${a.key}`)).status).toBe(200);
      expect(logged("anonymous workspace claim")).toEqual([
        {
          level: 30,
          claim: "claimed",
          via: "link",
          anonymousUserId: a.userId,
          userId: n.user.id,
        },
      ]);
      expect(claimLog.lines.join("\n")).not.toContain("new-teacher@example.test");
    });

    test("row 3: asked for in browser 1, opened in browser 2: the pending row claims", async () => {
      const a = await visitorWithLesson();
      const link = await requestMagicLink("phone@example.test", {
        target: claimApp,
        cookie: a.cookie,
      });
      expect(await claimRows()).toEqual([
        { identifier: claimId("phone@example.test"), value: a.userId },
      ]);

      const cookie = await verify(link); // a fresh cookie jar
      const n = await meBody(claimApp, cookie);
      expect(n.workspaceId).toBe(a.workspaceId);
      expect(await claimRows()).toEqual([]);
      expect((await get(cookie, `/documents/${a.lessonId}`)).status).toBe(200);
      expect((await get(cookie, `/files/${a.key}`)).status).toBe(200);
      // Browser 1 is signed out: its anonymous session cannot follow the Workspace (or heal a new one).
      expect((await get(a.cookie, "/me")).status).toBe(401);
      expect(logged("anonymous workspace claim")).toEqual([
        {
          level: 30,
          claim: "claimed",
          via: "pending",
          anonymousUserId: a.userId,
          userId: n.user.id,
        },
      ]);
      expect(claimLog.lines.join("\n")).not.toContain("phone@example.test");
    });

    describe("after a cross-device claim, browser 1 can start a new signed-out lesson", () => {
      async function signInAgain(cookie: string) {
        const res = await claimApp.request(`${BASE}/auth/sign-in/anonymous`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: WEB, cookie },
          body: "{}",
        });
        expect(res.status).toBe(200);
        return meBody(claimApp, cookieHeaderFromResponse(res));
      }
      async function claimedElsewhere() {
        const a = await visitorWithLesson();
        const link = await requestMagicLink("again@example.test", {
          target: claimApp,
          cookie: a.cookie,
        });
        await verify(link);
        return a;
      }

      test("at once, while its signed session cache still names the deleted session", async () => {
        const a = await claimedElsewhere();
        expect(a.cookie).toContain("tj.session_data=");
        const fresh = await signInAgain(a.cookie);
        expect(fresh.user.isAnonymous).toBe(true);
        expect(fresh.user.id).not.toBe(a.userId);
      });

      test("later, with only the dead session token left", async () => {
        const a = await claimedElsewhere();
        const tokenOnly = a.cookie
          .split("; ")
          .filter((pair) => pair.startsWith("tj.session_token="))
          .join("; ");
        const fresh = await signInAgain(tokenOnly);
        expect(fresh.user.id).not.toBe(a.userId);
      });

      test("a live anonymous session is still refused a second one", async () => {
        const { cookie } = await signInAnonymously(claimApp);
        const res = await claimApp.request(`${BASE}/auth/sign-in/anonymous`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: WEB, cookie },
          body: "{}",
        });
        expect(res.status).toBe(400);
      });
    });

    test("the pending row's identifier cannot be spent through the verify endpoint", async () => {
      const a = await visitorWithLesson();
      await requestMagicLink("spent@example.test", { target: claimApp, cookie: a.cookie });
      const rows = await claimRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.identifier).not.toContain("spent");
      // Better Auth's verify consumes any `verifications` row by identifier: an address-shaped
      // identifier would let anyone who knows the address delete the claim.
      await claimApp.request(
        `${BASE}/auth/magic-link/verify?token=${encodeURIComponent("claim:spent@example.test")}`,
        { redirect: "manual" },
      );
      expect(await claimRows()).toEqual(rows);
    });

    test("pending row and same browser: the browser's own session claims, the row is dropped", async () => {
      const a = await visitorWithLesson();
      const link = await requestMagicLink("both@example.test", {
        target: claimApp,
        cookie: a.cookie,
      });
      const n = await meBody(claimApp, await verify(link, a.cookie));
      expect(n.workspaceId).toBe(a.workspaceId);
      expect(await claimRows()).toEqual([]);
      expect(logged("anonymous workspace claim").map(({ claim, via }) => ({ claim, via }))).toEqual(
        [
          { claim: "superseded", via: "pending" },
          { claim: "claimed", via: "link" },
        ],
      );
    });

    test("someone else's pending row for the address does not beat the browser's own lesson", async () => {
      const victim = await visitorWithLesson();
      const link = await requestMagicLink("victim@example.test", {
        target: claimApp,
        cookie: victim.cookie,
      });
      // Another anonymous browser asks for a link to the same address afterwards: its row
      // replaces the victim's.
      const other = await visitorWithLesson();
      await requestMagicLink("victim@example.test", { target: claimApp, cookie: other.cookie });
      expect(await claimRows()).toEqual([
        { identifier: claimId("victim@example.test"), value: other.userId },
      ]);

      const n = await meBody(claimApp, await verify(link, victim.cookie));
      expect(n.workspaceId).toBe(victim.workspaceId);
      expect([...(await workspacesFor(other.userId))].map((w) => w.id)).toEqual([
        other.workspaceId,
      ]);
      expect(await claimRows()).toEqual([]);
    });

    test("a link opened on a device whose anonymous session holds no lesson still claims", async () => {
      const laptop = await visitorWithLesson();
      const link = await requestMagicLink("empty-phone@example.test", {
        target: claimApp,
        cookie: laptop.cookie,
      });
      const { cookie: phone } = await signInAnonymously(claimApp);
      const phoneUser = (await meBody(claimApp, phone)).user.id;

      const n = await meBody(claimApp, await verify(link, phone));
      expect(n.workspaceId).toBe(laptop.workspaceId);
      expect(await claimRows()).toEqual([]);
      expect(logged("anonymous workspace claim").map(({ claim, via }) => ({ claim, via }))).toEqual(
        [
          { claim: "claimed", via: "pending" },
          { claim: "nothing-to-claim", via: "link" },
        ],
      );
      // The phone's empty anonymous Workspace stays with it for the cleanup job.
      expect(await workspacesFor(phoneUser)).toHaveLength(1);
    });

    test("row 4 (ruling 127): an existing account signing in from the visitor's browser takes the lesson", async () => {
      const e = await createTestUserWithWorkspace(db.unsafeDb, { email: "existing@example.test" });
      await db.sql`update users set created_at = now() - interval '1 day' where id = ${e.userId}`;
      const own = await createDocument(
        forWorkspace(db.unsafeDb, e.workspaceId),
        "lesson",
        generatedLesson(),
      );
      const a = await visitorWithLesson();
      const link = await requestMagicLink("existing@example.test", {
        target: claimApp,
        cookie: a.cookie,
      });

      const cookie = await verify(link, a.cookie);
      expect((await meBody(claimApp, cookie)).workspaceId).toBe(e.workspaceId);
      expect([...(await workspacesFor(e.userId))].map((w) => w.id)).toEqual([e.workspaceId]);
      expect((await get(cookie, `/documents/${own.id}`)).status).toBe(200);
      // The signed-out lesson is in the account under the same id, so `/l/<id>` keeps working.
      expect((await get(cookie, `/documents/${a.lessonId}`)).status).toBe(200);
      expect(logged("anonymous workspace claim").map(({ claim, via }) => ({ claim, via }))).toEqual(
        [
          { claim: "superseded", via: "pending" },
          { claim: "moved", via: "link" },
        ],
      );
    });

    test("row 4, another device: the email-keyed pending row never reaches an existing account", async () => {
      const e = await createTestUserWithWorkspace(db.unsafeDb, { email: "old@example.test" });
      await db.sql`update users set created_at = now() - interval '1 day' where id = ${e.userId}`;
      const a = await visitorWithLesson();
      const link = await requestMagicLink("old@example.test", {
        target: claimApp,
        cookie: a.cookie,
      });
      expect((await meBody(claimApp, await verify(link))).workspaceId).toBe(e.workspaceId);
      expect([...(await workspacesFor(a.userId))].map((w) => w.id)).toEqual([a.workspaceId]);
      expect(await claimRows()).toEqual([]);
      expect(logged("anonymous workspace claim").map(({ claim, via }) => ({ claim, via }))).toEqual(
        [{ claim: "declined-existing", via: "pending" }],
      );
    });

    test("row 5: a pending claim past its hour is removed and ignored", async () => {
      const a = await visitorWithLesson();
      const link = await requestMagicLink("slow@example.test", {
        target: claimApp,
        cookie: a.cookie,
      });
      await db.sql`update verifications set expires_at = now() - interval '1 second'
        where identifier = ${claimId("slow@example.test")}`;

      const n = await meBody(claimApp, await verify(link));
      expect(n.workspaceId).not.toBe(a.workspaceId);
      expect([...(await workspacesFor(a.userId))].map((w) => w.id)).toEqual([a.workspaceId]);
      expect(await claimRows()).toEqual([]);
      expect(logged("anonymous workspace claim")).toEqual([]);
    });

    test("row 6: no claim row without an anonymous session, nor from a signed-in browser", async () => {
      await requestMagicLink("plain@example.test", { target: claimApp });
      expect(await claimRows()).toEqual([]);
      const signedIn = await verify(
        await requestMagicLink("plain@example.test", { target: claimApp }),
      );
      await requestMagicLink("someone@example.test", { target: claimApp, cookie: signedIn });
      expect(await claimRows()).toEqual([]);
    });

    test("row 7, another device: a failing claim still signs in and keeps the row", async () => {
      const a = await visitorWithLesson();
      const link = await requestMagicLink("fault@example.test", {
        target: claimApp,
        cookie: a.cookie,
      });
      let cookie = "";
      await withFailingWorkspaceHandover(db, async () => {
        cookie = await verify(link);
      });

      const n = await meBody(claimApp, cookie);
      expect(n.workspaceId).not.toBe(a.workspaceId);
      expect([...(await workspacesFor(a.userId))].map((w) => w.id)).toEqual([a.workspaceId]);
      expect(await workspaceCount()).toBe(2);
      // Rolled back with the claim: the next sign-in within the hour tries again.
      expect(await claimRows()).toEqual([
        { identifier: claimId("fault@example.test"), value: a.userId },
      ]);
      expect(logged("anonymous workspace claim failed")).toEqual([
        {
          level: 50,
          claim: undefined,
          via: "pending",
          anonymousUserId: a.userId,
          userId: n.user.id,
        },
      ]);
    });

    test("row 7, same browser: a failing claim still signs in and leaves both Workspaces whole", async () => {
      const a = await visitorWithLesson();
      const link = await requestMagicLink("fault2@example.test", { target: claimApp });
      let cookie = "";
      await withFailingWorkspaceHandover(db, async () => {
        cookie = await verify(link, a.cookie);
      });

      const n = await meBody(claimApp, cookie);
      expect(n.workspaceId).not.toBe(a.workspaceId);
      expect([...(await workspacesFor(a.userId))].map((w) => w.id)).toEqual([a.workspaceId]);
      expect(await workspaceCount()).toBe(2);
      expect(logged("anonymous workspace claim failed")).toEqual([
        { level: 50, claim: undefined, via: "link", anonymousUserId: a.userId, userId: n.user.id },
      ]);
    });
  });
});
