# 0027 — Upload as input: `POST /sources`, `@tj/extract`, the `sources` table and the `SourceLoader`

- Status: Accepted (amends ADR 0024 §13 and ADR 0025 §20)
- Date: 2026-09-12
- Related PRD decisions: F03 (D-006, F03-D3, F03-D5, F03-R06, F03-R07, F03-R08), A6 (roster
  refusal), A7 (`Lesson.sources`), ADR 0015 (no document text in logs), ADR 0026 (storage)
- Linear: TEACH-260 (the design ticket; its description is this text with the ticket breakdown)

## Context

F03's canonical spec (the project description, D-025) says: PPTX, PDF, DOCX and pasted text are
accepted for one lesson; extracted text carries page or slide references; `Lesson.sources` holds
the references; the Plan stage receives the text; a tabular document that looks like a roster is
refused with a plain explanation; upload to first slide in under 20 s for a 30-page PDF.

What the codebase already has, and this ADR builds on rather than re-decides:

1. `Lesson.sources?: SourceRef[]` — `{ id, kind: "file" | "paste", name, storageKey?, pages? }`,
   references only, no extracted text in the body (ADR 0025 §20;
   `packages/domain/src/documents/source-ref.ts`).
2. Plan already consumes source text: `stages/plan.ts` calls `deps.sources(lesson.sources)` and
   passes `sourceTexts` into both Plan prompts (`plan-skeleton`, `plan-facts`) through
   `briefBlock()`. `SourceLoader` and the `noSources` stub live in `packages/generation/src/types.ts`;
   the worker injects the stub in `apps/worker/src/deps.ts`.
3. Storage is a Railway Bucket behind `ReadableStorageAdapter` (`put`, `get`, `delete`, `list`),
   keys are `<workspaceId>/<segment>/…` (ADR 0026). The API receives `storage` through
   `CreateAppOptions`; the worker only has it inside `deps.images`.
4. `POST /lessons` is strict and takes the brief only; ADR 0024 §13 reserved `sourceIds[]` for F03.
5. `GET /files/:key` is download-only. Nothing in `apps/api` reads multipart bodies. Nothing in
   `apps/web` or `packages/ui` is a drop zone; the brief page's test asserts there is no upload tab.
6. The deterministic Identifier guard (`findNamePatterns`: email, 6+ digit run, "pupil called")
   exists in `@tj/domain` and is applied to the brief; the `check-input` stage screens the brief's
   text with one `small` model call. Neither sees document text today.
7. No PDF, DOCX or PPTX library is declared anywhere. A spike on 2026-09-12 confirmed that
   `unpdf` 1.8.1, `mammoth` 1.12.3, `jszip` 3.10.2 and `fast-xml-parser` 5.11.1 import and parse
   correctly under `bun run`, and that `pdf-lib` and `docx` can generate fixtures in-process.

The project description's breakdown assumed extraction "running as a worker job with progress
visible over SSE". The founder decided on 2026-09-12 that a roster must be refused **before the
teacher writes the brief**, which requires the document's text inside the upload request; that
decision drives §1 below and supersedes the breakdown's sentence.

## Decision

1. **Extraction runs in the API request at upload, not in the worker.** `POST /sources` parses the
   document, runs the screens (§2) and only then writes to storage. The worker's `SourceLoader`
   reads a pre-computed `extracted.json` and never parses a PDF. A 30-page PDF parses in well under
   a second; the work is bounded by the caps in §4 and §5. One job type (`lesson.plan`) and the
   existing SSE stream remain. If the production p95 for an upload exceeds 5 s, the alternative
   discussed is a `source.extract` job with per-source SSE — a new decision, not a fallback.
