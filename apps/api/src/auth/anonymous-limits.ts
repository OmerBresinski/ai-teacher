/**
 * Cost bounds on signed-out lessons (TEACH-222, rulings 109–111). All counts live in Postgres so
 * they hold across api replicas and restarts; nothing here is per-process except the
 * per-Workspace create queue.
 *
 * - `countAnonymousLessonsToday` — lessons created this UTC day in Workspaces whose owner is still
 *   anonymous (a claimed Workspace drops out). A non-tenant query, so it lives here, not in a
 *   tenant repository (ADR 0007).
 * - `bumpAnonymousSignins` — the per-IP, per-UTC-day counter behind the sign-in ceiling.
 * - `anonymousSignInLimits` — middleware on `POST /auth/sign-in/anonymous`, mounted in `app.ts`
 *   before `auth.handler`: global cap first (403 anonymous_capacity),
 *   then the per-IP ceiling (429 rate_limited).
 */
import type { DbHandle } from "@tj/db";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../context";
import type { Env } from "../env";
import { errorResponse } from "../errors";
import { clientIp } from "./client-ip";

type Sql = Pick<DbHandle, "sql">;

export const ANONYMOUS_LESSON_LIMIT = 2;
export const ANONYMOUS_REPLAN_LIMIT = 3;

export const SIGN_IN_REQUIRED_MESSAGE = "Sign in to edit, export and save.";
export const REPLAN_LIMIT_MESSAGE = "Sign in to keep changing the plan.";
export const ANONYMOUS_LIMIT_MESSAGE = "Sign in to make more lessons.";
export const ANONYMOUS_CAPACITY_MESSAGE =
  "Signed-out lessons are busy today. Sign in to make your lesson.";
export const ANONYMOUS_RATE_LIMITED_MESSAGE =
  "Too many signed-out lessons from this network today. Sign in to carry on.";

export type AnonymousLimitsEnv = Partial<
  Pick<Env, "ANONYMOUS_SIGNINS_PER_IP_DAILY" | "ANONYMOUS_LESSONS_DAILY_CAP" | "AUTH_IP_HEADER">
>;

export const DEFAULT_SIGNINS_PER_IP_DAILY = 20;
export const DEFAULT_LESSONS_DAILY_CAP = 200;

export function signinsPerIpDaily(env: AnonymousLimitsEnv): number {
  return env.ANONYMOUS_SIGNINS_PER_IP_DAILY ?? DEFAULT_SIGNINS_PER_IP_DAILY;
}

export function lessonsDailyCap(env: AnonymousLimitsEnv): number {
  return env.ANONYMOUS_LESSONS_DAILY_CAP ?? DEFAULT_LESSONS_DAILY_CAP;
}

/** Lessons created since UTC midnight in Workspaces owned by an anonymous user. */
export async function countAnonymousLessonsToday(db: Sql): Promise<number> {
  const rows = await db.sql<{ n: number }[]>`
    select count(*)::int as n
    from documents d
    join workspaces w on w.id = d.workspace_id
    join users u on u.id = w.owner_user_id
    where u.is_anonymous
      and d.kind = 'lesson'
      and d.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
  `;
  return rows[0]?.n ?? 0;
}

/** Count one anonymous sign-in for `ip` today (UTC) and answer the new total. */
export async function bumpAnonymousSignins(db: Sql, ip: string): Promise<number> {
  const rows = await db.sql<{ count: number }[]>`
    insert into anonymous_signins (ip, day, count)
    values (${ip}, (now() at time zone 'utc')::date, 1)
    on conflict (ip, day) do update set count = anonymous_signins.count + 1
    returning count
  `;
  return rows[0]?.count ?? 1;
}

/**
 * Global cap, then per-IP ceiling, on the anonymous sign-in endpoint. Only `POST` is counted; a
 * request with no resolvable IP skips the ceiling (and says so once) rather than sharing one
 * bucket with every other such request.
 */
export function anonymousSignInLimits(db: Sql, env: AnonymousLimitsEnv): MiddlewareHandler<AppEnv> {
  const perIp = signinsPerIpDaily(env);
  const cap = lessonsDailyCap(env);
  let warnedNoIp = false;
  let reportedSource = false;
  return async (c, next) => {
    if (c.req.method !== "POST") return next();
    if ((await countAnonymousLessonsToday(db)) >= cap) {
      c.get("logger")?.warn({ cap }, "anonymous sign-in refused: daily lesson cap reached");
      return errorResponse(c, 403, "anonymous_capacity", ANONYMOUS_CAPACITY_MESSAGE);
    }
    const ip = clientIp(c.req.raw.headers, env);
    if (!reportedSource) {
      reportedSource = true;
      const xff = c.req.header("x-forwarded-for");
      c.get("logger")?.info(
        {
          ipResolved: ip !== null,
          xffEntries: xff === undefined ? 0 : xff.split(",").length,
          cfConnectingIp: c.req.header("cf-connecting-ip") !== undefined,
          xRealIp: c.req.header("x-real-ip") !== undefined,
        },
        "anonymous sign-in: first request's IP headers (names and counts only)",
      );
    }
    if (ip === null) {
      if (!warnedNoIp) {
        warnedNoIp = true;
        c.get("logger")?.warn("anonymous sign-in: no client IP header; per-IP ceiling skipped");
      }
      return next();
    }
    const count = await bumpAnonymousSignins(db, ip);
    if (count > perIp) {
      c.get("logger")?.warn({ perIp }, "anonymous sign-in refused: per-IP daily ceiling");
      return errorResponse(c, 429, "rate_limited", ANONYMOUS_RATE_LIMITED_MESSAGE);
    }
    return next();
  };
}

/**
 * Runs `fn` for one key at a time in this process: two anonymous `POST /lessons` from the same
 * Workspace cannot both pass the two-lesson count before either inserts. (One api replica today;
 * a second replica would need a row lock instead.)
 */
export function createKeyedQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return async function run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(fn);
    const tail = result.catch(() => undefined);
    tails.set(key, tail);
    try {
      return await result;
    } finally {
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}
