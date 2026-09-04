# Architecture Decision Records

Decisions made for the Teaching Journey (working name "AI Teacher") codebase. Each ADR is small and immutable; supersede rather than edit.

Product decisions live in Notion (Master PRD §17 and each feature PRD's "Decisions" table). ADRs here cover engineering decisions only, and reference the product decision they implement or deviate from.

| #    | Title                                              | Status   |
| ---- | -------------------------------------------------- | -------- |
| 0001 | Bun runtime and workspaces                         | Accepted |
| 0002 | Turborepo for task orchestration                   | Accepted |
| 0003 | Biome for lint and format                          | Accepted |
| 0004 | Vite + React SPA with TanStack Router (code-based) | Accepted |
| 0005 | Hono on Bun with Hono RPC as the API contract      | Accepted |
| 0006 | Postgres + Drizzle; pg-boss for jobs               | Accepted |
| 0007 | Workspace tenancy via workspace_id and scoped DB   | Accepted |
| 0008 | better-auth for identity                           | Accepted |
| 0009 | Tailwind + shadcn/ui as the design-system base     | Accepted |
| 0010 | Hosting: Vercel (web) + Railway (api, worker, PG)  | Accepted |
| 0011 | Vercel Blob for object storage                     | Accepted |
| 0012 | Server-sent events for generation progress         | Accepted |
| 0013 | Monorepo layout and @tj/* package scope            | Accepted |
| 0014 | Testing: bun test, Vitest, Playwright              | Accepted |
| 0015 | Env validation, logging, commit conventions        | Accepted |
| 0016 | Deviations from PRD accepted for MVP scaffolding   | Accepted |
| 0017 | Agent skill layout: .agents canonical + symlinks   | Accepted |

Template: `0000-template.md`.

## Amendments

- 2026-09-03 — The default branch is **`master`**, not `main` (founder decision; the GitHub repo `OmerBresinski/ai-teacher` was created with `master` and is not renamed). Read `main` in ADR 0015 as `master`.
