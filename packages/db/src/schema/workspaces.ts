import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * `workspaces` — the tenant root (ADR 0007). Every tenant table carries a `workspace_id` FK to
 * this table; it is the only application table without one, so it is listed in
 * `NON_TENANT_TABLES` and `forWorkspace()` refuses it at the type level.
 *
 * - `id` has **no database default**: ids are minted app-side with `newId<WorkspaceId>()` from
 *   `@tj/domain` (UUIDv7, time-ordered) so the caller knows the id before the row exists.
 * - `owner_user_id` is plain `text` for now. TEACH-20 (better-auth) creates `users` and adds the
 *   foreign key in its own migration; until then the column is opaque.
 * - `name` exists on the row even though the domain `Workspace` skeleton in `@tj/domain` has no
 *   `name` field (F17 owns display name, plan and members). The database is the superset: F17
 *   adds the field to the schema when it lands. Do not "fix" the mismatch by adding it to
 *   `@tj/domain` here.
 */
export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
