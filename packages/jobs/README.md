# `@tj/jobs`

Typed pg-boss layer shared by the worker (runs jobs) and the API (enqueues and cancels them):
a `createBoss()` factory, `enqueue()` / `cancel()`, the `JobRegistry` type, and `runJob()`, which
turns handler activity into `job_events` rows + `pg_notify` for the SSE stream
(ADR [0006](../../docs/adr/0006-postgres-drizzle-pgboss.md),
[0012](../../docs/adr/0012-sse-progress.md)). Job **names, payload schemas and event schemas**
live in `@tj/domain`; the `job_events` table and the NOTIFY contract live in `@tj/db`. This
package glues them to pg-boss and owns nothing else.

Consumed from source (`import … from "@tj/jobs"`), no build step. pg-boss **12.30.0** (exact).

## Public API

```ts
import {
  createBoss, ensureQueues,                 // boot
  enqueue, cancel,                          // API side (TEACH-19)
  defineJob, runJob, emitJobEvent,          // worker side
  NonRetryableError,
  type JobsContext, type JobContext, type JobHandler, type JobRegistry, type BossJob,
} from "@tj/jobs";
```

| Function | Signature | Notes |
| -------- | --------- | ----- |
| `createBoss` | `(databaseUrl: string, opts?: { schema?: "pgboss" \| "pgboss_test"; max?: number; applicationName?: string; role?: "worker" \| "enqueue-only" }) => PgBoss` | **Not started.** Caller does `await boss.start()` then `await ensureQueues(boss)`. `role: "enqueue-only"` (the api, ADR 0006) sets `supervise: false, schedule: false` so only the worker runs maintenance and cron. `bossOptions()` returns the same config for tests. |
| `ensureQueues` | `(boss: PgBoss) => Promise<void>` | `createQueue` for every `JobName` with the shared policy (below). Idempotent; run on every boot. pg-boss ≥ 10 refuses `send` to a queue that was never created. |
| `enqueue` | `<N extends JobName>(ctx: JobsContext, name: N, payload: JobPayloadInputs[N], opts: { workspaceId: WorkspaceId; singletonKey?: string }) => Promise<JobId \| null>` | `JobPayloadSchemas[name].parse(payload)` **before** pg-boss is touched (throws `ZodError`); mints `jobId = newId<JobId>()`; `boss.send(name, { jobId, workspaceId, payload }, { id: jobId, singletonKey, retryLimit: 1 })`; writes the `queued` event. `null` only when `singletonKey` deduplicated (no event). |
| `cancel` | `(ctx: JobsContext, jobId: JobId, opts?: { name?: JobName }) => Promise<CancelResult>` | See "Cancel semantics". |
| `defineJob` | `<K extends JobName>(name: K, handler: JobHandler<K>) => JobHandler<K>` | Identity helper that types `ctx.payload`. |
| `runJob` | `<N extends JobName>(ctx: JobsContext, name: N, registry: JobRegistry, bossJob: JobWithMetadata, opts: { logger: pino.Logger; shutdown?: AbortSignal }) => Promise<RunJobOutcome>` | Runs one pg-boss job through the registry and emits events. Returns the pg-boss `perJobResults` disposition (`{ id, status: "completed" \| "failed" \| "deadletter", output? }`) plus `event`, the last event type written. |
| `emitJobEvent` | `(ctx: Pick<JobsContext, "db" \| "sql">, event: JobEvent) => Promise<{ id: number }>` | `insertJobEvent` then `notifyJobEvent` with the returned id — the order `@tj/db` requires. |

```ts
interface JobsContext { boss: PgBoss; db: Db /* unsafeDb from createDb */; sql: Sql }

interface JobContext<K extends JobName> {
  jobId: JobId; workspaceId: WorkspaceId; payload: JobPayloads[K];
  signal: AbortSignal;                                   // reason: "cancelled" | "shutdown"
  progress: (percent?: number, message?: string) => Promise<void>;
  logger: pino.Logger;                                   // jobId/workspaceId/job/attempt bound
}
type JobHandler<K> = (ctx: JobContext<K>) => Promise<void>;
type JobRegistry = { [K in JobName]: JobHandler<K> };   // missing handler = compile error
```

Booting either process:

```ts
const { unsafeDb, sql, close } = createDb(env.DATABASE_URL);
const boss = createBoss(env.DATABASE_URL);
await boss.start();
await ensureQueues(boss);
const ctx: JobsContext = { boss, db: unsafeDb, sql };
```

The API only needs `enqueue`/`cancel`; it must **never** call `boss.work()` (ADR 0006: the worker
is the sole consumer).

## Adding a job

1. In `@tj/domain` (`packages/domain/src/jobs.ts`): add the name to `JobName`, a strict payload
   schema, and register it in `JobPayloadSchemas`.
2. In `apps/worker/src/jobs/<name>.ts`: `export const fooJob = defineJob("foo", async (ctx) => …)`.
3. Add it to `apps/worker/src/jobs/index.ts`. Until you do, `typecheck` fails: `JobRegistry` is a
   mapped type over `JobName`.
4. `ensureQueues()` creates the queue on the next boot; `enqueue(ctx, "foo", …)` is typed.

Handler rules: check `ctx.signal.aborted` between steps (and pass the signal to fetch / AI calls);
call `ctx.progress()` freely — it is rate-limited; throw `NonRetryableError` when a retry cannot
help; never log payload or content bodies (ADR 0015).

## Event contract

