# `@tj/api` — Teaching Journey HTTP API

Hono on Bun. The typed contract for `apps/web` through Hono RPC (ADR 0005). Deploys to Railway
from the root `Dockerfile` (ADR 0010). Env validation and structured logging follow ADR 0015.

```sh
bun run dev          # bun --watch src/index.ts  (reads apps/api/.env)
bun test             # unit tests + /health against TEST_DATABASE_URL (skips visibly if unset)
bun run build        # bun build src/index.ts --target=bun --outdir=dist
bun run start        # bun dist/index.js
```

## Environment (`src/env.ts`)

Parsed once at boot with Zod. A missing/invalid value prints one `VAR: message` line per problem
to stderr (for example `DATABASE_URL: Required`) and exits 1 — no stack trace. Bun loads `.env`
from the **cwd only** (turbo does not load env files), so the API reads `apps/api/.env`.

The variables, their defaults and where each value is set live in the env contract —
[`docs/env.md`](../../docs/env.md) (generated from `infra/env.contract.ts`, which also generates
this app's `.env.example`). `src/env.contract.test.ts` fails when `EnvSchema` (+ the SSE knobs
schema) and the contract disagree. Required at boot: `DATABASE_URL`, `BETTER_AUTH_SECRET` (created
by `bun run setup`). `TEST_DATABASE_URL` is read only by the tests, never by the server.

`parseEnv(source)` is the pure core (returns `{ ok, env | errors }`) — unit-test it; `loadEnv()`
is the boot wrapper that prints and exits.

## Application shape

`createApp({ env, db, logger? })` in `src/app.ts` returns the Hono app with **no `serve` side
effects**; `src/index.ts` wires `loadEnv()` → `createDb()` → `createApp()` → `Bun.serve()` and
handles SIGTERM/SIGINT (stop accepting, drain in-flight with `server.stop(false)`, close the pool,
exit 0). Tests call `app.request()` directly.

Middleware order:

1. **request-id** — `hono/request-id`; honours an incoming `x-request-id`, otherwise
   `crypto.randomUUID()`; echoed on every response, including errors.
2. **logger** — one pino line per request: `method`, `path`, `status`, `duration_ms`,
   `request_id`. **Never log bodies, prompts or Artefact content.** A child logger is available as
   `c.get("logger")`.
3. **CORS** — origins from `env.WEB_ORIGIN` (exact) and `env.WEB_ORIGIN_PATTERNS` (globs, see
   `createOriginMatcher` in `src/origins.ts`), `credentials: true`, `maxAge: 600`. Requests from
   any other origin receive **no** CORS headers at all.
4. **`secureHeaders()`**.
5. **Routes** — chained feature routers from `src/routes/`.
6. **`notFound` / `onError`** — the envelope below.

Mount points (search for the ticket ids in `src/app.ts`):

- `// TEACH-20: mount /auth/* and requireSession here`
- `// TEACH-19: mount /jobs and /events here` (`streamSSE`, `Last-Event-ID` replay — ADR 0012)
- `fileRoutes(storage)` — `GET /files/:key` proxy over the `ReadableStorageAdapter` (see "Files")

## Background jobs (ADR 0006)

`src/index.ts` builds pg-boss with `createBoss(env.DATABASE_URL, { applicationName: "tj-api",
role: "enqueue-only" })`: the api only `enqueue`s/`cancel`s, so pg-boss maintenance
(`supervise: false`) and cron (`schedule: false`) are off here and run in `apps/worker` alone.

## Error envelope

Every non-2xx response has the same body; `message` is a plain sentence safe to show in the UI
(F18-R12) — never a code, a stack or internal detail.

```json
{
  "error": {
    "code": "validation_failed",
    "message": "The request contains invalid fields.",
    "requestId": "7f1a…",
    "retryable": false,
    "fields": ["name"]
  }
}
```

