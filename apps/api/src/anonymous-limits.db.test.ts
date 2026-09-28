/**
 * TEACH-222 against the real test database: two lessons per anonymous Workspace, the re-plan cap,
 * the refused writes, the per-IP sign-in ceiling, the global daily cap and the kill switch.
 * Real better-auth anonymous sessions; pg-boss only queues (no worker runs here).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearGenerating, forWorkspace } from "@tj/db";
import {
  cookieHeaderFromResponse,
  createTestUserWithWorkspace,
  issueSessionCookie,
  withTestDb,
} from "@tj/db/testing";
import { type JobId, type LessonId, newId, storageKey, type WorkspaceId } from "@tj/domain";
import { createBoss, ensureQueues, type JobsContext } from "@tj/jobs";
import { LocalDiskStorage } from "@tj/storage";
import type { PgBoss } from "pg-boss";
import { createApp } from "./app";
import { type AuthEnv, createAuth } from "./auth/auth";
import type { ErrorEnvelope } from "./errors";
import { createEventsRuntime } from "./events/runtime";
import { CaptureMailSender } from "./mail";
import { silentLogger, TEST_ENV_NO_SHIM } from "./test-helpers";

const t = await withTestDb({ max: 4 });
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping anonymous limits db tests: ${t.reason}`);

const BASE = "http://localhost:3001";
const WEB = "http://localhost:5173";
const AUTH_ENV: AuthEnv = {
  ...TEST_ENV_NO_SHIM,
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789",
  BETTER_AUTH_URL: BASE,
  COOKIE_DOMAIN: undefined,
  COOKIE_SAMESITE: "lax",
  GOOGLE_CLIENT_ID: undefined,
  GOOGLE_CLIENT_SECRET: undefined,
  MICROSOFT_CLIENT_ID: undefined,
  MICROSOFT_CLIENT_SECRET: undefined,
};

describeDb("anonymous guard and limits (TEACH-222)", () => {
  if (!t.ok) return;
  const db = t.db;
  const auth = createAuth({
    env: AUTH_ENV,
    db,
    mail: new CaptureMailSender(),
    logger: silentLogger,
  });
  const storageRoot = mkdtempSync(join(tmpdir(), "tj-222-"));
  const storage = new LocalDiskStorage(storageRoot);
  let boss: PgBoss;
  let jobs: JobsContext;

  type Env = Parameters<typeof createApp>[0]["env"];
  const appWith = (env: Partial<Env> = {}) =>
    createApp({
      env: { ...TEST_ENV_NO_SHIM, ANONYMOUS_LESSONS_ENABLED: "true", ...env },
      db,
      logger: silentLogger,
      auth,
      jobs,
      events: createEventsRuntime({ jobs, logger: silentLogger }),
      storage,
      rateLimit: { limit: 1000, windowMs: 60_000 },
    });

  beforeAll(async () => {
    boss = createBoss(db.url, { schema: "pgboss_test_anon", max: 2, applicationName: "tj-222" });
    await boss.start();
    await ensureQueues(boss);
    jobs = { boss, db: db.unsafeDb, sql: db.sql };
  });
  afterAll(async () => {
    await boss.stop({ graceful: false, close: true });
    await db.close();
    rmSync(storageRoot, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await db.truncateTenantTables();
  });

  let ipSeq = 0;
  async function signIn(app: ReturnType<typeof appWith>, ip = `198.51.100.${++ipSeq}`) {
    const res = await app.request(`${BASE}/auth/sign-in/anonymous`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: WEB, "x-forwarded-for": ip },
      body: "{}",
    });
    return { res, cookie: cookieHeaderFromResponse(res) };
  }
  const send = (
    app: ReturnType<typeof appWith>,
    cookie: string,
    method: string,
    path: string,
    body?: unknown,
  ) =>
    app.request(`${BASE}${path}`, {
      method,
      headers: { cookie, origin: WEB, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const brief = (topic: string, requestId?: string) => ({
    brief: { topic },
    yearGroup: "Year 5",
    ...(requestId ? { requestId } : {}),
  });
  const code = async (res: Response) => ((await res.json()) as ErrorEnvelope).error.code;
  const workspaceOf = async (app: ReturnType<typeof appWith>, cookie: string) =>
    ((await (await send(app, cookie, "GET", "/me")).json()) as { workspaceId: WorkspaceId })
      .workspaceId;

  test("rows 1–3: two lessons, the third is 403 anonymous_limit, a repeated requestId replays", async () => {
    const app = appWith();
    const { cookie } = await signIn(app);
    const first = newId();
    const a = await send(app, cookie, "POST", "/lessons", brief("Volcanoes", first));
    expect(a.status).toBe(202);
    const { lessonId } = (await a.json()) as { lessonId: string };
    const b = await send(app, cookie, "POST", "/lessons", brief("Rivers", newId()));
    expect(b.status).toBe(202);

    const c = await send(app, cookie, "POST", "/lessons", brief("Deserts", newId()));
    expect(c.status).toBe(403);
    expect(await c.clone().json()).toMatchObject({
      error: {
        code: "anonymous_limit",
        message: "Sign in to make more lessons.",
        retryable: false,
      },
    });

    const again = await send(app, cookie, "POST", "/lessons", brief("Volcanoes", first));
    expect(again.status).toBe(202);
    expect(((await again.json()) as { lessonId: string }).lessonId).toBe(lessonId);
  });

  test("row 2 under a race: five parallel briefs still make two lessons", async () => {
    const app = appWith();
    const { cookie } = await signIn(app);
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        send(app, cookie, "POST", "/lessons", brief(`Topic ${i}`, newId())),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([202, 202, 403, 403, 403]);
  });

  test("rows 4–5: writes are 403 sign_in_required; own reads are 200", async () => {
    const app = appWith();
    const { cookie } = await signIn(app);
    const created = await send(app, cookie, "POST", "/lessons", brief("Volcanoes", newId()));
    const { lessonId } = (await created.json()) as { lessonId: string };
    const ws = await workspaceOf(app, cookie);

    for (const [method, path, body] of [
      ["PUT", `/documents/${lessonId}`, { body: {}, expectedUpdatedAt: new Date().toISOString() }],
      ["POST", `/lessons/${lessonId}/worksheet`, {}],
      ["POST", `/lessons/${lessonId}/regenerate`, { targets: [] }],
      ["POST", `/lessons/${lessonId}/cascade`, { changedFactIds: [] }],
      ["POST", "/sources", { text: "x" }],
      ["POST", "/briefs/parse", { text: "x" }],
      ["DELETE", `/documents/${lessonId}`, undefined],
    ] as const) {
      const res = await send(app, cookie, method, path, body);
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
      expect(await code(res)).toBe("sign_in_required");
    }

    expect((await send(app, cookie, "GET", `/documents/${lessonId}`)).status).toBe(200);
    expect((await send(app, cookie, "GET", "/documents?kind=lesson")).status).toBe(200);
    const key = storageKey(ws, "images", "a.png");
    await storage.put(key, new Uint8Array([1, 2, 3]), { contentType: "image/png" });
    expect((await send(app, cookie, "GET", `/files/${key}`)).status).toBe(200);
    const events = new AbortController();
    const stream = await app.request(`${BASE}/events`, {
      headers: { cookie, origin: WEB },
      signal: events.signal,
    });
    expect(stream.status).toBe(200);
    events.abort();
  });

  test("row 5b: three re-plans, the fourth is 403 sign_in_required; generate as today", async () => {
    const app = appWith();
    const { cookie } = await signIn(app);
    const created = await send(app, cookie, "POST", "/lessons", brief("Volcanoes", newId()));
    const { lessonId, jobId } = (await created.json()) as { lessonId: LessonId; jobId: JobId };
    const ws = forWorkspace(db.unsafeDb, await workspaceOf(app, cookie));
    let holder = jobId;
    for (let revision = 1; revision <= 3; revision++) {
      await clearGenerating(ws, lessonId, holder);
      const res = await send(app, cookie, "POST", `/lessons/${lessonId}/plan`, {
        expectedRevision: revision,
        brief: { topic: `Volcanoes ${revision}` },
      });
      expect(res.status).toBe(202);
      holder = ((await res.json()) as { jobId: JobId }).jobId;
    }
    await clearGenerating(ws, lessonId, holder);
    const fourth = await send(app, cookie, "POST", `/lessons/${lessonId}/plan`, {
      expectedRevision: 4,
      brief: { topic: "Volcanoes 4" },
    });
    expect(fourth.status).toBe(403);
    expect(await fourth.json()).toMatchObject({
      error: { code: "sign_in_required", message: "Sign in to keep changing the plan." },
    });

    const generate = await send(app, cookie, "POST", `/lessons/${lessonId}/generate`, {
      expectedRevision: 4,
      objectives: [{ text: "Explain why volcanoes erupt." }],
    });
    // No worker ran, so the lesson has no proposal yet: the route's own state check answers, not
    // the guard (a signed-in teacher gets the same 422 here).
    expect(generate.status).toBe(422);
    expect(await code(generate)).not.toBe("sign_in_required");
  }, 30_000);

  test("row 6: a signed-in teacher is unchanged (third lesson, save path, fourth re-plan)", async () => {
    const app = appWith();
    const { userId } = await createTestUserWithWorkspace(db.unsafeDb);
    const cookie = await issueSessionCookie(auth, userId);
    for (const topic of ["A", "B", "C"]) {
      expect((await send(app, cookie, "POST", "/lessons", brief(topic, newId()))).status).toBe(202);
    }
    const res = await send(app, cookie, "POST", "/briefs/parse", { text: "x" });
    expect(await code(res).catch(() => "none")).not.toBe("sign_in_required");
  });

  test("row 7: the 3rd sign-in from one IP is 429 with a ceiling of 2; another IP is 200", async () => {
    const app = appWith({ ANONYMOUS_SIGNINS_PER_IP_DAILY: 2 });
    const ip = "203.0.113.7";
    expect((await signIn(app, ip)).res.status).toBe(200);
    expect((await signIn(app, `10.0.0.1, ${ip}`)).res.status).toBe(200);
    const third = await signIn(app, ip);
    expect(third.res.status).toBe(429);
    expect(await code(third.res)).toBe("rate_limited");
    expect(third.cookie).not.toContain("tj.session_token=");
    expect((await signIn(app, "203.0.113.8")).res.status).toBe(200);
  });

  test("row 8: at the daily cap, anonymous POST /lessons and sign-in are 403 anonymous_capacity", async () => {
    const app = appWith({ ANONYMOUS_LESSONS_DAILY_CAP: 1 });
    const one = await signIn(app);
    const two = await signIn(app);
    expect((await send(app, one.cookie, "POST", "/lessons", brief("A", newId()))).status).toBe(202);
    const refused = await send(app, two.cookie, "POST", "/lessons", brief("B", newId()));
    expect(refused.status).toBe(403);
    expect(await code(refused)).toBe("anonymous_capacity");
    const again = await signIn(app);
    expect(again.res.status).toBe(403);
    expect(await code(again.res)).toBe("anonymous_capacity");

    // A signed-in teacher does not count towards, nor is stopped by, the cap.
    const { userId } = await createTestUserWithWorkspace(db.unsafeDb);
    const teacher = await issueSessionCookie(auth, userId);
    expect((await send(app, teacher, "POST", "/lessons", brief("C", newId()))).status).toBe(202);
  });

  test("row 9: kill switch off → existing lesson readable, POST /lessons 403 anonymous_disabled", async () => {
    const on = appWith();
    const { cookie } = await signIn(on);
    const created = await send(on, cookie, "POST", "/lessons", brief("Volcanoes", newId()));
    const { lessonId } = (await created.json()) as { lessonId: string };

    const off = appWith({ ANONYMOUS_LESSONS_ENABLED: "false" });
    expect((await send(off, cookie, "GET", `/documents/${lessonId}`)).status).toBe(200);
    const refused = await send(off, cookie, "POST", "/lessons", brief("Rivers", newId()));
    expect(refused.status).toBe(403);
    expect(await code(refused)).toBe("anonymous_disabled");
  });
});
