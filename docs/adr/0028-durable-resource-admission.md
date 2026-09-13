# 0028 — Durable resource admission: storage, queue and spend ceilings

- Status: Accepted (design only — nothing below is implemented yet)
- Date: 2026-09-13
- Related PRD decisions: F15-R02 (per-tenant enumeration), F13-R03 (job retry), F18-R12 (error copy)
- Supersedes nothing. ADR 0006 (pg-boss), 0007 (tenancy), 0015 (env), 0024 (documents),
  0025 §15 (per-Lesson budget), 0026 (bucket) and 0027 (Sources) all stand; §5 below **requires a
  restructure** of `createLessonAndEnqueue` and `enqueue`, described there.

## Context

TEACH-279. At `48172245` the only aggregate control is `apps/api/src/rate-limit.ts`: an in-memory
fixed-window count of *requests* per Workspace, per api replica (`infra/README.md` "Known gaps"
already records that it does not survive horizontal scaling). Nothing bounds **total** work or
bytes:

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

Constraints: PostgreSQL only, no Redis (ADR 0006). Every tenant row goes through `forWorkspace()`
(ADR 0007). pg-boss is **12.30.0**; the three mechanisms §5 relies on were read in
`packages/jobs/node_modules/pg-boss/dist/types.d.ts`, `dist/adapters/drizzle.d.ts` and
`dist/plans.js`, and their **exact** guarantees are quoted there rather than assumed.

## Decision

### 1. Two independent layers, named separately

**Safety ceilings** (this ADR) stop one tenant, or the whole install, exhausting infrastructure.
**Commercial soft limits** (TEACH-32) are a product decision about plans. A safety ceiling sits far
above any plan's fair use: hitting one is an incident signal, not a paywall, and its copy says so.
Neither layer may be implemented by reading the other's counters.

### 2. Two tables, and the tenant/global split is structural

Because a global counter has no Workspace, it cannot live in a tenant table: a
`workspace_id NOT NULL REFERENCES workspaces(id)` column has no legal value for it, and a reserved
all-zero UUID would both violate the foreign key and remain reachable through `forWorkspace()`. The
split is therefore two tables, and the privilege boundary is enforced by the schema rather than by
convention.

`packages/db/src/schema/resource-usage.ts`:

```ts
export const resourceKind = pgEnum("resource_kind", [
  "storage_bytes", "document_count", "jobs_outstanding", "spend_usd_day",
]);

/** Tenant counters. Added to TENANT_TABLES: workspace_id NOT NULL + FK + index. */
export const resourceUsage = pgTable("resource_usage", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  kind: resourceKind("kind").notNull(),
  /** `""` for lifetime counters; `YYYY-MM-DD` (UTC) for `spend_usd_day`. */
  window: text("window").notNull().default(""),
  /** Settled amount: bytes, rows, jobs, or micro-USD. Never a float. */
  committed: bigint("committed", { mode: "bigint" }).notNull().default(0n),
  /** Outstanding reservations, maintained in the same locked statement as `committed` (§3). */
  held: bigint("held", { mode: "bigint" }).notNull().default(0n),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.workspaceId, t.kind, t.window] }),
  check("resource_usage_committed_nonnegative", sql`${t.committed} >= 0`),
  check("resource_usage_held_nonnegative", sql`${t.held} >= 0`),
]);

/** Install-wide counters. NON_TENANT_TABLES: no workspace_id, so forWorkspace() cannot reach it. */
export const resourceUsageGlobal = pgTable("resource_usage_global", {
  kind: resourceKind("kind").notNull(),
  window: text("window").notNull().default(""),
  committed: bigint("committed", { mode: "bigint" }).notNull().default(0n),
  held: bigint("held", { mode: "bigint" }).notNull().default(0n),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.kind, t.window] }),
  check("resource_usage_global_committed_nonnegative", sql`${t.committed} >= 0`),
  check("resource_usage_global_held_nonnegative", sql`${t.held} >= 0`),
]);

export const resourceReservations = pgTable("resource_reservations", {
  id: uuid("id").primaryKey(),
  /** NULL only for a global-scope row; a tenant row always names its Workspace. */
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  scope: text("scope", { enum: ["workspace", "global"] }).notNull(),
  kind: resourceKind("kind").notNull(),
  window: text("window").notNull().default(""),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  /** Set for job reservations so a dead job's hold is recoverable by id. */
  jobId: uuid("job_id"),
  /** NULL for a hold with no wall-clock deadline (a queued job, §4). */
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("resource_reservations_ws_kind_idx").on(t.workspaceId, t.kind, t.window),
  index("resource_reservations_expires_idx").on(t.expiresAt),
  /** One row per job per kind **per scope**: a job holds both a tenant and a global slot. */
  uniqueIndex("resource_reservations_job_kind_scope_uidx")
    .on(t.jobId, t.kind, t.scope).where(sql`${t.jobId} is not null`),
  check("resource_reservations_amount_positive", sql`${t.amount} > 0`),
  check("resource_reservations_scope_workspace",
    sql`(${t.scope} = 'global' and ${t.workspaceId} is null)
     or (${t.scope} = 'workspace' and ${t.workspaceId} is not null)`),
]);
```