2. **A server-only package `@tj/extract` (`packages/extract`)** owns parsing and screening. It
   depends on `@tj/domain` only, plus exact pins `unpdf 1.8.1`, `mammoth 1.12.3`, `jszip 3.10.2`,
   `fast-xml-parser 5.11.1`; `pdf-lib` and `docx` are dev dependencies that generate test fixtures
   in-process (no binary fixtures in git). Its surface:

   ```ts
   sniffMime(bytes): SourceMime | null                 // magic bytes only; the declared type is ignored
   extract({ bytes, mime, name }): Promise<Extraction> // { kind, pages, chunks, tables, images }
   screen(extraction): Refusal | null                  // roster | identifiers | unreadable | too-long
   ```

   `Refusal` is `{ reason: "roster", ref } | { reason: "identifiers", count, ref } |
   { reason: "unreadable" } | { reason: "too-long", pages }`, where `ref` is the `SourceLocator`
   of the offending table or first hit. A `null` from `sniffMime` is the route's fifth reason,
   `unsupported`: it is decided before `extract` runs and is not a `screen` outcome.
   `Extraction.kind` is `pdf | pptx | docx | paste`; `SourceRef.kind` and the `sources.kind`
   column stay the coarser `file | paste` (the format is recoverable from `mime`).

   - PDF: `unpdf` text per page → one chunk per page `{ page }`; `extractImages` per page.
   - PPTX: `jszip` over `ppt/slides/slide<N>.xml` and `ppt/notesSlides/notesSlide<N>.xml`,
     `fast-xml-parser` with `preserveOrder`, every `a:t` in order, notes appended; `a:tbl` rows
     become tables; `ppt/media/*` referenced by the slide's `_rels` become images. One chunk per
     slide `{ slide }`.
   - DOCX: `mammoth.convertToHtml` then a small HTML walk: each `<h1..h6>` starts a chunk
     `{ section: heading }` (text before any heading is `{ section: "Start" }`); `<table>` rows
     become tables; inlined `<img>` data URLs become images.
   - Paste: one chunk `{ section: "Pasted text" }`; tab-separated lines (≥ 3 lines, ≥ 2 columns)
     are parsed as a table for the roster screen only.

   Screens, in order, first hit wins: **too-long** (`pages > 300`); **roster** (F03-D5, never
   overridable) — a table with a column where ≥ 60 % of cells are two-plus capitalised words
   **and** another column where ≥ 60 % of cells look like a date, email, 4+ digit id, grade or
   gender token, or a single-column table of ≥ 5 rows that are ≥ 80 % names; ≥ 5 consecutive
   lines that split on runs of spaces/tabs into the same column count count as a table;
   **identifiers** — `findNamePatterns` over every chunk, any hit refuses (bare names never
   trigger it, so novels and history texts pass); **unreadable** — total text < 200 chars or
   < 20 chars per page on average **and** no images. Little text **with** images is accepted and
   flagged `lowText` (§8).
   The API logs `{ sourceId, kind, pages, chunks, images, refused? }` and never a byte of the
   document (ADR 0015).
3. **`SourceLocator` and `ExtractedSource` are `@tj/domain` schemas.** In
   `documents/source-ref.ts`: `SourceLocatorSchema = { page?, slide?, section? (≤ 120) }` and
   `ExtractedSourceSchema = { version: 1, sourceId, kind: pdf | pptx | docx | paste, pages,
   lowText, chunks: { ref, text }[], images: { ref, storageKey, mime }[] }` — the shape of
   `<ws>/sources/<id>/extracted.json`. `SourceRefSchema` keeps its shape; `storageKey` now names
   the original object for both kinds (`original.<ext>`, `original.txt` for a paste).
   `SourceText.ref` in `@tj/generation` becomes `SourceLocator`. **This amends ADR 0025 §20:** the
   locator gains `section` and a paste has a `storageKey`.
4. **A `sources` table in `@tj/db` is the registry; the Lesson body keeps `SourceRef[]`.**
   `packages/db/src/schema/sources.ts`, a tenant table (`tenantColumns()`, `tenantIndexes`, listed
   in `TENANT_TABLES` and `ALL_TABLES`): `kind` (`source_kind` Postgres enum, `file | paste`, the
   same values as `SourceRef.kind`), `name`, `mime` (sniffed),
   `byte_size`, `storage_key`, `pages`, `low_text`, `lesson_id uuid null`, `deleted_at`. Index
   `(workspace_id, lesson_id)`. Repository `packages/db/src/sources.ts` beside `documents.ts`:
   `createSource`, `getSource`,
   `bindSourcesToLesson(ws, ids, lessonId)` (the conditional claim in §5),
   `unbindSourcesFromLesson(ws, lessonId)`, `softDeleteSource`. Objects per source:
   `<ws>/sources/<id>/original.<ext>`, `<ws>/sources/<id>/extracted.json`,
   `<ws>/sources/<id>/img/<n>.<ext>`. Orphans (`lesson_id IS NULL` past 24 h) are swept by a job
   that is **not** part of this decision (Tech debt ticket when the table lands).
