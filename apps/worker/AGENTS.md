# AGENTS.md — `apps/worker` (`@tj/worker`)

pg-boss consumer on Bun. Runs generation and other background jobs; exposes no HTTP surface beyond
a health endpoint. Read the root [`AGENTS.md`](../../AGENTS.md) first. Scaffolded by TEACH-17.

## Skills to load (in `./.agents/skills/`)

| Skill | Load when… |
| ----- | ---------- |
| `use-railway` | Railway service config, start command, variables, Postgres, PR environments |
| `ai-sdk` | calling a model or touching AI SDK code |

## Constraints that override the skills

- **ADR 0006 — sole pg-boss consumer.** Only this app calls `boss.work(...)`. `apps/api` enqueues;
  this app consumes. Job names are constants from `@tj/domain`; payloads are Zod-validated before
  a handler runs. Queues live in the same Postgres — no Redis or other broker.
- **ADR 0012 — job events.** Handlers publish `started` / `progress` / `completed` (and failure)
  events for each job (job-events table or pg-boss completion hooks); the API fans them out over
  SSE. Never open an HTTP stream to clients from here.
- **ADR 0018 — AI provider.** Provider is `@tj/ai` `createAi`; handlers use `deps.ai.model(cls)`
  and pass `signal` as `abortSignal`. Never import `@ai-sdk/*` directly in apps, use the Vercel AI
  Gateway, or log prompt/completion text. Model IDs come from `AI_MODEL_*`.
- **Never import from `apps/api`.** Share code only through packages (`@tj/domain`, `@tj/db`,
  `@tj/jobs`, …). Dependency direction is apps → packages.
- ADR 0007: tenant tables only through `forWorkspace(workspaceId)` from `@tj/db`.
- ADR 0015: `src/env.ts` validates env with Zod at boot; `pino` structured logs; never log prompt
  or content bodies.
- ADR 0010: deploys to Railway (EU-West) as a second service from the same root `Dockerfile` with
  a different start command; PR environments pair with the API's.
- Tests: `bun test` (ADR 0014).

## Jobs

`src/jobs/index.ts` is the registry; every `JobName` needs a handler (a missing key does not
compile).

| Job | Handler | Decided by |
| --- | ------- | ---------- |
| `ping`, `ai.ping` | `ping.ts`, `ai-ping.ts` | ADR 0012, 0018 (demo) |
| `lesson.plan` | `lesson-plan.ts` — check-input and Plan; stops at `planned` when the payload has `stopAfter`, otherwise runs the whole pipeline | ADR 0025 §5, ADR 0029 |
| `lesson.generate` | TEACH-13 (placeholder today) — Generate (slides only), Illustrate, Evaluate, Repair from `planned` | ADR 0029 |
| `lesson.worksheet` | TEACH-14 (placeholder today) — frame, fill, check one worksheet on its own row, lock and budget | ADR 0030 |
| `lesson.cascade`, `lesson.regenerate` | `lesson-cascade.ts`, `lesson-regenerate.ts` — unlocked proposal jobs | ADR 0025 §18 |

- **A job owns its row through the lock.** Write with `putDocumentAsJob`; `lost_lock` or
  `missing` → `NonRetryableError`, write nothing further. A plan or generate job whose payload
  `revision` is not the row's `plan.revision` refuses to start (ADR 0029 items 4–5).
- **`lesson.worksheet` never writes the lesson row** and charges `AI_WORKSHEET_COST_CAP_USD`, not
  the lesson's cap (ADR 0030 item 1).
