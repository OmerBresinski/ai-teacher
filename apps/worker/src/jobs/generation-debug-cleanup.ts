/**
 * `generation.debug-cleanup` (Greg, 20 Oct 2026): once a day, delete `generation_debug` rows older
 * than `GENERATION_DEBUG_TTL_DAYS` (default 30). A system job like `auth.anonymous-cleanup`: no
 * Workspace, no job events, nothing enqueues it but the worker's own pg-boss cron.
 */
import { deleteExpiredGenerationDebug, type Sql } from "@tj/db";
import type { Logger } from "pino";

export const GENERATION_DEBUG_CLEANUP_QUEUE = "generation.debug-cleanup";
/** 03:47 UTC daily: off the hour, and half an hour after the anonymous cleanup. */
export const GENERATION_DEBUG_CLEANUP_CRON = "47 3 * * *";

export async function runGenerationDebugCleanup({
  sql,
  ttlDays,
  logger,
  signal,
}: {
  sql: Sql;
  ttlDays: number;
  logger: Pick<Logger, "info">;
  signal?: AbortSignal;
}): Promise<number> {
  const deleted = await deleteExpiredGenerationDebug(sql, ttlDays, signal ? { signal } : {});
  logger.info({ ttlDays, deleted }, "generation debug cleanup done");
  return deleted;
}
