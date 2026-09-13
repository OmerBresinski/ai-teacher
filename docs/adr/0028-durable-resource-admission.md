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
  windowKey: text("window_key").notNull().default(""),
  /** Settled amount: bytes, rows, jobs, or micro-USD. Never a float. */
  committed: bigint("committed", { mode: "bigint" }).notNull().default(0n),
  /** Outstanding reservations, maintained in the same locked statement as `committed` (§3). */
  held: bigint("held", { mode: "bigint" }).notNull().default(0n),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.workspaceId, t.kind, t.windowKey] }),
  check("resource_usage_committed_nonnegative", sql`${t.committed} >= 0`),
  check("resource_usage_held_nonnegative", sql`${t.held} >= 0`),
]);

/** Install-wide counters. NON_TENANT_TABLES: no workspace_id, so forWorkspace() cannot reach it. */
export const resourceUsageGlobal = pgTable("resource_usage_global", {
  kind: resourceKind("kind").notNull(),
  windowKey: text("window_key").notNull().default(""),
  committed: bigint("committed", { mode: "bigint" }).notNull().default(0n),
  held: bigint("held", { mode: "bigint" }).notNull().default(0n),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.kind, t.windowKey] }),
  check("resource_usage_global_committed_nonnegative", sql`${t.committed} >= 0`),
  check("resource_usage_global_held_nonnegative", sql`${t.held} >= 0`),
]);

