import type { JobId, LessonId, WorkspaceId } from "@tj/domain";
import { asc, eq } from "drizzle-orm";
import type { Sql } from "./client";
import { generationDebug } from "./schema/generation-debug";
import { forWorkspace, type ScopableDb } from "./tenant";

/** Rows the daily cleanup deletes per statement; a backlog drains in a few statements. */
export const GENERATION_DEBUG_DELETE_BATCH = 5000;

/** One row of `generation_debug` as the worker writes it (ids and order come from the caller). */
export interface GenerationDebugInsert {
  lessonId: LessonId;
  jobId: JobId;
  attempt: number;
  seq: number;
  kind: string;
  slideIndex?: number | null;
  payload: unknown;
  createdAt?: Date;
}

export type GenerationDebugRow = typeof generationDebug.$inferSelect;

/** Insert a batch of debug rows for one Workspace in one statement. */
export async function insertGenerationDebug(
  db: ScopableDb,
  workspaceId: WorkspaceId,
  rows: readonly GenerationDebugInsert[],
): Promise<number> {
  if (rows.length === 0) return 0;
  await forWorkspace(db, workspaceId)
    .insert(generationDebug)
    .values(
      rows.map((r) => ({
        lessonId: r.lessonId,
        jobId: r.jobId,
        attempt: r.attempt,
        seq: r.seq,
        kind: r.kind,
        slideIndex: r.slideIndex ?? null,
        payload: r.payload,
        ...(r.createdAt ? { createdAt: r.createdAt } : {}),
      })),
    );
  return rows.length;
}

/** A lesson's debug rows in the order they were recorded. */
export function listGenerationDebug(
  db: ScopableDb,
  workspaceId: WorkspaceId,
  lessonId: LessonId,
): Promise<GenerationDebugRow[]> {
  return forWorkspace(db, workspaceId)
    .select(generationDebug, eq(generationDebug.lessonId, lessonId))
    .orderBy(
      asc(generationDebug.createdAt),
      asc(generationDebug.jobId),
      asc(generationDebug.attempt),
      asc(generationDebug.seq),
    );
}

/**
 * Delete every debug row older than `ttlDays` (the daily `generation.debug-cleanup` cron), in
 * batches of `GENERATION_DEBUG_DELETE_BATCH`. Cross-tenant by design: age is the only predicate.
 */
export async function deleteExpiredGenerationDebug(
  sql: Sql,
  ttlDays: number,
  { batch = GENERATION_DEBUG_DELETE_BATCH, signal }: { batch?: number; signal?: AbortSignal } = {},
): Promise<number> {
  let total = 0;
  for (;;) {
    if (signal?.aborted) break;
    const deleted = await sql`
      delete from generation_debug
      where id in (
        select id from generation_debug
        where created_at < now() - make_interval(days => ${ttlDays})
        limit ${batch}
      )
    `;
    total += deleted.count;
    if (deleted.count < batch) break;
  }
  return total;
}
