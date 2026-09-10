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
   findings are otherwise **recomputed** client-side by the shared checker (item 10), never trusted
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

   **Amended 2026-09-07 (TEACH-137): an input check runs first.** A `check-input` step precedes
   Plan in the same job: the Identifier guard re-run over the Brief's free text, then one `small`
   call (`check-input.v<n>`) reporting `learner-name`, `unsafe-content` or `not-a-lesson` findings.
   Any finding stops the run with `InputRejected` (the findings, content-free) before anything is
   persisted; the worker maps it to a non-retryable failure. The step writes no checkpoint: a
   lesson with no `generation` runs it again, a lesson at `planned` or later never does.
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

   **Amended 2026-09-07 (TEACH-138): the title slide comes before any model call, and Plan is two
   calls.** Nothing is visible until the first persist, so the `title` slide is materialised from
   the Brief alone (`generatedFrom.promptVersion: "brief"`, `model: "none"`) and written before
   Plan's first call. Plan then makes two `standard` calls instead of one: a **skeleton** call
   (`plan-skeleton.v<n>`: objectives and outline, whose `factRefs` may name objectives only) after
   which the `objectives` slide is materialised and the skeleton-only facts written, and a
   **facts** call (`plan-facts.v<n>`: vocabulary, worked examples, questions, and the outline
   entries each supports) after which the merged `LessonFacts` are written with
   `generation.stage: "planned"`. The two intermediate persists carry **no** `generation` key —
   `stage` is the checkpoint and must not be claimed before the facts exist; a retry that finds a
   lesson without one re-runs Plan and keeps the title slide it left. `promptVersions.planned`
   records both versions as `plan-skeleton.v<n>+plan-facts.v<n>`. The first `progress` events
   are `2 "Starting"`, `6 "Planned the lesson"`, `10 "Planned"`. Plan's output is also trimmed
   (`reasoning` ≤ 120 chars, ≤ 4 worked-example steps, ≤ 6 terms) so the facts call is short;
   Generate is unchanged and stays sequential (a parallel Generate was considered and rejected).
   A budget stop on the facts call keeps the skeleton facts, records the `budget` finding and
   still reaches `planned` (item 15); Generate does not add a second `budget` finding.
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
   `MIN_FONT_SIZE`, and the `FIT_VERSION` constant, which tracks the floors the recipes lay out
   against; the re-fit itself — `fitVersion` handling and `use-fit-migration` — stays in the
   editor as ADR 0021 §3 says), `grid.ts`, `layouts.ts` (`layoutSlide`, `SLIDE_KIND_*`),
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
    the worker and the editor. When `worksheet` is omitted the worksheet half of the objective
    check is skipped (no finding, not a pass); the worker always passes the worksheet it created,
    and the editor passes it once `Lesson.artefacts.worksheetId` has loaded. `Finding = { check:
    string; severity: "error" | "warning"; target: { slideId?, elementId?, blockId?, factId? };
    message: string; fix?: RepairHint }`. The F06
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
    **Amended 2026-09-08: a deterministic repair runs when the first validation fails.** Sonnet 5 and Haiku 4.5
    get their schema from the Bedrock provider as a forced `json` tool, and a tool input sometimes
    arrives with a list — or the whole answer — serialised as a JSON *string*
    (`{ "learningObjectives": "[{…}]" }`; two production Plan failures on 2026-09-07). The text is
    validated by `Output.object` as before; only when that fails does `repairJsonText`
    (`packages/generation/src/repair-json.ts`) parse any string property that is itself JSON and
    hoist an answer wrapped under its own first key, and the repaired text is validated the same
    way. If it passes it is the answer (logged as `repairs: [...]`, kinds only); if not, the
    original miss goes to the one retry as before. The retry prompt ends with a shape
    reminder (lists are arrays, never JSON-in-a-string, nothing wrapped in a string) and drops the
    checks zod runs on a path after a wrong type there, since the follow-on message ("Too big:
    expected string to have <=4 characters" for a string where an array was due) misleads the
    model. This is not a text-and-parse path: `Output.object` and its schema still drive the
    call; the repair is a pure function of the text with no model involvement.
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
    `result: JobResultSchema`, a `z.discriminatedUnion("job", [...])` whose members are declared
    per job name in `@tj/domain/jobs.ts` (`{ job: "lesson.cascade" | "lesson.regenerate",
    proposals: [...], flagged: [...] }`; `lesson.plan` returns none). A `job_events` row carries no
    job name, so the discriminator is inside the result and SSE consumers narrow on `result.job`.
    `runJob` accepts a handler return value and writes it into the terminal event; the SSE stream
    the editor already follows delivers it. Bounded to a few elements; not a general result
    store. This amends ADR 0012.
20. **`Lesson.sources` is reserved as references.** `Lesson.sources?: SourceRef[]`, `SourceRef =
    { id, kind: "file" | "paste", name, storageKey?, pages? }` — no extracted text in the body.
    This supersedes ADR 0024 §13's "no field is reserved now"; `POST /lessons` still takes no
    `sourceIds` until F03 adds them.
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
    cost against the last `master` run. This is the first eval harness; ADR 0018 deferred "eval
    harness" to F13, which keeps the general harness and routing policy.
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
- Amendments: ADR 0012 (progress `documentUpdatedAt`, `completed.result`); ADR 0018 §1 and
  Consequences (Mastra in-process; the F06 eval set); ADR 0021 §1 and §3 (catalogue and
  `FIT_VERSION` move to `@tj/slides`); ADR 0022 §1 (dependency list); ADR 0024 §13, §14 and §18
  (`Lesson.sources` reserved; one job; `putDocumentAsJob`). ADR 0013's package map: two rows.
- Env contract grows by `AI_LESSON_COST_CAP_USD`, `AI_LESSON_TOKEN_CAP`,
  `AI_EVAL_RUN_COST_CAP_USD`, `MASTRA_TELEMETRY_DISABLED`, and the test-only `AI_FAKE_SCRIPT`.
- Generated lessons have no images and no `timer` slides until an image source and a timing
  spec exist; the teacher adds them. F07 finds `authoredBy`/`generatedFrom` already in place and
  ships behaviour only. F05 fills `curriculumRef`; F03 fills `Lesson.sources` and the loader.
- The worksheet is not deleted with its lesson (item 4); F15's retention work decides cascade.
- Costs: about 17 model calls per lesson (2 Plan + ~12 Generate + 1 worksheet + 1 Evaluate + ≤1
  Repair) on `standard`/`small`; the first baseline is recorded by the eval ticket (F06 item 9).

## Open

Nothing at the time of acceptance. Deferred: per-stage model-class overrides (F13), model checks
on manual edits (cost), image generation or search for `image-text` / `image-match` (needs
`POST /files`), worksheet deletion cascade (F15), a Mastra-persisted run state (only if Studio
time-travel on production runs is ever wanted).

## Amendment (2026-09-09, project Generation quality — TEACH-206)

§23 said the paid half "posts tokens and cost against the last `master` run". It now also scores
quality: a **rubric judge** scorer (`packages/generation/eval/scorers.ts` `rubricJudgeScorer`,
prompt `eval/rubric-prompt.ts`) makes one structured call per brief on the `frontier` class through
`callStructured` and scores eight dimensions 1–5 (`correctness`, `depth`, `pitch`, `coherence`,
`questionQuality`, `notes`, `worksheetValueAdd`, `imageFit`; `imageFit` is `null` without a placed
photograph). The scores and their per-dimension means go to `eval/results/<sha>.json` and to the
PR comment as `now − master` rows beside cost and duration; the judge's one-line rationales are
written to the gitignored results file only and never to CI output (ADR 0015). The judge is
charged to the run's budget (`AI_EVAL_RUN_COST_CAP_USD`), runs in the paid half only — the schema
half still never spends — and is eval-only: the prompt is not in `PROMPTS`, not pinned by
`prompts.test.ts` and never runs in production. The first `workflow_dispatch` run on `master`
after this lands is the project's baseline; the `frontier` model the judge runs on is whatever
`AI_MODEL_FRONTIER` names (the model-classes ticket moves it to GPT-5.6 Sol and re-baselines).

## Amendment (2026-09-09, project Generation quality — TEACH-207)

§13 deferred "per-stage overrides" to F13. The first one lands here, as reasoning effort rather
than model class: `CallStructuredOptions.effort: "low" | "medium" | "high"` is **required** on
every call, so no stage runs at the provider's default by omission, and `callStructured` sends it
to Bedrock as `providerOptions.bedrock.reasoningConfig.maxReasoningEffort` (which
`@ai-sdk/amazon-bedrock` maps to `reasoning.effort` for an OpenAI id; for an Anthropic id nothing
is sent, since `@tj/ai` disables thinking there and the `small` Haiku may not accept
`output_config.effort`). The retry carries the same effort. Values are set at the call sites, never
in a prompt or in `create-ai.ts`'s per-class middleware: Generate (slides and worksheet),
check-input, the illustrate judge, Repair, cascade and regenerate run at `low`; plan-skeleton,
plan-facts and Evaluate at `medium` (the project's §6 table is the hypothesis; its A/B ticket
decides the contested cells). `AiCallContext.effort` puts the value on every `ai` log line beside
`durationMs`. This is the fix for the 168-second Luna lesson of 9 Sept 2026 (TEACH-205).

## Amendment (2026-09-09, project Generation quality — TEACH-209)

§1's `LessonFacts` grows so depth, correctness and coherence can be properties of the facts rather
than of slide wording. New, all optional on a stored lesson (ADR 0021 §2): `keyIdeas[]`
(`{ id: k<n>, statement, explanation, example, analogy?, objectiveRefs }`, the teaching points
`content` slides are built from); `misconceptions[]` changes shape from `{ id, text }` to
`{ id: m<n>, belief, correction, objectiveRefs }` (`migrate()` maps the old shape; no stored lesson
carried one); `questions[]` gain `objectiveRefs?`, `distractors?[{ text, misconceptionRef? }]`,
`use?: slide | worksheet | exit | any` and `tier?: easy | core | stretch`;
`workedExamples[].misconceptionRef?`; `vocabulary[].objectiveRefs?`; `outline[].brief?
{ adds, avoids? }`; `facts.pitch? { readingAgeTarget, sentenceLengthMax, avoid[] }`.
`LessonFactsSchema` checks that every `objectiveRefs` entry is an existing `o` id and every
`misconceptionRef` an existing `m` id, and `factRefs` may point at `k` and `m` ids. §10's
`objective-coverage` resolves through this graph: a slide or block covers an objective when its
`factRefs` name it or name a fact linked to it (by the fact's `objectiveRefs` or by an outline entry
listing both), which removes the false "not covered by the worksheet" errors blocks referencing
questions produced. `assignFactIds` mints `k` and `m` and resolves the ordinal links; `factsBlock`
renders the new lists, so every prompt version is bumped. The prompts that ask Plan for the new
facts are the Plan-prompts ticket's.

## Amendment (2026-09-09, project Generation quality — TEACH-208)

§13's class table is superseded by the project's per-stage table (Generation quality §6), read
with ADR 0018's amendment of the same date (Luna / Terra / Sol). Class and reasoning effort per
stage:

| Stage | Class | Effort | Why |
| -- | -- | -- | -- |
| check-input | small (Luna) | low | form check |
| plan-skeleton | standard (Terra) | medium | decides the lesson's shape |
| plan-facts | standard (Terra) | medium | the substance; where depth comes from |
| verify (TEACH-212) | standard (Terra) | high | correctness, one call |
| generate (slides, worksheet) | small (Luna) | low | fills a given shape; latency-critical |
| illustrate judge | standard (Terra) | low | small → standard, 2026-09-10 (TEACH-222): the small class passed a llama as a rodent; ≈ +$0.02 a photo |
| evaluate | standard (Terra) | medium | must be right to be trusted |
| repair | small (Luna) | low | targeted rewrite |
| cascade / regenerate | small (Luna) | low | unchanged behaviour |

Effort is per call (TEACH-207 amendment). **Class routing is not all in place yet:** this
amendment lands the ids; Generate, Repair and the proposal jobs still call `standard` until the
Generate ticket (TEACH-213) moves them to `small`, so in the interim a lesson runs Plan, Generate
and Repair on Terra (≈ $0.12–0.20 a lesson) — accepted for the days between the two tickets.
`frontier` (Sol) is the eval judge only and never a pipeline stage. The two contested cells
(Generate on Luna vs Terra; Evaluate on Terra vs Luna-high) are decided by the project's A/B
ticket (TEACH-221) with eval data; the table is the hypothesis.

## Amendment (2026-09-09, project Generation quality — TEACH-210)

§10's shared checker grows from four schema checks to nine, and §8's spec schemas become a
sanitiser. In `@tj/slides` `specs.ts`, every text slot decodes HTML entities before its length cap
and refuses house-rule or prompt vocabulary; `notes` refuses repair commentary; `multiple-choice`
options, `matching` sides and `sort` steps must be distinct; a `footnote` may not repeat an item;
`sort` refuses a classify stem or same-first-word steps; `true-false` refuses two long claims joined
by "and". Each is a validation issue with a message written for the model, so `callStructured`'s one
retry (§14) sees it. In `@tj/domain`, `checkLesson` adds `readability` (warning; prose kinds only,
against `facts.pitch`, sentence length and a Flesch–Kincaid reading age), `repetition` (warning; a
stem asked twice across slides and sheet, or a five-word phrase recurring four or more times —
counts only, never the phrase), `explanation-share` (warning; explain-kind minutes under 30 %),
`degenerate-question` and `leaked-language` (errors, with `regenerate-slide` / `regenerate-block`
hints) — the sanitiser's rules re-applied to a stored document. The rules live in
`documents/text-guards.ts` and `text-metrics.ts`; the checks in `documents/quality-checks.ts`; the
plain-text projections `slideText` / `blockText` moved from `@tj/generation` to
`@tj/domain/documents/text.ts` so the checker measures the text Evaluate reads. `SCHEMA_CHECKS`
is the single source the eval's scorer reads. The fixtures were made clean against the new checks
(the worksheet fixture repeated the multiple-choice slide's stem — Problem 2 in miniature — and the
skeleton fixture explained for 15 of 60 minutes).

## Amendment (2026-09-10, project Generation quality — TEACH-211)

§7's two Plan calls now produce the richer `LessonFacts` of the TEACH-209 amendment and a lesson
shape that teaches before it tests. `plan-skeleton` (v6) writes a `phase` on every outline entry
after the two Plan materialises itself — `starter` → `explain` → `practise` → `check`, in order,
each present at least once — and a `brief { adds, avoids? }` saying what the slide contributes
that no other does; explain-phase minutes are at least 30 % of the lesson, and a class the teacher
marked "New to it" gets a content or worked-example slide per objective. The schema is a factory,
`planSkeletonSchemaFor({ durationMin, answers })`, because those two rules read the brief. The
picture brief becomes concrete: `mustShow` is a list of one to four nouns a camera captures,
`purpose` one of `identify-parts | observe | compare | context`, `avoid?` a list; the stored
`ImageBriefSchema` coerces the older string form and defaults the purpose, so earlier lessons
parse unchanged. `plan-facts` (v4) asks for 2–5 key ideas, 2–4 misconceptions, up to 8 terms and
4 worked examples, 12–20 questions each with `tier`, `use`, `objectiveRefs` and distractors tied to
misconceptions, and the `pitch`; a content entry must receive a key idea and a worked-example
entry a worked example, checked in `planFactsSchemaFor`. `MAX_OUTPUT_TOKENS` rises to 2 500 / 7 000.
The TEACH-138 caps (6 / 3 / 8) are lifted: the facts call is the substance of the lesson and is
allowed to be long; its wall time on Terra `medium` is the number to watch (the project's fallback
is the skeleton at `low` first). Generate does not yet read the briefs or key ideas — that is the
Generate ticket; the resume path (`existingSkeleton`) rebuilds phase, brief and picture brief.

## Amendment (2026-09-10, project Generation quality — TEACH-212)

§7's Plan is three calls, not two. After the facts call and `assignFactIds`, **Verify** — one
`standard` call at `high` effort, prompt `verify-facts.v1` — reads the merged facts as a subject
specialist and returns a patch of at most twelve corrections (`factId`, `field`, optional step
`index`, `value`, `reason` from a closed set); `verifyOutputSchemaFor(facts)` refuses an unknown or
objective id, a field the fact's kind lacks, a step that does not exist or a value over that
field's own limit, with messages the retry can act on; `applyVerifyPatch` applies it immutably and
re-parses the facts. Each applied correction leaves a content-free `fact-verify` warning
(`"<Kind> <field> corrected: <reason>."`) on `generation.findings`, which Evaluate now carries with
`budget` and `image`. Verify is inside Plan (project Decision 1: a separate call, not a self-check
inside plan-facts) and is not a stage: no checkpoint, no persist of its own — it announces itself
as progress `8 "Checking the facts"` on the skeleton persist and the `planned` persist carries the
result with `promptVersions.planned = plan-skeleton.vN+plan-facts.vN+verify-facts.v1`. A cap stop
skips it (one budget finding at most); two schema misses leave the facts as they were and one
`fact-verify` warning with no target; the job never fails on Verify. A lesson resumed at `planned`
is not re-verified, because Plan is skipped whole. Plan's wall time gains one Terra `high` call
(~$0.017 a lesson); the project's A/B ticket owns the fallback if Plan's 30 s p50 is exceeded.

## Amendment (2026-09-10, project Generation quality — TEACH-213)

§7 rejected parallel Generate because coherence needed the previous slide's text. The TEACH-211
amendment removed that reason: every outline entry carries a `brief { adds, avoids? }`, so a slide
can be written from the plan alone. Generate now runs its slide calls four at a time
(`GENERATE_CONCURRENCY`, `runBounded` moved to `stages/shared.ts`), each given its own brief, its
neighbours' `adds`, the facts its entry references (`referencedFacts`: only those, plus every
misconception and the pitch), its phase and the stems reserved for other slides or the sheet
(`stemPlan`); a `content` slide is built from its key idea, a question slide from its question with
the distractors verbatim, and `notes` name the misconception and a question to ask. Slides are
**persisted in outline order** as each lands — slide *i* waits for slide *i − 1*'s persist — so one
persist is in flight at a time, `slides.length` grows by exactly one per write and the read-only
editor's `pendingSlides` still holds. The worksheet call runs concurrently from its own question
pool (`use: worksheet | any`) in three tiers, with the slide and exit-ticket stems excluded, and each
block's `factRefs` names its question and objectives; it is persisted with the final `generated`
write as before. Both calls move to the `small` class at `low` effort (§13: the cost model depends
on it). A budget stop lets in-flight calls finish, starts none, keeps what was written and names
the first slide that could not be generated; a slide that fails twice still fails the stage (§14) and
stops the other workers from starting more — graceful per-slide failure is a follow-up. The
`content` recipe has no free `small` slot for an example, so the key idea's example goes into
`body`; no `example` spec slot was added.

