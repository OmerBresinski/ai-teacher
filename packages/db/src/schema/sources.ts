import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantColumns, tenantIndexes } from "./_columns";

/**
 * `sources` — the registry of teacher-provided materials uploaded through `POST /sources`
 * (ADR 0027 §4). One row per Source; the Lesson body still carries the `SourceRef[]` it was
 * created with (ADR 0025 §20), and this table answers what the body cannot: who owns the object,
 * which Sources were never bound to a lesson (the orphan sweep), and what to delete.
 *
 * - `id` is app-minted (`newId()`, UUIDv7) as `documents` is; it is also the folder segment of
 *   every object the Source owns: `<ws>/sources/<id>/original.<ext>`, `…/extracted.json`,
 *   `…/img/<n>.<ext>`.
 * - `kind` is the coarse `file | paste` of `SourceRef.kind`; the document format (pdf, pptx,
 *   docx) is recoverable from `mime`, which is the **sniffed** type, never the one the browser
 *   declared.
 * - `storage_key` names the original object; `pages` is pages for a PDF, slides for a PPTX, 1 for
 *   a DOCX or a paste; `low_text` marks a document whose text was thin but which carried images
 *   (ADR 0027 §2, §8).
 * - `lesson_id` is `NULL` until `POST /lessons` claims the Source in the same transaction that
 *   creates the lesson (§5). No FK to `documents`: lessons are soft-deleted and restored, and a
 *   constraint would block nothing useful while making restore order-sensitive.
 * - `deleted_at` is the soft-delete flag, as on `documents`; `DELETE /sources/:id` and the sweep
 *   set it after removing the objects.
 * - Tenant table: `workspace_id NOT NULL` FK → `workspaces` `ON DELETE CASCADE`. The
 *   `(workspace_id, lesson_id)` index serves the claim (`lesson_id IS NULL`) and "sources of this
 *   lesson".
 */
export const sourceKind = pgEnum("source_kind", ["file", "paste"]);

export const sources = pgTable(
  "sources",
  {
    ...tenantColumns(),
    kind: sourceKind("kind").notNull(),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    byteSize: integer("byte_size").notNull(),
    storageKey: text("storage_key").notNull(),
    pages: integer("pages").notNull(),
    lowText: boolean("low_text").notNull().default(false),
    lessonId: uuid("lesson_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    ...tenantIndexes("sources", t),
    index("sources_workspace_id_lesson_id_idx").on(t.workspaceId, t.lessonId),
  ],
);
