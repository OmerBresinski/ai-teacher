/**
 * `GET /auth-providers` — which "Continue with …" buttons `/sign-in` may show (ADR 0008 amendment
 * of 2026-09-28, item 5). Public: it says only whether each provider has credentials, read from the
 * live better-auth instance so it can never disagree with `POST /auth/sign-in/social`.
 */
import { Hono } from "hono";
import type { Auth } from "../auth/auth";
import type { AppEnv } from "../context";

export function authProviderRoutes(auth: Pick<Auth, "options"> | undefined) {
  // Test doubles of `Auth` often carry only `api`; no `options` means nothing is on.
  const providers: object = auth?.options?.socialProviders ?? {};
  const body = {
    google: Object.hasOwn(providers, "google"),
    microsoft: Object.hasOwn(providers, "microsoft"),
  };
  return new Hono<AppEnv>().get("/auth-providers", (c) => {
    c.header("Cache-Control", "public, max-age=300");
    return c.json(body, 200);
  });
}
