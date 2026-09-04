import { type AnyPgColumn, index, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

/**
 * Building blocks for **future tenant tables** (ADR 0007). Use them so every tenant table gets
 * the tenancy columns and the `workspace_id` index by construction:
 *
 * ```ts
 * export const journeys = pgTable(
 *   "journeys",
 *   { ...tenantColumns(), title: text("title").notNull() },
 *   (t) => [...tenantIndexes("journeys", t)],
 * );
 * ```
 *
 * `job_events` deliberately does **not** use `tenantColumns()`: its primary key is a `bigserial`
 * because the row id doubles as the SSE event id (ADR 0012, `Last-Event-ID` replay needs a
 * monotonically increasing integer), and it has no `updated_at` because events are immutable.
 * It still has `workspace_id NOT NULL` + FK + index, which is what the tenancy invariant test
 * checks.
 */
export function tenantColumns() {
  return {
    /** App-minted UUID (`newId()` from `@tj/domain`); no database default on purpose. */
    id: uuid("id").primaryKey(),
    ...workspaceColumn(),
    ...timestampColumns(),
  };
}

/**
 * Just the `workspace_id` column: `NOT NULL`, FK to `workspaces.id`, `ON DELETE CASCADE` so
 * deleting a Workspace removes every row it owns (F15-R02 right to deletion).
 */
export function workspaceColumn() {
  return {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
  };
}

/** `created_at` / `updated_at` as `timestamptz NOT NULL DEFAULT now()`. */
export function timestampColumns() {
  return {
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  };
}

/**
 * The index every tenant table needs on `workspace_id` (ADR 0007). Pass the table name so the
 * index name is stable and readable in `\di` output.
 */
export function tenantIndexes(tableName: string, table: { workspaceId: AnyPgColumn }) {
  return [index(`${tableName}_workspace_id_idx`).on(table.workspaceId)];
}
