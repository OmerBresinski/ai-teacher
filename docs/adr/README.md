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
| 0011 | Vercel Blob for object storage                     | Superseded by 0026 (2026-09-07) |
| 0012 | Server-sent events for generation progress         | Accepted (amended 2026-09-06, 2026-09-16) |
| 0013 | Monorepo layout and @tj/* package scope            | Accepted (amended 2026-09-06, 2026-09-12) |
| 0014 | Testing: bun test, Playwright (Vitest retired)     | Accepted |
| 0015 | Env validation, logging, commit conventions        | Accepted |
| 0016 | Deviations from PRD accepted for MVP scaffolding   | Accepted (amended 2026-09-04) |
| 0017 | Agent skill layout: .agents canonical + symlinks   | Accepted |
| 0018 | AI provider: Amazon Bedrock via Vercel AI SDK in @tj/ai | Superseded by 0031 (2026-09-25) |
| 0019 | Adopt the TeachDeck visual system in @tj/ui; shell and editor kits | Accepted, amended 2026-09-06 (×2) |
| 0020 | Library screens run on an in-memory mock data layer behind TanStack Query | Accepted (amended 2026-09-06) |
| 0021 | Tie-in document contract: TeachDeck schemas in @tj/domain | Accepted (amended 2026-09-06) |
| 0022 | @tj/editor: package boundary, kit rule, state model and fonts | Accepted (amended 2026-09-13) |
| 0023 | Export pipeline: client-side exporters, SPA print routes, JSON import | Accepted (amended 2026-09-12) |
| 0024 | Document persistence and the lesson brief: `documents` table, document API, `POST /lessons` | Accepted (amended 2026-09-06, 2026-09-12, 2026-09-16) |
| 0025 | Lesson generation: LessonFacts, the `lesson.plan` pipeline, Evaluate and Repair | Accepted (amended 2026-09-12, 2026-09-16) |
| 0026 | Railway Bucket (S3-compatible) for object storage  | Accepted (amended 2026-09-12) |
| 0027 | Upload as input: `POST /sources`, `@tj/extract`, `sources` table, `SourceLoader` | Accepted (amended 2026-09-16) |
| 0028 | GSAP for the character scenes, click-loaded                        | Accepted |
| 0029 | Plan confirmation: the plan job, the generate job and plan revisions | Accepted |
| 0030 | The worksheet is an independent job                               | Accepted |
| 0031 | AI provider: OpenAI direct in @tj/ai; Bedrock kept until the planner switch | Accepted |

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
- 2026-09-06 — ADR 0022 §5: the save endpoint is `PUT /documents/:id` (ADR 0024 §7), not per-kind routes. See the amendment in `0022-editor-package-boundary-and-state.md`.
- 2026-09-06 — ADR 0012: `progress` gains `documentUpdatedAt`; `completed` gains a per-job `result` (ADR 0025 §7, §19). See the amendment in `0012-sse-progress.md`.
- 2026-09-06 — ADR 0013: `packages/slides` (`@tj/slides`) and `packages/generation` (`@tj/generation`) added to the package map (ADR 0025 §9, §17). See the fourth amendment in `0013-monorepo-layout.md`.
- 2026-09-06 — ADR 0018 §1, Consequences: `@mastra/core` adopted in-process for the lesson pipeline, no Mastra storage, server or model router; price table, `costUsd()`, `createBudget()` and richer log fields in `@tj/ai`; the eval harness starts with F06's eval set (ADR 0025 §15, §16, §21, §23). See `0018-ai-provider.md`.
- 2026-09-06 — ADR 0021 §1, §3: the theme catalogue, layout recipes and `FIT_VERSION` move to `@tj/slides` (the re-fit stays in the editor); optional `facts`, `generation`, `artefacts`, `sources`, `generatedFrom`, `authoredBy`, `Worksheet.lessonId` (ADR 0025). See the third amendment in `0021-tie-in-document-contract.md`.
- 2026-09-06 — ADR 0022 §1, §4: `@tj/slides` dependency; cascade proposals apply as one transaction (ADR 0025 §9, §18). See the second amendment in `0022-editor-package-boundary-and-state.md`.
- 2026-09-06 — ADR 0024 §13, §14, §18: `Lesson.sources` reserved as references; one `lesson.plan` job with checkpoints; the worker writes through `putDocumentAsJob` keyed on the lock; stale locks released on read (ADR 0025 §5–§7, §24). See the amendment in `0024-document-persistence-and-lesson-brief.md`.
- 2026-09-07 — ADR 0016 §1: files move from Vercel Blob (`fra1`) to a Railway Bucket in `ams` (ADR 0026); the residency statement is now "Railway EU-West" for compute, Postgres and files. See `0016-prd-deviations.md`.
- 2026-09-12 — ADR 0024 §13: `POST /lessons` gains `sourceIds` (≤ 3), resolved against the `sources` table and written to `Lesson.sources` (ADR 0027 §5). See the second amendment in `0024-document-persistence-and-lesson-brief.md`.
- 2026-09-12 — ADR 0025 §20: `SourceLocator` gains `section`; a paste has a `storageKey`; the `SourceLoader` reads `extracted.json` and Plan caps source text at 40k chars (ADR 0027 §3, §6). See the amendment in `0025-lesson-generation-pipeline.md`.
- 2026-09-12 — ADR 0023 §6, Consequences: Import posts to `POST /documents` through `libraryMutations.importDocument` (server-assigned id); exporters fetch `/files/` images with the session cookie (`include` for the api origin, `omit` elsewhere, `crossorigin` only in capture mode); imported `/files/` references from another Workspace render broken by design; locked lessons export their current state (TEACH-272). See the amendment in `0023-export-pipeline.md`.
- 2026-09-12 — ADR 0013: `packages/extract` (`@tj/extract`) added to the package map (ADR 0027 §2). See the fifth amendment in `0013-monorepo-layout.md`.
- 2026-09-12 — ADR 0026: documents store pictures as the api path `/files/<key>`; the origin is resolved at render (`ImageOriginProvider`) and export (`resolveImageSrc`), `API_PUBLIC_BASE_URL` removed, migration 0006 rewrites stored absolute URLs (TEACH-275). See the amendment in `0026-railway-bucket-storage.md`.
- 2026-09-13 — ADR 0022 §8, §9: route chunk ceilings pinned from measurement + 20% in `scripts/check-bundle-budget.ts` (lesson editor 241 KB, present 109 KB, view 91 KB, lesson print 51 KB, worksheet editor 187 KB, worksheet print 36 KB); the catalogue gap analysis and handoff e2e delivered (TEACH-113). See the fourth amendment in `0022-editor-package-boundary-and-state.md`.
- 2026-09-16 — ADR 0025 §4, §5, §7, §8, §9, §10–§12, §15, §22: the lesson pipeline splits into `lesson.plan` (stops at `planned`, Verify awaited) and `lesson.generate` behind a plan revision compare-and-set (ADR 0029); the worksheet becomes the independent `lesson.worksheet` job with its own row, lock and budget, linked by `documents.lesson_id`, and the recipes move to `@tj/slides` (ADR 0030). See the amendment in `0025-lesson-generation-pipeline.md`.
- 2026-09-16 — ADR 0024 §6, §18: `POST /lessons` writes `Lesson.plan`, takes `skipPlanning` and `requestId`, and returns `revision`; the lesson lock is released at `planned` and retaken by `POST /lessons/:id/generate`; a worksheet row has its own lock (ADRs 0029, 0030). See the amendment in `0024-document-persistence-and-lesson-brief.md`.
- 2026-09-16 — ADR 0012: `progress` gains `stage` (ADR 0029 item 14). See the amendment in `0012-sse-progress.md`.
- 2026-09-16 — ADR 0027 §5: sources may change after creation through `POST /lessons/:id/plan`, released one by one with `unbindSource`; still at most three per lesson (ADR 0029 item 12). See the amendment in `0027-upload-as-input.md`.
- 2026-09-16 — ADR 0015 (by reference, file unchanged): the new routes and jobs log ids, revisions, counts and booleans only; `POST /briefs/parse` logs `{ rules, model, dropped, ms }` (ADR 0029 item 15).
- 2026-09-25 — ADR 0016 §1 item 5: model inference moves from Amazon Bedrock (`us-east-1`) to OpenAI's API (US) in flight (ADR 0031); OpenAI replaces AWS as the sub-processor of lesson content in the F15-R01 data-flow statement; same revisit date. See the amendment in `0016-prd-deviations.md`.