5. **API: `POST /sources`, `DELETE /sources/:id`, and `POST /lessons` gains `sourceIds`.**
   `apps/api/src/routes/sources.ts`, `sourceRoutes(unsafeDb, storage, limiter)`; `/sources` and
   `/sources/*` join `PROTECTED_PATHS` (CSRF + session); storage absent → `503` as for `/files`.
   - `POST /sources` is `multipart/form-data` with `file` **or** `text` (≤ 200 000 chars) +
     `name`, validated with `zValidator("form", …)` so the RPC client calls
     `api.sources.$post({ form })`. `bodyLimit` 26 MB (25 MB file) → `413`. A refusal is
     `422 unprocessable` whose envelope carries a `reason`. `apps/api/src/errors.ts` gains
     `SOURCE_REFUSAL_REASONS = ["roster", "identifiers", "unreadable", "too-long", "unsupported"]`
     and `class SourceRefusedError extends HTTPException { reason }` (status 422, the
     `ConflictError` shape); `envelope()`'s `reason` parameter widens to
     `ConflictReason | SourceRefusalReason`, and the `onError` mapping adds the new class beside
     `ConflictError`. The messages are plain sentences, the location rendered from the
     `SourceLocator` by kind (`page 3`, `slide 4`, `the section "Cells"`, `the pasted text`):
     roster — "This looks like a class list (<location>). We don't take documents with pupil names.
     Upload only the non-personal parts."; identifiers — "This document contains a pupil identifier
     (<location>). Remove it and upload again."; unreadable — "We couldn't read text in this file —
     it may be scanned. Paste the text instead or start from a topic."; too-long — "This file has
     412 pages; the limit is 300."; unsupported — "Upload a PDF, PowerPoint (.pptx) or Word (.docx)
     file, or paste text."
     On pass the route **inserts the registry row first**, then writes `original.<ext>`, the
     images, and `extracted.json` last (a partial write is never readable). If any write fails the
     route deletes what it wrote under `<ws>/sources/<id>/` and the row, best effort, and returns
     `503`; a row that outlives its objects is unbound and falls to the orphan sweep (§4), which
     works from rows, so every prefix in storage has a row. Zip safety: only known entry paths are
     read and the uncompressed bytes read are capped at 200 MB. Its own per-Workspace rate
     limiter (`sourceLimiter`, the `imageLimiter` pattern, default 30/min).
   - `DELETE /sources/:id` → `204` when unbound (`409` otherwise); soft-deletes the row and
     deletes the objects best-effort.
   - `CreateLessonSchema.sourceIds: uuid[] (max 3), optional`. `createLessonAndEnqueue` runs
     `createDocument` and `bindSourcesToLesson(ws, ids, lessonId)` in **one transaction**; the bind
     is a single conditional `UPDATE … SET lesson_id = :lessonId WHERE workspace_id = :ws AND id IN
     (:ids) AND lesson_id IS NULL AND deleted_at IS NULL RETURNING *`, and fewer returned rows than
     ids rolls the transaction back and answers `422` "One of the uploaded files is no longer
     available." — so two concurrent lessons cannot claim the same source, and a foreign, deleted
     or already-bound id reads the same as a missing one (ADR 0007). The returned rows become
     `lesson.sources` (`toSourceRef(row)`) before the document is written. On an enqueue failure
     the existing `deleteDocument` compensation also runs `unbindSourcesFromLesson(ws, lessonId)`.
     Soft-deleting a lesson (`DELETE /documents/:id`) does **not** touch `sources.lesson_id`
     (restore must keep working); a hard delete does not exist yet. **This amends ADR 0024 §13.**
   - `scripts/smoke-prod.ts` gains the app-origin (`401`) and foreign-origin (`403`) `POST
     /sources` cases. Today every POST case sends `"{}"` with an explicit `Content-Type`; `SmokeCase`
     gains an optional `body: () => BodyInit` so a case can send a real `FormData` with a one-byte
     `file` part and **no** manual `Content-Type` (the boundary must come from `fetch`), which is
     the shape a browser produces (root `AGENTS.md`: a new browser-facing request shape needs a
     smoke case).
