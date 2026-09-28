/**
 * better-auth instance for `@tj/api` (ADR 0008). Email magic link, plus Google when
 * `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are both set (ADR 0008 amendment of 2026-09-27).
 * Microsoft is wired and gated the same way but stays off by decision: its credentials are not
 * set until it has its own linking review (amendment item 1).
 *
 * Mounted at `/auth/*` by `app.ts` (`basePath: "/auth"`), so the browser-facing endpoints are
 * `POST /auth/sign-in/magic-link`, `GET /auth/magic-link/verify`, `GET /auth/get-session`,
 * `POST /auth/sign-out`, … `requireSession` (`require-session.ts`) resolves the cookie into
 * `c.get("user")`, `c.get("session")` and `c.get("workspaceId")`.
 */
import type { DbHandle } from "@tj/db";
import { authSchema } from "@tj/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import type { Env } from "../env";
import type { Logger } from "../logger";
import type { MailSender } from "../mail";
import { confirmPageUrl, MAGIC_LINK_EXPIRES_IN_SECONDS, magicLinkMail } from "./magic-link-mail";
import { createPersonalWorkspace } from "./workspace-hook";

export const AUTH_BASE_PATH = "/auth";

export type AuthEnv = Pick<
  Env,
  | "NODE_ENV"
  | "WEB_ORIGIN"
  | "WEB_ORIGIN_PATTERNS"
  | "BETTER_AUTH_SECRET"
  | "BETTER_AUTH_URL"
  | "COOKIE_DOMAIN"
  | "COOKIE_SAMESITE"
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "MICROSOFT_CLIENT_ID"
  | "MICROSOFT_CLIENT_SECRET"
>;

export interface CreateAuthOptions {
  env: AuthEnv;
  db: Pick<DbHandle, "unsafeDb" | "sql">;
  mail: MailSender;
  logger: Logger;
}

function socialProviders(env: AuthEnv, logger: Logger) {
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {};
  if (!("google" in google)) logger.info("Google sign-in disabled (no credentials)");

  const microsoft =
    env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET
      ? {
          microsoft: {
            clientId: env.MICROSOFT_CLIENT_ID,
            clientSecret: env.MICROSOFT_CLIENT_SECRET,
          },
        }
      : {};
  if (!("microsoft" in microsoft)) logger.info("Microsoft sign-in disabled (no credentials)");

  return { ...google, ...microsoft };
}

/**
 * Session cookie attributes (ADR 0008). `Lax` by default; `COOKIE_SAMESITE=none` is the
 * *preview* exception (Vercel preview ↔ Railway PR api on unrelated origins) and browsers only
 * accept `SameSite=None` together with `Secure`, so it forces `secure` regardless of `NODE_ENV`.
 * Production keeps `Lax` and shares the cookie via `COOKIE_DOMAIN` (ADR 0010, TEACH-36).
 */
export function sessionCookieAttributes(env: Pick<AuthEnv, "NODE_ENV" | "COOKIE_SAMESITE">): {
  sameSite: "lax" | "strict" | "none";
  secure: boolean;
  httpOnly: true;
} {
  const sameSite = env.COOKIE_SAMESITE ?? "lax";
  return {
    sameSite,
    secure: sameSite === "none" || env.NODE_ENV === "production",
    httpOnly: true,
  };
}

/**
 * `COOKIE_DOMAIN` only when this api is actually under it. A browser drops a `Domain=` that does
 * not cover the responding host, so an api at `api-ai-teacher-pr-7.up.railway.app` that inherited
 * production's `.bresinski.org` would set a cookie nobody stores; better to fall back to a
 * host-only cookie and say so once at boot.
 */