## Amendment (2026-09-10, project Generation quality — TEACH-216)

§11's model half of Evaluate becomes a closed rubric with evidence. `evaluate.v3` names one of
seven checks — `answer-correctness`, `fact-consistency` (the only two that may be `error`),
`kind-misuse`, `repetition`, `pitch`, `notes-quality`, and `image-fit` reserved for the
picture-first ticket; `terminology` and `age-fit` are retired as subsumed — and every finding
carries `evidence`, the exact span of slide or block text it is about (`Finding.evidence?` in
`@tj/domain`, optional, never set by schema checks, never rendered by the badge, never logged). The
call moves to the `standard` class at `medium` effort and sees each slide's notes beside its text
so `notes-quality` can judge them. `knownTargetsWithEvidence` drops a finding whose target does
not exist or whose evidence is not in that target's text (case and whitespace aside; a lesson-level
finding may quote a fact) and logs only the count — dropping is cheaper than a retry, and the
false-positive rate is the point. §12's Repair runs on the `small` class at `low` effort with each
finding's evidence in context and the rule that `notes` are for the teacher, not a change log (the
TEACH-210 sanitiser refuses commentary at validation). Facts first: a `fact-consistency` finding
that names `target.factId` triggers one `repair-fact.v1` call — Verify's correction shape,
`verifyOutputSchemaFor` and `applyVerifyPatch` reused, corrections filtered to that fact — applied
to the facts before the artefact is regenerated from them, with one `fact-verify` warning per
applied correction; a fact patch is not one of the six targets. A better Evaluate may raise the
eval's `modelFindings` count (more real findings); the rubric is the quality signal.


