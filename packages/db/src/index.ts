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
  findLessonByRequestId,
  findWorksheetForGeneration,
  getDocument,
  getSeriesWithLessons,
  handOffLock,
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
  type ListSort,
  type ListSummariesOptions,
  type ListSummariesResult,
  listSummaries,
  listWorksheetsOfLesson,
  MalformedCursorError,
  type PutDocumentAsJobResult,
  type PutDocumentResult,
  parseDocumentBody,
  putDocument,
  putDocumentAsJob,
  type ReleaseStaleLockOptions,
  releaseStaleLock,
  relockWorksheet,
  restore,
  type SetPlanRevisionOptions,
  type SetPlanRevisionResult,
  STALE_LOCK_AFTER_MS,
  setContinueWhenPlanned,
  setPlanRevisionAndLock,
  softDelete,
  type WorksheetForGeneration,
} from "./documents";
export { isUniqueViolation, PG_UNIQUE_VIOLATION } from "./errors";
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
export { type SeedDocument, type SeedResult, seedDocuments } from "./seed";
export {
  bindSourcesToLesson,
  createSource,
  getSource,
  listSourcesOfLesson,
  type NewSource,
  type SoftDeleteSourceResult,
  type SourceRow,
  softDeleteSource,
  toSourceRef,
  unbindSource,
  unbindSourcesFromLesson,
} from "./sources";
export {
  forWorkspace,
  type ScopableDb,
  type TenantInsert,
  type TenantTable,
  type TenantUpdate,
  type WorkspaceDb,
} from "./tenant";
