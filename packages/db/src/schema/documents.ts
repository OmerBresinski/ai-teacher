import type { Lesson, Series, Slide, Worksheet } from "@tj/domain/documents";
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantColumns, tenantIndexes } from "./_columns";

/**
 * `documents` — one row per Lesson, Worksheet or Series (ADR 0024 §3). The domain document is
 * stored whole as `body jsonb`, always at `CURRENT_VERSION` because `migrate()` runs on write
 * (§4); the editor's reducers and undo work on the whole document, so slides and elements are
 * deliberately **not** normalised into tables.
 *
 * - `id` is app-minted (`newId()`, UUIDv7) with no database default, as `workspaces` is; the
 *   repository rewrites `body.id` to the row id on create (§11), so the two never disagree.
 * - `kind` is a Postgres enum so a list query can filter on it with an index and a bad value fails
 *   at the database boundary too.
 * - `title`, `subject`, `year_group`, `theme_id`, `item_count`, `cover` are **promoted columns**:
 *   copies of `summarise(body)` written on every insert and update, so the Library list reads them
 *   without touching `body`. `cover` is the first slide with data-URL images stripped (ADR 0021
 *   §5), `null` for worksheets and series.
 * - `updated_at` has `DEFAULT now()` but no trigger: the repository sets it explicitly on update
 *   and compares it for optimistic concurrency (§4), so the value must be the one a client saw.
 * - `deleted_at` is the soft-delete flag (§5); lists exclude it, `restore` clears it, and there is
 *   no sweep until F15 decides retention.
 * - `generating_job_id` locks the row while a job writes into it (§18): set in the transaction
 *   that enqueues `lesson.plan`, cleared by the worker on the terminal event.
 * - Tenant table: `workspace_id NOT NULL` FK → `workspaces` `ON DELETE CASCADE`. The
 *   `(workspace_id, kind, updated_at)` and `(workspace_id, kind, title)` indexes serve the two
 *   default sort orders of `listSummaries`; `(workspace_id, deleted_at)` serves the exclusion
 *   filter and a future sweep.
 */
export const documentKind = pgEnum("document_kind", ["lesson", "worksheet", "series"]);

export const documents = pgTable(
  "documents",
  {
    ...tenantColumns(),
    kind: documentKind("kind").notNull(),
    body: jsonb("body").$type<Lesson | Worksheet | Series>().notNull(),
    title: text("title").notNull(),
    subject: text("subject"),
    yearGroup: text("year_group"),
    themeId: text("theme_id"),
    itemCount: integer("item_count").notNull(),
    cover: jsonb("cover").$type<Slide>(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    generatingJobId: uuid("generating_job_id"),
  },
  (t) => [
    ...tenantIndexes("documents", t),
    index("documents_workspace_id_kind_updated_at_idx").on(t.workspaceId, t.kind, t.updatedAt),
    index("documents_workspace_id_kind_title_idx").on(t.workspaceId, t.kind, t.title),
    index("documents_workspace_id_deleted_at_idx").on(t.workspaceId, t.deletedAt),
  ],
);
