/**
 * better-auth client for `apps/web` (ADR 0008). Talks to the api's `/auth/*` endpoints with
 * cookies included; the magic-link plugin adds `signIn.magicLink({ email, callbackURL })` and the
 * anonymous plugin `signIn.anonymous()` (TEACH-223; the api refuses it unless
 * `ANONYMOUS_LESSONS_ENABLED=true`).
 *
 * ```ts
 * const authClient = createAuthClient(import.meta.env.VITE_API_URL);
 * await authClient.signIn.magicLink({ email, callbackURL: window.location.origin + "/" });
 * const { data } = authClient.useSession();
 * ```
 *
 * `baseUrl` is the API origin (e.g. `http://localhost:3001`); the `/auth` base path is appended
 * here so the server (`basePath: "/auth"`) and the client cannot drift apart.
 */
import { anonymousClient, magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient as createBetterAuthClient } from "better-auth/react";

export const AUTH_BASE_PATH = "/auth";

export function createAuthClient(baseUrl: string) {
  const origin = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return createBetterAuthClient({
    baseURL: `${origin}${AUTH_BASE_PATH}`,
    plugins: [magicLinkClient(), anonymousClient()],
    fetchOptions: { credentials: "include" },
  });
}

export type AuthClient = ReturnType<typeof createAuthClient>;
