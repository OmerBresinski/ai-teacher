import { describe, expect, test } from "bun:test";
import { effectiveCookieDomain, sessionCookieAttributes } from "./auth";

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
