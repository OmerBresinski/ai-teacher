# 0024 — Document persistence and the lesson brief: `documents` table, document API, `POST /lessons`

- Status: Accepted
- Date: 2026-09-06
- Related PRD decisions: F01 (SCOPE Now 2, 12; P1, P6, P8; D-001, D-006, D-019; A6), F06 item 1
  (LessonFacts on the lesson), TD project scope note ("backend connects later"); ADRs 0005, 0006,
  0007, 0011, 0012, 0020, 0021, 0022

## Context

The Editor port (TD — Editor port, TEACH-96 → 113) is frontend-only on the in-memory mock store
(ADR 0020). There is no persisted Lesson: the only tenant table is `job_events`
(`packages/db/src/schema/index.ts`, `TENANT_TABLES`), the protected route prefixes are `/me`,
`/jobs/*`, `/events`, `/files/*` (`apps/api/src/app.ts`), and `CreateAppOptions.db` is
`Pick<DbHandle, "sql">` with the note that routes "will take `unsafeDb` through `forWorkspace()`".
ADR 0021 deferred exactly this: "Revisit when the API lands: the row shape (`workspaceId`, `kind`,
`body jsonb`), the list endpoint's summary shape, and whether `migrate()` runs on read or on
write." `packages/domain/src/objects/lesson.ts` is kept as the persistence-row skeleton.

F01 — Lesson brief and class context is the first feature project after the Editor port (SCOPE Now
order) and cannot be built without that layer: its item 1 requires `classContext` to "serialise
and deserialise without loss between the teaching-journey API and the TeachDeck editor document"
and the name-pattern guard to run "in both the client and the API"; its item 2 requires that
"saving the brief enqueues the F06 Plan stage and the client receives a job id to follow over
SSE". F06 later puts `LessonFacts` "on the lesson" and derives everything from it.

This ADR records the engineering decisions for both: how documents persist and how the brief
enters the system. Product shape (fields of the brief, the two questions, ClassContext categories)
is F01's project description and is not repeated here.

## Decision

1. **The brief is a field on the Lesson document.** `Lesson.brief?: Brief` is added to
   `@tj/domain/documents/lesson.ts` as an **optional** field (no version bump, ADR 0021 §2 rule:
   optional additions never bump `version`). A TeachDeck file without a brief is a valid document;
   a product file with one is a valid TeachDeck file (unknown keys are tolerated by its parser).
   `Brief` holds only what the Lesson does not already carry: `topic` (free text: topic or
   objective), `durationMin`, `classContext?`, and the answers to the at-most-two clarifying
   questions. `Lesson.subject`, `yearGroup`, `ageBand`, `readingLevel`, `language` **stay
   canonical** on the Lesson (TeachDeck reads them for the library card and the copy pitch); the
   brief does not duplicate them and there is no sync rule. The brief screen writes those Lesson
   fields directly.
2. **ClassContext and the name-pattern guard live in `@tj/domain`.** `ClassContextSchema` (size
   band, needs as category counts, prior knowledge, notes) and a pure `findNamePatterns(text)` sit
   beside the document schemas (`packages/domain/src/documents/class-context.ts`). Every free-text
   field of `Brief` and `ClassContext` is refined with the guard, so the **same Zod schema rejects
   on the client (form) and in the API (`zValidator`) with the same message** — F01 item 1 by
   construction, no model call (P6 is a structural guarantee, not a classifier). The guard is the
   "Identifier guard" of the glossary.
3. **One `documents` tenant table, `kind` + `body jsonb`.** In
   `packages/db/src/schema/documents.ts`, listed in `TENANT_TABLES`: `id uuid` (minted app-side
   with `newId()` as `workspaces` does), `workspace_id` FK, `kind` enum
   `lesson | worksheet | series`, `body jsonb` (the domain document, always `CURRENT_VERSION`),
   and **promoted list columns** written by the API from the parsed body on every write:
   `title text`, `subject text null`, `year_group text null`, `theme_id text null`,
   `item_count int` (slides or blocks), `cover jsonb null` (the first Slide, ADR 0021 §6), plus
   `created_at`, `updated_at`, `deleted_at null`. A single `summarise(document)` in `@tj/domain`
   replaces the mock store's hand-filled `DocumentSummary` (ADR 0021 §6 said "no shared
   `summarise()` yet"). The list endpoint reads the promoted columns only — never `body`.
   Normalising slides and elements into tables is rejected: the editor's reducers and undo work
   on the whole document (ADR 0022 §4).
