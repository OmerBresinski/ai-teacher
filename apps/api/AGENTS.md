# AGENTS.md — `apps/api` (`@tj/api`)

Hono application on Bun. The typed contract for `apps/web` (Hono RPC). Read the root
[`AGENTS.md`](../../AGENTS.md) first. Scaffolded by TEACH-16.

## Skills to load (in `./.agents/skills/`)

| Skill | Load when… |
| ----- | ---------- |
| `hono` | routes, middleware, validation, `streamSSE`, testing, RPC types |
| `use-railway` | Railway service config, variables, Postgres, PR environments, deploy failures |
| `ai-sdk` | calling a model or touching AI SDK code |

## Constraints that override the skills

- **ADR 0005 — Hono RPC is the API contract.** Build routers by **chaining**
  (`new Hono().get(...).post(...)`) so the route types are preserved; compose feature routers
  with `.route("/prefix", featureRouter)`; **export `AppType`** (`export type AppType = typeof
  app`) and re-export it from `packages/api-client`, which `apps/web` consumes via `hc<AppType>()`.
  Validate input with `@hono/zod-validator` on every route. Do not add a second framework or
  OpenAPI generator; if a public API is needed later, add `hono-openapi` on the same routes.
- Routes are grouped by feature under `src/routes/`.
- **ADR 0018 — AI provider.** Provider is `@tj/ai` `createAi`; callers use `ai.model(cls)` and
  pass `abortSignal`. Never import `@ai-sdk/*` directly in apps, use the Vercel AI Gateway, or log
  prompt/completion text. Model IDs come from `AI_MODEL_*`.
- **ADR 0015 — env + logging.** `src/env.ts` parses `process.env` with Zod and throws on boot when
  values are missing/invalid; `.env.example` is committed here. Logging is `pino` structured JSON
  with a request-id middleware (`pino-pretty` in dev). **Never log prompt or content bodies.**
- **ADR 0007 — tenancy.** Every tenant table is accessed through `forWorkspace(workspaceId)` from
  `@tj/db`; never query tenant tables with the raw Drizzle client.
- ADR 0006: this app only **enqueues** pg-boss jobs (names from `@tj/domain`); it never consumes
  them. ADR 0012: progress is streamed with `streamSSE` (`GET /jobs/:id/events`, per-workspace
  `GET /events`), supporting `Last-Event-ID` replay.
- ADR 0010: deploys to Railway (EU-West) from the root `Dockerfile`; CORS allows the Vercel
  production and preview origins only; cookies are shared across `app.<domain>` / `api.<domain>`.
- Tests: `bun test`; integration tests hit the docker-compose Postgres with a per-run schema
  (ADR 0014).
