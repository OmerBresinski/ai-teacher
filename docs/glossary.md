# Glossary

Shared vocabulary for the Teaching Journey codebase. Product terms are copied from the Master PRD §19 so code, tickets and PRDs use the same words; engineering terms are defined here first.

## Product terms (from the Master PRD)

- **Adaptation** — proposed and accepted changes to future Lessons based on Observations.
- **Artefact** — a generated document that is a projection of a Lesson + Journey (plan, notes, slides, worksheet, quiz, exit ticket, …). Carries a derived-from lineage and a review state.
- **Artefact set** — all Artefacts for one Lesson, generated coherently from the same plan.
- **Cascade** — what follows a change to a fact: every AI-authored element or block whose `generatedFrom.factRefs` names it (the impact set) is re-derived by the `lesson.cascade` proposal job and applied in the editor as one undo transaction, with the toast "Auto changed on slides N and M to match"; teacher-authored elements in the impact set are flagged instead (F07). Only facts cascade (ADR 0025 §18).
- **Block** — one unit of a Worksheet: heading, paragraph, instructions, question, multiple-choice, fill-gap, matching, word search, word bank, answer box, lines, image, table, divider or page break (`WorksheetBlock` in `@tj/domain`). Blocks flow and paginate; they have no coordinates.
- **Brief** — what the teacher states before generation: topic or objective, duration and optional Class context, plus the answers to at most two clarifying questions. Stored as the optional `Lesson.brief` field of the document; `subject` / `yearGroup` stay on the Lesson itself (ADR 0024 §1). Product spec: project F01.
- **Class context** (`ClassContext`) — class-level facts on a Brief: size band, needs as category counts, prior knowledge, notes. Every free-text field is refined by the Identifier guard; no field can hold a roster or a name (ADR 0024 §2).
- **Class-level** — data about the group as a whole, never attributable to an individual learner.
- **Cohort Profile** — class-level description of who is being taught; never individual.
- **Concept** — a unit of understanding with prerequisites, objectives and typical misconceptions; a node in the Progression.
- **Draft / Reviewed / Stale / Taught / Needs attention** — the universal state vocabulary (F18-R07); the same chips everywhere. *(Superseded for the Shell by ADR 0019; the stale flag survives in F07.)*
- **Evaluate** — the third pipeline stage: the shared schema checks (`checkLesson`) and then one model call over the facts and the lesson text, producing Findings (ADR 0025 §10, §11).
- **Export** — producing a file from a Lesson or Worksheet in the teacher's browser: PDF (browser print of a print route), PPTX, PNG, DOCX or JSON (ADR 0023). Always teacher-initiated; never server-side at MVP.
- **Finding** — one result of Evaluate: `{ check, severity: error | warning, target, message, fix? }`. `error` findings drive Repair; what remains after it, plus `warning`s, are the **residuals** shown as the lint badge (ADR 0025 §10–§12).
- **Generate** — the second pipeline stage: from `LessonFacts` and its `outline`, one model call per outline entry returns a slide spec that `materialiseSlide` turns into a laid-out Slide; a further call returns the worksheet block specs. Every element and block carries `generatedFrom` and `authoredBy: "ai"` (ADR 0025 §8).
- **Identifier guard** — the name-pattern check that blocks learner names, IDs, emails and identifying phrases in free text (F15-R03). A pure `findNamePatterns()` in `@tj/domain`, applied as a Zod refinement so the client form and the API reject with the same message (ADR 0024 §2).
- **Import** — creating a Lesson or Worksheet from a JSON file in the interchange format, which is the domain document itself (`*.teachdeck.json`, `*.worksheet.json`; ADR 0021 §7). Entered from the Library's Import dialog.
- **Journey** — the plan from goal to outcome across N lessons; the product's central object. Typed and versioned. *(superseded by Series — TD decision D-001, 2026-09-05; the term remains in package/ADR names for history)*
- **Knowledge node** — an entry in the progressions/misconceptions graph (F05).
- **Lesson** — an ordered session in the Journey covering one or more Concepts. In the editor, it is a slide deck with 960×540-point slides plus notes; the Library shows it as a card.
- **LessonFacts** — the one object every Artefact of a Lesson is derived from: objectives (optional `curriculumRef`), vocabulary, worked examples, questions with answers and reasoning, misconceptions (empty at MVP), the `outline` (ordered slide kinds with minutes and the facts each covers) and `durationMin`. Stored as the optional `Lesson.facts` field; every fact has a stable short id that `factRefs` point at (ADR 0025 §1).
- **Library** — the signed-in home: Home plus the kind pages.
- **Observation** — class-level evidence of understanding recorded after teaching.
- **Plan** — the first pipeline stage: the Brief (and, from F03, Source text) becomes `LessonFacts` in one `standard` model call; the `title` and `objectives` slides are then materialised from it without a second call so the first slide is visible early (ADR 0025 §5, §7).
- **Progression** — the ordered, dependency-aware set of Concepts a Journey covers (a DAG).
- **Provenance** — machine- and human-readable indication that content was produced with AI and reviewed by a named role.
- **Reviewed** — the teacher has opened, checked and confirmed an Artefact; unlocks the "AI-assisted, teacher-reviewed" export label.
- **Repair** — the fourth pipeline stage: one targeted pass that regenerates only the specs named by `error` Findings, then re-runs the schema checks; it never runs twice automatically and the job completes whatever remains (ADR 0025 §12).
- **Series** — an ordered list of Lessons with non-exclusive membership; a Lesson may belong to several Series. The unit of sequencing that replaced the Journey planner.
- **Skill** — a packaged pedagogical capability the runtime calls (F13).
- **Slide** — one 960×540-point page of a Lesson: a `kind` (title, objectives, true-false, …), an ordered list of elements (text, image, shape, line, icon, table, embed, option, gap-text, timer, group) whose array order is draw order, optional notes, transition and question data (`Slide` in `@tj/domain`). Coordinates are points; export maps 1pt = 1pt.
- **Slide spec** — what the model produces for a slide: a per-kind content object (stem, options, explanation, notes, `factRefs`) validated by a Zod discriminated union; it carries no coordinates or rich text. `materialiseSlide(spec, themeId, ids)` in `@tj/slides` fills the layout recipe with it (ADR 0025 §8).
- **Source** — a teacher-provided material (file/URL) used for grounding.
- **Source reference** (`SourceRef`) — the entry F03 will write to `Lesson.sources`: `{ id, kind: file | paste, name, storageKey?, pages? }`; references only, the extracted text is loaded by the worker's `SourceLoader` (ADR 0025 §20).
- **Stage** — the present-mode surface: the letterboxed slide plus its controls, timer, ink and overview, always on the dark stage palette regardless of the app theme. In code, the `.tj-stage` variable scope in `@tj/ui` (ADR 0022 §3).
- **Theme (document)** — one of the six built-in slide designs a Lesson references by `themeId` (background, ink, accent, two font stacks, tags such as `dyslexia` or `low-vision`). The `Theme` type and schema live in `@tj/domain`; the catalogue (`THEMES`, `getTheme`, `DEFAULT_THEME_ID`) lives in `@tj/slides` (ADR 0025 §9, re-exported by `@tj/editor`) and the fonts it names in `@tj/editor`. Distinct from the app **theme** (`light` / `dark` / `high-contrast`, `data-theme` on `<html>`).
- **Worksheet** — a paginated A4 document made of blocks such as heading, question, multiple-choice, and fill-gap. It stands beside a Lesson's slides and is edited in the worksheet editor.
- **Workspace** — the container for a user's Journeys, Sources and settings. One personal Workspace per user at MVP.

