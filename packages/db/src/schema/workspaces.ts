import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

/**
 * `workspaces` — the tenant root (ADR 0007). Every tenant table carries a `workspace_id` FK to
 * this table; it has no `workspace_id` itself, so it is listed in `NON_TENANT_TABLES` and
 * `forWorkspace()` refuses it at the type level.
 *
 * - `id` has **no database default**: ids are minted app-side with `newId<WorkspaceId>()` from
 *   `@tj/domain` (UUIDv7, time-ordered) so the caller knows the id before the row exists.
 * - `owner_user_id` is `text` (better-auth ids are not UUIDs) with a FK to `users.id`
 *   (`ON DELETE CASCADE`: deleting the account deletes the Workspace and, through the tenant
 *   FKs, everything in it — F17-R12). It is **unique** because the MVP has exactly one personal
 *   Workspace per user (ADR 0008); the unique index is what makes `createPersonalWorkspace()`
 *   idempotent (`ON CONFLICT DO NOTHING`). F17 (teams / multiple workspaces) will relax this.
 * - `name` exists on the row even though the domain `Workspace` skeleton in `@tj/domain` has no
 *   `name` field (F17 owns display name, plan and members). The database is the superset: F17
 *   adds the field to the schema when it lands. Do not "fix" the mismatch by adding it to
 *   `@tj/domain` here.
 */
export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("workspaces_owner_user_id_uidx").on(t.ownerUserId)],
);
