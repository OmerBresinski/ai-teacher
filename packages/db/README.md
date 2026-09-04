# @tj/db

Drizzle ORM schema, committed SQL migrations and the `forWorkspace()` tenancy helper for Teaching
Journey. Postgres 16 + pgvector is the only database (ADR [0006](../../docs/adr/0006-postgres-drizzle-pgboss.md));
every tenant table carries `workspace_id` and is only reached through `forWorkspace()`
(ADR [0007](../../docs/adr/0007-workspace-tenancy.md)); `job_events` is the replay buffer for the
SSE progress stream (ADR [0012](../../docs/adr/0012-sse-progress.md)).

Consumed from source like every `@tj/*` package (no build step):

| Import            | What you get                                                                 |
| ----------------- | ---------------------------------------------------------------------------- |
| `@tj/db`          | `createDb`, `forWorkspace`, job-event helpers, `migrateDatabase`, the schema |
| `@tj/db/tenant`   | `forWorkspace`, `WorkspaceDb`, `TenantTable`, `TenantInsert`, `TenantUpdate` |
| `@tj/db/schema`   | tables, `tenantColumns()`, `TENANT_TABLES`, `NON_TENANT_TABLES`, `ALL_TABLES` |
| `@tj/db/testing`  | `withTestDb()` for `bun test` files                                          |

## Connecting

```ts
import { createDb, forWorkspace } from "@tj/db";

const { unsafeDb, sql, close } = createDb(process.env.DATABASE_URL, { max: 10 });
const db = forWorkspace(unsafeDb, workspaceId);
// ... on shutdown
await close();
```

- `unsafeDb` is the raw Drizzle client. **It is unsafe for tenant tables**: nothing stops a query
  from reading another Workspace's rows. Use it only for `NON_TENANT_TABLES` (`workspaces`),
  migrations, tests and admin tooling. Code review rejects raw tenant queries (ADR 0007).
- `sql` is the postgres.js client on the same pool, for `LISTEN`/`NOTIFY` and raw SQL.
- `createDb` never runs migrations. Migrations are an explicit deploy step (`bun run db:migrate`).

### Pool sizing

`max` defaults to 10 connections per process. Railway's shared Postgres allows roughly 100
connections in total; budget them across every process that holds a pool: each `apps/api`
replica, each `apps/worker` replica (pg-boss keeps its own pool on top), Drizzle Studio and ad-hoc
`psql`. Two api + two worker replicas at the default already reserve 40 (+ pg-boss). Lower `max`
before adding replicas. Prepared statements are on; turn them off if a transaction-mode pooler
(PgBouncer) is ever placed in front of the database.

## Tables

| Table        | Tenant? | Notes                                                                                                  |
| ------------ | ------- | ------------------------------------------------------------------------------------------------------ |
| `workspaces` | root    | `id uuid` PK **no default** (minted with `newId<WorkspaceId>()`), `owner_user_id text` FK → `users.id` `ON DELETE CASCADE`, **unique** (one personal Workspace per user, TEACH-20), `name text`, `created_at`/`updated_at timestamptz default now()`. `name` is a DB-side superset of the `@tj/domain` Workspace skeleton; F17 owns it. |
| `users`, `sessions`, `accounts`, `verifications` | no (identity) | better-auth 1.7.2 tables (`schema/auth.ts`, generated with `@better-auth/cli` then adjusted to `timestamptz`). `text` ids minted by better-auth. Identity sits above the Workspace (ADR 0008). |
| `job_events` | yes     | `id bigserial` PK (= SSE event id), `job_id uuid`, `workspace_id uuid` FK → `workspaces` `ON DELETE CASCADE`, `type text`, `payload jsonb` (the whole `JobEvent`), `at timestamptz`. Indexes `(workspace_id, at)`, `(job_id, at)`. Immutable rows. |

`schema/index.ts` classifies every table into `TENANT_TABLES = [jobEvents]` or
`NON_TENANT_TABLES = [workspaces, users, sessions, accounts, verifications]`. The classification is checked twice: at the type level (adding
a table to `ALL_TABLES` without listing it in exactly one list is a compile error) and by
`schema.test.ts` (every tenant table has `workspace_id NOT NULL`, a FK to `workspaces` and an
index led by `workspace_id`).

### Adding a tenant table

Use the building blocks in `schema/_columns.ts` so the tenancy columns and index exist by
construction:

```ts
import { index, pgTable, text } from "drizzle-orm/pg-core";
import { tenantColumns, tenantIndexes } from "./_columns";

export const journeys = pgTable(
  "journeys",
  { ...tenantColumns(), title: text("title").notNull() },
  (t) => [...tenantIndexes("journeys", t)],
);
```

`tenantColumns()` = `id uuid` PK (no default) + `workspace_id` (NOT NULL, FK, cascade) +
`created_at`/`updated_at`. Then add the table to `ALL_TABLES` and `TENANT_TABLES`, to
`truncateTenantTables()` in `src/testing.ts`, and generate a migration.

## `forWorkspace()`

