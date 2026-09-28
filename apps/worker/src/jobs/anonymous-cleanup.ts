/**
 * `auth.anonymous-cleanup` (TEACH-222): once a day, delete anonymous users older than
 * `ANONYMOUS_USER_TTL_DAYS` together with whatever Workspace they still own. The FK cascade
 * (`workspaces.owner_user_id` → `documents`, `sources`, `job_events`) removes the rows; the stored
 * objects under `<workspaceId>/` are deleted here. A claimed Workspace (TEACH-224 hands it to the
 * signed-in user) is no longer owned by the anonymous user, so it is never touched.
 *
 * A system job, not a `JobName`: it has no Workspace, emits no job events and nothing enqueues it
 * but the worker's own pg-boss cron. It follows the `ping.ts` shape (one handler, logger, signal)
 * and is registered beside the typed registry in `jobs/index.ts`.
 *
 * Old rows of the per-IP sign-in counter (`anonymous_signins`) go too.
 */
import type { Sql } from "@tj/db";
import type { StorageAdapter } from "@tj/domain";
import type { Logger } from "pino";

export const ANONYMOUS_CLEANUP_QUEUE = "auth.anonymous-cleanup";
/** 03:17 UTC daily, off the hour so it does not meet other cron work. */
export const ANONYMOUS_CLEANUP_CRON = "17 3 * * *";
/** Users per run; a backlog drains over the following days rather than in one long transaction. */
export const ANONYMOUS_CLEANUP_BATCH = 500;
/** Per-IP counter rows are kept this many days (only today's is ever read). */
const SIGNIN_COUNTER_KEEP_DAYS = 2;

export interface AnonymousCleanupDeps {
  sql: Sql;
  storage: Pick<StorageAdapter, "list" | "delete">;
  ttlDays: number;
  logger: Pick<Logger, "info" | "warn">;
  signal?: AbortSignal;
}

export interface AnonymousCleanupResult {
  users: number;
  workspaces: number;
  objects: number;
  objectFailures: number;
}

export async function runAnonymousCleanup({
  sql,
  storage,
  ttlDays,
  logger,
  signal,
}: AnonymousCleanupDeps): Promise<AnonymousCleanupResult> {
  const expired = await sql<{ userId: string; workspaceId: string | null }[]>`
    select u.id as "userId", w.id as "workspaceId"
    from users u
    left join workspaces w on w.owner_user_id = u.id
    where u.is_anonymous
      and u.created_at < now() - make_interval(days => ${ttlDays})
    order by u.created_at
    limit ${ANONYMOUS_CLEANUP_BATCH}
  `;
  const result: AnonymousCleanupResult = { users: 0, workspaces: 0, objects: 0, objectFailures: 0 };
  for (const { userId, workspaceId } of expired) {
    if (signal?.aborted) break;
    // Rows first: once the Workspace is gone nothing can reference its objects any more. The
    // `is_anonymous` re-check makes a user linked since the select safe to skip.
    const deleted = await sql`
      delete from users where id = ${userId} and is_anonymous returning id
    `;
    if (deleted.length === 0) continue;
    result.users += 1;
    if (workspaceId === null) continue;
    result.workspaces += 1;
    // Collect first, then delete: deleting while paging a bucket listing can skip keys.
    const keys: string[] = [];
    try {
      for await (const object of storage.list(`${workspaceId}/`)) keys.push(object.key);
    } catch {
      result.objectFailures += 1;
      logger.warn({ workspaceId }, "anonymous cleanup: listing stored objects failed");
    }
    for (const key of keys) {
      try {
        await storage.delete(key);
        result.objects += 1;
      } catch {
        result.objectFailures += 1;
      }
    }
  }
  await sql`
    delete from anonymous_signins
    where day < (now() at time zone 'utc')::date - ${SIGNIN_COUNTER_KEEP_DAYS}::int
  `;
  logger.info({ ttlDays, ...result }, "anonymous cleanup done");
  return result;
}
