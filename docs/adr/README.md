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
| 0019 | Adopt the TeachDeck visual system in @tj/ui; shell and editor kits | Accepted, amended 2026-09-06 (×2) |
| 0020 | Library screens run on an in-memory mock data layer behind TanStack Query | Accepted (amended 2026-09-06) |
| 0021 | Tie-in document contract: TeachDeck schemas in @tj/domain | Accepted (amended 2026-09-06) |
| 0022 | @tj/editor: package boundary, kit rule, state model and fonts | Accepted |
| 0023 | Export pipeline: client-side exporters, SPA print routes, JSON import | Accepted |
| 0024 | Document persistence and the lesson brief: `documents` table, document API, `POST /lessons` | Accepted |

Template: `0000-template.md`.

## Amendments

- 2026-09-04 — ADR 0011: private Artefact/Source downloads go through the API proxy `GET /files/:key` (session + workspace-scoped key); Vercel Blob has no time-limited signed URLs for private blobs. See the amendment section in `0011-vercel-blob.md`.
- 2026-09-04 — ADR 0013: `packages/jobs` (`@tj/jobs`) and `packages/storage` (`@tj/storage`) added to the package map. See the amendment section in `0013-monorepo-layout.md`.
- 2026-09-04 — ADR 0013: `packages/ai` (`@tj/ai`) added to the package map (ADR 0018). See the second amendment section in `0013-monorepo-layout.md`.
- 2026-09-04 — ADR 0016: item 5, model inference in AWS `us-east-1` (ADR 0018) widens the data-residency deviation; same revisit date. See `0016-prd-deviations.md`.
- 2026-09-06 — ADR 0019 §4: filled primary controls use TeachDeck's white-on-terracotta as a recorded contrast exception. See `0019-teachdeck-visual-system.md`.
- 2026-09-05 — ADR 0009: `@tj/ui` adopts the TeachDeck visual system and separates the shell and editor kits (ADR 0019). See `0009-tailwind-shadcn.md`.
- 2026-09-06 — ADR 0019 §3 and §5: the stage palette moves to `@tj/ui` as the `.tj-stage` scope and the editor consumes `@tj/ui` twins (ADR 0022). See the second amendment in `0019-teachdeck-visual-system.md`.
- 2026-09-06 — ADR 0020: `@tj/domain` holds the document schemas (ADR 0021); the mock store holds full documents; "no Zustand" covers the editor (ADR 0022). See `0020-frontend-mock-data-layer.md`.
- 2026-09-06 — ADR 0021 §1: the schemas live at `@tj/domain/documents` (subpath only); the `objects/lesson.ts` row stub is kept (TEACH-96). See the amendment in `0021-tie-in-document-contract.md`.
- 2026-09-06 — ADR 0013: `packages/editor` (`@tj/editor`) added to the layout (ADR 0022, TEACH-98). See the third amendment in `0013-monorepo-layout.md`.
- 2026-09-06 — ADR 0021: the three deferred questions (row shape, summary shape, migrate() timing) are answered by ADR 0024. See the second amendment in `0021-tie-in-document-contract.md`.
- 2026-09-06 — ADR 0020: the mock data layer is retired by ADR 0024 §9; `@tj/api-client` calls replace it behind the same query options. See the second amendment in `0020-frontend-mock-data-layer.md`.
