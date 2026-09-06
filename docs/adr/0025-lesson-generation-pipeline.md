# 0025 — Lesson generation: LessonFacts, the `lesson.plan` pipeline, Evaluate and Repair

- Status: Accepted
- Date: 2026-09-06
- Related PRD decisions: F06 (SCOPE Now 5, 6, 7, 9, 10; P2, P4, P7; D-007, D-013, D-017; A2–A5,
  A8), F03 A7 (`Lesson.sources`), F05 A7 (`curriculumRef`), F07 item 1 (`authoredBy`,
  `generatedFrom`); ADRs 0006, 0007, 0012, 0015, 0018, 0021, 0022, 0024

## Context

ADR 0024 put the Brief on the Lesson, created the row, the generating lock and the `lesson.plan`
job with a stub handler, and left to "F06's ADR": whether Plan, Generate, Evaluate and Repair are
one job or several, whether a `progress` payload carries the first slide early, where
`LessonFacts` lives, and how the worker writes (§14, §18, Consequences). F06's project
description is the product spec — one coherent lesson from one `LessonFacts` object: slides in
TeachDeck's kinds, a worksheet, an answer key and teacher notes; schema checks before anything is
shown; one Repair pass; residuals visible; a fact change cascades with undo; a per-lesson cost
cap; versioned prompts; an eval set in CI. Nothing here re-decides that shape.

What the code says today, read on `master` at `9752445`:

- `packages/db/src/documents.ts` `putDocument` updates `WHERE … AND generating_job_id IS NULL`.
  The worker holding the lock therefore **cannot** write through it; ADR 0024 §18's "the worker
  writes through `putDocument` with its own `expectedUpdatedAt`" is not implementable as written.
- The slide layout recipes the editor uses to place text on the 960×540 grid — `layoutSlide`,
  `grid.ts`, the theme catalogue (`THEMES`, `getTheme`, `fontFloor`, `FIT_VERSION`), `docFromText`
  / `docFromBullets` / `docFromNumbered` — live in `packages/editor/src/model/` and reach into
  `slide/elements/kit.ts` (React types) and `text/static.ts`. `@tj/editor` peer-depends on React.
  The worker cannot import them, and a generated slide that is not laid out by those recipes does
  not render like a TeachDeck slide.
- `SlideSchema` and `WorksheetBlockSchema` are `z.object`s: an unknown key such as `generatedFrom`
  is **stripped** on parse, so every metadata field must be declared in `@tj/domain`.
- `JobProgressSchema` is `{ percent?, message? }` and every job-event schema is `strictObject`;
  `JobCompletedEventSchema` carries no payload. `job_events.payload` is `jsonb`.
- `createFakeAi` returns one fixed `text` for every call; `ai@7.0.92` provides `Output.object` /
  `Output.array` and throws `NoObjectGeneratedError` with the model text on a schema miss.
- ADR 0018 §1 said "Mastra or another agent framework is not adopted". The founder now wants
  Mastra's step/workflow ergonomics, Studio in development and its scorers for the eval set —
  but not its storage, server, or model router.
- TEACH-82 (job durability) is open: `runJob` can run a handler twice when the terminal write
  fails (X1), and PR #110 left two residuals — a crash between the row insert and the enqueue
  leaves a lesson locked for ever; a job whose cancel failed may run against a deleted row.

## Decision

1. **`LessonFacts` is an optional field on the Lesson document.** `Lesson.facts?: LessonFacts` in
   `@tj/domain/documents/lesson-facts.ts`, under the ADR 0021 §2 rule (optional, no version bump).
   Every fact carries a stable short id minted by the worker (`o1`, `v3`, `q2`, `x1`, `s4`) that
   is never renumbered; `factRefs` point at these ids. Shape: `objectives[{ id, text,
   curriculumRef?: { scheme, code, version, status: "inferred" | "confirmed" } }]`,
   `vocabulary[{ id, term, definition }]`, `workedExamples[{ id, problem, steps[], answer }]`,
   `questions[{ id, stem, answer, reasoning }]`, `misconceptions[]` (empty at MVP, typed now),
   `outline[{ id, kind: SlideKind, minutes, factRefs[] }]` (the ordered lesson structure Plan
   decides and Generate follows one entry at a time), `durationMin`. `classContext` is read from
   `Lesson.brief`, not copied. Facts live beside the slides so a fact edit and its cascade are one
   document and one undo transaction (ADR 0022 §4); no promoted column, no second table.