`held` is a **column on the counter row**, not a `sum()` over reservation rows. That is what makes
§3 correct: a CTE that aggregates reservations reads the statement's snapshot, which is taken before
the `ON CONFLICT` row lock is granted, so two concurrent admissions could both see the same `held`
and both pass the ceiling test. Keeping `held` in the locked row removes the second read entirely.
Reservation rows remain, but only as the audit/recovery record of *what* is held.

`bigint` micro-USD for spend, never `numeric`/float, so `>=` comparisons cannot drift.

### 3. `packages/db/src/resource-usage.ts`: the only writer

```ts
export interface Ceilings { perWorkspace: bigint; global: bigint }
export type AdmitResult =
  | { status: "ok"; reservationIds: [string, string] }   // [workspace, global]
  | { status: "denied"; scope: "workspace" | "global"; kind: ResourceKind; retryAfterSeconds: number };

export async function admit(
  tx: ScopableDb, workspaceId: WorkspaceId, kind: ResourceKind,
  amount: bigint, ceilings: Ceilings,
  opts?: { jobId?: JobId; ttlSeconds?: number | null; now?: Date },
): Promise<AdmitResult>;

export async function commitReservation(tx: ScopableDb, reservationId: string, actual: bigint): Promise<void>;
export async function releaseReservation(tx: ScopableDb, reservationId: string): Promise<void>;
export async function commitDelta(tx: ScopableDb, workspaceId: WorkspaceId, kind: ResourceKind, delta: bigint): Promise<void>;
export async function reclaimExpired(db: ScopableDb, opts?: { now?: Date; limit?: number }): Promise<number>;
export async function reclaimOrphanedJobHolds(db: ScopableDb, boss: PgBoss): Promise<number>;
export async function usageFor(ws: WorkspaceDb, kinds?: ResourceKind[]): Promise<ResourceUsageRow[]>;
```

`admit` runs **two** statements inside the caller's transaction, in a fixed order — the Workspace
row first, then the global row — so concurrent admissions cannot deadlock. Each is one statement
that locks its counter row, tests the ceiling against the values *in that row*, and increments
`held` only if it passes:

```sql
-- Statement 1 (workspace). Statement 2 is the same shape against resource_usage_global.
with locked as (
  insert into resource_usage (workspace_id, kind, window) values ($1, $2, $3)
  on conflict (workspace_id, kind, window)
    -- A no-op SET is still an UPDATE: it takes the row lock even when the row already exists,
    -- so concurrent admissions for this (workspace, kind, window) serialise here.
    do update set workspace_id = excluded.workspace_id
  returning committed, held
), gate as (
  update resource_usage set held = held + $4, updated_at = now()
  where workspace_id = $1 and kind = $2 and window = $3
    and (select committed + held from locked) + $4 <= $5
  returning 1
)
insert into resource_reservations (id, workspace_id, scope, kind, window, amount, job_id, expires_at)
select $6, $1, 'workspace', $2, $3, $4, $7, $8 where exists (select 1 from gate)
returning id;
```