```ts
const db = forWorkspace(unsafeDb, workspaceId);

await db.select(jobEvents, gt(jobEvents.id, 42)).orderBy(asc(jobEvents.id)).limit(100);
await db.insert(jobEvents).values({ jobId, type, payload, at }).returning(); // workspaceId stamped
await db.update(jobEvents, eq(jobEvents.id, 7)).set({ type: "failed" });
await db.delete(jobEvents, eq(jobEvents.jobId, jobId));
await db.tx(async (scoped, rawTx) => { /* scoped is bound to the same workspace */ });
```

Rules:

1. Every query carries `workspace_id = :ws`. The optional `extraWhere` is `AND`ed with it and
   never replaces it. **Do not call `.where()` on the returned builder** — Drizzle would overwrite
   the predicate; chain `orderBy`/`limit`/`returning` instead.
2. `insert(table).values()` stamps `workspaceId` on every row (object or array). Supplying your own
   `workspaceId` is a type error.
3. Only tables with a `workspaceId` column are accepted; `db.select(workspaces)` fails to compile.
   Use `unsafeDb` for `NON_TENANT_TABLES`.
4. No joins are offered. Write them in a repository module inside this package and apply the
   predicate to every joined tenant table.
5. Postgres Row-Level Security is **not** enabled yet. F15 adds it as defence in depth
   (`SET LOCAL app.workspace_id` per transaction); `forWorkspace().tx()` is where that hook will go.

## Job events and the NOTIFY contract (TEACH-17 worker, TEACH-19 API)

```ts
import { insertJobEvent, listJobEvents, notifyJobEvent, JOB_EVENTS_CHANNEL, JobEventNotificationSchema } from "@tj/db";

// worker: commit the row, then notify with ids only
const { id } = await insertJobEvent(unsafeDb, event);           // event: JobEvent (Zod-validated)
await notifyJobEvent(sql, { id, jobId: event.jobId, workspaceId: event.workspaceId });

// api: one listener per process, fan out per workspace / job
await sql.listen(JOB_EVENTS_CHANNEL, (raw) => {
  const n = JobEventNotificationSchema.parse(JSON.parse(raw));
  const rows = await listJobEvents(unsafeDb, { workspaceId: n.workspaceId, jobId: n.jobId, afterId: lastSentId, limit: 100 });
});
```

- Channel `job_events`; payload `{ id: number, jobId: JobId, workspaceId: WorkspaceId }` (JSON,
  `JobEventNotificationSchema`). Ids only — `NOTIFY` payloads are capped at 8000 bytes and the row
  is the source of truth.
- `id` is the SSE `id:` field. On reconnect the client sends `Last-Event-ID`; the API replays with
  `listJobEvents({ afterId })`. Rows are ordered by `id` ascending; page with `limit`.
- `insertJobEvent` parses with `JobEventSchema` (strict: unknown `type`s and fields throw
  `ZodError`, `at` must be UTC `Z`), stores the whole event as `payload` and denormalises `type`,
  `jobId`, `at`.

## Migrations

```sh
bun run db:generate     # drizzle-kit generate: diff src/schema against drizzle/meta -> new SQL file
bun run db:migrate      # apply drizzle/ to DATABASE_URL, then TEST_DATABASE_URL when set
bun run db:studio       # drizzle-kit studio against DATABASE_URL
```

- Edit `src/schema/*.ts`, run `db:generate`, **review the SQL**, commit `drizzle/` (SQL + `meta/`).
  Migration `0000_init` was generated this way and hand-prefixed with
  `CREATE EXTENSION IF NOT EXISTS vector;` — the compose init script also runs it, both are
  idempotent.
- `db:migrate` (`src/migrate.ts`) uses `drizzle-orm/postgres-js/migrator`; applied migrations are
  recorded in `drizzle.__drizzle_migrations`, so re-running is a no-op. It exits 1 with a plain
  sentence when `DATABASE_URL` is unset or a migration fails. The root `bun run setup`, `db:reset`
  and `test:db` call it with both URLs; deploy runs it before the api/worker start. **Never on
  boot.**
- From this directory the commands read `packages/db/.env` (copy of `.env.example`); from the
  repository root the scripts pass the URLs explicitly.

## Testing

`bun test` in this package. Tests connect to `TEST_DATABASE_URL` only and **skip visibly** (with
the reason) when it is unset or unreachable. `bun run test:db` at the root ensures Postgres is up,
migrates, and runs them with the URL set.

```ts
import { afterAll, beforeEach, describe } from "bun:test";
import { withTestDb } from "@tj/db/testing";

const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping db tests: ${t.reason}`);

describeDb("my feature", () => {
  if (!t.ok) return;
  const { unsafeDb, sql, truncateTenantTables, close } = t.db;
  beforeEach(() => truncateTenantTables()); // TRUNCATE job_events, workspaces RESTART IDENTITY CASCADE
  afterAll(() => close());
  // ...
});
```

`withTestDb()` migrates the test database once per process, then hands out a pooled `DbHandle`
(`max` 4). Files sharing a database must not run their tests in parallel processes against the same
rows; `bun test` runs files sequentially by default.
