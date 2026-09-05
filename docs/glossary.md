# Glossary

Shared vocabulary for the Teaching Journey codebase. Product terms are copied from the Master PRD §19 so code, tickets and PRDs use the same words; engineering terms are defined here first.

## Product terms (from the Master PRD)

- **Adaptation** — proposed and accepted changes to future Lessons based on Observations.
- **Artefact** — a generated document that is a projection of a Lesson + Journey (plan, notes, slides, worksheet, quiz, exit ticket, …). Carries a derived-from lineage and a review state.
- **Artefact set** — all Artefacts for one Lesson, generated coherently from the same plan.
- **Class-level** — data about the group as a whole, never attributable to an individual learner.
- **Cohort Profile** — class-level description of who is being taught; never individual.
- **Concept** — a unit of understanding with prerequisites, objectives and typical misconceptions; a node in the Progression.
- **Draft / Reviewed / Stale / Taught / Needs attention** — the universal state vocabulary (F18-R07); the same chips everywhere.
- **Identifier guard** — shared component that blocks learner names, IDs, emails and identifying phrases in free text (F15-R03).
- **Journey** — the plan from goal to outcome across N lessons; the product's central object. Typed and versioned. *(superseded by Series — TD decision D-001, 2026-09-05; the term remains in package/ADR names for history)*
- **Knowledge node** — an entry in the progressions/misconceptions graph (F05).
- **Lesson** — an ordered session in the Journey covering one or more Concepts. In the editor, it is a slide deck with 960×540-point slides plus notes; the Library shows it as a card.
- **Library** — the signed-in home: Home plus the kind pages.
- **Observation** — class-level evidence of understanding recorded after teaching.
- **Progression** — the ordered, dependency-aware set of Concepts a Journey covers (a DAG).
- **Provenance** — machine- and human-readable indication that content was produced with AI and reviewed by a named role.
- **Reviewed** — the teacher has opened, checked and confirmed an Artefact; unlocks the "AI-assisted, teacher-reviewed" export label.
- **Series** — an ordered list of Lessons with non-exclusive membership; a Lesson may belong to several Series. The unit of sequencing that replaced the Journey planner.
- **Skill** — a packaged pedagogical capability the runtime calls (F13).
- **Source** — a teacher-provided material (file/URL) used for grounding.
- **Workspace** — the container for a user's Journeys, Sources and settings. One personal Workspace per user at MVP.
- **Worksheet** — a paginated A4 document made of blocks such as heading, question, multiple-choice, and fill-gap. It stands beside a Lesson's slides and is edited in the worksheet editor.

## Engineering terms

- **ADR** — Architecture Decision Record under `docs/adr/`; engineering decisions only. Product decisions live in Notion.
- **AI provider** — the hosted model service behind `@tj/ai`; Amazon Bedrock at MVP, reached through the Vercel AI SDK (ADR 0018). Features never import a vendor SDK.
- **Activity tray** — the UI surface listing running and completed jobs (F18-R04); consumes job events.
- **App** — a deployable unit under `apps/` (`web`, `api`, `worker`).
- **App bar** — the 48px docked top bar of a screen.
- **AppType** — the exported type of the Hono router used by the Hono RPC client (ADR 0005).
- **Domain package** (`@tj/domain`) — Zod schemas and TypeScript types for the product objects above, plus job-name constants and the `StorageAdapter` interface. Depends on nothing internal.
- **Editor kit** — TeachDeck's `components/ui2` component set that ships inside `@tj/editor` (ADR 0019).
- **Env schema** — the Zod schema in each app's `src/env.ts` that validates configuration at boot (ADR 0015).
- **Job** — a unit of background work enqueued by the API and executed by the worker via pg-boss (ADR 0006). Job names are constants in `@tj/domain`.
- **Job event** — a progress record (`queued`, `started`, `progress`, `completed`, `failed`, `cancelled`) emitted by the worker and streamed to clients over SSE (ADR 0012).
- **Kind page** — a Library page listing one kind of document: Lessons, Worksheets, or Series.
- **Kit** — the `/kit` component gallery route, available only in development, showing every `@tj/ui` component in every state; the visual acceptance surface.
- **Mock data layer** — the Zod-validated fixtures and in-memory store in `apps/web/src/mocks` (ADR 0020).
- **Model call** — one `generateText` / `streamText` invocation through `@tj/ai`. Logged as class, model ID, provider, latency and token counts — never as prompt or completion text (ADR 0015, F13-R10).
- **Model class** — the tier a caller asks `@tj/ai` for instead of a model ID: `frontier` (planning, coherence, adaptation), `standard` (plan, notes, slide outline), `small` (items, glossary, variants, summaries). Each maps to a Bedrock model ID via `AI_MODEL_<CLASS>` (F13 §7, ADR 0018).
- **Package** — an internal library under `packages/`, scoped `@tj/*`, never published.
- **Preview environment** — a per-PR deployment: Vercel preview for `web`, Railway PR environment for `api`/`worker` (ADR 0010).
- **Route tree** — the code-based TanStack Router definition in `apps/web/src/router.tsx` (ADR 0004).
- **Scoped DB** — the `forWorkspace(workspaceId)` query interface from `@tj/db` that always applies the tenant predicate (ADR 0007). The only permitted way to query tenant tables.
- **Shell** — the persistent chrome around a screen (sidebar, app bar, theme selector), owned by `@tj/ui` (ADR 0019).
- **Tenant table** — any table with a `workspace_id` column. Non-tenant tables (users, sessions, workspaces, pg-boss internals) are listed explicitly in `packages/db`.
