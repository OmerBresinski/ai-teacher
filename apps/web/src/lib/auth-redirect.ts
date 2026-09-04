/**
 * better-auth's magic-link verify endpoint appends `?error=INVALID_TOKEN` (and optionally
 * `error_description`) to the URL it redirects to on failure. Those params must never be carried
 * into the next `callbackURL` or the next `/sign-in?redirect=…`, otherwise a later *successful*
 * sign-in still lands on `/?error=INVALID_TOKEN` (TEACH-68).
 */
const AUTH_ERROR_PARAMS = ["error", "error_description"] as const;

/** Sentinel origin: only used to parse relative paths; never appears in the returned value. */
const PARSE_ORIGIN = "http://relative.invalid";

/**
 * True for `/path` only: not `//host` (protocol-relative), not `/\host` (WHATWG URL parsing treats
 * `\` as `/` for http(s), so that is protocol-relative too), not an absolute URL.
 */
export function isSameOriginPath(target: string | undefined): target is string {
  return typeof target === "string" && /^\/(?![/\\])/.test(target);
}

/**
 * Normalise a redirect target to a same-origin relative path without auth error params.
 * Anything that is not a same-origin path — or cannot be parsed — collapses to `/`. The result
 * always satisfies `isSameOriginPath` (e.g. `/..//evil.example` normalises to `//evil.example`
 * and is rejected).
 */
export function sanitiseRedirectPath(target: string | undefined): string {
  if (!isSameOriginPath(target)) return "/";
  let url: URL;
  try {
    url = new URL(target, PARSE_ORIGIN);
  } catch {
    return "/";
  }
  if (url.origin !== PARSE_ORIGIN) return "/";
  for (const param of AUTH_ERROR_PARAMS) url.searchParams.delete(param);
  const path = url.pathname + url.search + url.hash;
  return isSameOriginPath(path) ? path : "/";
}
