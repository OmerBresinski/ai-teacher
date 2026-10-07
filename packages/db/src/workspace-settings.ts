import type { WorkspaceId } from "@tj/domain";
import { type Country, localeFor } from "@tj/domain/documents";
import { eq } from "drizzle-orm";
import { workspaces } from "./schema/workspaces";
import type { ScopableDb } from "./tenant";

/*
 * Account-level settings on the personal Workspace row (TEACH-33 part b, ruling 183). `workspaces`
 * is a `NON_TENANT_TABLE`, so these query it by id with the raw client; the id always comes from
 * the session (`getWorkspaceId`), never from the request body.
 */

/** The Workspace's country; England when the row is missing or holds an unknown value. */
export async function getWorkspaceCountry(
  db: ScopableDb,
  workspaceId: WorkspaceId,
): Promise<Country> {
  const rows = await db
    .select({ country: workspaces.country })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return localeFor(rows[0]?.country).country;
}

/** Set the Workspace's country. New lessons read it; saved lessons keep their own. */
export async function setWorkspaceCountry(
  db: ScopableDb,
  workspaceId: WorkspaceId,
  country: Country,
): Promise<void> {
  await db
    .update(workspaces)
    .set({ country, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId));
}
