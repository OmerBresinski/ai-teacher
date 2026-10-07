/**
 * Personal Workspace provisioning (ADR 0008). Every user gets exactly one personal Workspace in
 * the MVP; it is created by the better-auth `user.create.after` database hook on first sign-in
 * and, defensively, by `requireSession` if it is ever missing.
 *
 * Uses the postgres.js client (`db.sql`) rather than Drizzle so `@tj/api` needs no direct
 * `drizzle-orm` dependency; `workspaces` is a `NON_TENANT_TABLE`, so raw access is allowed.
 */
import type { DbHandle } from "@tj/db";
import { newId, type WorkspaceId } from "@tj/domain";
import type { Logger } from "../logger";

export const PERSONAL_WORKSPACE_NAME = "Personal";

type Sql = Pick<DbHandle, "sql">;

/** The user's personal Workspace id, or `undefined` if none exists yet. */
export async function findPersonalWorkspaceId(
  db: Sql,
  userId: string,
): Promise<WorkspaceId | undefined> {
  const rows = await db.sql<{ id: string }[]>`
    select id from workspaces where owner_user_id = ${userId} limit 1`;
  return rows[0]?.id as WorkspaceId | undefined;
}

/**
 * Create the personal Workspace for `userId` if it does not exist and return its id. Idempotent
 * under concurrency: the unique index on `workspaces.owner_user_id` makes the insert
 * `ON CONFLICT DO NOTHING`, and the follow-up select returns whichever row won.
 */
export async function createPersonalWorkspace(db: Sql, userId: string): Promise<WorkspaceId> {
  const id = newId<WorkspaceId>();
  await db.sql`
    insert into workspaces (id, owner_user_id, name)
    values (${id}, ${userId}, ${PERSONAL_WORKSPACE_NAME})
    on conflict (owner_user_id) do nothing`;
  const found = await findPersonalWorkspaceId(db, userId);
  if (!found) throw new Error(`createPersonalWorkspace: no workspace for user ${userId}`);
  return found;
}

/**
 * Startup self-check: count users without a Workspace (the hook failed, or rows were edited by
 * hand) and warn. `requireSession` heals each one on their next request, so this is a signal,
 * not a blocker.
 */
export async function logUsersWithoutWorkspace(db: Sql, logger: Logger): Promise<number> {
  const rows = await db.sql<{ count: string }[]>`
    select count(*)::text as count from users u
    where not exists (select 1 from workspaces w where w.owner_user_id = u.id)`;
  const count = Number(rows[0]?.count ?? 0);
  if (count > 0) {
    logger.warn({ count }, "users without a personal workspace (healed on next sign-in)");
  }
  return count;
}
