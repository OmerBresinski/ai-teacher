/**
 * Postgres error classification for callers that treat a constraint violation as a normal
 * outcome rather than a bug (TEACH-82: a second terminal `job_events` row is "already settled").
 *
 * Drizzle 0.45 wraps driver errors in `DrizzleQueryError` and keeps the postgres.js
 * `PostgresError` (which carries the SQLSTATE in `code`) on `cause`, so the check walks the
 * `cause` chain rather than trusting the outermost error.
 */

/** SQLSTATE for `unique_violation`. */
export const PG_UNIQUE_VIOLATION = "23505";

/**
 * `true` when `err` (or anything on its `cause` chain) is a Postgres `unique_violation`.
 * Pass `constraint` to require the violated index/constraint name as well, so a different unique
 * violation in the same statement is not mistaken for the expected one.
 */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  for (let cur: unknown = err, depth = 0; cur !== null && cur !== undefined && depth < 8; depth++) {
    if (typeof cur !== "object") return false;
    const {
      code,
      constraint_name: name,
      cause,
    } = cur as {
      code?: unknown;
      constraint_name?: unknown;
      cause?: unknown;
    };
    if (code === PG_UNIQUE_VIOLATION) {
      return constraint === undefined || name === constraint;
    }
    cur = cause;
  }
  return false;
}
