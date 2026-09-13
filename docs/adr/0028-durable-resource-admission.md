# 0028 — Durable resource admission: storage, queue and spend ceilings

- Status: Accepted (design only — nothing below is implemented yet)
- Date: 2026-09-13
- Related PRD decisions: F15-R02 (per-tenant enumeration), F13-R03 (job retry), F18-R12 (error copy)
- Supersedes nothing. Amends nothing: ADR 0006 (pg-boss), 0007 (tenancy), 0015 (env), 0024
  (documents), 0025 §15 (per-Lesson budget), 0026 (bucket) and 0027 (Sources) all stand.

## Context

TEACH-279. At `48172245` the only aggregate control in the product is
`apps/api/src/rate-limit.ts`: an in-memory fixed-window count of *requests* per Workspace, per api
replica (`infra/README.md` "Known gaps" already records that it does not survive horizontal
scaling). Nothing bounds **total** work or bytes:

- `POST /documents` and `PUT /documents/:id` accept 10 MiB bodies (`documentBodyLimit`) with no
  count or byte ceiling per Workspace; `POST /sources` stores `original.*`, up to 40 extracted
  images and `extracted.json` per upload (`writeObjects`, `apps/api/src/routes/sources.ts:217`);
  `POST /images/pick` copies up to 8 MiB per pick (`packages/images/src/store-photo.ts`).
- `enqueue()` (`packages/jobs/src/enqueue.ts:47`) sends to pg-boss with no per-Workspace ceiling on
  queued or running work. `apps/worker/src/index.ts:33` registers one worker per queue with
  `localConcurrency: env.WORKER_CONCURRENCY` (default 4) and no group key.
- TEACH-280 (deployed, `d7e3bf2f`) reserves model spend *inside one job's in-process Budget* seeded
  from the Lesson checkpoint. That is not authoritative: the state lives in mutable Lesson JSON, is
  per job, and a crashed process loses its holds.

The verified availability reproduction on the ticket is the shape this ADR must fix: user A's four
ordinary `POST /lessons` requests (all `202`, below the 10/minute request limit) occupied all four
`lesson.plan` slots, and user B's request sat queued with no `started` event for three seconds until
one of A's calls was released. Tenancy held throughout (A reading B's Document was `404`), so this
is availability interference, not a cross-Workspace escape.

Constraints: PostgreSQL only, no Redis (ADR 0006). Every tenant row goes through
`forWorkspace()` (ADR 0007). pg-boss is **12.30.0**, which has distributed
`groupConcurrency` (`WorkConcurrencyOptions`, database-tracked across nodes), `group: { id, tier }`
on `send`, and `fromDrizzle(tx, sql)` to enlist `send` in a caller's transaction — all three are
load-bearing below and were read in `packages/jobs/node_modules/pg-boss/dist/types.d.ts`.

## Decision

### 1. Two independent layers, named separately

**Safety ceilings** (this ADR) exist to stop one tenant, or the whole install, exhausting
infrastructure. **Commercial soft limits** (TEACH-32) are a product decision about plans. A safety
ceiling is deliberately far above any plan's fair use: hitting one is an incident signal, not a
paywall, and its copy says so ("This Workspace has reached a safety limit. Nothing was lost.").
Neither layer may be implemented by reading the other's counters.

### 2. `resource_usage`: the durable ledger

New tenant table, `packages/db/src/schema/resource-usage.ts`, added to `TENANT_TABLES`:

```ts
export const resourceKind = pgEnum("resource_kind", [
  "storage_bytes", "document_count", "jobs_outstanding", "spend_usd_day",
]);

export const resourceUsage = pgTable("resource_usage", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  kind: resourceKind("kind").notNull(),
  /** `""` for lifetime counters; `YYYY-MM-DD` (UTC) for `spend_usd_day`. */
  window: text("window").notNull().default(""),
  /** Settled amount. Bytes, rows, jobs, or micro-USD — never floats. */
  committed: bigint("committed", { mode: "bigint" }).notNull().default(0n),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.workspaceId, t.kind, t.window] }),
  check("resource_usage_committed_nonnegative", sql`${t.committed} >= 0`),
]);

export const resourceReservations = pgTable("resource_reservations", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  kind: resourceKind("kind").notNull(),
  window: text("window").notNull().default(""),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  /** Set for job reservations so a dead job's hold is recoverable by id. */
  jobId: uuid("job_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("resource_reservations_ws_kind_idx").on(t.workspaceId, t.kind, t.window),
  index("resource_reservations_expires_idx").on(t.expiresAt),
  uniqueIndex("resource_reservations_job_kind_uidx").on(t.jobId, t.kind).where(sql`${t.jobId} is not null`),
  check("resource_reservations_amount_positive", sql`${t.amount} > 0`),
]);
```