## Amendment (2026-09-10, project Generation quality — TEACH-220, part 1)

§7 and §8: the picture comes before the text for an `image-text` slide, and the picker looks at
the pictures (project §3b, Decision 6). Generate starts one `pickPhoto` per `image-text` outline
entry as soon as it starts, alongside the first slide batch; that entry's slide call waits for its
own pick and no other, and the chosen photograph lands in the slide's image slot in the same
persist as the slide's text — no placeholder is ever written for a slide that has a photo. The
judge (`pick-or-requery-photo.v3`, `small` class) receives the candidates' thumbnails as image
parts, numbered to match their ids, and answers `{ pick, visible, count, query }`; a deterministic
gate places only when `visible ⊇ mustShow` (the TEACH-211 list of concrete nouns). A pick that
fails the gate is treated as its `query` when one is given — the requery's pool goes through a
second judge call with the same gate, never placed blind — else as none; at most two judge calls
per slide. What the judge saw is stored on the element (`PhotoSource.evidence`: `visible`,
`count`, `alt`, `promptVersion`) and given to the slide prompt (`generate-slide.v7`: "The
photograph on this slide shows … Visible … Not visible … Purpose"), whose rules let a task name
only visible items; a slide with no photograph is told so and may mention no picture. The
sanitiser enforces the same contract (`imageTextSpecSchemaFor(photo)` in `@tj/slides`: plural
picture words with one photo, a task verb on a hidden `mustShow` item, any picture word on a
`none` slide are validation issues the retry names); Repair re-checks an `image-text` slide against
the evidence on its element. The `illustrate` stage step stays for the resume path (a lesson
resumed at `generated` with a placeholder is still placed; a filled slot is skipped) and its counts
add to the picks Generate already counted. Superseded: TEACH-191's captions-only judge ("alt text
is the whole evidence"). Two caveats found at the stop-gate: the Bedrock provider's `supportedUrls`
is `s3://` only, so the AI SDK downloads an `https` thumbnail in the worker process before the call
(`downloadAssets`) — the model is billed for the image as input tokens (~550 per thumbnail on Luna
and Terra), and unit tests give the fake thumbnails as data URLs; and sending Pexels thumbnails to
a model for selection is use of the API results within its terms — no pupil data is involved.
`image-fit` in Evaluate, the eval's `PhotoPlacer` and the merged progress strip are part 2.

## Amendment (2026-09-10, project Generation quality — TEACH-220, part 2)

§11 gains the `image-fit` check TEACH-216 reserved: Evaluate (`evaluate.v4`) receives each placed
`image-text` slide's photograph as an image part — the thumbnail the pick judge looked at, kept on
the element as `PhotoSource.evidence.thumbnail`, since the api's `/files/*` proxy authorises per
request and cannot be fetched by the model — and lists the slide as `[slideId …, image-text,
photo N]`; a task the text sets that does not work with the picture is an `image-fit` warning with
the task phrase as evidence. §12: Repair (`repair.v4`) on an `image-text` slide is given the same
evidence block Generate had and the rule that the photograph cannot change; the regenerated slide
keeps the original image element (`keepPhoto`), so only text is rewritten. `knownTargetsWithEvidence`
also removes a `target.factId` that names no patchable fact instead of dropping the finding, and
Repair commits a fact patch only together with the artefact regenerated from it. The eval places
photographs when `PEXELS_API_KEY` is set (`eval/photo-placer.ts`: Pexels search plus a `put` that
keeps nothing) and shows them to the rubric judge the same way, so `imageFit` is scored; the
generating strip merges "Adding pictures" into "Writing the slides and pictures" (founder
decision), since the picture now lands with its slide and the `illustrate` step reports 88 only on
the resume path.

## Amendment (2026-09-10, TEACH-222 — Repair after the rodents lesson)

§12. Three defects from the first production lesson generated on the picture-first pipeline:
(1) `wasRepaired` dropped only `error` findings on a regenerated target, so a teacher read an
`image-fit` warning quoting a sentence Repair had deleted — now `staleAfterRepair` drops every
model finding on a regenerated target whose evidence is no longer in the new text (a warning whose
evidence survived stays); (2) Repair was shown the slide's flattened `slideText`, whose first line
for `image-text` is the recipe's fixed caption `KEY IDEA`, and the small model copied it into
`heading` — Repair (`repair.v5`) is now shown the slide field by field (`specFieldsOf`, keyed on
each element's text preset; captions excluded) and told to put each field back in its own field;
(3) `repair-fact.v2` names the fields the fact's array allows (`VERIFY_FIELDS_BY_ARRAY`) after the
model invented `statement` on a misconception. §13: the photo judge moves to the `standard` class
(founder decision, same day) — see the table.

## Amendment (2026-09-10, TEACH-223 — three deterministic guards)

§14 sanitiser: (1) every list member the layout numbers or bullets (`items`, `steps`, option
texts) has a leading enumerator stripped ("1. ", "2) ", "a) ", "- ") — the model wrote them and the
exit ticket rendered "1. 1. …"; (2) `slideSpecSchemaFor(kind)` for every kind but `image-text`,
and `blockSpecSchemaFor` for every block, refuse a picture word (`photo`, `picture`, `image`) in
any field including `notes`: a worked example said "A photo shows an animal…" beside no photo.
`diagram` is not in the list — "draw the three particle diagrams on the board" is a normal note.
§10 `checkLesson`: `degenerate-question` gains a stem test (`questionless`) for open-response
stems, exit-ticket items and worksheet questions — no `?` and no sentence opening with an
imperative or question word is an `error` (regenerate); a task about "your decision"/"the
animal"/"it" with nothing before it that posed the decision is a `warning`.

## Amendment (2026-09-10, TEACH-224 — the picture is the subject)

§7. The first production lesson on the picture-first pipeline placed a llama's snout for "rodent
incisors close-up": the brief's `mustShow` included "rodent head" (a classification, not a thing a
camera captures), the small-class judge said every item was visible, and the text was then written
to the wrong animal. Changes: the judge (`pick-or-requery-photo.v4`) answers `onSubject` — whether
the main thing in the picked photograph is an example of the subject — and the gate requires it as
well as `visible ⊇ mustShow`; an omitted `onSubject` reads as false, so a pick that does not say
so is never placed; a gated pick logs `offSubject`. The ticket's lexical alt-vs-subject guard was
dropped after checking Pexels: captions for "rodent incisors" say rat, hamster, mouse, prairie dog
— never "rodent" — so word overlap would have removed every good candidate. Plan
(`plan-skeleton.v7`) refuses a `mustShow` item made only of the subject's own words;
`plan-facts.v5` refuses a worked-example problem or question stem that presumes a picture ("a
photo shows", "the diagram", "pictured above"), a `pitch.avoid` entry the vocabulary defines, and —
when the outline has no vocabulary slide — a term no key idea uses. `generate-slide.v8` and
`repair.v6` may name only the kind of thing the caption names.

## Amendment (2026-09-10, TEACH-226 — the second rodents lesson)

The lesson generated after TEACH-222/223/224 placed a real rodent, but a nutria behind a wire
fence, and left two "explain your decision" tasks as warnings. §10: a `degenerate-question`
"no-referent" finding is an `error` with a regenerate fix, so Repair (`repair.v7`, told to write
the question first) rewrites it. §7: the judge (`pick-or-requery-photo.v5`) also answers `clear` —
required items large, sharp and unobstructed enough for a projector — and the gate requires it
(`onSubject && clear && visible ⊇ mustShow`; omitted reads as false; gated picks log `unclear`);
`plan-skeleton.v8` tells Plan to list cage, fence, bars, glass and hands in `avoid` for a living
subject. The pool is eight candidates from ten a query (was six from five) — about $0.002 more per
judge call on the standard class.

## Amendment (2026-09-10, TEACH-227 — captions first, then pictures)

§7. The picture pick is two stages (founder direction): a `small`-class **shortlist** call
(`shortlist-photos.v1`) reads the captions of up to thirty portrait results and names at most six
that are the subject itself — captions are cheap text and reliable for *what* a photograph is of,
useless for what is visible — and the `standard`-class judge (`pick-or-requery-photo.v5`) looks
only at those. A shortlist that fails falls back to the first six; one that names nothing ends the
slide without a judge call; an empty pool still reaches the judge, which may requery. Both stages
run again on a requery. §11: an `image-fit` finding on a slide whose `imageBrief.purpose` is
`identify-parts` or `observe` becomes an `error` with a regenerate fix — the third rodents lesson
set "find the squirrel's front teeth" on a squirrel whose paws hid its mouth — and `repair.v8` is
told to rewrite the task to what is visible. Two Plan rejections added earlier the same day are
withdrawn as costing a Terra retry each for no quality gain: `imageBrief.avoid` allows six items
(`plan-skeleton.v9` asks for spoilers softly) and an unexplained vocabulary term is a prompt rule,
not a rejection.
## Amendment (2026-09-10, project Lesson shape by objective verb — TEACH-228)

§7 and §23. The brief's two clarifying answers — `objectiveVerb` (Recall / Explain / Apply /
Evaluate) and `priorConfidence` (New to it / Some prior knowledge / Revisiting) — now have a
**lesson shape**: `packages/generation/src/shapes.ts` encodes the project's decision table (what a
lesson for each cell must contain, and which of that a schema can check) as data, with the
founder's decisions of the same day (Recall forbids `open-response`; Apply's method slide is a
`worked-example` in every subject; Evaluate softens below Year 5 — the judgement stem becomes
"which … and one reason"). `lessonShapeOf(answers, { yearGroup, ageBand })` is pure and defaults
to Explain / Some prior knowledge, the values the brief screen suggests. This amendment changes no
pipeline behaviour: Plan (TEACH-229) and the writers (TEACH-230) read the shape next. The eval's
eight briefs now carry a verb and a confidence covering every value, and the rubric judge
(`rubric-judge.v2`) scores a ninth dimension, `verbFit`, told both.

