/**
 * Cloudflare Turnstile on the two sign-in endpoints that need no human round trip (TEACH-243):
 * `POST /auth/sign-in/anonymous` mints an identity and `POST /auth/sign-in/magic-link` sends mail
 * to any address. Google sign-in is not gated; the OAuth consent screen is already a human step.
 *
 * Verification stays inside better-auth's `captcha` plugin: it reads the token from the
 * `x-captcha-response` request header and answers before the endpoint runs. Its errors are
 * better-auth's own (not the app error envelope): 400 `MISSING_RESPONSE`, 403
 * `VERIFICATION_FAILED`, 500 `UNKNOWN_ERROR` when siteverify is unreachable.
 *
 * With `TURNSTILE_SECRET_KEY` unset (local dev, most tests) nothing is gated. Production refuses
 * to boot without it (`env.ts`).
 */
import { captcha } from "better-auth/plugins";
import type { Env } from "../env";

/** The request header the web sends the Turnstile token in. CORS allows it (`app.ts`). */
export const CAPTCHA_HEADER = "x-captcha-response";

/** Endpoints (relative to `AUTH_BASE_PATH`) that require a token. */
export const CAPTCHA_ENDPOINTS = ["/sign-in/anonymous", "/sign-in/magic-link"];

export interface CaptchaPluginOptions {
  /** Tests point siteverify at a stub instead of Cloudflare. */
  siteVerifyURLOverride?: string;
}

/** Precise plugin type (not `BetterAuthPlugin`), so `plugins.find((p) => p.id === …)` still narrows. */
type CaptchaPlugin = ReturnType<typeof captcha>;

export function captchaPlugins(
  env: Partial<Pick<Env, "TURNSTILE_SECRET_KEY">>,
  options: CaptchaPluginOptions = {},
): CaptchaPlugin[] {
  const secretKey = env.TURNSTILE_SECRET_KEY;
  if (!secretKey) return [];
  return [
    captcha({
      provider: "cloudflare-turnstile",
      secretKey,
      endpoints: CAPTCHA_ENDPOINTS,
      ...(options.siteVerifyURLOverride
        ? { siteVerifyURLOverride: options.siteVerifyURLOverride }
        : {}),
    }),
  ];
}
