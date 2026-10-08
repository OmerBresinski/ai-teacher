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

/** One transaction, seen both as a Drizzle client and as a raw `executeSql` (see `withSqlTransaction`). */
export interface SqlTransaction {
  /**
   * Drizzle over the transaction's connection; `forWorkspace(tx.db, …)` scopes it as usual. It is
   * already a transaction: do not open another on it (`tx.db.transaction()`,
   * `forWorkspace(tx.db, …).tx()`), which postgres.js cannot nest here and throws.
   */
  db: Db;
  /**
   * Run parameterised SQL (`$1`, `$2`, …) on the same connection, in pg-boss's adapter shape
   * (`send(name, data, { db: tx })` inserts the job inside this transaction).
   */
  executeSql: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
}

/**
 * Run `fn` inside one postgres.js transaction on `sql`, so rows written through `tx.db` and
 * statements run through `tx.executeSql` commit (or roll back) together. A throw in `fn` rolls
 * everything back and rethrows. Nothing is visible to other sessions until it returns.
 */
export async function withSqlTransaction<R>(
  sql: Sql,
  fn: (tx: SqlTransaction) => Promise<R>,
): Promise<R> {
  const result = await sql.begin(async (connection) => {
    // A transaction handle has no `options`, which Drizzle reads for its type parsers; it runs
    // on the pool's connection with the pool's parsers, so it borrows them.
    const client = Object.assign(connection, { options: sql.options }) as unknown as Sql;
    return fn({
      db: drizzle(client, { schema }),
      executeSql: async (text, values = []) => ({
        rows: [...(await connection.unsafe(text, values as never[]))],
      }),
    });
  });
  return result as R;
}
