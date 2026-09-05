import { Hono } from "hono";
import { UNAUTHORIZED_MESSAGE } from "../auth/require-session";
import type { AppEnv } from "../context";
import { errorResponse } from "../errors";

export function meRoutes() {
  return new Hono<AppEnv>().get("/me", (c) => {
    const user = c.get("user");
    const workspaceId = c.get("workspaceId");
    // `requireSession` always sets both; the guard keeps the route safe if it is ever mounted bare.
    if (!user || !workspaceId) {
      return errorResponse(c, 401, "unauthorized", UNAUTHORIZED_MESSAGE, false);
    }
    return c.json(
      { user: { id: user.id, email: user.email, name: user.name }, workspaceId: workspaceId },
      200,
    );
  });
}