Two tables, not one: a reservation is a row that can expire and be swept, while `committed` is the
single row a `SELECT … FOR UPDATE` serialises on. `bigint` micro-USD, never `numeric`/float, so
spend arithmetic is exact and `>=` comparisons cannot drift. `window` is `""` rather than nullable
so the primary key needs no partial index.

The global ceiling is the same table with the reserved all-zero Workspace id
(`00000000-0000-0000-0000-000000000000`), inserted by the migration and owned by
`packages/db/src/resource-usage.ts` alone: no route may pass it, and `forWorkspace()` is not the
access path for it (a global read/write takes `unsafeDb`, like `workspaces`). That boundary is what
stops a tenant request touching global state.

### 3. `packages/db/src/resource-usage.ts`: the only writer

```ts
export interface Ceilings { perWorkspace: bigint; global: bigint }
export type AdmitResult =
  | { status: "ok"; reservationId: string }
  | { status: "denied"; scope: "workspace" | "global"; kind: ResourceKind; retryAfterSeconds: number };

export async function admit(
  tx: ScopableDb, workspaceId: WorkspaceId, kind: ResourceKind,
  amount: bigint, ceilings: Ceilings, opts?: { jobId?: JobId; ttlSeconds?: number; now?: Date },
): Promise<AdmitResult>;

export async function commitReservation(tx: ScopableDb, reservationId: string, actual: bigint): Promise<void>;
export async function releaseReservation(tx: ScopableDb, reservationId: string): Promise<void>;
export async function commitDelta(tx: ScopableDb, workspaceId: WorkspaceId, kind: ResourceKind, delta: bigint): Promise<void>;
export async function reclaimExpired(db: ScopableDb, opts?: { now?: Date; limit?: number }): Promise<number>;
export async function usageFor(ws: WorkspaceDb, kinds?: ResourceKind[]): Promise<ResourceUsageRow[]>;
```

`admit` is one statement per scope inside the **caller's** transaction, in a fixed lock order
(workspace row, then global row) so two replicas cannot deadlock:

```sql
with ws as (
  insert into resource_usage (workspace_id, kind, window) values ($1, $2, $3)
  on conflict (workspace_id, kind, window) do update set workspace_id = excluded.workspace_id
  returning committed
), held as (
  select coalesce(sum(amount), 0) as amount from resource_reservations
  where workspace_id = $1 and kind = $2 and window = $3 and expires_at > $4
)
insert into resource_reservations (id, workspace_id, kind, window, amount, job_id, expires_at)
select $5, $1, $2, $3, $6, $7, $8
where (select committed from ws) + (select amount from held) + $6 <= $9
returning id;
```

The `on conflict … do update` is deliberate: it takes a row lock even when the row already exists,
so concurrent admissions for the same `(workspace, kind, window)` serialise on it. Zero rows
returned is a denial, and the caller has not yet performed any side effect. `commitReservation`
deletes the reservation and adds `actual` to `committed` in the same statement, so a settled amount
can be **smaller** than the reservation (a 10 MiB body that stored 2 MiB) but never silently larger:
`actual > amount` is permitted and recorded — the ceiling is a gate on admission, not a lie about
what was stored.

Reservation TTLs: 60 s for a request-scoped reservation (an HTTP handler holds it for one request),
`JOB_EXPIRE_IN_SECONDS + 60` for a job's `jobs_outstanding` and spend holds, so a hold always
outlives the attempt pg-boss will expire. `reclaimExpired` deletes expired rows and is called from
the worker's existing maintenance path; it never touches `committed`, because an expired
reservation whose side effect *did* land is reconciled by §6, not by guesswork.

### 4. Where each ceiling is enforced

`apps/api/src/admission.ts` exports one middleware factory and one helper, injected through
`CreateAppOptions.admission` (the api) and `WorkerDeps.admission` (the worker) — never a module
singleton, so tests inject a fake exactly as they do for `RateLimiter` today.

| Path | Kind(s) | Amount | Where |
| --- | --- | --- | --- |
| `POST /documents`, `POST /lessons` | `document_count`, `storage_bytes` | 1 row; `Content-Length` of the validated body | Inside the existing `ws.tx()` that already writes the row (`createLessonAndEnqueue`) |
| `PUT /documents/:id` | `storage_bytes` | `max(0, newBytes − oldBytes)`; a shrink is a `commitDelta` of the negative difference after the write | Same transaction as `putDocument` |
| `POST /sources` | `storage_bytes` | Upload byte length, reserved **before** extraction; committed to the true sum of `writeObjects` keys | Wraps `createSource` + `writeObjects` |
| `POST /images/pick` | `storage_bytes` | `MAX_PHOTO_BYTES`; committed to `bytes` actually stored | Around `storePhoto` |
| `enqueue()` | `jobs_outstanding` | 1, `jobId` recorded | Same transaction as `boss.send` (§5) |
| `callStructured` reservation | `spend_usd_day` | The TEACH-280 estimate, micro-USD | Worker, before the in-process Budget reserve |
| `DELETE`/soft-delete/`restore`, Source delete, orphan sweep | `storage_bytes`, `document_count` | Negative `commitDelta` of the bytes/rows actually removed | The same transaction as the deletion |

