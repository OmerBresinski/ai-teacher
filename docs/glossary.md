# Glossary

Shared vocabulary for the Teaching Journey codebase. Product terms are copied from the Master PRD §19 so code, tickets and PRDs use the same words; engineering terms are defined here first.

## Product terms (from the Master PRD)

- **Journey** — the plan from goal to outcome across N lessons; the product's central object. Typed and versioned.
- **Progression** — the ordered, dependency-aware set of Concepts a Journey covers (a DAG).
- **Concept** — a unit of understanding with prerequisites, objectives and typical misconceptions; a node in the Progression.
- **Lesson** — an ordered session in the Journey covering one or more Concepts.
- **Artefact** — a generated document that is a projection of a Lesson + Journey (plan, notes, slides, worksheet, quiz, exit ticket, …). Carries a derived-from lineage and a review state.
- **Artefact set** — all Artefacts for one Lesson, generated coherently from the same plan.
- **Cohort Profile** — class-level description of who is being taught; never individual.
- **Observation** — class-level evidence of understanding recorded after teaching.
- **Adaptation** — proposed and accepted changes to future Lessons based on Observations.
- **Source** — a teacher-provided material (file/URL) used for grounding.
- **Skill** — a packaged pedagogical capability the runtime calls (F13).
- **Knowledge node** — an entry in the progressions/misconceptions graph (F05).
- **Workspace** — the container for a user's Journeys, Sources and settings. One personal Workspace per user at MVP.
- **Class-level** — data about the group as a whole, never attributable to an individual learner.
- **Reviewed** — the teacher has opened, checked and confirmed an Artefact; unlocks the "AI-assisted, teacher-reviewed" export label.
- **Draft / Reviewed / Stale / Taught / Needs attention** — the universal state vocabulary (F18-R07); the same chips everywhere.
- **Provenance** — machine- and human-readable indication that content was produced with AI and reviewed by a named role.
- **Identifier guard** — shared component that blocks learner names, IDs, emails and identifying phrases in free text (F15-R03).

## Engineering terms

- **App** — a deployable unit under `apps/` (`web`, `api`, `worker`).
- **Package** — an internal library under `packages/`, scoped `@tj/*`, never published.
- **Domain package** (`@tj/domain`) — Zod schemas and TypeScript types for the product objects above, plus job-name constants and the `StorageAdapter` interface. Depends on nothing internal.
- **Scoped DB** — the `forWorkspace(workspaceId)` query interface from `@tj/db` that always applies the tenant predicate (ADR 0007). The only permitted way to query tenant tables.
- **Tenant table** — any table with a `workspace_id` column. Non-tenant tables (users, sessions, workspaces, pg-boss internals) are listed explicitly in `packages/db`.
- **Job** — a unit of background work enqueued by the API and executed by the worker via pg-boss (ADR 0006). Job names are constants in `@tj/domain`.
- **Job event** — a progress record (`queued`, `started`, `progress`, `completed`, `failed`, `cancelled`) emitted by the worker and streamed to clients over SSE (ADR 0012).
- **Activity tray** — the UI surface listing running and completed jobs (F18-R04); consumes job events.
- **Route tree** — the code-based TanStack Router definition in `apps/web/src/router.ts` (ADR 0004).
- **AppType** — the exported type of the Hono router used by the Hono RPC client (ADR 0005).
- **Env schema** — the Zod schema in each app's `src/env.ts` that validates configuration at boot (ADR 0015).
- **Preview environment** — a per-PR deployment: Vercel preview for `web`, Railway PR environment for `api`/`worker` (ADR 0010).
- **ADR** — Architecture Decision Record under `docs/adr/`; engineering decisions only. Product decisions live in Notion.