## Amendment (2026-09-10, project Lesson shape by objective verb — TEACH-229)

§7. Plan writes the outline to the lesson shape, and an outline without that shape is a validation
issue the retry names. `plan-skeleton.v10` no longer appends the brief's answers as "The teacher
also said" lines: `PlanSkeletonInput.shape` (from `lessonShapeOf(answers, { yearGroup, ageBand })`,
computed once in `stages/plan.ts`) is rendered as a **Shape** block of plain sentences, one per
`LessonShape` field that applies (`prompts/shape.ts`), and the prompt's own example opens its
explain phase with a definition slide. `planSkeletonSchemaFor({ durationMin, shape })` enforces
the table's deterministic column: `firstExplainKind`, `requiredKinds` (+ `requireVocabulary`),
`forbiddenKinds`, `minContent`, `minCheckEntries` (slides in the practise and check phases — the
slides where pupils answer; the base of 2 is the phase rule already in force), `explainMinPercent`
(replacing the fixed 30 %), `practiseMinPercent`, `requireWorkedExampleBeforePractise` and
`requireTwoCases`; the "New to it" one-explain-slide-per-objective rule (TEACH-211) is kept as
`shape.confidence`. Without a shape the schema is structural only (`PlanSkeletonSchema`, the resume
path). `requireMisconceptionConfronted` needs the facts, so `planFactsSchemaFor(skeleton, shape)`
checks it (a `true-false` in the outline, or any distractor with a `misconceptionRef`); the same
call's tier floor is the shape's `tierWeights` less one, and `plan-facts.v6` states the target
from the shape ("Question tiers: 5 easy, 5 core, 2 stretch") instead of the fixed 4 / 5 / 3. Two
rows of the table stay prompt-only, by the TEACH-227 rule that a rejection must buy quality worth a
Terra retry: that the definition slide's brief "mentions defining" and that Evaluate's criteria
slide "mentions criteria" are wording the model chooses, and the position and kind checks catch
the lesson that never defines its subject. §23: one skeleton fixture cannot satisfy all eight
eval cells (Recall forbids the `open-response` Explain requires), so there are four —
`fixtures/plan-skeleton.{recall,explain,apply,evaluate}.json`, the same lesson with positions 0–6
identical so the one `plan-facts.json` fits each — and `eval:schema` picks the fixture by the
brief's verb (`fixtureAiFor`); `FIXTURES.planSkeleton` is the Explain one, the default cell.

