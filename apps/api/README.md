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
to stderr (for example `DATABASE_URL: Required`) and exits 1 — no stack trace. `.env.example` is
committed; `bun run setup` copies it to `.env`. Bun loads `.env` from the **cwd only** (turbo does
not load env files), so the API reads `apps/api/.env`.

| Variable       | Default                 | Notes                                                     |
| -------------- | ----------------------- | --------------------------------------------------------- |
| `NODE_ENV`     | `development`           | `development` \| `test` \| `production`; pretty logs in development only |
| `PORT`         | `3001`                  | coerced to an integer                                     |
| `DATABASE_URL` | — (required)            | Postgres URL; `/health` runs `select 1` on it              |
| `WEB_ORIGIN`   | `http://localhost:5173` | comma-separated browser origins allowed by CORS → `string[]` |
| `LOG_LEVEL`    | `info`                  | pino level (`fatal` … `trace`, `silent`)                   |

`TEST_DATABASE_URL` is read only by the tests (`@tj/db/testing`), never by the server.

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
3. **CORS** — origins from `env.WEB_ORIGIN`, `credentials: true`, `maxAge: 600`. Requests from any
   other origin receive **no** CORS headers at all.
4. **`secureHeaders()`**.
5. **Routes** — chained feature routers from `src/routes/`.
6. **`notFound` / `onError`** — the envelope below.

Mount points (search for the ticket ids in `src/app.ts`):

- `// TEACH-20: mount /auth/* and requireSession here`
- `// TEACH-19: mount /jobs and /events here` (`streamSSE`, `Last-Event-ID` replay — ADR 0012)
- `// TEACH-15 follow-up: GET /files/:key proxy` (over the `StorageAdapter`)

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

## `AppType` and `@tj/api-client`

`src/app.ts` exports `type AppType`. `package.json#exports` exposes `./app` → `./src/app.ts` so
`packages/api-client` can `import type { AppType } from "@tj/api/app"` (type-only; nothing from the
server ends up in a browser bundle). See `packages/api-client/README.md`.