Every event is a `JobEvent` (`@tj/domain`), stored whole in `job_events.payload` and announced on
the `job_events` channel with ids only (`@tj/db`). For one `jobId`, ordered by `job_events.id`:

```
queued                       enqueue()
started                      runJob(), after re-validating the stored payload
progress*                    ctx.progress(); ≥ 250 ms apart
completed | failed | cancelled   exactly one, last
```

- **`progress` rate limit:** leading + trailing throttle per job. The first call emits at once;
  calls inside the 250 ms window replace each other and the latest one is written when the window
  closes (or right before the terminal event). The last progress a handler reports is never lost.
- **Terminal events are terminal** (`JOB_TERMINAL_EVENT_TYPES`): once `completed`, `failed` or
  `cancelled` is written for a `jobId`, nothing else follows. This is why a retryable failure
  with an attempt left is *not* a `failed` event (see "Retry policy").
- `at` is the worker's clock (`Date#toISOString()`); consumers should order by `id`, not `at`.
- `failed.error.retryable` tells the API whether to offer a manual retry (F13-R03).

## Retry policy

Configured once, in `ensureQueues()` (queue) and `enqueue()` (per job): `retryLimit: 1`,
`retryDelay: 1` s, `expireInSeconds: 900`, `deleteAfterSeconds: 7 days` (completed / failed /
cancelled rows), `retentionSeconds: 14 days` (rows nobody ever picked up).

`runJob` maps the handler outcome onto pg-boss's `perJobResults` dispositions (the worker
registers with `perJobResults: true`, `batchSize: 1`, `includeMetadata: true`):

| Handler outcome | Event written | pg-boss disposition | pg-boss state after |
| --------------- | ------------- | ------------------- | ------------------- |
| returns | `completed` | `completed` | `completed` |
| throws `NonRetryableError` | `failed { retryable: false }` | `deadletter` (terminal, bypasses `retryLimit`; no DLQ configured so it just fails) | `failed`, `retry_count` unchanged |
| stored payload fails `JobPayloadSchemas[name]` | `failed { retryable: false }` (no `started`) | `deadletter` | `failed` |
| throws anything else, or shutdown abort, and `retryCount < retryLimit` | `progress { message: "attempt N failed (…); retrying" }` | `failed` | `retry` → a fresh `started` follows ~1 s later |
| same, no attempts left | `failed { retryable: true }` | `failed` | `failed` |
| `signal.reason === "cancelled"` | `cancelled` | `completed` (no-op: the row is already `cancelled`) | `cancelled` |

Deviation from the ticket text ("on throw → `failed`; shutdown → `failed retryable:true`"): a
`failed` event while pg-boss is about to retry would break the terminal-event guarantee that
`@tj/domain` exports, so the intermediate attempt is reported as `progress` and `failed
{ retryable: true }` is reserved for the exhausted case. Each retry attempt emits its own `started`.

## Cancel semantics and latency

`cancel(ctx, jobId)` finds the job (scanning every `JobName` queue unless `opts.name` is given),
calls `boss.cancel(name, jobId)` — pg-boss flips the row to `cancelled` whenever `state <
completed`, i.e. queued **or active** — then decides who writes the terminal event:

| Job state before | Result | Who writes `cancelled` |
| ---------------- | ------ | ---------------------- |
| `created` / `retry` (no worker has it) | `{ status: "cancelled" }` | `cancel()` itself, immediately |
| `active` | `{ status: "cancelling" }` | the worker: `runJob` polls `findJobs` every **250 ms**, aborts `ctx.signal` with reason `"cancelled"`, and writes `cancelled` once the handler returns or throws |
| `completed` / `failed` / `cancelled` | `{ status: "already_finished", state }` | nobody; nothing changes |
| unknown id | `{ status: "not_found" }` | — |

Latency for an active job ≈ 250 ms poll + whatever the handler is awaiting before it checks
`signal.aborted` (the `ping` job checks every 300 ms; the integration test asserts < 600 ms). A
job that was fetched between `cancel()`'s two reads (`startedOn` moved) is treated as active so
the event is written exactly once. If the handler finishes in the same instant the cancel lands,
`completed` may win; pg-boss's `complete` is then a no-op on the cancelled row — best effort, and
the events stay consistent with the terminal rule.

## pg-boss schema note

`boss.start()` installs and migrates pg-boss's own tables into the schema passed to
`createBoss()` — **`pgboss`** in development/production, **`pgboss_test`** in the integration
tests (so a test run never truncates or races real queues). This is the one exception to
"migrations never run on boot" (ADR 0006): that rule governs the **application** schema managed by
`@tj/db`/drizzle-kit; pg-boss's internal tables are versioned and migrated by pg-boss itself and
are never referenced by application code. `pgboss.job.id` **is** the `JobId` (`enqueue` passes
`options.id`), so `job_events.job_id = pgboss.job.id` joins directly for debugging.

## Testing

```sh
bun test                      # from packages/jobs; reads packages/jobs/.env for TEST_DATABASE_URL
bun run test                  # from the root: turbo runs this package's tests too (same .env)
```

Unit tests (no DB): payload validation happens before `boss.send`; the progress throttle; the
`JobRegistry` type (`// @ts-expect-error`, enforced by `typecheck`). Integration tests
(`jobs.integration.test.ts`) use `withTestDb()` from `@tj/db/testing` plus a real pg-boss on
`pgboss_test` and a worker loop identical to `apps/worker`; they **skip visibly** when
`TEST_DATABASE_URL` is unset or unreachable.
