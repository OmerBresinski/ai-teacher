# P0 — Monorepo Scaffolding: ticket map

Linear project: **P0 — Monorepo Scaffolding** (team Teacher AI). Tickets use the Agentic Task template.

| Tier | Ticket | Scope | Blocked by |
| ---- | -------- | ----- | ---------- |
| 0 | TEACH-11 | Bootstrap: Bun workspaces, Turborepo, Biome, `@tj/config`, lefthook + commitlint, GitHub repo | — |
| 1 | TEACH-27 | Install agent skills (TanStack Router/Query, shadcn, Hono, Vercel, Railway) + `AGENTS.md` per app | 11 |
| 1 | TEACH-12 | `@tj/domain`: object skeletons, IDs, job names/events, `StorageAdapter` | 11 |
| 1 | TEACH-13 | `@tj/ui`: Tailwind v4 + shadcn plumbing, theme switching | 11, 27 |
| 1 | TEACH-18 | Local dev env: docker-compose (PG+pgvector), `setup`/`doctor`/`dev`, env scaffolding | 11 |
| 2 | TEACH-14 | `@tj/db`: Drizzle, migrations, `forWorkspace()` | 11, 12, 18 |
| 2 | TEACH-15 | `@tj/storage`: local disk + Vercel Blob | 11, 12 |
| 3 | TEACH-16 | `apps/api` (Hono) + `@tj/api-client` | 12, 14, 27 |
| 3 | TEACH-17 | `apps/worker` + `@tj/jobs` (pg-boss, ping job, events) | 12, 14, 27 |
| 4 | TEACH-19 | Job endpoints + SSE with replay | 16, 17 |
| 4 | TEACH-20 | Auth skeleton (better-auth, personal workspace) | 14, 16 |
| 4 | TEACH-21 | `apps/web` (Vite + React, TanStack Router code-based) | 13, 16, 27 |
| 5 | TEACH-22 | Test harness (Vitest, bun test DB, Playwright + axe) | 19, 20, 21 |
| 5 | TEACH-24 | Dockerfile + Railway (api, worker, PG, PR envs) | 16, 17, 20, 27 |
| 5 | TEACH-25 | Vercel deploy (SPA, previews, Speed Insights) | 21, 27 |
| 6 | TEACH-23 | CI: GitHub Actions, bundle budget, audit, secrets | 18 (+22) |
| 6 | TEACH-26 | Env contract + Railway/Vercel wiring; local compose path self-contained | 18, 24, 25 |

Critical path: 11 → 18 → 14 → 16 → 20 → 22 → 23.

Next project after P0: **F18 App Shell & Command Surface** (Implementation Order build_order 1), then F13, F15, F17.
