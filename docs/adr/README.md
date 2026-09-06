# Architecture Decision Records

Decisions made for the Teaching Journey (working name "AI Teacher") codebase. Each ADR is small and immutable; supersede rather than edit.

Product decisions are the founder's and are not recorded here. ADRs cover engineering decisions only, and reference the product decision they implement or deviate from.

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
| 0009 | Tailwind + shadcn/ui as the design-system base     | Accepted (amended 2026-09-05) |
| 0010 | Hosting: Vercel (web) + Railway (api, worker, PG)  | Accepted |
| 0011 | Vercel Blob for object storage                     | Accepted (amended 2026-09-04) |
| 0012 | Server-sent events for generation progress         | Accepted |
| 0013 | Monorepo layout and @tj/* package scope            | Accepted (amended 2026-09-04) |
| 0014 | Testing: bun test, Playwright (Vitest retired)     | Accepted |
| 0015 | Env validation, logging, commit conventions        | Accepted |
| 0016 | Deviations from PRD accepted for MVP scaffolding   | Accepted (amended 2026-09-04) |
| 0017 | Agent skill layout: .agents canonical + symlinks   | Accepted |
| 0018 | AI provider: Amazon Bedrock via Vercel AI SDK in @tj/ai | Accepted |
| 0019 | Adopt the TeachDeck visual system in @tj/ui; shell and editor kits | Accepted |
| 0020 | Library screens run on an in-memory mock data layer behind TanStack Query | Accepted |

Template: `0000-template.md`.

## Amendments

- 2026-09-04 — ADR 0011: private Artefact/Source downloads go through the API proxy `GET /files/:key` (session + workspace-scoped key); Vercel Blob has no time-limited signed URLs for private blobs. See the amendment section in `0011-vercel-blob.md`.
- 2026-09-04 — ADR 0013: `packages/jobs` (`@tj/jobs`) and `packages/storage` (`@tj/storage`) added to the package map. See the amendment section in `0013-monorepo-layout.md`.
- 2026-09-04 — ADR 0013: `packages/ai` (`@tj/ai`) added to the package map (ADR 0018). See the second amendment section in `0013-monorepo-layout.md`.
- 2026-09-04 — ADR 0016: item 5, model inference in AWS `us-east-1` (ADR 0018) widens the data-residency deviation; same revisit date. See `0016-prd-deviations.md`.
- 2026-09-05 — ADR 0009: `@tj/ui` adopts the TeachDeck visual system and separates the shell and editor kits (ADR 0019). See `0009-tailwind-shadcn.md`.
