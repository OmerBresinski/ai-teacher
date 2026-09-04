/**
 * Workspace seam (ADR 0007): every tenant route resolves the caller's Workspace through
 * `getWorkspaceId(c)` and nothing else.
 *
 * Contract:
 * 1. If a previous middleware set `c.set("workspaceId", …)` that value wins. TEACH-20's
 *    `requireSession` does exactly that once the session cookie is verified, which makes the
 *    header shim below unreachable for authenticated requests.
 * 2. Otherwise, outside production only, the `x-tj-workspace-id` header is accepted so the
 *    scaffold (curl, tests, `apps/web` before auth lands) can pick a Workspace. It must parse as a
 *    `WorkspaceId` (UUID) — anything else is a 400 `bad_request`.
 * 3. Otherwise 401 `unauthorized`.
 *
 * TEACH-20 replaces step 2 by setting the context variable; delete the header branch then.
 */
import { WorkspaceId } from "@tj/domain";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./context";

export const WORKSPACE_HEADER = "x-tj-workspace-id";

export interface GetWorkspaceIdOptions {
  /** Whether the header shim is allowed. Defaults to `process.env.NODE_ENV !== "production"`. */
  allowHeaderShim?: boolean;
}

export function getWorkspaceId(
  c: Context<AppEnv>,
  { allowHeaderShim = process.env.NODE_ENV !== "production" }: GetWorkspaceIdOptions = {},
): WorkspaceId {
  const fromSession = c.get("workspaceId");
  if (fromSession !== undefined) return fromSession;

  if (allowHeaderShim) {
    const raw = c.req.header(WORKSPACE_HEADER);
    if (raw !== undefined) {
      const parsed = WorkspaceId.safeParse(raw.trim());
      if (!parsed.success) {
        throw new HTTPException(400, {
          message: `The ${WORKSPACE_HEADER} header must be a workspace id.`,
        });
      }
      return parsed.data;
    }
  }

  throw new HTTPException(401, { message: "You need to sign in to do that." });
}

/**
 * Middleware form: resolves the Workspace once and stores it in `c.var.workspaceId` so handlers
 * can read it without repeating the fallback logic. Rejects with 400/401 as `getWorkspaceId`.
 */
export function requireWorkspace(opts: GetWorkspaceIdOptions = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set("workspaceId", getWorkspaceId(c, opts));
    await next();
  };
}
