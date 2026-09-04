# `@tj/worker`

The pg-boss consumer (ADR [0006](../../docs/adr/0006-postgres-drizzle-pgboss.md)): the **only**
process that calls `boss.work()`. It runs every job registered in `src/jobs/index.ts` through
`runJob()` from [`@tj/jobs`](../../packages/jobs/README.md), which writes `job_events` rows +
`pg_notify` for the API's SSE stream (ADR [0012](../../docs/adr/0012-sse-progress.md)). No HTTP
surface beyond `/health`.

## Environment

Validated with Zod at boot (`src/env.ts`, ADR 0015); a bad value prints the offending keys and
exits 1. `bun run setup` copies `.env.example` to `.env`; Bun reads `.env` from the cwd only.

| Variable | Default | Meaning |
| -------- | ------- | ------- |
| `DATABASE_URL` | — (required) | Postgres URL; same database as `apps/api`. pg-boss installs its own `pgboss` schema on first start. |
| `WORKER_CONCURRENCY` | `4` | Jobs processed concurrently per queue in this process (`localConcurrency`). |
| `PORT` | `3002` | Health endpoint port. |
| `LOG_LEVEL` | `info` | pino level. |
| `NODE_ENV` | `development` | `development` switches on `pino-pretty`. |

## Run

```sh
bun run dev        # bun --watch src/index.ts (from apps/worker; or `bun run dev` at the root)
bun run build      # bun build src/index.ts --target=bun --outdir=dist
bun run start      # bun dist/index.js  (Railway start command)
bun test           # env parsing + ping handler unit tests
```

Boot sequence: parse env → `createDb` (pool of 4) → `createBoss` → `boss.start()` →
`ensureQueues()` → `boss.work(name, { batchSize: 1, localConcurrency, includeMetadata,
perJobResults, pollingIntervalSeconds: 0.5 }, …)` per `JobName` → `Bun.serve` on `PORT`.

## Health

`GET /health` → `{ "ok": true, "activeJobs": 0, "boss": "started" }`. `ok` is `false` (and `boss`
is `stopping`/`stopped`) once shutdown has begun, so a load balancer drains the instance.

## Jobs

`src/jobs/index.ts` exports `registry: JobRegistry` — a mapped type over `JobName`, so adding a
name in `@tj/domain` without a handler here fails `typecheck`. `src/jobs/ping.ts` is the ADR 0012
demo: `steps` progress events 300 ms apart, `signal.aborted` checked between steps,
`NonRetryableError` at `failAt`. See `@tj/jobs` README for the event contract, retry policy and
cancel semantics.

## Shutdown

`SIGTERM` / `SIGINT`:

1. `/health` flips to `ok: false`.
2. `boss.stop({ graceful: true })` — no new jobs are fetched; active handlers keep running.
3. After **25 s** the shared shutdown `AbortSignal` fires (`signal.reason === "shutdown"`); each
   `runJob` settles its attempt as retryable so pg-boss re-queues the job (see `@tj/jobs`
   "Retry policy").
4. pg-boss closes its pool, `close()` drains the `@tj/db` pool, the process exits **0**.

Railway's stop grace period must exceed 25 s (ADR 0010). Verified locally: idle worker exits in
< 1 s; a worker with a 12-step ping in flight waits for it and exits 0 in ~2 s.
