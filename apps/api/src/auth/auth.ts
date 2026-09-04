/**
 * better-auth instance for `@tj/api` (ADR 0008). Magic link only for now; Google and Microsoft
 * OAuth are wired but gated on their credentials being present in the environment.
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

function magicLinkMail(url: string): { subject: string; text: string; html: string } {
  return {
    subject: "Your sign-in link for Teaching Journey",
    text: [
      "Hi,",
      "",
      "Click the link below to sign in to Teaching Journey. It works once and expires in 5 minutes.",
      "",
      url,
      "",
      "If you did not request this, you can ignore this email.",
    ].join("\n"),
    html: `<p>Hi,</p><p>Click the link below to sign in to Teaching Journey. It works once and expires in 5 minutes.</p><p><a href="${url}">${url}</a></p><p>If you did not request this, you can ignore this email.</p>`,
  };
}

/**
 * Session cookie attributes (ADR 0008). `Lax` by default; `COOKIE_SAMESITE=none` is the
 * *preview* exception (Vercel preview ↔ Railway PR api on unrelated origins) and browsers only
 * accept `SameSite=None` together with `Secure`, so it forces `secure` regardless of `NODE_ENV`.
 * Production keeps `Lax` and shares the cookie via `COOKIE_DOMAIN` (ADR 0010).
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

export function createAuth({ env, db, mail, logger }: CreateAuthOptions) {
  if (env.COOKIE_SAMESITE === "none") {
    logger.warn(
      "COOKIE_SAMESITE=none: session cookie is SameSite=None; Secure (cross-site preview mode). " +
        "Production should use lax + COOKIE_DOMAIN (ADR 0008/0010).",
    );
  }
  return betterAuth({
    appName: "Teaching Journey",
    baseURL: env.BETTER_AUTH_URL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    // better-auth accepts `https://*.vercel.app`-style globs, so the preview patterns go straight in.
    trustedOrigins: [...env.WEB_ORIGIN, ...env.WEB_ORIGIN_PATTERNS],
    database: drizzleAdapter(db.unsafeDb, { provider: "pg", usePlural: true, schema: authSchema }),
    emailAndPassword: { enabled: false },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await mail.send({ to: email, ...magicLinkMail(url) });
        },
      }),
    ],
    socialProviders: socialProviders(env, logger),
    session: {
      cookieCache: { enabled: true, maxAge: 300 },
    },
    advanced: {
      cookiePrefix: "tj",
      crossSubDomainCookies: env.COOKIE_DOMAIN
        ? { enabled: true, domain: env.COOKIE_DOMAIN }
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
    },
    telemetry: { enabled: false },
    // Route better-auth's own log lines through pino (structured, level-filtered, no colours).
    logger: {
      disableColors: true,
      log: (level, message, ...args) => {
        logger[level]({ better_auth: true, args }, message);
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
