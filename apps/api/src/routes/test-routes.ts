/**
 * Test-only routes (TEACH-22). Mounted by `app.ts` **only** when `testRoutesEnabled(env)`:
 * `NODE_ENV === "test"` *and* `ENABLE_TEST_ROUTES=1`. `env.ts` additionally refuses to boot with
 * `ENABLE_TEST_ROUTES` set in production, so these can never reach a deployed api.
 *
 * `GET /__test/last-magic-link?email=…` — the last magic link the api "sent" to `email`, read
 * from the in-memory `CaptureMailSender`. Playwright's `signedInPage` fixture uses it to sign in
 * without a mailbox. Not part of `AppType` (never reaches the RPC client types).
 */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context";
import type { Env } from "../env";
import { errorResponse } from "../errors";
import { type CaptureMailSender, extractFirstUrl } from "../mail";
import { validationHook } from "../validation";

export type TestRoutesEnv = Pick<Env, "NODE_ENV"> & Partial<Pick<Env, "ENABLE_TEST_ROUTES">>;

/** The single place that decides whether test routes exist in this process. */
export function testRoutesEnabled(env: TestRoutesEnv): boolean {
  return env.NODE_ENV === "test" && env.ENABLE_TEST_ROUTES === "1";
}

const lastMagicLinkQuery = z.object({ email: z.email() });

export function testRoutes(mail: CaptureMailSender) {
  return new Hono<AppEnv>().get(
    "/__test/last-magic-link",
    zValidator("query", lastMagicLinkQuery, validationHook),
    (c) => {
      const { email } = c.req.valid("query");
      const message = mail.lastFor(email);
      const url = message ? extractFirstUrl(message.text) : undefined;
      if (!message || !url) {
        return errorResponse(
          c,
          404,
          "not_found",
          "No magic link has been sent to that address.",
          false,
        );
      }
      return c.json({ email: message.to, url }, 200);
    },
  );
}
