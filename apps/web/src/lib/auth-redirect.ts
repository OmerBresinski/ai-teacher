/**
 * better-auth's magic-link verify endpoint appends `?error=INVALID_TOKEN` (and optionally
 * `error_description`) to the URL it redirects to on failure. Those params must never be carried
 * into the next `callbackURL` or the next `/sign-in?redirect=…`, otherwise a later *successful*
 * sign-in still lands on `/?error=INVALID_TOKEN` (TEACH-68).
 */
const AUTH_ERROR_PARAMS = ["error", "error_description"] as const;

/** Sentinel origin: only used to parse relative paths; never appears in the returned value. */
const PARSE_ORIGIN = "http://relative.invalid";

/** True for `/path` (any relative path) but not for `//host` (protocol-relative) or absolute URLs. */
export function isSameOriginPath(target: string | undefined): target is string {
  return typeof target === "string" && target.startsWith("/") && !target.startsWith("//");
}

/**
 * Normalise a redirect target to a same-origin relative path without auth error params.
 * Anything that is not a same-origin path collapses to `/`.
 */
export function sanitiseRedirectPath(target: string | undefined): string {
  if (!isSameOriginPath(target)) return "/";
  const url = new URL(target, PARSE_ORIGIN);
  for (const param of AUTH_ERROR_PARAMS) url.searchParams.delete(param);
  return url.pathname + url.search + url.hash;
}