Zero rows returned is a denial, and the caller has not yet performed any side effect. If statement 1
succeeds and statement 2 denies, the caller's transaction rolls back — nothing to compensate.

`commitReservation` moves the amount from `held` to `committed` and deletes the reservation row in
one statement, so a settled amount may be **smaller** than the reservation (a 10 MiB body that
stored 2 MiB). `actual > amount` is permitted and recorded in full: the ceiling gates admission, it
does not misreport what was stored. `releaseReservation` decrements `held` and deletes the row.

Reservation lifetimes:

- **Request-scoped** (documents, Sources, picks): `expires_at = now() + 60s`. An HTTP handler holds
  one for a single request.
- **Active-attempt leases** (spend): `JOB_EXPIRE_IN_SECONDS + 60`, so the hold always outlives the
  attempt pg-boss will expire.
- **Queued job slots** (`jobs_outstanding`): `expires_at = NULL`. A job may sit queued far longer
  than any attempt timeout — `JOB_RETENTION_SECONDS` is 14 days — so a wall-clock TTL would free the
  slot while the job is still waiting and defeat the bound. These holds are released by the terminal
  event (§5) and swept by `reclaimOrphanedJobHolds`, which deletes a hold whose `job_id` has no
  non-terminal row in pg-boss. That sweep, not a timer, is the crash backstop.

`reclaimExpired` deletes expired rows and decrements `held` accordingly; it never touches
`committed`, because an expired reservation whose side effect *did* land is reconciled by §6.

### 4. Where each ceiling is enforced

`apps/api/src/admission.ts` exports one middleware factory and one in-transaction helper, injected
through `CreateAppOptions.admission` (api) and `WorkerDeps.admission` (worker) — never a module
singleton, so tests inject a fake exactly as they do for `RateLimiter`.

| Path | Kind(s) | Amount | Where |
| --- | --- | --- | --- |
| `POST /documents`, `POST /lessons` | `document_count`, `storage_bytes` | 1 row; the validated body's byte length | Inside the transaction that writes the row (§5 for `POST /lessons`) |
| `PUT /documents/:id` | `storage_bytes` | `max(0, newBytes − oldBytes)`; a shrink is a negative `commitDelta` after the write | Same transaction as `putDocument` |
| `POST /sources` | `storage_bytes` | Upload byte length, reserved **before** extraction; committed to the true sum of the keys written | Wraps `createSource` + `writeObjects` |
| `POST /images/pick` | `storage_bytes` | `MAX_PHOTO_BYTES`; committed to `bytes` actually stored | Around `storePhoto` |
| `enqueue()` | `jobs_outstanding` | 1, `jobId` recorded, no expiry | Same transaction as `boss.send` (§5) |
| `callStructured` | `spend_usd_day` | The TEACH-280 estimate, micro-USD | Worker, before the in-process Budget reserve |
| Physical purge of documents/Sources/objects | `storage_bytes`, `document_count` | Negative `commitDelta` of what was actually removed | Same transaction as the purge |

**Soft delete does not reclaim.** ADR 0024 §5 keeps a soft-deleted row and its body in the table,
and `deleteSourceObjects` only runs on the rollback and hard-delete paths — the bytes are still
stored, so returning capacity for a soft delete would let a Workspace recycle its ceiling
indefinitely while its storage grew. Counters therefore track *stored* bytes and rows regardless of
`deleted_at`, and capacity comes back only on physical removal: the `POST /lessons` failure path's
`deleteDocument`, `DELETE /sources/:id`'s object removal, and the orphan sweep (TEACH-271). `restore`
changes nothing, because nothing was reclaimed. The consequence, stated plainly: a Workspace at its
ceiling must *purge*, not just delete, and until a purge path exists for documents that means
support intervention. That is a real gap, and it is why `LIMIT_WORKSPACE_DOCUMENTS` is set well
above plausible use.