export const resourceReservations = pgTable("resource_reservations", {
  id: uuid("id").primaryKey(),
  /** NULL only for a global-scope row; a tenant row always names its Workspace. */
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  scope: text("scope", { enum: ["workspace", "global"] }).notNull(),
  kind: resourceKind("kind").notNull(),
  windowKey: text("window_key").notNull().default(""),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  /** Set for job reservations so a dead job's hold is recoverable by id. */
  jobId: uuid("job_id"),
  /** NULL for a hold with no wall-clock deadline (a queued job, §4). */
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("resource_reservations_ws_kind_idx").on(t.workspaceId, t.kind, t.windowKey),
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

/** Thrown, not returned: see below. */
export class AdmissionDenied extends Error {
  readonly scope: "workspace" | "global";
  readonly kind: ResourceKind;
  readonly retryAfterSeconds: number;
}

/** Resolves with both reservation ids, or throws `AdmissionDenied`. */
export async function admit(
  tx: ScopableDb, workspaceId: WorkspaceId, kind: ResourceKind,
  amount: bigint, ceilings: Ceilings,
  opts?: { jobId?: JobId; ttlSeconds?: number | null; now?: Date },
): Promise<{ reservationIds: [string, string] }>;   // [workspace, global]

export async function commitReservation(tx: ScopableDb, reservationId: string, actual: bigint): Promise<void>;
export async function releaseReservation(tx: ScopableDb, reservationId: string): Promise<void>;
export async function commitDelta(tx: ScopableDb, workspaceId: WorkspaceId, kind: ResourceKind, delta: bigint): Promise<void>;
export async function reclaimExpired(db: ScopableDb, opts?: { now?: Date; limit?: number }): Promise<number>;
export async function reclaimOrphanedJobHolds(db: ScopableDb, boss: PgBoss): Promise<number>;
export async function usageFor(ws: WorkspaceDb, kinds?: ResourceKind[]): Promise<ResourceUsageRow[]>;
```

**`admit` throws on denial rather than returning it.** A denial can happen on the *second* scope,
after the first has already incremented `held` in the caller's transaction. Returning a value would
let a handler answer `429` and still commit that partial hold — a slow leak that only the reconciler
would ever notice. Throwing makes the rollback structural: the transaction cannot commit, and
`apps/api/src/errors.ts` maps `AdmissionDenied` to the `429` envelope in one place. The same applies
to `enqueue` (§5.1).

`admit` runs **three plain statements** inside the caller's transaction — no data-modifying CTEs.
The first two repeat for the global counter, in a fixed order (Workspace row, then global row) so
concurrent admissions cannot deadlock:

```sql
-- 1. Ensure the counter row exists. Idempotent, no lock semantics relied on.
insert into resource_usage (workspace_id, kind, window_key) values ($1, $2, $3)
on conflict (workspace_id, kind, window_key) do nothing;

-- 2. Admit: one guarded UPDATE. It takes the row lock, and on conflict re-evaluates its WHERE
--    against the latest committed row version, so two concurrent admissions cannot both pass.
--    Zero rows returned is a denial, and no side effect has happened yet.
update resource_usage set held = held + $4, updated_at = now()
where workspace_id = $1 and kind = $2 and window_key = $3
  and committed + held + $4 <= $5
returning held;

-- 3. Record what is held, for audit and recovery.
insert into resource_reservations (id, workspace_id, scope, kind, window_key, amount, job_id, expires_at)
values ($6, $1, 'workspace', $2, $3, $4, $7, $8);
```

An earlier draft folded steps 1 and 2 into one statement with sibling data-modifying CTEs (`locked`
that upserted, `gate` that updated the same row). That is **wrong**, and measurably so: two
data-modifying CTEs touching the same row in one statement do not see each other's effects, and on
PostgreSQL 16 the shape returned **zero rows while capacity was available** — it would have denied
every admission. Two ordinary statements inside the transaction are both correct and obvious; the
`ON CONFLICT DO UPDATE … WHERE` single-statement alternative is also wrong here, because its `WHERE`
is skipped on the insert path, so the first admission for a new counter would bypass the ceiling.


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
| `POST /documents`, `POST /lessons` | `document_count`, `storage_bytes` | 1 row; the request body's byte length as the **estimate**, committed to `pg_column_size(body)` from the insert's `RETURNING` | Inside the transaction that writes the row (§5 for `POST /lessons`) |
| `PUT /documents/:id` | `storage_bytes` | Growth only: reserve `newLen − oldLen` when positive, then commit the signed `pg_column_size(body)` difference. A non-growing update reserves **nothing** and applies only the (negative or zero) `commitDelta` | Same transaction as `putDocument` |
| `POST /sources` | `storage_bytes` | **Two** admissions: the upload's byte length before extraction, then the *measured* size of the extraction output before `writeObjects`; both commit to bytes actually written | Wraps `createSource` + `writeObjects` |
| `POST /images/pick` | `storage_bytes` | `MAX_PHOTO_BYTES`; committed to `bytes` actually stored | Around `storePhoto` |
| `enqueue()` | `jobs_outstanding` | 1, `jobId` recorded, no expiry | Same transaction as `boss.send` (§5) |
| `callStructured` | `spend_usd_day` | The TEACH-280 estimate, micro-USD | Worker, before the in-process Budget reserve |
| Physical purge of documents/Sources/objects | `storage_bytes`, `document_count` | Negative `commitDelta` of what was actually removed | Same transaction as the purge |

**Reclamation follows the bytes, not the word "delete".** The two paths differ, and the rule has to
name them separately:

- **Documents.** ADR 0024 §5's soft delete keeps the row *and its body* in the table, so nothing is
  freed and nothing is credited. `restore` therefore re-admits nothing either. Capacity returns only
  on physical removal: `POST /lessons`' failure-path `deleteDocument`, or a future purge.
- **Sources.** `DELETE /sources/:id` soft-deletes the registry row **and physically deletes every
  object under `<ws>/sources/<id>/`** (`deleteSourceObjects`). The bytes really are gone, so that
  path **does** credit `storage_bytes` — in the same transaction as the row update, for the **summed
  `StorageObject.size` of the objects whose delete actually succeeded**. Not `sources.byte_size`:
  that records the upload alone, so crediting it would permanently undercount. Objects whose delete
  failed are not credited — they are still stored, and §6's reconciler finds them. The same applies
  to the `POST /sources` rollback and the orphan sweep (TEACH-271).

So `document_count` is a count of rows that still exist (soft-deleted included), and `storage_bytes`
tracks bytes that are still stored. The consequence, stated plainly: a Workspace at its *document*
ceiling must have rows purged, which today means support intervention — which is why
`LIMIT_WORKSPACE_DOCUMENTS` sits well above plausible use, and why founder decision 5 asks whether a
purge path is worth building.


**A zero-sized write reserves nothing.** The same rule that governs a non-growing `PUT` governs an
empty upload: pasted text can be 0 bytes, and `amount > 0` forbids a zero hold. `POST /sources`
therefore skips the upload reservation when the body is empty and admits only the measured
extraction output. (Whether an empty paste should be rejected outright at validation is a separate
question and not this ADR's to answer.)

**A reservation is always positive; a shrink is a delta.** `resource_reservations.amount` is
`> 0` by constraint, so a write that does not grow must not ask for a zero-sized hold. `PUT` therefore
reserves only when `newLen > oldLen`; otherwise it skips admission entirely and applies the signed
`commitDelta` after the write. A shrink can never be denied — it frees capacity.

**Extraction output is admitted separately, because the upload does not bound it.** `POST /sources`
stores the original *plus* the extracted images and `extracted.json`, so reserving only the upload's
bytes would let a Workspace exceed `storage_bytes` by whatever extraction adds. There is no usable
*a priori* bound: the only existing cap is `ChildRunnerConfig.maxOutputBytes`
(`CHILD_RUNNER_DEFAULTS.maxOutputBytes`, 128 MiB), and it limits the child's **JSON stdout including
base64 overhead**, not the bytes finally stored — so it is both the wrong quantity and far too
pessimistic to reserve up front.
The extraction result is in memory before anything is written, so its size is *known* at that point:
admit it as a second reservation **before** `writeObjects`, and deny before any object exists. Both
reservations then commit to the bytes actually written. That keeps the ceiling a real ceiling without
reserving 128 MiB per upload.

**One byte metric, measured once.** A document's stored size is `pg_column_size(body)` — the
compressed JSONB the row actually occupies — and that is what both the commit and the reconciler use.
The request body's length is only the *reservation estimate*, which is exactly the
reserve-then-settle asymmetry §3 already allows (a reservation may settle smaller or larger). Mixing
the two — admitting on request length and reconciling on `pg_column_size` — would manufacture
permanent drift, so the commit resolves to `pg_column_size` inside the same transaction via
`RETURNING`, before the reconciler ever sees the row.

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
  It **throws** `EnqueueDeduplicated` instead of returning `null` when `singletonKey` suppresses the
  send: a returned `null` cannot roll back a transaction the caller owns, so it would commit the
  document, the Source claim, the hold and the event for a job that does not exist. The route maps
  that error to the existing `409`. (Without a `tx`, `enqueue` keeps today's `JobId | null`.)
- `notifyJobEvent` moves **after** the commit, so `enqueue` returns the inserted event id to its
  caller and the caller notifies once the transaction has committed. A `NOTIFY` inside a transaction
  only fires on commit anyway, and the api's listener must never see an id it cannot read. If that
  post-commit notify fails the row is still committed, but the existing degraded-polling fallback
  does **not** cover it: `apps/api/src/events/listener.ts` sets `hub.setDegraded(true)` when the
  *listener* cannot subscribe, not when a *notifier* throws, so a healthy listener would leave an
  open stream waiting for an event nobody published. The notifier runs in the api process that owns
  the hub, so it must mark the hub degraded itself on failure — one call, and the existing polling
  path (which has an integration test) then delivers the committed row. Without that call this is a
  hang, not a best-effort degradation; TEACH-304 must test the notifier-failure case specifically.

  **This fix only covers the api.** `EventsRuntime.hub` exists in the api process, so an enqueue
  caller can degrade it. Terminal settlement runs in the **worker**, whose `JobsContext` holds no
  hub reference and no route to one, so a worker-side notify failure cannot degrade the api's hub at
  all: the terminal row is committed and an open stream waits indefinitely. This ADR does **not**
  solve that — it needs either a durable outbox drained by a poller, or an api-side floor that polls
  for terminal rows regardless of hub state. It is listed in §7 as unresolved, and TEACH-304 must not
  claim the transactional settle is complete without it.
- `createLessonAndEnqueue` passes its `scoped` handle, so the Source claim, the document row, the
  reservation, the pg-boss row and the `queued` event are one atomic unit. `undoCreate` and
  `enqueue`'s `boss.cancel` compensation both **disappear**: there is no window in which one exists
  without the others.
- Callers that have no transaction (the proposal routes) keep today's behaviour by passing no `tx`;
  they get a transaction of their own inside `enqueue`.

**Release needs a transactional settle path, which does not exist yet.** `run-job.ts`'s `settle`
calls `emitJobEvent`, which is `insertJobEvent` followed by `notifyJobEvent` with no shared
transaction; `cancel()` does the same for a queued job. Releasing the hold "in the same transaction
as the terminal event" therefore requires building that path: a helper in `@tj/jobs` that, in one
transaction, inserts the terminal `job_events` row and releases the job's `jobs_outstanding` holds,
then notifies after commit. Three details the helper must get right, none of which come for free:

- The insert must be `ON CONFLICT DO NOTHING … RETURNING` (or run under a savepoint). `insertJobEvent`
  is a plain insert today, so a unique-index violation would abort the whole transaction rather than
  identify a loser — the index alone does not make the helper idempotent. The helper returns
  winner/loser explicitly, and only the winner releases.
- It releases the **`jobs_outstanding`** reservations only. A job's `spend_usd_day` holds are settled
  by the pipeline (§4) and must not be released here, or a terminal event would refund spend.
- It releases the Workspace hold before the global one, the same order `admit` takes, so a release
  racing an admission cannot deadlock.

Both `run-job.ts`'s `settle` and `enqueue.ts`'s queued-cancel branch must go through it — two call
sites, one helper. A
`retry` keeps the hold, because the job is still outstanding. A cancel of a *running* job releases
nothing: the worker's terminal event does it. `reclaimOrphanedJobHolds` (§3) is the crash backstop.


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
  rows (the same metric §4 commits, soft-deleted rows included, since their bytes are still stored) — plus `document_count` from `documents`, then writes the difference with `commitDelta` and
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

**Workspace deletion must adjust the global counters before the cascade.** `resource_usage` rows and
Workspace-keyed reservations are tenant-scoped and cascade away with the Workspace, but
`resource_usage_global` is not keyed by Workspace, so a delete would silently leave the global
counters overstated forever — and the next reconciliation pass cannot repair them, because the rows
that recorded those amounts are gone and the object prefixes are no longer enumerable from any
surviving row. Deletion therefore decrements the global counters by that Workspace's committed
amounts **in the same transaction**, before the cascade fires. A reconciler cannot be the safety net
here; the adjustment has to happen while the evidence still exists.

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
3. Whether a Workspace at its storage ceiling may still *generate*. This ADR's "yes, generation is
   bounded by spend instead" is **not sufficient as written**: the worker's `lesson-plan` path
   creates and repeatedly updates JSONB documents, which are exactly the bytes §4 charges. So the
   real question is what a worker document write does at the ceiling — deny it and fail the job
   mid-pipeline, or let it through and treat the ceiling as advisory for worker writes. Until the
   founder answers, the worker write path stays outside enforcement (`ADMISSION_ENFORCE=0` for it),
   because failing a half-finished generation is worse than a small overshoot.
4. Retention for `resource_reservations` rows after commit (this ADR deletes them; an audit trail is
   a product/compliance decision).
5. Whether a purge path for soft-deleted documents is worth building, given §4's consequence.
6. How a **worker**-side notify failure is recovered (durable outbox vs an api-side polling floor),
   per §5.1 — an engineering choice this ADR deliberately leaves open rather than guessing, and a
   prerequisite for TEACH-304's transactional settle.

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
  connections racing the last unit: exactly one admits, one throws `AdmissionDenied`, and
  `committed + held` never exceeds the ceiling. Also a plain single-threaded admission against an
  **existing** counter row and a **fresh** one, which is the case the rejected single-statement
  shapes got wrong (§3) (this is the test that would have caught the aggregate-snapshot race §2 describes);
  commit smaller than reservation; `actual > amount` recorded; `held` returning to zero after
  release; the negative-`commitDelta` floor via the check constraint; `resource_usage_global`
  unreachable through `forWorkspace()` **by type**, not by convention.
- `packages/jobs/src/enqueue.test.ts` / `run-job.test.ts` — one transaction covering reservation +
  send + `queued` event: a failed send or failed event insert leaves none of the three; a
  deduplicated send throws `EnqueueDeduplicated` and leaves none of the three; the new transactional
  settle helper releases exactly one hold per scope and the unique-index loser releases nothing; a
  `retry` does not release; cancelling a *running* job does not release; `reclaimOrphanedJobHolds` frees a killed worker's hold and a queued
  job's hold is **not** freed by time alone.
- `apps/api` route tests — the `429` envelope per path (from a thrown `AdmissionDenied`, asserting
  the transaction rolled back and no partial hold remains), reads/soft-deletes still `200`/`204` at
  the ceiling, admission-store outage `503` for writes and `200` for reads, that a **document** soft
  delete returns no capacity, and that `DELETE /sources/:id` **does** — it physically removes the
  objects.
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