Reads (`GET`), `DELETE`, cancel and sign-out are **never** admitted: a Workspace at its ceiling can
still read, export and delete its way back under it. When the admission store itself is unavailable
the API fails **closed** for every expensive write above (503, `service_unavailable`,
`retryable: true`) and open for reads/cancels — a Postgres outage already fails those writes.

Denial shape, reusing `apps/api/src/errors.ts` unchanged: `429` with `code: "rate_limited"`,
`Retry-After`, and copy that names no threshold ("This Workspace has reached a safety limit for
uploads. Nothing was lost. Try again later, or delete something first."). `429` and not `507`
because the client behaviour we want is the existing retry/backoff, and `rate_limited` is already in
`RETRYABLE_STATUSES`.

### 5. Queue admission and fairness (the availability fix)

Two changes, both required; neither alone satisfies the ticket's regression:

1. **Bounded outstanding work per Workspace.** `enqueue()` gains a required
   `admission` collaborator on `JobsContext`. It reserves `jobs_outstanding` and calls
   `boss.send(..., { db: fromDrizzle(tx, sql), group: { id: workspaceId } })` **inside one
   transaction**, so the reservation and the queued row commit together. The existing compensation
   path (`enqueue`'s `catch` → `boss.cancel`) is replaced by the transaction: nothing to compensate,
   because nothing commits unless both do. `run-job.ts` releases the reservation in the same
   transaction that writes the terminal `job_events` row — the one place that already knows a job is
   over, and already idempotent under
   `job_events_one_terminal_per_job_uidx`. A `retry` keeps the hold (the job is still outstanding);
   only a terminal event or `reclaimExpired` frees it.
2. **Fair selection across Workspaces.** `apps/worker/src/index.ts` passes
   `groupConcurrency: { default: WORKER_GROUP_CONCURRENCY }` to `boss.work` for every queue.
   pg-boss 12.30 tracks group concurrency in the database across nodes, so with
   `group.id = workspaceId` from §5.1, one Workspace can hold at most
   `WORKER_GROUP_CONCURRENCY` of the `WORKER_CONCURRENCY` slots and a fetch skips its remaining
   jobs, leaving capacity for another Workspace. This is what makes B run while A still has three
   jobs submitted; raising `WORKER_CONCURRENCY` would not.

`groupConcurrency` is pg-boss's own mechanism and needs no new SQL, but it is *not* a substitute for
§5.1: without a bounded queue a single tenant can still fill the table and its own group forever.

### 6. Recovery, reconciliation and the honest gaps

- **Crash between side effect and commit.** The side effect and the commit share one transaction
  everywhere except object storage, which is not transactional. `POST /sources` and
  `POST /images/pick` therefore commit the *actual* bytes after `put`, and the existing failure
  path (`deleteSourceObjects` + `softDeleteSource`) already removes what it wrote. A crash between
  `put` and commit leaks bytes that the ledger does not know about; the reconciler below is the
  only cure, and this ADR says so rather than claiming exactness.
- **Reconciler.** A new scheduled job `usage.reconcile` (pg-boss cron, one Workspace per run,
  round-robin) recomputes `storage_bytes` from `storage.list("<ws>/")` and `document_count` from
  `documents`, then writes the difference with `commitDelta`, logging
  `{ workspaceId, kind, drift }`. It is the authority when it disagrees with the incremental
  counter. Daily; a Workspace whose drift exceeds 5% is logged at `warn`.
- **Unknown provider billing.** `spend_usd_day` commits the same conservative figure TEACH-280
  holds: an uncertain call stays charged. The daily window closes at UTC midnight and is never
  back-dated, so a long job that spans midnight charges the day it *started* — recorded here
  because it is a real asymmetry, not an oversight.
- **Deleted Workspace.** `on delete cascade` drops its rows; the global counter is corrected by the
  reconciler's next pass, not by the delete (a cascade cannot run application code).
- **What this does not do.** No cross-install fairness beyond the group ceiling; no priority
  inversion protection (a Workspace at its group ceiling waits behind its own jobs); no per-user
  ceiling inside a Workspace; no protection against a single 26 MiB upload that is under every
  ceiling. Those are separate tickets if they matter.

### 7. Thresholds: defaults, and what only the founder can decide

New env, declared in `infra/env.contract.ts` (so `docs/env.md`, `.env.example` and the per-app
contract tests follow automatically), all `worker`/`api` config, all with defaults:

| Variable | Default | Rationale |
| --- | --- | --- |
| `LIMIT_WORKSPACE_STORAGE_BYTES` | `2147483648` (2 GiB) | ~80 Sources at the 26 MiB cap, or thousands of documents; far above any teacher's real use, small enough that one tenant cannot fill a Railway volume |
| `LIMIT_GLOBAL_STORAGE_BYTES` | `53687091200` (50 GiB) | Bucket headroom; must be raised before the 26th active Workspace at full ceiling |
| `LIMIT_WORKSPACE_DOCUMENTS` | `5000` | Row-count guard for the `documents` table |
| `LIMIT_WORKSPACE_JOBS_OUTSTANDING` | `20` | Queued + running per Workspace; a teacher plans a handful of Lessons at once |
| `LIMIT_GLOBAL_JOBS_OUTSTANDING` | `2000` | Table guard, well above one worker's throughput |
| `WORKER_GROUP_CONCURRENCY` | `2` | Half of the default `WORKER_CONCURRENCY: 4`, so one Workspace can never take every slot |
| `LIMIT_WORKSPACE_SPEND_USD_DAY` | `10.00` | 20 Lessons/day at the `AI_LESSON_COST_CAP_USD` 0.50 ceiling |
| `LIMIT_GLOBAL_SPEND_USD_DAY` | `50.00` | Deliberately conservative: this is the number that caps a bad day's invoice |

**Founder decisions, unresolved and not guessed here.** These are the values a wrong guess makes
either useless or harmful, so they are listed for sign-off rather than silently chosen:

1. The two spend ceilings above are the *shape* the founder must confirm; nobody but the founder can
   say what a day's Bedrock spend may be.
2. Whether hitting `LIMIT_GLOBAL_*` should alert (and where), or only log.
3. Whether a Workspace at its storage ceiling may still *generate* (this ADR says yes: generation
   writes documents, not Sources, and is bounded by spend instead).
4. Retention for `resource_reservations` rows after commit (this ADR deletes them; an audit trail
   is a product/compliance decision).

### 8. Rollout

1. Migration adds both tables plus the global row; nothing reads them.
2. Backfill `storage_bytes`/`document_count` per Workspace with the reconciler run once
   (`bun run --cwd packages/db db:backfill-usage`, modelled on `db:backfill-summaries`).
3. Ship enforcement **in shadow first**: `ADMISSION_ENFORCE=0` logs the decision (`admission
   denied` with kind/scope/amount) and admits anyway. Read the logs for a week.
4. Flip `ADMISSION_ENFORCE=1` per ceiling kind, spend last.
5. Only then update `infra/README.md` "Known gaps" to retire the in-memory rate-limit row.

## Testing the follow-on work must include

Named, because "add tests" is not a contract:

- `packages/db/src/resource-usage.test.ts` — two real concurrent transactions against
  `TEST_DATABASE_URL` racing the last unit of capacity: exactly one `ok`, one `denied`; commit
  smaller than reservation; `actual > amount` recorded; expired reclaim; negative `commitDelta`
  never below zero (the check constraint); the global row unreachable through `forWorkspace()`.
- `packages/jobs/src/enqueue.test.ts` — a failed `boss.send` leaves no reservation; a deduplicated
  send (`singletonKey`) leaves no reservation; the terminal event releases exactly one hold;
  a `retry` does not.
- `apps/api` route tests — the `429` envelope per path, `Retry-After` present, reads/deletes still
  `200`/`204` at the ceiling, admission-store outage is `503` for writes and `200` for reads.
- `apps/worker` — `spend_usd_day` denial produces the existing partial-Lesson budget finding, with
  a fake AI and no real key.
- **The availability regression, end to end** (`apps/web/e2e/fairness.spec.ts` or an api
  integration test): two real signed users in separate Workspaces, real Postgres, real pg-boss,
  held fake model calls. A submits more than `WORKER_GROUP_CONCURRENCY` Lessons; B's Lesson must
  reach `started` while A still has work outstanding. Assert both the tenant and global counters
  atomically under concurrent admission. Raising concurrency or lowering the request limit does not
  satisfy this test.

## Consequences

Easier: one place (`resource_usage`) answers "what is this Workspace using", which is also what
TEACH-32's plans and any future usage screen need; the api can scale horizontally without the
in-memory limiter being the weak point.

Harder: every expensive write grows a transaction and two statements; the ledger can drift from
object storage and needs the reconciler to stay honest; `groupConcurrency` adds database work to
each fetch.

Revisit when the api runs more than one replica, when a second worker service exists, or when
TEACH-32 sets commercial limits — whichever comes first.

**This ADR is a design. The availability interference on TEACH-279 remains live in production until
the implementation tickets below are deployed.**