2. **Element and block metadata: F07's names, declared now.** `elementBase` in `slide.ts` and
   every `WorksheetBlock` variant gain two optional fields: `generatedFrom?: { factRefs: string[];
   promptVersion: string; model: string; at: string }` and `authoredBy?: "ai" | "teacher"`. F06
   writes both on everything it generates (`authoredBy: "ai"`); the flip to `"teacher"` on first
   manual edit and the stale flag are F07's behaviour, unchanged in shape. A stored lesson without
   the fields still parses; a TeachDeck file is unaffected.
3. **Generation state is on the document.** `Lesson.generation?: { jobId, stage: "planned" |
   "generated" | "evaluated" | "repaired", startedAt, completedAt?, promptVersions:
   Record<stage, string>, usage: { calls, inputTokens, outputTokens, costUsd: number | null },
   findings: Finding[] }`. `stage` is the checkpoint a retry resumes from; `findings` holds the
   model-check findings and the unrepaired schema findings at completion (residuals). Schema
   findings are otherwise **recomputed** client-side by the shared checker (item 9), never trusted
   from storage.
4. **The worksheet is a second `documents` row, linked both ways.** `Lesson.artefacts?: {
   worksheetId: string }` and `Worksheet.lessonId?: string` (both optional additions). The worker
   creates the worksheet with `createDocument(ws, "worksheet", body, { generatingJobId: jobId })`
   during Generate, so it carries the same lock and the editor treats it read-only the same way;
   both locks clear in the handler's `finally`. The answer key is the worksheet's block `answer`
   fields with `includeAnswerKey: true`; teacher notes are `Slide.notes`. Deleting the lesson does
   **not** cascade to the worksheet at MVP.
