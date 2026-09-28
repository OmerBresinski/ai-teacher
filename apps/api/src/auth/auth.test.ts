import { describe, expect, test } from "bun:test";
import {
  DROPPED_OAUTH_TOKENS,
  effectiveCookieDomain,
  MICROSOFT_CONSUMER_TENANT_ID,
  microsoftEmailVerified,
  microsoftOptions,
  sessionCookieAttributes,
} from "./auth";

describe("sessionCookieAttributes", () => {
  test("default: Lax, Secure only in production", () => {
    expect(sessionCookieAttributes({ NODE_ENV: "development", COOKIE_SAMESITE: "lax" })).toEqual({
      sameSite: "lax",
      secure: false,
      httpOnly: true,
    });
    expect(sessionCookieAttributes({ NODE_ENV: "production", COOKIE_SAMESITE: "lax" })).toEqual({
      sameSite: "lax",
      secure: true,
      httpOnly: true,
    });
  });

  test("COOKIE_SAMESITE=none (preview exception) forces SameSite=None; Secure", () => {
    for (const NODE_ENV of ["development", "test", "production"] as const) {
      expect(sessionCookieAttributes({ NODE_ENV, COOKIE_SAMESITE: "none" })).toEqual({
        sameSite: "none",
        secure: true,
        httpOnly: true,
      });
    }
  });

  test("strict is passed through", () => {
    expect(sessionCookieAttributes({ NODE_ENV: "test", COOKIE_SAMESITE: "strict" }).sameSite).toBe(
      "strict",
    );
  });
});

describe("effectiveCookieDomain", () => {
  const warnings: unknown[] = [];
  const logger = { warn: (...args: unknown[]) => void warnings.push(args) };

  test("kept when the api host is under the parent", () => {
    warnings.length = 0;
    expect(
      effectiveCookieDomain(
        { COOKIE_DOMAIN: ".bresinski.org", BETTER_AUTH_URL: "https://api.bresinski.org" },
        logger,
      ),
    ).toBe(".bresinski.org");
    expect(warnings).toHaveLength(0);
  });

  test("dropped with one warning when the api host is elsewhere (PR environment)", () => {
    warnings.length = 0;
    expect(
      effectiveCookieDomain(
        {
          COOKIE_DOMAIN: ".bresinski.org",
          BETTER_AUTH_URL: "https://api-ai-teacher-pr-7.up.railway.app",
        },
        logger,
      ),
    ).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  test("a look-alike host does not match", () => {
    warnings.length = 0;
    expect(
      effectiveCookieDomain(
        { COOKIE_DOMAIN: ".bresinski.org", BETTER_AUTH_URL: "https://evilbresinski.org" },
        logger,
      ),
    ).toBeUndefined();
  });

  test("unset stays unset, silently", () => {
    warnings.length = 0;
    expect(
      effectiveCookieDomain(
        { COOKIE_DOMAIN: undefined, BETTER_AUTH_URL: "http://localhost:3001" },
        logger,
      ),
    ).toBeUndefined();
    expect(warnings).toHaveLength(0);
  });
});

describe("DROPPED_OAUTH_TOKENS", () => {
  test("nulls exactly the three provider tokens on every accounts write (ADR 0008 item 3)", () => {
    expect(DROPPED_OAUTH_TOKENS).toStrictEqual({
      accessToken: null,
      refreshToken: null,
      idToken: null,
    });
  });
});

describe("Microsoft sign-in (ADR 0008 amendment of 2026-09-28)", () => {
  const WORK_TENANT = "72f988bf-86f1-41af-91ab-2d7cd011db47";

  function idToken(claims: Record<string, unknown>): string {
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${part({ alg: "RS256", typ: "JWT" })}.${part({
      oid: "oid-1",
      iss: `https://login.microsoftonline.com/${claims.tid}/v2.0`,
      name: "Ada Lovelace",
      email: "ada@school.example",
      ...claims,
    })}.sig`;
  }

  test("a personal account's email is verified", () => {
    expect(microsoftEmailVerified({ tid: MICROSOFT_CONSUMER_TENANT_ID })).toBe(true);
  });

  test("a work or school email is verified only with xms_edov", () => {
    expect(microsoftEmailVerified({ tid: WORK_TENANT, xms_edov: true })).toBe(true);
    expect(microsoftEmailVerified({ tid: WORK_TENANT, xms_edov: "1" })).toBe(true);
    expect(microsoftEmailVerified({ tid: WORK_TENANT })).toBe(false);
    expect(microsoftEmailVerified({ tid: WORK_TENANT, xms_edov: false })).toBe(false);
    // Entra's `email_verified` is not trusted on its own: a tenant admin controls it.
    expect(microsoftEmailVerified({ tid: WORK_TENANT, email_verified: true })).toBe(false);
  });

  test("options: any account type, account picker, identity scopes, no photo", () => {
    const options = microsoftOptions("client-id", "client-secret");
    expect(options.tenantId).toBe("common");
    expect(options.prompt).toBe("select_account");
    expect(options.disableDefaultScope).toBe(true);
    expect(options.scope).toEqual(["openid", "profile", "email"]);
    expect(options.disableProfilePhoto).toBe(true);
  });

  test("getUserInfo passes a verified email through, marked verified", async () => {
    const { getUserInfo } = microsoftOptions("client-id", "client-secret");
    const info = await getUserInfo({
      idToken: idToken({ tid: WORK_TENANT, xms_edov: true }),
      accessToken: "access",
    });
    expect(info?.user).toMatchObject({ email: "ada@school.example", emailVerified: true });

    const personal = await getUserInfo({ idToken: idToken({ tid: MICROSOFT_CONSUMER_TENANT_ID }) });
    expect(personal?.user.emailVerified).toBe(true);
  });

  test("getUserInfo refuses an unverified email, so no user is created or linked", async () => {
    const { getUserInfo } = microsoftOptions("client-id", "client-secret");
    expect(await getUserInfo({ idToken: idToken({ tid: WORK_TENANT }) })).toBeNull();
    expect(
      await getUserInfo({ idToken: idToken({ tid: WORK_TENANT, email_verified: true }) }),
    ).toBeNull();
  });
});
