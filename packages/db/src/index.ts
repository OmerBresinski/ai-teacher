/**
 * `@tj/db` — Drizzle schema, migrations and the `forWorkspace()` tenancy helper (ADR 0006, 0007,
 * 0012). Subpaths: `@tj/db/tenant`, `@tj/db/schema`, `@tj/db/testing`.
 */
export { type CreateDbOptions, createDb, type Db, type DbHandle, type Sql } from "./client";
export {
  clearGenerating,
  createDocument,
  type DocumentBody,
  type DocumentRow,
  type DocumentSummaryRow,
  deleteDocument,
  escapeLike,
  getDocument,
  getSeriesWithLessons,
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
  type ListSort,
  type ListSummariesOptions,
  type ListSummariesResult,
  listSummaries,
  MalformedCursorError,
  type PutDocumentAsJobResult,
  type PutDocumentResult,
  parseDocumentBody,
  putDocument,
  putDocumentAsJob,
  type ReleaseStaleLockOptions,
  releaseStaleLock,
  restore,
  STALE_LOCK_AFTER_MS,
  softDelete,
} from "./documents";
export {
  getTerminalJobEvent,
  hasQueuedJobEvent,
  insertJobEvent,
  JOB_EVENTS_CHANNEL,
  type JobEventNotification,
  JobEventNotificationSchema,
  type JobEventRow,
  type ListJobEventsOptions,
  listJobEvents,
  notifyJobEvent,
  terminalJobEventFor,
} from "./job-events";
export { MIGRATIONS_FOLDER, migrateDatabase } from "./migrator";
export * from "./schema/index";
export {
  forWorkspace,
  type ScopableDb,
  type TenantInsert,
  type TenantTable,
  type TenantUpdate,
  type WorkspaceDb,
} from "./tenant";