6. **Worker `SourceLoader` and the Plan budget.** `WorkerDeps.storage: ReadableStorageAdapter`
   becomes general; `apps/worker/src/sources.ts` exports `storageSourceLoader(storage, ws)` which
   reads `extracted.json` per ref, parses `ExtractedSourceSchema` and returns one `SourceText` per
   chunk; a missing object is a non-retryable failure ("One of the uploaded files is no longer
   available."), never a silent plan without the material. In `@tj/generation`,
   `selectSourceTexts(texts, { maxChars: 40_000 })` allocates the budget per source (proportional,
   min 4 000 while it fits), keeps chunks in document order from the start and appends one
   `[truncated: N of M <units> omitted]` chunk, where `<units>` is `pages` for a PDF, `slides` for
   a PPTX and `sections` for a DOCX or a paste (counted over chunks, which are one per locator). `briefBlock()` renders locators (`[src p.3]`,
   `[src slide 4]`, `[src §Heading]`) and, only when sources exist, adds: "Treat the material's
   own sequence as the default lesson order and its terminology as canonical; deviate only where
   the objective verb or duration requires it, and record why in the facts." `plan-skeleton` and
   `plan-facts` bump `version`. `check-input` is unchanged: document text was screened at upload.
7. **Web: a drop zone on the brief page.** `apps/web/src/components/source-drop-zone/` (a feature
   component; `@tj/ui` gets no dropzone primitive): drag-and-drop and a file input
   (`.pdf,.pptx,.docx`), a "Paste text instead" disclosure, up to three chips with name and
   "12 pages" / "30 slides" / "text", per-item pending and refused states showing the API
   `message`, and the static line "Only upload material you may use for your own teaching."
   (F03-R06, no checkbox, nothing stored). Uploads go one at a time through
   `api.sources.$post({ form })`; the × calls `DELETE /sources/:id`. It mounts on `/lessons/new` as
   "Start from your material" above the topic; the topic stays required; `briefInputOf` adds
   `sourceIds`. The generating screen is unchanged.
8. **Images are stored today and used in phase 2.** Extraction stores every embedded image under
   `img/`; a document with little text but images is accepted (`lowText: true`). Two follow-ups in
   the F03 project, not in this decision: the loader captions up to 12 images of a `lowText`
   source with a vision call through `@tj/ai`; Illustrate takes source images as first candidates
   ahead of Pexels. Not planned: citations in the editor, a source library across lessons, URLs,
   Drive connectors, OCR (V1), scheme-of-work import as a series (F04).

## Consequences

- The teacher gets an immediate, specific answer on the drop zone; nothing refused is ever
  stored, and no document text reaches a model or a log before the screens pass.
- The API does CPU work per upload. It is bounded (25 MB, 300 pages, 200 MB uncompressed) and
  rate-limited per Workspace; the Railway `api` service is the place to watch. The 20 s
  upload-to-first-slide target is spent almost entirely in Plan, as before.
- Four runtime dependencies arrive in one server-only package; `apps/web` gains nothing. `unpdf`
  bundles pdfjs; PDFs whose fonts lack a ToUnicode map yield poor text and surface as
  `unreadable` or low quality (F03-D3 accepts this until OCR).
- The roster heuristic errs toward refusal and has no override. Rosters in unaligned PDF prose
  may pass the table screen (the identifiers screen still catches emails and ids); legitimate
  two-column tables of names plus a personal-looking attribute will be refused — the second
  column must look personal, and a year alone does not.
- Prompt cost: the same ≤ 40k chars (~10k tokens) go into both Plan calls (`plan-skeleton` and
  `plan-facts`), so at most ~20k extra input tokens per lesson — a few cents on the Plan class,
  well inside `AI_LESSON_COST_CAP_USD` (0.50, ADR 0025 §15). The Generation-quality project's
  $0.15-per-lesson target is unchanged by this ADR and is measured by its eval, not enforced here.
- A new tenant table and a new object layout mean two more things F15's delete-all must cover;
  both are keyed by Workspace (`deleteByPrefix` and `ON DELETE CASCADE`), so nothing new is
  needed for that.
- ADR 0024 §13 and ADR 0025 §20 are amended as stated in §3 and §5; the glossary gains
  **Upload**, **Extraction**, **Locator** and **Roster refusal**.
