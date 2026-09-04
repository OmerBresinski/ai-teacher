/**
 * `requireSession` — Hono middleware that turns the better-auth cookie into request context
 * (ADR 0008). After it runs, handlers can rely on:
 *
 * - `c.get("user")`      — `{ id, email, name, … }`
 * - `c.get("session")`   — `{ id, token, expiresAt, … }`
 * - `c.get("workspaceId")` — the caller's personal Workspace (`WorkspaceId`)
 *
 * No valid session → `401 { error: { code: "unauthorized", retryable: false, … } }`. The
 * Workspace is looked up by owner and created if missing (the `user.create.after` hook normally
 * did that on first sign-in; this is the defensive path).
 */
import type { DbHandle } from "@tj/db";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../context";
import { errorResponse } from "../errors";
import { getWorkspaceId, WORKSPACE_HEADER } from "../workspace";
import type { Auth } from "./auth";
import { createPersonalWorkspace, findPersonalWorkspaceId } from "./workspace-hook";

export const UNAUTHORIZED_MESSAGE = "You need to sign in to do that.";

/**
 * `auth` may be `undefined` (an app built without better-auth, e.g. unit tests of public
 * routes). With no valid session the request is rejected with 401 — except outside production,
 * where the dev-only `x-tj-workspace-id` header shim (`workspace.ts`) is honoured so curl/tests
 * can select a Workspace without a cookie. Production ignores the header entirely.
 */
export function requireSession(
  auth: Pick<Auth, "api"> | undefined,
  db: Pick<DbHandle, "sql">,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const result = auth ? await auth.api.getSession({ headers: c.req.raw.headers }) : null;
    if (!result) {
      // Dev-only header shim: a present `x-tj-workspace-id` is validated by `getWorkspaceId`
      // (400 if malformed); an absent header falls through to the standard 401.
      if (process.env.NODE_ENV !== "production" && c.req.header(WORKSPACE_HEADER) !== undefined) {
        c.set("workspaceId", getWorkspaceId(c));
        await next();
        return;
      }
      return errorResponse(c, 401, "unauthorized", UNAUTHORIZED_MESSAGE, false);
    }

    const workspaceId =
      (await findPersonalWorkspaceId(db, result.user.id)) ??
      (await createPersonalWorkspace(db, result.user.id));

    c.set("user", result.user);
    c.set("session", result.session);
    c.set("workspaceId", workspaceId);
    await next();
  };
}