4. **Whole-document writes with optimistic concurrency; `migrate()` on write.**
   `PUT /documents/:id` takes the full domain document plus the `updatedAt` the client last saw
   (`If-Match`-style field in the body). The API runs `migrate()` → `parseLesson` /
   `parseWorksheet` / `parseSeries`, recomputes the promoted columns, sets `updated_at` and returns
   the stored document; a mismatch is **409** and the editor reloads. `GET` returns the body as
   stored (the client still parses it, cheaply). Storage is therefore always `CURRENT_VERSION`; a
   future `version` bump ships a one-off data migration through `packages/db/src/migrate.ts`
   rather than a read-time upgrade. This matches the editor's debounced `onSave(document)`
   (ADR 0022 §5) and keeps the worker reading one shape.
5. **Soft delete with restore.** `DELETE /documents/:id` sets `deleted_at`; lists exclude deleted
   rows; `POST /documents/:id/restore` clears it (the library's 6 s Undo). **No sweep at MVP**:
   soft-deleted rows are kept until F15 ("delete all", erasure) decides the retention window and
   adds the sweep job. The `forWorkspace()` predicate applies to every one of these.
6. **`POST /lessons` creates the document and enqueues Plan.** The brief screen makes one call:
   `POST /lessons` with `{ brief, subject?, yearGroup?, ... }`. In one `db.tx`, the API inserts a
   `documents` row (`kind: lesson`, empty `slides`, `title` from the topic, `brief` set) and
   enqueues the F06 Plan job (`JobName` entry in `@tj/domain/jobs.ts`, payload `{ lessonId }`)
   through the existing `JobsContext`, returning `{ lessonId, jobId }`. The client navigates to
   `/l/$lessonId` and follows `GET /jobs/:jobId/events` (ADR 0012, TEACH-19). Until F06 lands the
   worker registers a stub handler that completes immediately. Skipping both clarifying questions
   and leaving duration at its key-stage default must still succeed (F01 item 2).
7. **Documents route family, `/documents/*` + `/lessons`, protected like `/files/*`.**
   `apps/api/src/routes/documents.ts` (`documentRoutes(unsafeDb)`) chained for Hono RPC
   (ADR 0005): `GET /documents?kind=` (summaries), `POST /documents` (create from a full document —
   Import, Make a copy), `GET|PUT|DELETE /documents/:id`, `POST /documents/:id/restore`; and
   `apps/api/src/routes/lessons.ts` for `POST /lessons` (item 6). Both prefixes join
   `PROTECTED_PATHS` (CSRF guard + `requireSession`) and `CreateAppOptions.db` widens to the
   `unsafeDb` handle for `forWorkspace()`. Request bodies are **capped** (see item 8).
8. **Images stay data URLs for now; bodies are capped.** ADR 0021 §5 stands: `ImageElement.src`
   keeps data URLs until an upload endpoint exists. The document routes enforce a **10 MB** body
   cap (Hono `bodyLimit`, 413 through the error envelope) so a large deck fails loudly rather than
   slowly; a downscaled deck is 1–3 MB. `POST /files` (upload via `StorageAdapter.put` under
   `<workspaceId>/images/…`) and the one-off rewrite of stored `src` values are a **separate
   ticket after F01**, not part of this design.
9. **The web replaces the mock layer behind the existing query options.** `apps/web/src/mocks` is
   swapped for `@tj/api-client` calls inside the same TanStack Query option factories and
   mutations the shell and the Editor port already consume (ADR 0020 framed the mocks as a
   stand-in). The hook surface does not change, so Editor-port tickets keep landing unchanged.
   Seed content is handled by item 16; no switchable offline mode is kept.
10. **Data access is a repository module in `@tj/db`.** `packages/db/src/documents.ts` beside
    `job-events.ts`: `listSummaries(ws, kind)`, `getDocument(ws, id)`,
    `createDocument(ws, kind, body)`, `putDocument(ws, id, body, expectedUpdatedAt)` returning
    `ok | conflict | missing`, `softDelete`, `restore`, and `getSeriesWithLessons(ws, id)`. Every
    function takes the `WorkspaceDb` from `forWorkspace()` and computes the promoted columns with
    `summarise()`; routes and the worker (F06 Plan writes the lesson) share it. `tenant.ts`
    already says joins and compound queries belong in a repository module inside this package.
11. **Ids are minted by the API; `body.id` equals the row id.** `documents.id` is a `uuid` from
    `newId()` (UUIDv7, as `workspaces` does). On create — including Import and Make a copy — the
    API rewrites `body.id` to the new row id; the editor no longer mints document ids (slide and
    element ids stay `nanoid` inside the body, ADR 0021). Routes are `/l/<uuid>`, `/w/<uuid>`.
12. **Series membership stays inside the document.** A Series is a `documents` row whose
    `body.lessonIds` (TeachDeck shape) is the source of truth; no join table.
    `getSeriesWithLessons` resolves the ids against the same table **within the Workspace**, so an
    id from another tenant or a soft-deleted lesson simply drops out (as the mock store does
    today). "Which Series contain this Lesson" is a jsonb containment query over the Workspace's
    few series rows. F04 reads `lessonIds` in order for series context.
13. **`POST /lessons` takes the brief only.** No Sources in the request; F03 adds an optional
    `sourceIds[]` and `Lesson.sources` (the A7 hook F06 item 3 names) when the upload path exists.
    No field is reserved now.
14. **The job is `lesson.plan` with `{ lessonId }`.** `JobName.lessonPlan = "lesson.plan"`, strict
    payload `{ lessonId }`, registered in `JobPayloadSchemas`. Progress uses the existing job-event
    types (ADR 0012); whether a `progress` payload carries the first slide early, and whether Plan,
    Generate, Evaluate and Repair are one job or several, is F06's decision.
15. **`POST /lessons` is rate-limited like `/jobs/ai-ping`.** It joins
    `rateLimitByWorkspace(aiLimiter)` in `app.ts` with the same config, since every call ends in a
    model call.
16. **New Workspaces are empty.** No starter content is inserted on first sign-in. A
    `bun run db:seed` script inserts the TeachDeck starter lessons and demo worksheet into a
    dev/test database through the repository (fixtures already exist as
    `packages/domain/src/documents/fixtures.test-helpers.ts`); e2e uses the script. Production
    teachers see the empty state and the New dialog (F16 owns the first-run experience).
17. **The list endpoint paginates, sorts and searches server-side.**
    `GET /documents?kind=&sort=updated|title|created&q=&cursor=&limit=` returns
    `{ items, nextCursor }` (default `limit` 100, keyset cursor on the sort column + id). Sort keys
    are promoted columns; `q` is `ILIKE` on `title` and `subject`. The library's search and sort
    move from client-side filtering to query params and `infiniteQueryOptions`, so every page is
    consistent with the server order. Decided now so the response shape never has to break.
18. **A lesson is locked while a job is generating into it.** `documents.generating_job_id uuid
    null`: set in the same transaction that enqueues `lesson.plan` (item 6), cleared by the worker
    on the job's terminal event. While set, `PUT /documents/:id` answers **409** with a
    `generating` code and the editor shows the lesson read-only with the progress stream; the
    worker writes through `putDocument` with its own `expectedUpdatedAt` like any client. No merge
    logic, no lost teacher edits (P4). F06 inherits the lock for Generate/Evaluate/Repair.

## Consequences

- `@tj/domain/jobs.ts` gains `lesson.plan`; `apps/worker` gains a stub handler until F06.
- Import and Make a copy change identity: the copied document gets a new uuid (item 11);
  TeachDeck JSON files keep their original `id` only in the file, not in the row.
- ADR 0021's three deferred questions are answered: row shape (item 3), summary shape (item 3,
  `summarise()` in domain), `migrate()` on write (item 4). ADR 0020's mock layer is retired by
  item 9; ADR 0021 §6's web-local `DocumentSummary` becomes the API's list shape.
