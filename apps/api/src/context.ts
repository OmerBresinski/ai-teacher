import type { WorkspaceId } from "@tj/domain";
import type { Auth } from "./auth/auth";
import type { Logger } from "./logger";

/** The `user` / `session` shapes better-auth returns from `auth.api.getSession()`. */
export type SessionResult = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;
export type SessionUser = SessionResult["user"];
export type Session = SessionResult["session"];

/** Per-request variables set by the middleware in `app.ts`. */
export type AppEnv = {
  Variables: {
    requestId: string;
    logger: Logger;
    /** Set by `requireSession` (TEACH-20); absent on public routes. */
    user: SessionUser;
    session: Session;
    /** The caller's personal Workspace (TEACH-20); `getWorkspaceId(c)` reads it (TEACH-19). */
    workspaceId?: WorkspaceId;
  };
};
