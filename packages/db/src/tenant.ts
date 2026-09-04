import type { WorkspaceId } from "@tj/domain";
import { and, eq, type SQL } from "drizzle-orm";
import type {
  PgColumn,
  PgDatabase,
  PgQueryResultHKT,
  PgTable,
  TableLikeHasEmptySelection,
} from "drizzle-orm/pg-core";

/**
 * Any Drizzle Postgres client we can scope: the pooled `Db` from `createDb()` or the `tx` inside
 * `db.transaction()`. Only the query-builder surface is used, so the schema generics stay open.
 */
// biome-ignore lint/suspicious/noExplicitAny: structural type that covers both Db and PgTransaction
export type ScopableDb = PgDatabase<PgQueryResultHKT, any, any>;

/** A table `forWorkspace()` accepts: any Postgres table with a `workspaceId` column. */
export type TenantTable = PgTable & { workspaceId: PgColumn };

/** Insert shape for a tenant table; `workspaceId` is supplied by the helper, not the caller. */
export type TenantInsert<T extends TenantTable> = Omit<T["$inferInsert"], "workspaceId">;

/** Update shape for a tenant table; `workspaceId` cannot be changed through the helper. */
export type TenantUpdate<T extends TenantTable> = Omit<Partial<T["$inferInsert"]>, "workspaceId">;

/**
 * `from()` guards against selecting from a data-modifying subquery with a conditional type that
 * TypeScript cannot resolve for a generic `T`. Our `T` is always a `PgTable`, for which the guard
 * is `false`, so we tell the compiler that explicitly.
 */
type FromArg<T extends PgTable> = TableLikeHasEmptySelection<T> extends true ? never : T;

function scope(table: TenantTable, workspaceId: WorkspaceId, extraWhere?: SQL): SQL {
  const tenant = eq(table.workspaceId, workspaceId);
  // `and()` only returns `undefined` for zero arguments; we always pass at least one.
  return (extraWhere ? and(tenant, extraWhere) : tenant) as SQL;
}

function scopedQueries(db: ScopableDb, workspaceId: WorkspaceId) {
  return {
    workspaceId,

    /** `SELECT * FROM table WHERE workspace_id = :ws [AND extraWhere]`. */
    select<T extends TenantTable>(table: T, extraWhere?: SQL) {
      return db
        .select()
        .from(table as FromArg<T>)
        .where(scope(table, workspaceId, extraWhere));
    },

    /** `INSERT INTO table …` with `workspaceId` set on every row. Chain `.returning()`. */
    insert<T extends TenantTable>(table: T) {
      return {
        values(rows: TenantInsert<T> | TenantInsert<T>[]) {
          const list = Array.isArray(rows) ? rows : [rows];
          const stamped = list.map((row) => ({ ...row, workspaceId }) as T["$inferInsert"]);
          return db.insert(table).values(stamped);
        },
      };
    },

    /** `UPDATE table SET … WHERE workspace_id = :ws [AND extraWhere]`. Chain `.returning()`. */
    update<T extends TenantTable>(table: T, extraWhere?: SQL) {
      return {
        set(values: TenantUpdate<T>) {
          return db
            .update(table)
            .set(values as T["$inferInsert"])
            .where(scope(table, workspaceId, extraWhere));
        },
      };
    },

    /** `DELETE FROM table WHERE workspace_id = :ws [AND extraWhere]`. Chain `.returning()`. */
    delete<T extends TenantTable>(table: T, extraWhere?: SQL) {
      return db.delete(table).where(scope(table, workspaceId, extraWhere));
    },
  };
}

/** The scoped query surface returned by `forWorkspace()`. */
export interface WorkspaceDb extends ReturnType<typeof scopedQueries> {
  /**
   * Run `fn` in a transaction with a helper scoped to the same Workspace. The raw transaction
   * is passed second, for `NON_TENANT_TABLES` only.
   */
  tx<R>(fn: (scoped: WorkspaceDb, tx: ScopableDb) => Promise<R>): Promise<R>;
}

/**
 * Scope `db` to one Workspace (ADR 0007). Every query built through the returned object carries
 * `workspace_id = :ws`; route handlers and workers use this — never the raw client — for tenant
 * tables. Cheap to call per request; it holds no connection of its own.
 *
 * ```ts
 * const db = forWorkspace(unsafeDb, workspaceId);
 * await db.select(jobEvents, gt(jobEvents.id, 42)).orderBy(asc(jobEvents.id)).limit(100);
 * await db.insert(jobEvents).values({ jobId, type, payload, at });   // workspaceId stamped
 * await db.update(jobEvents, eq(jobEvents.id, 7)).set({ type: "failed" });
 * await db.delete(jobEvents, eq(jobEvents.jobId, jobId));
 * await db.tx(async (scoped) => { ... });
 * ```
 *
 * Rules:
 * - `select`/`update`/`delete` take an optional `extraWhere` that is `AND`ed with the tenant
 *   predicate — it never replaces it. Do **not** call `.where()` again on the returned builder:
 *   Drizzle would overwrite the predicate. Chain `orderBy`/`limit`/`returning` instead.
 * - `insert(table).values()` stamps `workspaceId` on every row (object or array); passing your
 *   own `workspaceId` is a type error.
 * - Joins are not offered. Write them in a repository module inside this package and apply the
 *   predicate to **every** joined tenant table.
 * - A table without `workspaceId` (e.g. `workspaces`) is rejected at compile time; use
 *   `unsafeDb` for `NON_TENANT_TABLES`.
 */
export function forWorkspace(db: ScopableDb, workspaceId: WorkspaceId): WorkspaceDb {
  return {
    ...scopedQueries(db, workspaceId),
    tx(fn) {
      return db.transaction((tx) => fn(forWorkspace(tx, workspaceId), tx));
    },
  };
}