- `@tj/domain/documents` gains `Brief`, `ClassContext`, `findNamePatterns`, `summarise`; `@tj/db`
  gains `documents.ts` and a `db:seed` script. It still depends on `zod` only (ADR 0013).
- The F06 design can assume: a Lesson row exists before Plan runs, `brief` is on it,
  `LessonFacts` will be another optional document field or a promoted column — decided in F06's
  ADR — and the worker reads and writes documents through the same `forWorkspace()` repository.
- Large PUTs while images are data URLs (item 8). Revisit when `POST /files` lands: the rewrite
  ticket removes the cap's main reason to exist.
- Optimistic concurrency (item 4) means the editor needs a reload path on 409; the Editor port's
  autosave ticket (TEACH-103) must surface it rather than swallow it.
- Soft delete (item 5) has no sweep; F15 adds retention and the sweep job. The lock (item 18)
  means a crashed job must still emit a terminal event or the lesson stays read-only — the
  job-durability work in TEACH-82 becomes a prerequisite for F06, not a nice-to-have.
- Import (`POST /documents` from JSON) and "Make a copy" get a real backend for free; Export stays
  client-side (ADR 0023).

## Open

Nothing at the time of acceptance. Deferred to other projects: retention/sweep (F15), stage split
and first-slide streaming (F06), `POST /files` uploads (follow-up ticket).
