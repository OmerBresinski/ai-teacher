/**
 * Browser-origin allow-list for CORS and better-auth `trustedOrigins` (ADR 0010, TEACH-25).
 *
 * `WEB_ORIGIN` holds exact origins (production `https://app.<domain>`, local dev).
 * `WEB_ORIGIN_PATTERNS` holds glob patterns for origins that are only known per deployment —
 * Vercel preview URLs such as `https://teaching-journey-web-git-<branch>-<team>.vercel.app`.
 * A pattern is an origin where `*` matches one or more characters that are **not** `/`, `.` or
 * `:` — so `https://*.vercel.app` matches `https://foo.vercel.app` but not
 * `https://foo.evil.com/.vercel.app`, `https://a.b.vercel.app` or `https://foo.vercel.app:8443`.
 * Prefer the narrowest pattern that covers your project's preview URLs (see infra/README.md).
 */

const GLOB_SEGMENT = "[^/.:]+";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Compile one glob origin pattern (`https://*.vercel.app`) to an anchored RegExp. */
export function compileOriginPattern(pattern: string): RegExp {
  const source = pattern.split("*").map(escapeRegExp).join(GLOB_SEGMENT);
  return new RegExp(`^${source}$`);
}

/** Basic shape check used by the env schema: `scheme://host[:port]` with at least one `*`. */
export function isValidOriginPattern(pattern: string): boolean {
  if (!pattern.includes("*")) return false;
  if (pattern.endsWith("/")) return false;
  const probe = pattern.replaceAll("*", "placeholder");
  try {
    const url = new URL(probe);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === probe;
  } catch {
    return false;
  }
}

export interface OriginMatcher {
  (origin: string): boolean;
  /** Exact origins, for callers that need a list (logging). */
  readonly exact: readonly string[];
  /** Raw patterns as configured. */
  readonly patterns: readonly string[];
}

/** `matcher(origin)` is true for an exact `WEB_ORIGIN` entry or any `WEB_ORIGIN_PATTERNS` match. */
export function createOriginMatcher(
  exact: readonly string[],
  patterns: readonly string[] = [],
): OriginMatcher {
  const exactSet = new Set(exact);
  const regexes = patterns.map(compileOriginPattern);
  const matcher = ((origin: string) =>
    exactSet.has(origin) || regexes.some((re) => re.test(origin))) as OriginMatcher;
  Object.defineProperty(matcher, "exact", { value: [...exact] });
  Object.defineProperty(matcher, "patterns", { value: [...patterns] });
  return matcher;
}
