import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

/** The Drizzle client bound to our schema. Prefer `forWorkspace()` for tenant tables. */
export type Db = PostgresJsDatabase<typeof schema>;

/** The postgres.js tagged-template client (raw SQL, `LISTEN`/`NOTIFY`). */
export type Sql = postgres.Sql;

export interface CreateDbOptions {
  /**
   * Maximum connections in the postgres.js pool. Default 10.
   *
   * Sizing on Railway: the shared Postgres plan allows ~100 connections in total. Budget them
   * across every process that holds a pool — `apps/api` (each replica), `apps/worker` (each
   * replica; pg-boss keeps its own pool on top of this one), Drizzle Studio and ad-hoc `psql`.
   * Two api + two worker replicas at the default 10 already reserve 40 (+ pg-boss). Lower `max`
   * before adding replicas; do not raise it above what one process can actually keep busy.
   */
  max?: number;
}

export interface DbHandle {
  /**
   * The raw Drizzle client. **Unsafe for tenant tables**: nothing stops a query from reading
   * another Workspace's rows (ADR 0007). Use it only for `NON_TENANT_TABLES` (`workspaces`),
   * migrations, tests and admin tooling; everything else goes through `forWorkspace()`.
   */
  unsafeDb: Db;
  /** postgres.js client sharing the same pool; use for `LISTEN`/`NOTIFY` and raw SQL. */
  sql: Sql;
  /** Drain the pool. Call on shutdown (and at the end of every test file). */
  close: () => Promise<void>;
}

/**
 * Create a pooled connection to `url`. Never runs migrations: those are applied by
 * `bun run db:migrate` before deploy (ADR 0006), not at boot.
 *
 * ```ts
 * const { unsafeDb, sql, close } = createDb(process.env.DATABASE_URL);
 * const db = forWorkspace(unsafeDb, workspaceId);
 * ```
 */
export function createDb(url: string, opts: CreateDbOptions = {}): DbHandle {
  if (!url) throw new Error("createDb: a Postgres connection URL is required");
  const sql = postgres(url, {
    max: opts.max ?? 10,
    // Prepared statements are fine on a direct connection; disable if a transaction pooler
    // (PgBouncer in transaction mode) is ever put in front of the database.
    prepare: true,
    onnotice: () => undefined,
  });
  const unsafeDb = drizzle(sql, { schema });
  return {
    unsafeDb,
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}