Reads (`GET`), soft delete, cancel and sign-out are **never** admitted: a Workspace at its ceiling
can still read, export and delete. When the admission store itself is unavailable the API fails
**closed** for every expensive write above (`503 service_unavailable`, `retryable: true`) and open
for reads/cancels — a Postgres outage already fails those writes.

Denial shape, reusing `apps/api/src/errors.ts` unchanged: `429`, `code: "rate_limited"`,
`Retry-After`, and copy that names no threshold ("This Workspace has reached a safety limit for
uploads. Nothing was lost. Try again later, or delete something first."). `429` because the client
behaviour we want is the existing retry/backoff, and `rate_limited` is already in
`RETRYABLE_STATUSES`.

### 5. Queue admission and fairness (the availability fix)

Two changes. Neither alone satisfies the ticket's regression.

**5.1 Bounded outstanding work per Workspace — and the restructure it needs.**
`createLessonAndEnqueue` (`apps/api/src/routes/lessons.ts:75`) today **commits** `ws.tx()` (Source
claim + document insert) and *then* calls `enqueue()`, compensating with `undoCreate` if the send
fails. `enqueue()` in turn calls `boss.send` and *then* inserts the `queued` event, compensating
with `boss.cancel`. Reserving inside the existing transaction is therefore impossible without
changing that shape, so this ADR changes it:

- `enqueue()` gains an optional `tx` (a `ScopableDb` from the caller's transaction) and, when given
  one, does all three things inside it: `admit(jobs_outstanding)`, `boss.send(..., { db:
  fromDrizzle(tx, sql), group: { id: workspaceId } })`, and `insertJobEvent({ type: "queued" })`.
  `notifyJobEvent` moves **after** the commit (a `NOTIFY` inside a transaction only fires on commit
  anyway, and the api's listener must never see an id it cannot read).
- `createLessonAndEnqueue` passes its `scoped` handle, so the Source claim, the document row, the
  reservation, the pg-boss row and the `queued` event are one atomic unit. `undoCreate` and
  `enqueue`'s `boss.cancel` compensation both **disappear**: there is no window in which one exists
  without the others. The `409` for a deduplicated send becomes a rollback of the same transaction.
- Callers that have no transaction (the proposal routes) keep today's behaviour by passing no `tx`;
  they get a transaction of their own inside `enqueue`.

A deduplicated send (`singletonKey` → `null`) rolls back, so it leaves no reservation.
`run-job.ts` releases the hold in the same transaction that writes the terminal `job_events` row
(`settle`), which is already idempotent under `job_events_one_terminal_per_job_uidx`: if the insert
loses to the index, the release is not applied twice. A `retry` keeps the hold — the job is still
outstanding. A cancel does **not** release; only the terminal event does, so a cancel racing a
worker cannot double-release. `reclaimOrphanedJobHolds` (§3) is the crash backstop.

**5.2 Fair selection across Workspaces, with the guarantee stated exactly.**
`boss.work` passes `groupConcurrency: { default: WORKER_GROUP_CONCURRENCY }` for every queue, and
§5.1 sets `group.id = workspaceId`. Read from `dist/plans.js`, the fetch SQL applies group limits in
two places:

1. **Before** `ORDER BY … LIMIT`, in the `next` CTE's `WHERE`: `(j.group_id IS NULL OR
   <active count for this group> < <group limit>)`. A Workspace already at its limit is excluded
   from the candidate set, so its backlog cannot crowd out another Workspace's job. This is the
   property the reproduction needs, and it is a pre-limit filter, not a post-limit one.
2. **After** the limit, in `group_ranking`/`group_filtered`: `(active_cnt + group_rn) <= group_limit`
   ranks jobs of the same group inside one fetched batch.

What this does **not** give us: the active count is read in the same statement, not under a lock
held across concurrent fetches, so two workers fetching simultaneously can each see the same count
and admit one job apiece — a transient overshoot of at most one job per concurrent fetcher. With
`localConcurrency: 4` in one process that is a bounded, acceptable inaccuracy for a *fairness*
mechanism; it is **not** a hard cap. If a hard per-Workspace running bound is ever required, it
needs its own atomic gate (a `running` counter admitted in the same transaction as the `started`
event), and that is deliberately out of scope here. `WORKER_GROUP_CONCURRENCY: 2` against
`WORKER_CONCURRENCY: 4` leaves margin for exactly this reason.

### 6. Recovery, reconciliation and the honest gaps

- **Crash between side effect and commit.** Everything except object storage shares one transaction
  with its counter change. `POST /sources` and `POST /images/pick` commit the *actual* bytes after
  `put`, and their existing failure paths remove what they wrote; a crash in between leaks bytes the
  ledger does not know about. The reconciler is the only cure, and this ADR does not pretend the
  incremental counter is exact.
- **Reconciler.** A new `usage.reconcile` job (pg-boss cron, one Workspace per run, round-robin)
  recomputes both halves of `storage_bytes` — object storage via `storage.list("<ws>/")` **and** the
  document bodies the same counter charges for, via `sum(pg_column_size(body))` over the Workspace's
  rows — plus `document_count` from `documents`, then writes the difference with `commitDelta` and
  logs `{ workspaceId, kind, drift }`. Counting only the bucket would understate a counter that
  charges for JSONB bodies, so both are in scope or neither is. It is the authority when it
  disagrees with the incremental counter, runs daily, and logs `warn` above 5% drift. It never
  touches `spend_usd_day`: there is no independent source of truth to recompute it from.
- **Spend is an admitted-estimate budget, not an invoice ceiling.** `spend_usd_day` admits TEACH-280's
  conservative *estimate*, permits `actual > amount`, and keeps uncertain calls charged. It bounds
  how much work we are willing to *start* in a day; it cannot bound what the provider ultimately
  bills. A true invoice cap needs provider-side budgets or billing reconciliation, which is not in
  this ADR. `LIMIT_GLOBAL_SPEND_USD_DAY` should be read as "stop starting work after roughly this
  much", and the founder decision in §7 is about that number, not a guarantee.
- **Daily window.** Charged to the day the call **started**, never back-dated across UTC midnight.
- **Deleted Workspace.** `on delete cascade` drops its tenant rows; the global counters are
  corrected by the reconciler's next pass, since a cascade cannot run application code.
- **What this does not do.** No cross-install fairness beyond the group filter; no hard running-slot
  bound (§5.2); no per-user ceiling inside a Workspace; no protection against a single upload that
  is under every ceiling; no purge path for soft-deleted documents (§4).

### 7. Thresholds: defaults, and what only the founder can decide

New env in `infra/env.contract.ts` (so `docs/env.md`, `.env.example` and the per-app contract tests
follow), all config, all defaulted:

| Variable | Default | Rationale |
| --- | --- | --- |
| `LIMIT_WORKSPACE_STORAGE_BYTES` | `2147483648` (2 GiB) | ~80 Sources at the 26 MiB cap; far above a teacher's real use, small enough that one tenant cannot fill the volume |
| `LIMIT_GLOBAL_STORAGE_BYTES` | `53687091200` (50 GiB) | Bucket headroom; raise before the 26th Workspace at full ceiling |
| `LIMIT_WORKSPACE_DOCUMENTS` | `5000` | Row guard, set high because soft deletes do not reclaim (§4) |
| `LIMIT_WORKSPACE_JOBS_OUTSTANDING` | `20` | Queued + running per Workspace |
| `LIMIT_GLOBAL_JOBS_OUTSTANDING` | `2000` | Table guard, well above one worker's throughput |
| `WORKER_GROUP_CONCURRENCY` | `2` | Half of `WORKER_CONCURRENCY: 4`, with margin for §5.2's soft overshoot |
| `LIMIT_WORKSPACE_SPEND_USD_DAY` | `10.00` | 20 Lessons/day at the `AI_LESSON_COST_CAP_USD` 0.50 ceiling |
| `LIMIT_GLOBAL_SPEND_USD_DAY` | `50.00` | Conservative; see §6 — this bounds work started, not the invoice |

**Founder decisions, unresolved and not guessed.**

1. Both spend numbers above are a *shape* to confirm; only the founder can say what a day's Bedrock
   spend may be, and §6 explains why it is not a hard invoice cap.
2. Whether hitting `LIMIT_GLOBAL_*` alerts (and where), or only logs.
3. Whether a Workspace at its storage ceiling may still *generate* (this ADR says yes: generation
   writes documents and is bounded by spend instead).
4. Retention for `resource_reservations` rows after commit (this ADR deletes them; an audit trail is
   a product/compliance decision).
5. Whether a purge path for soft-deleted documents is worth building, given §4's consequence.

### 8. Rollout

1. Migration adds the three tables; nothing reads them.
2. Backfill per Workspace with the reconciler run once (`bun run --cwd packages/db
   db:backfill-usage`, modelled on `db:backfill-summaries`), counting both bucket objects and
   document bodies.
3. Ship enforcement **in shadow**: `ADMISSION_ENFORCE=0` logs the decision (`admission denied` with
   kind/scope/amount) and admits anyway. Read the logs for a week.
4. Flip `ADMISSION_ENFORCE=1` per kind, spend last.
5. Only then retire the in-memory rate-limit row in `infra/README.md` "Known gaps".

## Testing the follow-on work must include

- `packages/db/src/resource-usage.test.ts` — two genuinely concurrent transactions on separate
  connections racing the last unit: exactly one `ok`, one `denied`, and `committed + held` never over
  the ceiling (this is the test that would have caught the aggregate-snapshot race §2 describes);
  commit smaller than reservation; `actual > amount` recorded; `held` returning to zero after
  release; the negative-`commitDelta` floor via the check constraint; `resource_usage_global`
  unreachable through `forWorkspace()` **by type**, not by convention.
- `packages/jobs/src/enqueue.test.ts` / `run-job.test.ts` — one transaction covering reservation +
  send + `queued` event: a failed send or failed event insert leaves none of the three; a
  deduplicated send leaves no reservation; the terminal event releases exactly one hold; a `retry`
  does not; a cancel does not; `reclaimOrphanedJobHolds` frees a killed worker's hold and a queued
  job's hold is **not** freed by time alone.
- `apps/api` route tests — the `429` envelope per path, reads/soft-deletes still `200`/`204` at the
  ceiling, admission-store outage `503` for writes and `200` for reads, and that a soft delete does
  **not** return capacity.
- `apps/worker` — `spend_usd_day` denial produces the existing partial-Lesson budget finding, with a
  fake AI and no real key; the reconciler corrects drift in both directions, counts document bodies
  as well as objects, and never writes `spend_usd_day`.
- **The availability regression** (`apps/web/e2e/fairness.spec.ts` or an api integration test): two
  real signed users in separate Workspaces, real Postgres, real pg-boss, held fake model calls. A
  submits more than `WORKER_GROUP_CONCURRENCY` Lessons; B's Lesson must reach `started` while A still
  has work outstanding. Assert both counters atomically under concurrent admission. Raising
  concurrency or lowering the request limit does not satisfy this test.

## Consequences

Easier: one place answers "what is this Workspace using", which TEACH-32's plans and any usage
screen will also need; the api can scale horizontally without the in-memory limiter being the weak
point.

Harder: `enqueue` and `createLessonAndEnqueue` become transactional (§5.1) — a real refactor of two
compensation paths; every expensive write grows a transaction and two statements; the ledger drifts
from object storage and needs the reconciler; soft deletes no longer feel like they free space (§4).

Revisit when the api runs more than one replica, when a second worker service exists, when a hard
running-slot bound is needed (§5.2), or when TEACH-32 sets commercial limits.

**This ADR is a design. The availability interference on TEACH-279 remains live in production until
the implementation tickets are deployed.**
