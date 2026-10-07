import type { WorkspaceId } from "@tj/domain";
import { type Country, localeFor } from "@tj/domain/documents";
import { and, eq, isNull } from "drizzle-orm";
import { workspaces } from "./schema/workspaces";
import type { ScopableDb } from "./tenant";

/*
 * Account-level settings on the personal Workspace row (TEACH-33 part b, ruling 183). `workspaces`
 * is a `NON_TENANT_TABLE`, so these query it by id with the raw client; the id always comes from
 * the session (`getWorkspaceId`), never from the request body.
 */

/**
 * The Workspace's country and whether one was ever set; England when the row is missing, unset
 * (`chosen: false`) or holds an unknown value.
 */
export async function getWorkspaceSettings(
  db: ScopableDb,
  workspaceId: WorkspaceId,
): Promise<{ country: Country; chosen: boolean }> {
  const rows = await db
    .select({ country: workspaces.country })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  const stored = rows[0]?.country ?? null;
  return { country: localeFor(stored).country, chosen: stored !== null };
}

/** The Workspace's country; England when the row is missing, unset or holds an unknown value. */
export async function getWorkspaceCountry(
  db: ScopableDb,
  workspaceId: WorkspaceId,
): Promise<Country> {
  return (await getWorkspaceSettings(db, workspaceId)).country;
}

/**
 * Set the country from the sign-up hint (the web's geolocation), only while none is set, so it
 * never overrides a teacher's choice or an existing account. Returns the country now in force.
 */
export async function applyCountryHint(
  db: ScopableDb,
  workspaceId: WorkspaceId,
  country: Country,
): Promise<Country> {
  await db
    .update(workspaces)
    .set({ country, updatedAt: new Date() })
    .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.country)));
  return getWorkspaceCountry(db, workspaceId);
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
