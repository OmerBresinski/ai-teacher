# AGENTS.md — `apps/worker` (`@tj/worker`)

pg-boss consumer on Bun. Runs generation and other background jobs; exposes no HTTP surface beyond
a health endpoint. Read the root [`AGENTS.md`](../../AGENTS.md) first. Scaffolded by TEACH-17.

## Skills to load (in `./.agents/skills/`)

| Skill | Load when… |
| ----- | ---------- |
| `use-railway` | Railway service config, start command, variables, Postgres, PR environments |

## Constraints that override the skills

- **ADR 0006 — sole pg-boss consumer.** Only this app calls `boss.work(...)`. `apps/api` enqueues;
  this app consumes. Job names are constants from `@tj/domain`; payloads are Zod-validated before
  a handler runs. Queues live in the same Postgres — no Redis or other broker.
- **ADR 0012 — job events.** Handlers publish `started` / `progress` / `completed` (and failure)
  events for each job (job-events table or pg-boss completion hooks); the API fans them out over
  SSE. Never open an HTTP stream to clients from here.
- **Never import from `apps/api`.** Share code only through packages (`@tj/domain`, `@tj/db`,
  `@tj/jobs`, …). Dependency direction is apps → packages.
- ADR 0007: tenant tables only through `forWorkspace(workspaceId)` from `@tj/db`.
- ADR 0015: `src/env.ts` validates env with Zod at boot; `pino` structured logs; never log prompt
  or content bodies.
- ADR 0010: deploys to Railway (EU-West) as a second service from the same root `Dockerfile` with
  a different start command; PR environments pair with the API's.
- Tests: `bun test` (ADR 0014).
