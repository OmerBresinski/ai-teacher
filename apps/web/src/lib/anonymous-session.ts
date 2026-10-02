/**
 * Signed-out first lesson (TEACH-244, FLOW.md §7.4): before the first write, a visitor with no
 * session gets a Turnstile token and an anonymous better-auth session, then `/me` is refetched so
 * the page (and the session boundary) see the anonymous user. A visitor who already has a session
 * (anonymous or not) is left alone.
 */
import type { QueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth";
import { type Me, meQueryOptions } from "@/lib/query";

/** Why the anonymous path could not start; every one falls back to today's `/sign-in` flow. */
export class AnonymousSignInError extends Error {
  /** `captcha`: the token was refused, retry inline. `fallback`: go to `/sign-in`. */
  readonly kind: "captcha" | "fallback";
  constructor(kind: "captcha" | "fallback", message: string) {
    super(message);
    this.name = "AnonymousSignInError";
    this.kind = kind;
  }
}

type SignInError = { status?: number; code?: string; message?: string } | null | undefined;

export async function ensureAnonymousSession(
  client: QueryClient,
  getToken: () => Promise<string | null>,
): Promise<Me> {
  // Already signed in (teacher or anonymous): nothing to do. Loads `/me` if the cache is cold.
  const current = await client.ensureQueryData(meQueryOptions);
  if (current) return current;
  const token = await getToken();
  const { error } = await authClient.signIn.anonymous({
    fetchOptions: token ? { headers: { "x-captcha-response": token } } : {},
  });
  if (error) throw signInFailure(error as SignInError);
  const me = await client.fetchQuery({ ...meQueryOptions, staleTime: 0 });
  if (!me) throw new AnonymousSignInError("fallback", "Sign in to make your lesson.");
  return me;
}

/**
 * better-auth's captcha plugin answers 400 (no token) / 403 `VERIFICATION_FAILED`; the api's own
 * 403 `anonymous_capacity` and 429 `rate_limited` use the error envelope,
 * which better-fetch surfaces as `{ status, error: { code } }` flattened into `error`.
 */
function signInFailure(error: SignInError): AnonymousSignInError {
  const code = error?.code ?? "";
  if (code === "MISSING_RESPONSE" || code === "VERIFICATION_FAILED")
    return new AnonymousSignInError("captcha", "We couldn’t check this browser. Try again.");
  return new AnonymousSignInError("fallback", "Sign in to make your lesson.");
}