## Amendment (2026-09-10, TEACH-237 — the shape rules rejected a good outline)

§7. Forty minutes after TEACH-229 deployed, the first production lesson (Explain / New to it,
60 min) was rejected on both attempts of its first job — one failed job, a pg-boss retry, ~90 s of
"Planning" — by two rules of our own making: the "New to it" row requires a `vocabulary` slide and
40 % explain, and the TEACH-211 phase check then refused vocabulary in the explain phase; and the
explain share was 23 of 24 minutes. Changes: `vocabulary` is an explain-phase kind (teaching, not
practice) in both `EXPLAIN_KINDS` sets — Plan's and `checkLesson`'s `explanation-share` — and
`firstExplainKind` looks past a leading vocabulary slide to the definition (`plan-skeleton.v11`
says so). Every phase-share rule passes a phase within two minutes of `floor(percent × duration /
100)` and otherwise names the minutes to add. `ImageBriefSchema.avoid` in `@tj/domain` is `max(6)`,
as Plan's has been since TEACH-227: a skeleton `callStructured` accepted had been refused by the
bare `LessonFactsSchema.parse` in `assignFactIds` with a `ZodError` and no retry. Two TEACH-229
rules are withdrawn to prompt rules by the TEACH-227 test — would it fire on a good outline?:
`requireTwoCases` (two cases can be set against each other on a discussion, content or
open-response slide) and `requireMisconceptionConfronted` (`misconceptionRef` is optional, and a
distractor that names the belief in its text is a good answer). `minContent` counts `image-text`
as a content slide (it is one, with a photograph). The rest of the column stands: `forbiddenKinds`
and `requireWorkedExampleBeforePractise` are founder decisions; `requiredKinds`, `minCheckEntries`
and the shares are what the table means by the shape.

