import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./context";
import type { OriginMatcher } from "./origins";

export const CROSS_SITE_MESSAGE = "This request did not come from an allowed origin.";

/** Use Referer only when browsers omit Origin (for example, on navigations). */
export function requestOrigin(c: Context<AppEnv>): string | undefined {
  const origin = c.req.header("Origin");
  if (origin !== undefined) return origin;

  const referer = c.req.header("Referer");
  if (referer === undefined) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

/**
 * Reject browser requests from origins outside the CORS allow-list on protected paths.
 *
 * The allow-list is the decision when an origin is known. `Sec-Fetch-Site: cross-site` is only a
 * fallback for requests that carry no Origin/Referer (an `<img src>` under a strict Referrer-Policy):
 * it must never override an allowed Origin, because until TEACH-30 lands the production web app
 * (`*.vercel.app`) and api (`*.up.railway.app`) are different sites and every legitimate request
 * is marked `cross-site`.
 */
export function rejectCrossSiteRequests(allowed: OriginMatcher): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const origin = requestOrigin(c);
    const rejected =
      origin === undefined ? c.req.header("Sec-Fetch-Site") === "cross-site" : !allowed(origin);
    if (rejected) throw new HTTPException(403, { message: CROSS_SITE_MESSAGE });
    await next();
  };
}
