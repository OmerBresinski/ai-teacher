import { describe, expect, test } from "bun:test";
import { sessionCookieAttributes } from "./auth";

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