5. **One job, four stages, checkpointed.** `lesson.plan { lessonId }` (name and payload fixed by
   ADR 0024 §14) runs Plan → Generate → Evaluate → Repair in one pg-boss job. After each stage the
   worker writes `generation.stage`; a retry (pg-boss `retryLimit: 1`, or TEACH-82's guard) reads
   the row and resumes from the stage after the checkpoint instead of re-spending Plan. A chain
   of jobs is rejected: it would re-lock the row four times and hand the lock across four
   at-least-once boundaries. Cancel (`signal.aborted`) is checked between model calls; what was
   written stays.
6. **The worker writes through `putDocumentAsJob`.** `packages/db/src/documents.ts` gains
   `putDocumentAsJob(ws, id, body, jobId): Promise<{ status: "ok"; row } | { status: "lost_lock" }
   | { status: "missing" }>` — `UPDATE … WHERE id = :id AND generating_job_id = :jobId`. The lock
   is the concurrency token; no `expectedUpdatedAt`. On `lost_lock` or `missing` the handler stops
   with `NonRetryableError` and writes nothing further (a newer job owns the row, or the row was
   hard-deleted by `POST /lessons`' failure path — the second PR #110 residual is closed by
   construction). This amends ADR 0024 §18. Teachers keep `putDocument` and its 409s; P4 holds:
   while the lock is set nobody but the job writes.
7. **First slide early: write early, refetch on progress.** No slide content travels in a job
   event. Immediately after Plan the worker materialises the `title` and `objectives` slides
   deterministically from `LessonFacts` (no model call) and writes them; Generate then writes the
   document **after every slide**. `JobProgressSchema` gains an optional
   `documentUpdatedAt: IsoDateTime`; the read-only editor refetches `GET /documents/:id` when it
   changes and the slides appear one by one. ADR 0012's event types are unchanged; this amends its
   payload shape only.
8. **The model produces content, never geometry.** Generate asks for a per-kind **slide spec** —
   a Zod discriminated union on `kind` (e.g. `{ kind: "multiple-choice", stem, options: [{ text,
   correct }], explanation, notes, factRefs }`) — and a pure `materialiseSlide(spec, themeId, ids)`
   fills the layout recipe with it: coordinates, `RichDoc`s, option element ids, `question` data,
   `generatedFrom` on every element. `parseLesson` passes by construction; Evaluate is about
   pedagogy, not shape. The same holds for worksheet block specs. Allowed slide kinds: `title`,
   `objectives`, `starter`, `vocabulary`, `content`, `worked-example`, `instructions`,
   `discussion`, `true-false`, `multiple-choice`, `matching`, `fill-gap`, `sort`, `open-response`,
   `exit-ticket`, `plenary`. Excluded until an image source exists: `image-text`, `image-match`
   (ADR 0021 §5 still rules; no image elements are generated), and `timer`, `blank`, `embed`.
   Allowed worksheet blocks: `heading`, `instructions`, `paragraph`, `question`,
   `multiple-choice`, `fill-gap`, `matching`, `word-bank`.
9. **The layout recipes move to a pure package `@tj/slides`.** `packages/slides` holds the theme
   catalogue (`THEMES`, `getTheme`, `DEFAULT_THEME_ID` re-export, `fontFloor`, `textRole`,
   `MIN_FONT_SIZE`, `FIT_VERSION`), `grid.ts`, `layouts.ts` (`layoutSlide`, `SLIDE_KIND_*`),
   the rich-doc builders (`docFromText`, `docFromBullets`, `docFromNumbered`) and
   `materialiseSlide`; dependencies are `@tj/domain`, `nanoid` and `zod` only — no React, no
   Tiptap, no CSS. `@tj/editor` re-exports what it exported before so no import site in `apps/web`
   changes; `apps/worker` (through `@tj/generation`) imports it directly. Whatever the recipes
   need from `slide/elements/kit.ts` (`resolveFontSize`, `resolveTextStyle`) and `text/static.ts`
   (`docToPlainText`) moves with them; `kit.ts` re-exports. A build-guard test like
   `packages/editor/src/thumb.test.ts` pins that `@tj/slides` bundles without `react` or
   `@tiptap/*`. This amends ADR 0021 §1 ("the theme catalogue … live in `@tj/editor`") and
   ADR 0022 §1's dependency list; ADR 0013's package map gains a row.
10. **The shared checker lives in `@tj/domain`.** `@tj/domain/documents/checks.ts` exports
    `checkLesson(lesson: Lesson, worksheet?: Worksheet): Finding[]` — pure, zod-only, identical in
    the worker and the editor. `Finding = { check: string; severity: "error" | "warning"; target:
    { slideId?, elementId?, blockId?, factId? }; message: string; fix?: RepairHint }`. The F06
    checks and their severities: every question slide and question block has an answer
    (`error`); every objective is referenced by ≥1 slide **and** ≥1 worksheet block (`error`);
    every vocabulary term used in slide text exists in `facts.vocabulary` (`warning`); outline
    minutes sum to `durationMin` ± 10 % (`warning`). Rich text is read with a pure
    `richDocToPlainText` in domain. The editor runs `checkLesson` debounced (800 ms, the autosave
    interval) after every save and renders residuals as a lint badge; model checks are **not**
    re-run on manual edits at MVP.
11. **Evaluate = schema checks, then one model call.** After Generate the worker runs
    `checkLesson`, then one structured call over `facts` + the plain-text projection of every
    slide and block asking for findings in the same `Finding` shape (answer correctness,
    terminology, age fit), model class `small`. Model findings are appended to
    `generation.findings` and never trigger Repair on their own unless `severity: "error"`.
12. **Repair is one targeted pass and the job still completes.** Repair regenerates only the
    slide/block specs named by `error` findings (same materialise path, with the finding in
    context), re-runs `checkLesson`, and writes whatever remains as residuals. Repair never runs
    twice automatically; if a residual `error` stays, the lesson is still complete and the badge
    says so. A job fails (`failed { retryable }`) only when Plan or Generate cannot produce a
    document at all.
13. **Model classes per stage (ADR 0018 §4):** Plan `standard`, Generate `standard`, Evaluate
    (model checks) `small`, Repair `standard`, proposal jobs (item 18) `standard`. `frontier` is
    not used in F06: Plan has a 10-second budget. Per-stage overrides are not added now.
14. **Structured output through `Output.object`, one retry on a schema miss.** Every stage calls
    `generateText({ model: ai.model(cls), output: Output.object({ schema }), abortSignal })`. On
    `NoObjectGeneratedError` the call is retried **once** with the validation issues in context
    (F06 item 4); a second miss is a typed `StageFailure` the pipeline surfaces (Plan/Generate:
    job fails; Evaluate/Repair: recorded as a finding, job completes). No third attempt, no
    text-and-parse path.
15. **Cost: a USD cap with a token fallback.** `@tj/ai` gains `PRICES: Record<modelId, {
    inputPerMTok, outputPerMTok, cachedInputPerMTok }>` for the three `DEFAULT_MODEL_IDS`, a
    `costUsd(modelId, usage): number | null` helper, and a `createBudget({ capUsd, capTokens })`
    that every stage charges after each call and consults before the next. Env (contract in
    `infra/env.contract.ts`): `AI_LESSON_COST_CAP_USD` default `0.50`, `AI_LESSON_TOKEN_CAP`
    default `300000`, `AI_EVAL_RUN_COST_CAP_USD` default `3.00`. A configured model id with no
    price logs a `warn` at boot and is capped by tokens instead — the cap is never silently absent.
    Exceeding the cap stops generation between calls, keeps what was written, records a
    `budget` finding and completes the job; the teacher is told.
16. **Logging (ADR 0015).** Never prompts, model output or document content. The existing `ai`
    pino line from `@tj/ai`'s middleware gains, when the caller supplies them, `lessonId`,
    `jobId`, `stage`, `promptVersion`, `costUsd`; one `generation summary` info line per job
    carries stages run, calls, tokens, cost, findings by severity and `durationMs`.
17. **Pipeline package and prompt files.** A server-only `packages/generation` (`@tj/generation`)
    holds the stages, the spec schemas, `materialise*`, the budget wiring and the prompts; it
    depends on `@tj/domain`, `@tj/ai`, `@tj/slides`, `@mastra/core`, `ai`, `zod`. The worker
    handler is orchestration and persistence only. Prompts are TypeScript modules
    `src/prompts/<stage>.ts` exporting `{ version: "plan.v1", system, user(input) }`; the version
    string is written to `generatedFrom.promptVersion` and `generation.promptVersions`, and a test
    pins a hash of each prompt's text to its version so a wording change without a bump fails CI.
18. **Cascade and regenerate are unlocked proposal jobs.** `lesson.cascade { lessonId,
    changedFactIds[] }` and `lesson.regenerate { lessonId, targets: [{ slideId, elementId? |
    blockId }], instruction? }` are enqueued by `POST /lessons/:id/cascade` and
    `POST /lessons/:id/regenerate` with `singletonKey` `<lessonId>:<job>`. They do **not** set
    `generating_job_id` — the teacher keeps editing. The worker reads the current document,
    computes the impact set (every element/block whose `generatedFrom.factRefs` intersects
    `changedFactIds`, skipping `authoredBy: "teacher"`, which are returned as `flagged` for F07),
    re-derives specs in parallel (bounded concurrency 4) and returns them. It never writes the
    document. The editor applies the proposals through one reducer inside
    `beginTransaction`/`endTransaction` (one undo step, ADR 0022 §4) and shows "Auto changed on
    slides N and M to match" with Undo and View. The regenerate preview is the impact set computed
    client-side from `factRefs`, no model call.
19. **Job results ride on the `completed` event.** `JobCompletedEventSchema` gains an optional
    `result` whose schema is per job name (`JobResultSchemas`, `lesson.cascade` and
    `lesson.regenerate` → `{ proposals: [...], flagged: [...] }`; `lesson.plan` → none). `runJob`
    accepts a handler return value and writes it into the terminal event; the SSE stream the
    editor already follows delivers it. Bounded to a few elements; not a general result store.
    This amends ADR 0012.
20. **`Lesson.sources` is reserved as references.** `Lesson.sources?: SourceRef[]`, `SourceRef =
    { id, kind: "file" | "paste", name, storageKey?, pages? }` — no extracted text in the body.
    Plan takes `sourceTexts: { sourceId, ref: { page? | slide? }, text }[]` from a `SourceLoader`
    the worker owns (`deps.sources`), stubbed to `[]` until F03. `curriculumRef` on objectives is
    reserved for F05; Plan marks model-inferred objectives with no `curriculumRef`.
21. **Mastra, in-process only.** `@tj/generation` composes the four stages with
    `createStep`/`createWorkflow` from `@mastra/core/workflows` and exports `lessonWorkflow`; the
    handler runs `lessonWorkflow.createRun({ runId: jobId }).start({ inputData })` with `ai`,
    `budget`, `signal`, `logger` and the persistence callbacks passed through `RequestContext`.
    No `new Mastra()` in production, no Mastra storage (checkpoints are item 3), no Mastra model
    router (models come from `@tj/ai`, ADR 0018 §3), Mastra step retries off (item 14 owns the
    retry), `MASTRA_TELEMETRY_DISABLED=1` in the env contract for api and worker (its core pulls
    `posthog-node`). A dev-only `packages/generation/src/mastra.dev.ts` builds a `Mastra` instance
    with in-memory storage for `bun run studio:generation` (Studio); `@mastra/evals` scorers wrap
    the checker and model findings in the eval script only. This amends ADR 0018 §1.
22. **Testing.** `createFakeAi` gains `script: Array<string | ((call) => string)>` consumed in
    call order and a `calls` record (class, model id, count) so tests assert the sequence; stage
    fixtures live under `packages/generation/src/fixtures/`. Coverage: unit tests per stage and
    per check; `apps/worker/src/jobs/lesson-plan.integration.test.ts` on the real pg-boss loop and
    compose Postgres (pattern `apps/api/src/routes/lessons.integration.test.ts`) asserting facts,
    slide count, the worksheet row, findings, both locks cleared and event order; Playwright
    asserts only the read-only → editable transition with the worker on the fake (`AI_FAKE_SCRIPT`
    env switch, test/dev only). Golden documents are the fixtures' materialised output.
23. **Eval set in CI: free part always, paid part gated.** The schema-check half of the eval set
    (fixture briefs → fixture lessons → `checkLesson`) runs on every PR. The paid half runs only on
    `workflow_dispatch` or the `run-eval` PR label, needs `AWS_BEARER_TOKEN_BEDROCK` as a GitHub
    Actions secret the founder adds, is capped by `AI_EVAL_RUN_COST_CAP_USD`, and posts tokens and
    cost against the last `master` run.
24. **TEACH-82 gates the pipeline; residuals are self-healed.** TEACH-82 FR 1–5 (terminal-event
    guard, one terminal row per job, cancel re-read) land before the pipeline handler ticket: a
    double run is a double spend. The first PR #110 residual (row locked, no job) is closed here:
    `GET /documents/:id` clears a `generating_job_id` whose job has a terminal event or no
    `queued` event after 10 minutes (`releaseStaleLock` in the repository, logged). The second is
    closed by item 6.
25. **Frontend.** In the read-only editor: progress from the job stream, slides appearing (item
    7), a lint badge fed by `generation.findings` + `checkLesson`, and a facts panel (edit an
    objective, term, question; add/remove) whose edit dispatches an `updateFact` reducer and
    enqueues `lesson.cascade`; proposals apply as one transaction with the toast (item 18).
    Components come from `@tj/ui`; anything new is added there (ADR 0009).

## Consequences

- `@tj/domain/documents` gains `lesson-facts.ts`, `checks.ts`, `rich-text` plain-text
  projection, `Finding`, `SourceRef`, `generatedFrom`/`authoredBy` on elements and blocks,
  `Lesson.generation`, `Lesson.artefacts`, `Worksheet.lessonId`; `@tj/domain/jobs.ts` gains
  `lesson.cascade`, `lesson.regenerate`, `JobResultSchemas`, `documentUpdatedAt`. Still zod only.
- Two new packages: `@tj/slides` (pure recipes) and `@tj/generation` (server-only pipeline).
  `@tj/editor` shrinks by the moved files and re-exports them. ADR 0013's map gains both rows.
- `@tj/ai` gains prices, `costUsd`, `createBudget`, the scripted fake and richer log fields; it
  stays a thin client (ADR 0018 §2). `@tj/db` gains `putDocumentAsJob`, `releaseStaleLock` and
  `createDocument` for worksheets under a lock. `@tj/jobs` `runJob` carries a result into the
  terminal event.
- `@mastra/core` enters the dependency tree of the worker image (`IMAGE_WATCH` must list
  `packages/generation/**` and `packages/slides/**`, ADR 0018 Consequences pattern). Its telemetry
  is disabled by env; its storage and server are not used. Revisit if a second engine beside
  pg-boss ever starts to own retries or state.
- Amendments: ADR 0012 (progress `documentUpdatedAt`, `completed.result`); ADR 0018 §1 (Mastra
  in-process); ADR 0021 §1 (catalogue moves to `@tj/slides`); ADR 0022 §1 (dependency list);
  ADR 0024 §14 and §18 (one job; `putDocumentAsJob`). ADR 0013's package map: two rows.
- Env contract grows by `AI_LESSON_COST_CAP_USD`, `AI_LESSON_TOKEN_CAP`,
  `AI_EVAL_RUN_COST_CAP_USD`, `MASTRA_TELEMETRY_DISABLED`, and the test-only `AI_FAKE_SCRIPT`.
- Generated lessons have no images and no `timer` slides until an image source and a timing
  spec exist; the teacher adds them. F07 finds `authoredBy`/`generatedFrom` already in place and
  ships behaviour only. F05 fills `curriculumRef`; F03 fills `Lesson.sources` and the loader.
- The worksheet is not deleted with its lesson (item 4); F15's retention work decides cascade.
- Costs: about 16 model calls per lesson (1 Plan + ~12 Generate + 1 worksheet + 1 Evaluate + ≤1
  Repair) on `standard`/`small`; the first baseline is recorded by the eval ticket (F06 item 9).

## Open

Nothing at the time of acceptance. Deferred: per-stage model-class overrides (F13), model checks
on manual edits (cost), image generation or search for `image-text` / `image-match` (needs
`POST /files`), worksheet deletion cascade (F15), a Mastra-persisted run state (only if Studio
time-travel on production runs is ever wanted).
