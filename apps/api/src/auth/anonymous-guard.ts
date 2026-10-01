/**
 * `anonymousGuard` — what an anonymous (signed-out) session may do on the protected paths
 * (TEACH-222, rulings 109–110, SO-1). Mounted in `app.ts` after `requireSession`, so `user` is
 * set for every cookie session. No `user` (the dev header shim) or a signed-in user → no-op.
 *
 * Default deny: reads (`GET`, `HEAD`, `OPTIONS`) pass, and so do the writes on the allow-list
 * below; every other method on a protected path is 403 `sign_in_required`. A route added later is
 * therefore closed to anonymous users until someone lists it here.
 */
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../context";
import { errorResponse } from "../errors";
import { SIGN_IN_REQUIRED_MESSAGE } from "./anonymous-limits";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Writes an anonymous session may make. Ownership is the routes' own `forWorkspace()` scoping
 * (another Workspace's lesson is 404); the quotas are in `routes/lessons.ts`.
 */
export const ANONYMOUS_WRITE_ALLOW_LIST: ReadonlyArray<{ method: string; path: RegExp }> = [
  // Brief → lesson (two per Workspace, global daily cap).
  { method: "POST", path: /^\/lessons$/ },
  // The objectives step (SO-1): re-plan (at most 3 per lesson) and confirm.
  { method: "POST", path: /^\/lessons\/[^/]+\/plan$/ },
  { method: "POST", path: /^\/lessons\/[^/]+\/generate$/ },
  // Stopping one's own generation only saves spend.
  { method: "POST", path: /^\/jobs\/[^/]+\/cancel$/ },
];

export function isAnonymousAllowed(method: string, path: string): boolean {
  const m = method.toUpperCase();
  if (READ_METHODS.has(m)) return true;
  const p = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return ANONYMOUS_WRITE_ALLOW_LIST.some((rule) => rule.method === m && rule.path.test(p));
}

export function anonymousGuard(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.get("user")?.isAnonymous !== true) return next();
    if (isAnonymousAllowed(c.req.method, c.req.path)) return next();
    return errorResponse(c, 403, "sign_in_required", SIGN_IN_REQUIRED_MESSAGE);
  };
}
