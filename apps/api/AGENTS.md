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

## Lesson and brief routes

| Route | File | Decided by |
| ----- | ---- | ---------- |
| `POST /lessons` | `routes/lessons.ts` — creates the row, `plan.revision` 1, enqueues `lesson.plan`; `skipPlanning`, `requestId` | ADR 0024 §6, ADR 0029 |
| `POST /lessons/:id/plan` | `routes/lessons.ts` — re-plan, compare-and-set on `expectedRevision`; body changes in `routes/plan-patches.ts` | ADR 0029 |
| `POST /lessons/:id/generate` | `routes/lessons.ts` — confirm the plan, enqueue `lesson.generate` (or a pinned `lesson.plan` on a shape change) | ADR 0029 |
| `POST /lessons/:id/worksheet` | `routes/lessons.ts` — no lesson lock; reads the confirmed plan at `expectedRevision`, resolves `"auto"` with `@tj/slides`, locks a worksheet row (a `framed` one reused, else a new shell) and enqueues `lesson.worksheet` with a 30 s `singletonKey` slot | ADR 0030 |
| `GET /lessons/:id/worksheets` | `routes/lessons.ts` — the lesson's worksheets from `documents.lesson_id`, each with `generatingJobId` and `generation`; no limiter | ADR 0030 |
| `POST /lessons/:id/cascade`, `/regenerate` | `routes/lessons.ts` — unlocked proposal jobs | ADR 0025 §18 |
| `POST /briefs/parse` | `routes/briefs.ts` (TEACH-16) — rules, then one `small` call under 2 s; stateless | ADR 0029 item 13 |

- **Plan changes go through `setPlanRevisionAndLock`** (`@tj/db`): the revision check and the new
  lock are one write. `stale` → `409 stale`; the lock held by a plan job → `409 planning`, except
  that `/plan` passes `supersedeProposal` and takes a running proposal's lock (ADR 0029 items 4,
  5, 7).
- **Register `aiLimiter` per path** in `app.ts`, never on `/lessons/*` (it also matches
  `/lessons` and would charge a brief twice). `/briefs` and `/briefs/*` are in `PROTECTED_PATHS`.
- **`/worksheet` never touches the lesson row** (ADR 0030 item 1): no `setPlanRevisionAndLock`,
  no `updated_at` bump; the lock it takes is the worksheet's (`createDocument` with
  `generatingJobId`, or `relockWorksheet`). A recipe outside `WORKSHEET_RECIPE_IDS` is `422`.
- Log ids, revisions, counts and booleans only — never brief, objective or parse-box text
  (ADR 0015).