## Engineering terms

- **Activity tray** — the UI surface listing running and completed jobs (F18-R04); consumes job events.
- **ADR** — Architecture Decision Record under `docs/adr/`; engineering decisions only. Product decisions are the founder's and are not recorded here.
- **AI provider** — the hosted model service behind `@tj/ai`; Amazon Bedrock at MVP, reached through the Vercel AI SDK (ADR 0018). Features never import a vendor SDK.
- **App** — a deployable unit under `apps/` (`web`, `api`, `worker`).
- **App bar** — the 48px docked top bar of a screen.
- **AppType** — the exported type of the Hono router used by the Hono RPC client (ADR 0005).
- **Budget** — the per-lesson spend limit every pipeline stage charges after each model call and consults before the next: `AI_LESSON_COST_CAP_USD` from `@tj/ai`'s price table, falling back to `AI_LESSON_TOKEN_CAP` for an unpriced model id. Exceeding it stops generation, keeps what was written and records a `budget` Finding (ADR 0025 §15).
- **Cover** — the first Slide of a Lesson, carried on its `DocumentSummary` (and the `cover` column of the `documents` row, ADR 0024 §3) so the Library renders a real thumbnail from the list query (ADR 0021 §6).
- **Document** — a Lesson, Worksheet or Series as persisted and exchanged: the `@tj/domain` schema with `version`, validated by `parseLesson` / `parseWorksheet` / `parseSeries` and upgraded by `migrate()` (ADR 0021). Persisted as one row of the `documents` tenant table (`kind`, `body jsonb`, promoted list columns; ADR 0024 §3). The Library summary is derived from it by `summarise()`.
- **Document summary** — the list-endpoint shape of a Document: the promoted columns (`title`, `subject`, `yearGroup`, `themeId`, `itemCount`, `cover`, timestamps), never the body (ADR 0024 §3). Replaces the web-local `DocumentSummary` of ADR 0021 §6.
- **Domain package** (`@tj/domain`) — Zod schemas and TypeScript types for the product objects above, plus job-name constants and the `StorageAdapter` interface. Depends on nothing internal.
- **Editor kit** — the components that ship inside `@tj/editor` because they own document geometry or editor chrome and have no `@tj/ui` twin (Panel, Rail, Segmented, NumberInput, Color, ZoomControl, Deck, Overlay, FadeIn). Everything with a twin comes from `@tj/ui` (the "twin rule", ADR 0022 §2).
- **Editor package** (`@tj/editor`) — the React library holding the lesson editor, viewer, present mode, worksheet editor and exporters, mounted by `apps/web` on `/l/$lessonId(/present|/print)` and `/w/$worksheetId(/print)` (ADR 0022).
- **Env schema** — the Zod schema in each app's `src/env.ts` that validates configuration at boot (ADR 0015).
- **Generating lock** — `documents.generating_job_id`: set when `POST /lessons` enqueues `lesson.plan` and on the worksheet row the job creates; while set, `PUT /documents/:id` is 409 `generating` and the worker writes through `putDocumentAsJob` keyed on the job id; cleared on the terminal event, or on read when the job is terminal or never queued (ADR 0024 §18, ADR 0025 §6, §24).
- **Generation package** (`@tj/generation`) — the server-only package holding the pipeline stages, slide and block spec schemas, prompts, budget wiring and the in-process Mastra workflow; consumed by `apps/worker` only (ADR 0025 §17, §21).
- **Job** — a unit of background work enqueued by the API and executed by the worker via pg-boss (ADR 0006). Job names are constants in `@tj/domain`.
- **Job event** — a progress record (`queued`, `started`, `progress`, `completed`, `failed`, `cancelled`) emitted by the worker and streamed to clients over SSE (ADR 0012).
- **Job result** — the optional `result` on a `completed` job event, a discriminated union on `result.job` declared in `@tj/domain/jobs.ts`; how proposal jobs return their proposals to the editor (ADR 0025 §19).
- **Kind page** — a Library page listing one kind of document: Lessons, Worksheets, or Series.
- **Kit** — the `/kit` component gallery route, available only in development, showing every `@tj/ui` component in every state; the visual acceptance surface.
- **Mock data layer** — the Zod-validated fixtures and in-memory store in `apps/web/src/mocks` (ADR 0020). *(To be replaced by `@tj/api-client` calls behind the same query options when the document API lands — ADR 0024 §9.)*
- **Model call** — one `generateText` / `streamText` invocation through `@tj/ai`. Logged as class, model ID, provider, latency and token counts — plus `lessonId`, `jobId`, `stage`, `promptVersion` and `costUsd` when the caller is the pipeline (ADR 0025 §16) — never as prompt or completion text (ADR 0015, F13-R10).
- **Model class** — the tier a caller asks `@tj/ai` for instead of a model ID: `frontier` (planning, coherence, adaptation), `standard` (plan, notes, slide outline), `small` (items, glossary, variants, summaries). Each maps to a Bedrock model ID via `AI_MODEL_<CLASS>` (F13 §7, ADR 0018).
- **Package** — an internal library under `packages/`, scoped `@tj/*`, never published.
- **Pipeline** — the four stages Plan → Generate → Evaluate → Repair run as one `lesson.plan` job, checkpointed on `Lesson.generation.stage` so a retry resumes rather than re-spends (ADR 0025 §5).
- **Preview environment** — a per-PR deployment: Vercel preview for `web`, Railway PR environment for `api`/`worker` (ADR 0010).
- **Prompt version** — the `version` string a prompt module in `@tj/generation/src/prompts` exports (e.g. `plan.v1`), written to `generatedFrom.promptVersion` and `Lesson.generation.promptVersions`; a test pins each prompt's text hash to its version (ADR 0025 §17).
- **Proposal job** — `lesson.cascade` or `lesson.regenerate`: a job that reads the current document, re-derives specs for an impact set in parallel and returns them as a Job result without writing the document or taking the Generating lock; the editor applies them as one undo transaction (ADR 0025 §18).
- **Reducer (editor)** — a pure function `(document, action) => document` in `packages/editor/src/model/reducers/`; the port of a TeachDeck store action. Applied to the Query cache through `useDocumentHistory`, which owns undo/redo (ADR 0022 §4).
- **Repository module** — a file in `packages/db/src/` (`job-events.ts`, `documents.ts`) that holds every query for one table family, takes a Scoped DB and is the only place joins or compound queries are written (ADR 0007, ADR 0024 §10).
- **Route tree** — the code-based TanStack Router definition in `apps/web/src/router.tsx` (ADR 0004).
- **Scoped DB** — the `forWorkspace(workspaceId)` query interface from `@tj/db` that always applies the tenant predicate (ADR 0007). The only permitted way to query tenant tables.
- **Shell** — the persistent chrome around a screen (sidebar, app bar, theme selector), owned by `@tj/ui` (ADR 0019).
- **Slides package** (`@tj/slides`) — the pure package holding the theme catalogue, grid, `layoutSlide` recipes, rich-doc builders and `materialiseSlide`; depends on `@tj/domain`, `nanoid`, `zod` only and is shared by `@tj/editor` and `@tj/generation` (ADR 0025 §9).
- **Tenant table** — any table with a `workspace_id` column. Non-tenant tables (users, sessions, workspaces, pg-boss internals) are listed explicitly in `packages/db`.