Two optional fields: `fields` (only `validation_failed`) and `reason` (only `conflict` from the
document routes: `"stale"` when the `expectedUpdatedAt` a client sent is behind the row,
`"generating"` when a job holds the lesson's generating lock — ADR 0024 §4, §18). Throw
`ConflictError(reason, message)` from `src/errors.ts` to set it.

| Source                                       | Status        | `code`                                      |
| -------------------------------------------- | ------------- | ------------------------------------------- |
| `zValidator` failure (via `validationHook`) / `ZodError` | 400 | `validation_failed` (+ `fields: string[]`)   |
| `HTTPException`                              | its status    | `bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `payload_too_large`, `unprocessable`, `rate_limited`, `service_unavailable`, `internal_error` (5xx) or `http_error` (other 4xx) |
| Unknown route                                | 404           | `not_found`                                 |
| `/health` with the database down             | 503           | `service_unavailable`, `retryable: true`    |
| Anything else thrown                         | 500           | `internal_error` — generic message; details are logged with the request id only |

`retryable` is `true` for 408/425/429/502/503/504. Use `errorResponse(c, status, code, message,
retryable)` from `src/errors.ts` to return an envelope from a handler; throw `HTTPException` for the
common cases.

## Adding a route

Routers must be **chained** so Hono RPC keeps the types (ADR 0005). Every input is validated with
`@hono/zod-validator` and the shared `validationHook` (so failures use the envelope, not the
validator's raw body).

```ts
// src/routes/journeys.ts
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context";
import { validationHook } from "../validation";

export const journeyRoutes = new Hono<AppEnv>()
  .get("/journeys/:id", zValidator("param", z.object({ id: z.string() }), validationHook), (c) =>
    c.json({ id: c.req.valid("param").id }, 200),
  )
  .post("/journeys", zValidator("json", z.object({ goal: z.string().min(1) }), validationHook), (c) =>
    c.json({ ok: true }, 201),
  );
```

```ts
// src/app.ts — extend the chain; the exported AppType picks the new routes up automatically
const routes = app.route("/", healthRoutes(db)).route("/", helloRoutes).route("/", journeyRoutes);
```

Tenant tables are only reached through `forWorkspace(unsafeDb, workspaceId)` from `@tj/db`
(ADR 0007). Pass what a router needs as function arguments (see `healthRoutes(db)`), not through
module-level singletons, so tests can inject fakes.

## Routes today

| Route                | Response                                                     |
| -------------------- | ------------------------------------------------------------ |
| `GET /health`        | `200 { ok: true, db: "up" }` or `503` envelope (`retryable: true`) |
| `GET /hello?name=x`  | `200 { message: "Hello, x" }`; `400 validation_failed` when `name` is empty |
| `GET /me`            | `200 { user: { id, email, name }, workspaceId }`; `401 unauthorized` without a session (see "Auth") |
| `/auth/*`            | better-auth endpoints (magic link, session, sign-out; OAuth when configured) |
| `GET /documents?kind=&sort=&q=&cursor=&limit=` | `200 { items: DocumentSummary[], nextCursor }`; `400 validation_failed` for a bad `kind`/`sort`/`limit`, `400 bad_request` for a malformed cursor (see "Documents") |
| `POST /documents`    | `201 { document }` from `{ kind, body }`; `422 unprocessable` with the parser's message; `413 payload_too_large` over 10 MB |
| `GET /documents/:id` | `200 { document }` (soft-deleted rows included, `deletedAt` set); `404` unknown or another Workspace |
| `PUT /documents/:id` | `200 { document }` from `{ document, expectedUpdatedAt }`; `409 conflict` with `reason: "stale" \| "generating"`; `422` when `document.id` differs from the URL or the document is invalid; `413` over 10 MB; `404` |
| `DELETE /documents/:id` | `204` (idempotent); `404` |
| `POST /documents/:id/restore` | `200 { document }`; `404` |
| `GET /documents/:id/lessons` | `200 { series, lessons: DocumentSummary[] }` in `body.lessonIds` order; `404` when not found or not a series |
| `POST /lessons`      | `202 { lessonId, jobId }` from a brief (see "Lessons"); `400 validation_failed` (same Zod + Identifier guard as the brief screen); `409 conflict` when an identical job is queued; `429 rate_limited` past the model-call allowance; `503` without a job runtime |
| `GET /files/:key`    | Streams a stored object (`content-type`, `content-length`, `cache-control: private, no-store`); `401` without a session, `404` for a missing object **or** a key outside the caller's Workspace (never 403), `400 validation_failed` for a malformed key, `503` when no storage adapter is configured (see "Files") |
| `GET /__test/last-magic-link?email=x` | **Test-only** (see "Test routes"): `200 { email, url }` or `404 not_found`. Absent unless `NODE_ENV=test` and `ENABLE_TEST_ROUTES=1`. |

## Files (`GET /files/:key`, ADR 0011 amendment)

Vercel Blob has no time-limited signed URLs for private blobs, so every Artefact/Source download
goes through this proxy. `src/index.ts` builds the adapter with `createStorage()` from
`@tj/storage` — Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set, otherwise local disk at
`STORAGE_ROOT` (default `.data/storage`) — and passes it as `createApp({ storage })`. The route
is behind `requireSession`; the key (`<workspaceId>/<segment>/…`, `StorageKeySchema`) must start
with the caller's `workspaceId` or the answer is `404`, and the body is streamed from
`storage.get(key)` without buffering. `src/routes/files.ts` deliberately imports only from
`@tj/domain`: `@tj/storage` uses Bun globals, which must not leak into `AppType`.

## Documents (`/documents/*`, ADR 0024)

`src/routes/documents.ts` (`documentRoutes(unsafeDb)`) is the persistence API for Lesson,
Worksheet and Series documents. Every handler scopes the injected Drizzle client with
`forWorkspace(unsafeDb, workspaceId)` (ADR 0007) and calls the `@tj/db` repository
(`packages/db/src/documents.ts`), so another Workspace's id is a `404` — never `403`. Bodies are
validated twice: the request shape with `zValidator`, the document itself in the repository
(`migrate()` then `parseLesson` / `parseWorksheet` / `parseSeries`); a `DocumentParseError`
becomes `422` with the parser's message. `POST` mints the row id and rewrites `body.id` (§11).
`PUT` is a whole-document write with optimistic concurrency: `expectedUpdatedAt` must equal the
row's `updatedAt` and no job may hold `generatingJobId`, otherwise `409` with `reason`. `POST` and
`PUT` are capped at `DOCUMENT_BODY_LIMIT_BYTES` (10 MB, `hono/body-limit`) while images are data
URLs (§8). Lists never read `body`: `toSummaryJson` maps the promoted columns to the domain
`DocumentSummary` shape (ISO strings, `null` → absent) plus `deletedAt` and `generatingJobId`;
`sort` is `updated | title | created`, `q` is an `ILIKE` on title and subject, and `cursor` is the
opaque keyset cursor from the previous page (§17). `/documents` and `/documents/*` are both in
`PROTECTED_PATHS` (CSRF guard + `requireSession`).

## Lessons (`POST /lessons`, ADR 0024 §6, §13, §15, §18)

`src/routes/lessons.ts` (`lessonRoutes(unsafeDb, runtime)`) is how a brief becomes a Lesson. The
body is `CreateLessonSchema` from `@tj/domain/documents` — `{ brief: { topic, durationMin?,
classContext?, answers? }, subject?, yearGroup?, ageBand?, readingLevel?, language?, themeId? }`,
strict, every free-text field behind the Identifier guard — so the brief screen and the API reject
the same input with the same message. `lessonFromBrief()` applies the defaults the screen shows:
`ageBand` from the year group (`deriveAgeBand`: Reception → `eyfs`, Year 1–2 → `ks1`, 3–6 → `ks2`,
7–9 → `ks3`, 10–11 → `ks4`, 12–13 → `post16`), `durationMin` from the age band
(`defaultDurationMin`: 30 / 45 / 60), `title` = the topic cut to 80 characters, `themeId` =
`DEFAULT_THEME_ID`, `language` = `en-GB`, `slides: []`. The handler then mints the job id, inserts
the row with `generating_job_id = jobId` **first** (so a fast worker always finds a lock to clear),
enqueues `lesson.plan { lessonId }` under that id — removing the row again if the enqueue fails —
and answers `202 { lessonId, jobId }`. The
client navigates to `/l/$lessonId` and follows `GET /jobs/:jobId/events`; until the worker's
terminal event clears the lock, `PUT /documents/:lessonId` is `409 conflict` with
`reason: "generating"`. `/lessons` shares the per-Workspace model-call limiter with
`/jobs/ai-ping` (`AI_RATE_LIMIT_PER_WORKSPACE` / `AI_RATE_LIMIT_WINDOW_S`), the 10 MB body cap with
`/documents`, and is in `PROTECTED_PATHS`. Only `{ lessonId, jobId }` is logged.

## `AppType` and `@tj/api-client`

`src/app.ts` exports `type AppType`. `package.json#exports` exposes `./app` → `./src/app.ts` so
`packages/api-client` can `import type { AppType } from "@tj/api/app"` (type-only; nothing from the
server ends up in a browser bundle). See `packages/api-client/README.md`.

## Auth

Identity is **better-auth 1.7.2** (pinned exactly; ADR 0008) running inside this app with the
Drizzle adapter over `@tj/db`. Only the email magic link is enabled; Google and Microsoft OAuth
are wired in `src/auth/auth.ts` and switch on when their credentials are present.

### Environment

`BETTER_AUTH_SECRET` (required, ≥ 32 chars, generated by `bun run setup`), `BETTER_AUTH_URL`,
`COOKIE_DOMAIN`, `COOKIE_SAMESITE`, `MAIL_PROVIDER`, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`,
`MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`, `ENABLE_TEST_ROUTES` — defaults and semantics in
[`docs/env.md`](../../docs/env.md). Both OAuth values of a provider set → that sign-in is on;
otherwise boot logs `<Provider> sign-in disabled (no credentials)`. `COOKIE_SAMESITE=none` forces
`Secure` in every `NODE_ENV` and logs a boot warning (preview exception, TEACH-25).
`MAIL_PROVIDER` other than `console` stops boot until F17.

### Dev flow (console mail)

```sh
curl -X POST localhost:3001/auth/sign-in/magic-link \
  -H 'content-type: application/json' -H 'origin: http://localhost:5173' \
  -d '{"email":"you@example.com","callbackURL":"http://localhost:5173/"}'
```

The api log prints a boxed `MAIL (MAIL_PROVIDER=console)` block containing the link. Open it (or
`curl -i "<link>"`): the response is a `302` to `callbackURL` with `Set-Cookie: tj.session_token=…`
and `tj.session_data=…` (a 5-minute signed cache of the session so `requireSession` does not hit
the database on every request). `GET /me` with the cookie returns
`{ user: { id, email, name }, workspaceId }`. Links are single-use and expire after 5 minutes.
Sign out with `POST /auth/sign-out` (with the cookie and an `Origin` header).

### Test routes (`src/routes/test-routes.ts`, TEACH-22)

`GET /__test/last-magic-link?email=<address>` returns the last magic link the api "sent" to that
address — `200 { email, url }`, or `404 not_found` before any was sent. Playwright's `signedInPage`
fixture uses it to sign in without a mailbox ([`docs/testing.md`](../../docs/testing.md)).

It is mounted **only** when `testRoutesEnabled(env)` — `NODE_ENV === "test"` **and**
`ENABLE_TEST_ROUTES=1`. In that mode `src/index.ts` wraps the mail sender in a `CaptureMailSender`
(messages are recorded in memory *and* still forwarded to the console sender), and the app logs
`test routes enabled …` at `warn`. The route is not part of `AppType`. As a second, independent
guard, `src/env.ts` refuses to boot with `ENABLE_TEST_ROUTES` set when `NODE_ENV=production`
(`ENABLE_TEST_ROUTES: Cannot be set when NODE_ENV=production`, exit 1), even if other variables
are also invalid. Start the api in this mode by hand with:

```sh
NODE_ENV=test ENABLE_TEST_ROUTES=1 PORT=3811 DATABASE_URL=$TEST_DATABASE_URL \
  WEB_ORIGIN=http://localhost:4193 BETTER_AUTH_URL=http://localhost:3811 bun src/index.ts
```

### Cookie strategy

- **Local development**: web and api are made same-origin by the Vite dev proxy, so no
  `COOKIE_DOMAIN`, `SameSite=Lax`, not `Secure`.
- **Production (target)**: `app.<parent>` (Vercel) and `api.<parent>` (Railway) share the cookie
  via `COOKIE_DOMAIN=.<parent>` (`advanced.crossSubDomainCookies`); cookies are `Secure` whenever
  `NODE_ENV=production`. **Today (since 2026-09-04)** there is no parent domain —
  `teaching-journey-web.vercel.app` ↔ `api-production-903f.up.railway.app` — so production runs the
  unrelated-origins mode below (`COOKIE_SAMESITE=none`, `COOKIE_DOMAIN` unset); switch to `lax` +
  `COOKIE_DOMAIN` once the domain exists (ADR 0008 amendment, `infra/README.md`).
- **Unrelated origins** (Vercel preview ↔ Railway PR environment `ai-teacher-pr-<n>`, and
  production until the domain): `COOKIE_SAMESITE=none` — `sessionCookieAttributes()` then emits
  `SameSite=None; Secure` (Secure forced, since browsers drop `None` without it) and `createAuth`
  logs a warning at boot. Leave `COOKIE_DOMAIN` unset.
- Cookie names are prefixed `tj.`; `trustedOrigins` is `WEB_ORIGIN` + `WEB_ORIGIN_PATTERNS`
  (better-auth understands the same `*` globs), so requests carrying an `Origin` outside those
  are rejected by better-auth's CSRF check.
- Trade-off of the cookie cache: after sign-out, a client that keeps replaying its old
  `tj.session_data` cookie is still accepted for up to `cookieCache.maxAge` (300 s). Browsers do
  not do this — sign-out clears both cookies.

### `requireSession`

`requireSession(auth, db, { allowHeaderShim })` (`src/auth/require-session.ts`) is mounted
path-scoped in `app.ts` through the `PROTECTED_PATHS` list — `/me`, `/me/*`, `/jobs/*`, `/events`,
`/files/*` — right after the `rejectCrossSiteRequests` guard (TEACH-77). Add new protected prefixes
to that list only. `allowHeaderShim` is `env.ALLOW_WORKSPACE_HEADER_SHIM === "1"` (dev/test only;
refused in production): it is the sole place the `x-tj-workspace-id` header is honoured. After it
runs:

| `c.get(…)` | Value |
| ---------- | ----- |
| `"user"` | better-auth user: `{ id, email, name, emailVerified, image, createdAt, updatedAt }` |
| `"session"` | better-auth session: `{ id, token, userId, expiresAt, ipAddress, userAgent, … }` |
| `"workspaceId"` | the caller's personal `WorkspaceId` — what `forWorkspace()` / `getWorkspaceId(c, { allowHeaderShim: false })` should use downstream (never re-read the header) |

No session → `401 { error: { code: "unauthorized", message: "You need to sign in to do that.", retryable: false, requestId } }`.
`createApp({ auth })` is optional: without an `Auth`, `/auth/*` is not mounted and every
protected path answers 401 (unit tests of public routes).

### Personal workspace

`databaseHooks.user.create.after` calls `createPersonalWorkspace(db, user.id)`
(`src/auth/workspace-hook.ts`), inserting `workspaces { id: newId(), owner_user_id, name: "Personal" }`
with `ON CONFLICT (owner_user_id) DO NOTHING` — the unique index on `workspaces.owner_user_id`
(migration `0001_auth`) encodes the MVP rule of one personal Workspace per user; F17 relaxes it.
`requireSession` also creates the Workspace if it is missing, and `index.ts` runs
`logUsersWithoutWorkspace()` at boot, which warns with a count if any user has none.

Tests: `@tj/db/testing` exports `createTestUserWithWorkspace(unsafeDb, opts?)` (inserts a `users`
row directly plus its Workspace) and `issueSessionCookie(auth, userId)` (returns a `Cookie` header
value signed by the real better-auth instance). `src/mail` exports `CaptureMailSender` to read the
magic link out of the "sent" email. See `src/auth.db.test.ts`.

### Upgrading better-auth

`better-auth` is pinned exactly (`apps/api` and `packages/api-client` must match). After bumping:
`bunx @better-auth/cli@latest generate --config <file exporting auth> --output /tmp/auth.ts` and
diff against `packages/db/src/schema/auth.ts` (keep `timestamptz` and the snake_case index
names), then `bun run --cwd packages/db db:generate` for a migration if columns changed. Run
`bun run --filter=@tj/api test` — `auth.db.test.ts` covers the whole flow against Postgres.

## Jobs & events (TEACH-19, ADR 0006/0012)

The API **enqueues** pg-boss jobs and **streams** their events; it never runs them
(`apps/worker` does). `src/index.ts` builds the pg-boss context (`createBoss` → `start` →
`ensureQueues`) and an events runtime, and passes both to `createApp({ env, db, logger, jobs,
events })`. Without `jobs` (unit tests) every route below answers `503 service_unavailable`.

| Route                        | Response                                                            |
| ---------------------------- | ------------------------------------------------------------------- |
| `POST /jobs/ping`            | body `{ message, steps?, failAt? }` (`PingPayloadSchema`, strict) → `202 { jobId }`; `409 conflict` when a singleton key deduplicated the send |
| `POST /jobs/ai-ping`         | body `{ class? }` (`AiPingPayloadSchema`, strict) → `202 { jobId }`; triggers an AI model call in the worker |
| `POST /jobs/:id/cancel`      | `202 { status }` with `status` ∈ `cancelled` (never started; event written here) \| `cancelling` (running; the worker emits `cancelled` within ~250 ms) \| `already_finished` \| `not_found` |
| `GET /jobs/:id/events`       | SSE for one job; closes after a terminal event                       |
| `GET /events`                | SSE firehose for the caller's Workspace; never closes                |

`:id` must be a UUID (`400 validation_failed`, `fields: ["id"]`). A job is visible only through
its own Workspace: the routes look for at least one `job_events` row via
`forWorkspace(workspaceId)` and answer `404 not_found` otherwise — another tenant cannot tell a
missing job from a foreign one.

### AI request limit

`POST /jobs/ai-ping` has an in-memory, per-Workspace fixed-window limit: 10 requests per 60
seconds by default. Set `AI_RATE_LIMIT_PER_WORKSPACE` and
`AI_RATE_LIMIT_WINDOW_S` to tune it. An over-limit request returns `429 rate_limited`,
`retryable: true`, and `Retry-After` in seconds before validation or any model call runs.

### SSE protocol

```
id: 42
event: progress
data: {"type":"progress","jobId":"…","workspaceId":"…","at":"…","progress":{"percent":33,"message":"step 1/3"}}
```

- `id` is the `job_events.id` (bigserial, monotonic per database); `event` is the job event type
  (`queued | started | progress | completed | failed | cancelled`); `data` is the full `JobEvent`
  from `@tj/domain`.
- **Replay**: on connect the API sends rows with `id > Last-Event-ID` (all rows when the header is
  absent or not a non-negative integer), at most `EVENTS_REPLAY_LIMIT` of them, then switches to
  live delivery. `EventSource` sends `Last-Event-ID` automatically on reconnect, so no event is
  lost or duplicated across drops.
- **Live path**: the worker `INSERT`s a row then `NOTIFY job_events` with `{ id, jobId,
  workspaceId }`. The API keeps one `LISTEN` per process (`src/events/listener.ts`, a dedicated
  `max: 1` connection started lazily on the first stream) and fans notifications out through an
  in-memory hub (`src/events/hub.ts`). Each stream then re-reads `job_events` with
  `afterId: lastSent`, so the wire payload always comes from the table.
- **Terminal close**: `GET /jobs/:id/events` ends after `completed`, `failed` or `cancelled`.
  `GET /events` stays open.
- **Heartbeat**: a `: ping` comment every `EVENTS_HEARTBEAT_MS` keeps proxies from idling the
  connection out. Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`,
  `X-Accel-Buffering: no`, `Connection: keep-alive`; CORS (credentials) applies as elsewhere and
  `Last-Event-ID` is an allowed request header.
- **Degraded mode**: if `LISTEN` cannot be established the listener retries with backoff
  (500 ms → 10 s) and marks the hub degraded; while degraded every open stream polls
  `job_events` every `EVENTS_POLL_MS`. Delivery continues, only latency changes.
- **Limits**: at most `EVENTS_MAX_STREAMS_PER_WORKSPACE` concurrent streams per Workspace;
  beyond that `429 rate_limited` (`retryable: true`). Slots are released when the client
  disconnects, the job finishes, or the process shuts down (streams are ended before
  `server.stop()` so shutdown never waits on an open firehose).

### Workspace seam (`src/workspace.ts`)

`getWorkspaceId(c, { allowHeaderShim })` is how every tenant route learns the caller's Workspace:

1. `c.get("workspaceId")` when set — **TEACH-20's `requireSession` sets it** after verifying the
   session cookie.
2. Otherwise, only when `ALLOW_WORKSPACE_HEADER_SHIM=1`, the `x-tj-workspace-id` header (must be a
   UUID, else `400 bad_request`). `requireSession` honours this shim when no session cookie is
   present, so curl and integration tests can pick a Workspace without signing in. The flag is
   refused in production.
3. Otherwise `401 unauthorized`.

### Config knobs (`src/events/config.ts`)

Read from `process.env` with Zod defaults (`EVENTS_MAX_STREAMS_PER_WORKSPACE` 20,
`EVENTS_REPLAY_LIMIT` 500, `EVENTS_HEARTBEAT_MS` 15000, `EVENTS_POLL_MS` 1000); declared in the env
contract ([`docs/env.md`](../../docs/env.md)) and documented commented-out in `.env.example`.

Integration tests (`src/routes/jobs.integration.test.ts`) run a real pg-boss on schema
`pgboss_test` plus an in-test worker loop and skip visibly when `TEST_DATABASE_URL` is unreachable.
They create and use a dedicated database `<test database>_api` (derived from `TEST_DATABASE_URL`)
because turbo runs the `@tj/db` / `@tj/jobs` suites in parallel and those truncate the shared test
database between tests.
