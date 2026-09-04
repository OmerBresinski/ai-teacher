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

/** Reject browser requests from origins outside the CORS allow-list on protected paths. */
export function rejectCrossSiteRequests(allowed: OriginMatcher): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const origin = requestOrigin(c);
    if (c.req.header("Sec-Fetch-Site") === "cross-site" || (origin && !allowed(origin))) {
      throw new HTTPException(403, { message: CROSS_SITE_MESSAGE });
    }
    await next();
  };
}
