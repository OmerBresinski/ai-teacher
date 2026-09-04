/**
 * Integration: the magic-link flow end to end against the real test database (skips visibly when
 * unreachable). Cookies are captured from `Set-Cookie` and replayed by hand, as a browser would.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  cookieHeaderFromResponse,
  createTestUserWithWorkspace,
  issueSessionCookie,
  withTestDb,
} from "@tj/db/testing";
import { createApp } from "./app";
import { type AuthEnv, createAuth } from "./auth/auth";
import { createPersonalWorkspace, logUsersWithoutWorkspace } from "./auth/workspace-hook";
import { CaptureMailSender, extractFirstUrl } from "./mail";
import { silentLogger, TEST_ENV } from "./test-helpers";

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

  async function requestMagicLink(email: string): Promise<string> {
    const res = await app.request(`${BASE}/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: WEB },
      body: JSON.stringify({ email, callbackURL: `${WEB}/` }),
    });
    expect(res.status).toBe(200);
    const link = extractFirstUrl(mail.last?.text ?? "");
    if (!link) throw new Error("no magic link captured");
    expect(mail.last?.to).toBe(email);
    expect(link.startsWith(`${BASE}/auth/magic-link/verify?token=`)).toBe(true);
    return link;
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
    // Misbehaving client replaying only the session token: the DB session is gone → 401. (The
    // `tj.session_data` cache cookie alone would still pass for up to `cookieCache.maxAge`;
    // that is the documented trade-off of the cookie cache.)
    const tokenOnly = cookie.split("; ").find((p) => p.startsWith("tj.session_token=")) ?? "";
    expect((await app.request(`${BASE}/me`, { headers: { cookie: tokenOnly } })).status).toBe(401);
  });

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
        env: { ...AUTH_ENV, COOKIE_DOMAIN: ".example.test" },
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
    const link = extractFirstUrl(scopedMail.last?.text ?? "");
    const r2 = await scoped.request(link ?? "", { redirect: "manual" });
    const sessionLine = r2.headers.getSetCookie().find((l) => l.startsWith("tj.session_token="));
    expect(sessionLine).toMatch(/Domain=\.example\.test/i);
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
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
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
      user: { id: userId, email, name: "Factory" },
      workspaceId,
    });
  });
});