export function effectiveCookieDomain(
  env: Pick<AuthEnv, "COOKIE_DOMAIN" | "BETTER_AUTH_URL">,
  logger: Pick<Logger, "warn">,
): string | undefined {
  if (!env.COOKIE_DOMAIN) return undefined;
  const host = new URL(env.BETTER_AUTH_URL).hostname;
  const parent = env.COOKIE_DOMAIN.replace(/^\./, "");
  if (host === parent || host.endsWith(`.${parent}`)) return env.COOKIE_DOMAIN;
  logger.warn(
    { cookieDomain: env.COOKIE_DOMAIN, host },
    "COOKIE_DOMAIN ignored: BETTER_AUTH_URL is not under it (inherited production value in a PR environment?); session cookie is host-only",
  );
  return undefined;
}

/**
 * Merged into every `accounts` write (`databaseHooks.account` `create.before` and
 * `update.before`): sign-in needs the provider's identity only, so its tokens are never stored
 * (ADR 0008 amendment item 3). better-auth writes `null` and skips only `undefined`.
 */
export const DROPPED_OAUTH_TOKENS = {
  accessToken: null,
  refreshToken: null,
  idToken: null,
} as const;

export function createAuth({ env, db, mail, logger }: CreateAuthOptions) {
  const cookieDomain = effectiveCookieDomain(env, logger);
  if (env.COOKIE_SAMESITE === "none") {
    logger.warn(
      "COOKIE_SAMESITE=none: session cookie is SameSite=None; Secure (cross-site preview mode). " +
        "Production should use lax + COOKIE_DOMAIN (ADR 0008/0010).",
    );
  }
  return betterAuth({
    appName: "DayBack",
    baseURL: env.BETTER_AUTH_URL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    // better-auth accepts `https://*.vercel.app`-style globs, so the preview patterns go straight in.
    trustedOrigins: [...env.WEB_ORIGIN, ...env.WEB_ORIGIN_PATTERNS],
    database: drizzleAdapter(db.unsafeDb, { provider: "pg", usePlural: true, schema: authSchema }),
    emailAndPassword: { enabled: false },
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,
        // The email links to the web's confirm page, not to the verify endpoint: a mail scanner's
        // GET must not spend the single-use token (TEACH-246).
        sendMagicLink: async ({ email, url }, ctx) => {
          const link = confirmPageUrl(url, env.WEB_ORIGIN[0] as string, (origin) =>
            Boolean(ctx?.context.isTrustedOrigin(origin)),
          );
          await mail.send({ to: email, ...magicLinkMail(link, env.BETTER_AUTH_URL) });
        },
      }),
    ],
    socialProviders: socialProviders(env, logger),
    session: {
      cookieCache: { enabled: true, maxAge: 300 },
    },
    account: {
      // A sign-in with an already linked account rewrites nothing (amendment item 3).
      updateAccountOnSignIn: false,
      // Linking Google to a magic-link user copies its name and photo URL once; later sign-ins
      // leave them alone because `overrideUserInfoOnSignIn` stays off (amendment item 4).
      accountLinking: { updateUserInfoOnLink: true },
    },
    advanced: {
      cookiePrefix: "tj",
      crossSubDomainCookies: cookieDomain
        ? { enabled: true, domain: cookieDomain }
        : { enabled: false },
      defaultCookieAttributes: sessionCookieAttributes(env),
      useSecureCookies: env.NODE_ENV === "production" || env.COOKIE_SAMESITE === "none",
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await createPersonalWorkspace(db, user.id);
          },
        },
      },
      account: {
        create: { before: async () => ({ data: DROPPED_OAUTH_TOKENS }) },
        update: { before: async () => ({ data: DROPPED_OAUTH_TOKENS }) },
      },
    },
    telemetry: { enabled: false },
    // Better Call otherwise console.error()s unexpected failures after Better Auth's logger.
    // Rethrow to Hono's safe onError; Better Call still handles its typed APIError responses.
    // OAuth failures that have no errorCallbackURL (missing or unknown state, database errors)
    // redirect to the web's /sign-in instead of better-auth's page on this host (item 6).
    onAPIError: { throw: true, errorURL: new URL("/sign-in", env.WEB_ORIGIN[0]).toString() },
    // Library messages/args may include tokens, SQL parameters or provider response bodies.
    logger: {
      disableColors: true,
      log: (level) => {
        logger[level]({ better_auth: true }, "authentication event");
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
