/**
 * TEACH-300 against the real test database: magic-link sends are bounded per recipient (rolling
 * hour) and globally (UTC day). Over a bound nothing is sent and the answer is the normal one, so
 * nothing enumerates addresses. Synthetic recipients and `CaptureMailSender` only.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { withTestDb } from "@tj/db/testing";
import { createApp } from "./app";
import { type AuthEnv, createAuth, RATE_LIMIT_NO_IP_MESSAGE } from "./auth/auth";
import { magicLinkRecipientKey } from "./auth/magic-link-bounds";
import { CaptureMailSender } from "./mail";
import { captureLogger, TEST_ENV } from "./test-helpers";

const t = await withTestDb({ max: 4 });
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping magic-link bounds db tests: ${t.reason}`);

const BASE = "http://localhost:3001";
const WEB = "http://localhost:5173";
const SECRET = "test-secret-test-secret-test-secret-0123456789";

const AUTH_ENV: AuthEnv = {
  ...TEST_ENV,
  BETTER_AUTH_SECRET: SECRET,
  BETTER_AUTH_URL: BASE,
  COOKIE_DOMAIN: undefined,
  COOKIE_SAMESITE: "lax",
  GOOGLE_CLIENT_ID: undefined,
  GOOGLE_CLIENT_SECRET: undefined,
  MICROSOFT_CLIENT_ID: undefined,
  MICROSOFT_CLIENT_SECRET: undefined,
  MAGIC_LINK_SENDS_PER_RECIPIENT_HOURLY: 2,
  MAGIC_LINK_SENDS_DAILY_CAP: 4,
};

describeDb("magic-link send bounds (TEACH-300)", () => {
  if (!t.ok) return;
  const db = t.db;
  const mail = new CaptureMailSender();
  const { logger, lines } = captureLogger();
  const auth = createAuth({ env: AUTH_ENV, db, mail, logger });
  const app = createApp({ env: TEST_ENV, db, logger, auth });

  afterAll(() => db.close());
  beforeEach(async () => {
    await db.truncateTenantTables();
    mail.clear();
    lines.length = 0;
  });

  async function request(email: string) {
    const res = await app.request(`${BASE}/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: WEB },
      body: JSON.stringify({ email, callbackURL: `${WEB}/` }),
    });
    return { status: res.status, body: await res.text() };
  }

  test("recipient bound: the third send in an hour is skipped and answers like a send", async () => {
    const first = await request("bounded@example.test");
    expect(first.status).toBe(200);
    expect((await request("Bounded@Example.test")).status).toBe(200);
    expect(mail.all).toHaveLength(2);

    const over = await request("BOUNDED@example.test");
    expect(over).toEqual(first);
    expect(mail.all).toHaveLength(2);

    const bounded = lines.filter((l) => l.includes("magic link not sent: send bound reached"));
    expect(bounded).toHaveLength(1);
    expect(JSON.parse(bounded[0] as string)).toMatchObject({
      recipientCount: 2,
      dailyCount: 2,
      perRecipientHourly: 2,
      dailyCap: 4,
    });
    expect(lines.join("").toLowerCase()).not.toContain("bounded@example.test");
  });

  test("another recipient is unaffected; the table holds a key, never the address", async () => {
    await request("one@example.test");
    await request("one@example.test");
    expect((await request("two@example.test")).status).toBe(200);
    expect(mail.lastFor("two@example.test")).toBeDefined();
    const rows = await db.sql<{ recipient: string }[]>`select recipient from magic_link_sends`;
    expect(rows.map((r) => r.recipient)).toContain(
      magicLinkRecipientKey(SECRET, "ONE@example.test"),
    );
    expect(rows.some((r) => r.recipient.includes("@"))).toBe(false);
  });

  test("the hour rolls: sends older than an hour no longer count for the recipient", async () => {
    await request("rolling@example.test");
    await request("rolling@example.test");
    await db.sql`update magic_link_sends set sent_at = now() - interval '61 minutes'`;
    expect((await request("rolling@example.test")).status).toBe(200);
    expect(mail.all).toHaveLength(3);
  });

  test("global bound: at the daily cap no address gets mail; the answer is unchanged", async () => {
    for (const n of [1, 2, 3, 4]) await request(`cap-${n}@example.test`);
    expect(mail.all).toHaveLength(4);
    const over = await request("cap-5@example.test");
    expect(over).toEqual({ status: 200, body: JSON.stringify({ status: true }) });
    expect(mail.lastFor("cap-5@example.test")).toBeUndefined();
  });

  test("better-auth's no-IP fallback warning is the one library message let through, as a flag", async () => {
    const context = await auth.$context;
    context.logger.warn(`${RATE_LIMIT_NO_IP_MESSAGE} and is falling back to a shared bucket.`);
    context.logger.warn("some other library message");
    const events = lines
      .filter((l) => l.includes("authentication event"))
      .map((l) => JSON.parse(l));
    expect(events.map((e) => e.rateLimitNoIp)).toEqual([true, undefined]);
    expect(lines.join("")).not.toContain(RATE_LIMIT_NO_IP_MESSAGE);
  });
});
