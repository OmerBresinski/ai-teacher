# 0029 — Plan confirmation: the plan job, the generate job and plan revisions

- Status: Accepted
- Date: 2026-09-16
- Related PRD decisions: F06 backend PRD "Lesson creation flow — plan, slides, optional
  worksheet" (§8.1 auto-continue, §9 non-goals; rulings 74 `level`, 75 `slideCount`); ADRs 0007,
  0012, 0015, 0024, 0025, 0027; companion ADR 0030 (the worksheet job)
- Linear: TEACH-12. The design is the TDD in the description of the Linear project "Lesson
  creation flow — confirmed plan, slides, optional worksheet (backend)" (§4, §5, §8)

## Context

Today `POST /lessons` creates a locked `documents` row and enqueues one `lesson.plan` job that runs
the whole pipeline — check-input → Plan → Generate → Illustrate → Evaluate → Repair — in one go
(ADR 0025 §5). The teacher sees objectives only after slides are already being written, and cannot
change them before money is spent on the deck. The product now wants the teacher to confirm the
plan first: see the objectives, edit, add or remove them, change the slide count or duration, and
only then press Generate.

What the code on `master` at `b924555e` already gives this decision:

- **Resume is built in.** `packages/generation/src/workflow.ts` computes the resume point once in
  `runLessonPipeline()` (`:155`, stored under `RESUME_KEY` at `:163`; the key is declared at
  `:36`), from `resumeFrom(lesson)` (`:70`), and every `stageStep()` (`:88`) reads it. A lesson at
  `generation.stage = "planned"` already resumes at Generate.
- **Verify does not finish inside Plan.** Since TEACH-233 `plan()` (`stages/plan.ts:65`) persists
  `planned` right after the facts call and hands the running Verify call to Generate as
  `pendingVerify` (`:189`, returned at `:207`). A lesson that stops at `planned` today would
  show the teacher unverified facts.
- **The lock is the concurrency token for the worker.** `putDocumentAsJob`
  (`packages/db/src/documents.ts:454`) updates only `WHERE generating_job_id = :jobId` and returns
  `lost_lock` otherwise; the handler then stops with `NonRetryableError` (ADR 0025 §6).
- **TEACH-311 (PR #290) landed the contracts.** `LessonPlanSchema`
  (`packages/domain/src/documents/lesson.ts:79`) is `{ revision: int ≥ 1, state: "proposed" |
  "confirmed", jobId, confirmedAt? }` and is `Lesson.plan` (`:120`). `LessonPlanPayloadSchema`
  (`packages/domain/src/jobs.ts:63`) is `{ lessonId, revision, stopAfter?: "planned",
  pinObjectives? }`, `LessonGeneratePayloadSchema` (`:76`) is `{ lessonId, revision }`, and both
  names are in `JobPayloadSchemas` (`:156`). `JobProgressSchema` has `stage?` from
  `JOB_PROGRESS_STAGES` (`:197`). `Brief` has `slideCount?: 6 | 8 | 10 | 12` (`SLIDE_COUNTS`,
  `documents/brief.ts:20`) and `level?: "easier" | "standard" | "harder"` (`BRIEF_LEVELS`, `:24`).
  `applyObjectiveEdits(facts, objectives)` (`documents/objectives.ts:91`) returns `{ facts,
  shapeChanged }`.
- **TEACH-312 (PR #291) landed the repository.** In `packages/db/src/documents.ts`:
  `setPlanRevisionAndLock` (`:483`) reads the row `FOR UPDATE` inside `ws.tx`, returns `missing`
  for no lesson, `generating` when `generating_job_id` is set, `stale` when `plan.revision` —
  **0 for a lesson without `plan`** — is not `expectedRevision`, and otherwise writes the patched,
  parsed body and the new lock in one `UPDATE` (result type `SetPlanRevisionResult`, `:74`).
  `handOffLock(ws, id, from, to)` (`:523`) is one conditional `UPDATE`. `setContinueWhenPlanned`
  (`:541`) sets the flag without moving `updated_at`. `findLessonByRequestId` (`:347`) reads the
  `request_id` column. Migration `packages/db/drizzle/0007_documents_lesson_link.sql` adds
  `continue_when_planned boolean not null default false`, `request_id uuid` and the unique partial
  index `(workspace_id, request_id) where request_id is not null`. `unbindSource(ws, sourceId,
  lessonId)` is in `packages/db/src/sources.ts:94`.
- **The worker registry already names the new job.** `apps/worker/src/jobs/index.ts:25` registers
  `lesson.generate` as a `notImplemented` placeholder (`:13`) until TEACH-13.
- **The API has one AI limiter, registered per path.** `apps/api/src/app.ts:220-225` registers
  `aiLimiter` on `/lessons`, `/lessons/:id/cascade` and `/lessons/:id/regenerate` one by one,
  because `/lessons/*` also matches `/lessons` and would charge a brief twice (`:223`).
  `CONFLICT_REASONS` (`apps/api/src/errors.ts:32`) is `["stale", "generating"]`.

ADR 0025 §5 rejected "a chain of jobs": it "would re-lock the row four times and hand the lock
across four at-least-once boundaries". This ADR splits the job in two, so it has to say why that
objection does not apply.

## Decision

1. **Two jobs, one pipeline.** `lesson.plan` runs check-input and Plan and, when its payload has
   `stopAfter: "planned"`, stops after the `planned` checkpoint, releases the lock and completes.
   `lesson.generate` runs the same `runLessonPipeline` from `planned`: Generate (slides only, ADR
   0030), Illustrate, Evaluate, Repair. Both are one function: `runLessonPipeline` gains a
   `stopAfter?: "planned"` option, stored in the request context under a `STOP_KEY` and read by
   `stageStep()` exactly as `RESUME_KEY` is. The existing `resumeFrom` guard is the only resume
   logic; no second state machine. **Skip planning** is `POST /lessons` with `skipPlanning: true`,
   which enqueues `lesson.plan` without `stopAfter` — today's one-job run, with `plan.state`
   written as `confirmed` up front.
2. **The plan job awaits Verify before its checkpoint.** When `stopAfter` is set, Plan awaits the
   Verify call it started and writes `planned` with the `+verify-facts.v<n>` stamp, so every fact
   a teacher sees and every fact `lesson.generate` reads is verified. This reverses TEACH-233's
   overlap for the split flow only: the overlap existed to save 6–8 s on a critical path that now
   ends at a screen where the teacher reads the plan. A run without `stopAfter` (skip planning,
   pinned re-plan, item 8) keeps the TEACH-233 overlap. A lesson resumed at `planned` without the
   stamp is verified by Generate first, as today (`verifyStamped()`,
   `packages/generation/src/stages/generate.ts:397`).
3. **`Lesson.plan` is the revision the teacher is looking at.** `plan = { revision, state, jobId,
   confirmedAt? }` (`LessonPlanSchema`). `revision` starts at 1 and increases by one on every
   re-plan; `jobId` is the job that owns that revision; `state` is `proposed` until the teacher
   confirms, then `confirmed` with `confirmedAt`. It is an optional field, so no document
   `version` bump (ADR 0021 §2). `generation.stage` and `generating_job_id` keep their meanings.
   A lesson written before `plan` existed is revision 0 to the compare-and-set, so it can enter
   the flow.
4. **Every plan change is a compare-and-set in the API.** `POST /lessons/:id/plan`,
   `/generate` and `/worksheet` (ADR 0030) carry `expectedRevision`. The route calls
   `setPlanRevisionAndLock(ws, id, { expectedRevision, jobId, patch })`: one transaction with a
   row lock checks the revision, applies the patch (brief fields, objectives, `plan`), and sets
   `generating_job_id` to the new job id in the same `UPDATE`. `stale` is `409 stale`; the client
   refetches. The job is then enqueued under that id. A job whose payload `revision` does not
   equal the row's `plan.revision` refuses to start (`NonRetryableError`).
5. **A superseded job can never write.** Each revision has a new job id, and the API moves the
   lock to it in the statement that bumps the revision. The old job's next `putDocumentAsJob`
   returns `lost_lock` and it exits with `NonRetryableError` without writing again. The API also
   calls `cancel()` on the old job, best effort; correctness never depends on the cancel landing.
   **Gap for TEACH-13:** `setPlanRevisionAndLock` as merged returns `generating` whenever the row
   is locked, so a re-plan *while a plan job is still running* is refused rather than
   superseding it. The route that supersedes a running proposal must take the lock from
   `plan.jobId` while `plan.state = "proposed"` — the same row lock and compare-and-set, with
   `generating_job_id IS NULL OR generating_job_id = plan.jobId` — through an option on that
   function, not a second write path. Until then a re-plan during planning is `409 planning`.
6. **Why ADR 0025 §5's objection does not apply.** §5 rejected a chain in which each job hands the
   lock to the next across at-least-once boundaries: four hand-offs, any of which can run twice
   or not at all. Here the lock crosses **one** boundary (plan → generate), and it crosses it
   **through the API**, in the compare-and-set of item 4: the plan job releases the lock and
   completes; the teacher's `POST /generate` takes it again for a new job id in one conditional
   write. No job enqueues another job and no job passes the lock to another, except in the
   auto-continue case (item 10), where the hand-off is also one conditional `UPDATE`. A duplicate
   request loses the compare-and-set; a duplicate delivery of either job finds the lock on
   another id or the revision moved, and stops. Within each job the checkpoints of ADR 0025 §5
   are unchanged.
7. **Routes.** All under `/lessons/*` (already protected), `getWorkspaceId(allowHeaderShim:
   false)`, `zValidator` on every body:

   | Route | In | Out | Conflicts |
   | ----- | -- | --- | --------- |
   | `POST /lessons` | `CreateLessonSchema` + `skipPlanning?`, `requestId?` (uuid) | `202 { lessonId, jobId, revision: 1 }` | as today |
   | `POST /lessons/:id/plan` | `{ expectedRevision, brief: { topic, slideCount?, level?, durationMin?, classContext? }, yearGroup?, subject?, sourceIds? }` | `202 { jobId, revision }` | `409 stale`; `409 generating` once confirmed; `409 planning` while a plan job holds the lock, until the item 5 gap is closed |
   | `POST /lessons/:id/generate` | `{ expectedRevision, objectives: [{ id?, text }] (1–4), slideCount?, durationMin? }` | `202 { jobId, revision }` | `409 planning` while the plan job holds the lock; `409 stale`; `409 generating` once confirmed; `422` no objectives |

   `/generate` requires stage `planned` and no lock. It applies the objectives, sets
   `plan.state = "confirmed"` and enqueues `lesson.generate { lessonId, revision }`, which
   refuses unless the row is `planned` and `confirmed`. `ConflictError` gains the reason
   `planning`. Each new route is registered with `aiLimiter` on its own path, as
   `app.ts:220-225` does, never with `/lessons/*`.
8. **Pinned objectives and what invalidates a plan.** `/generate` runs
   `applyObjectiveEdits(facts, objectives)`:

   | Change | Effect |
   | ------ | ------ |
   | Objective text edited, same ids | No re-plan. Facts updated; `lesson.generate` re-materialises the objectives slide; revision unchanged |
   | Objective added or removed, or `slideCount` / `durationMin` changed | Pinned re-plan: new `o<n>` ids, facts serving only removed objectives dropped, outline emptied, revision bumped, `lesson.plan { pinObjectives: true }` **without** `stopAfter` (the teacher already confirmed) |
   | Year group or level | Pinned re-plan if the objectives were edited, otherwise a fresh proposal |
   | Topic or Sources | Fresh proposal: facts cleared, edits discarded (the client warns first) |
   | Anything after confirmation | Not a plan change: `lesson.cascade` / `lesson.regenerate` (ADR 0025 §18), unchanged |

   With `pinObjectives`, Plan gives the skeleton call the teacher's objectives as fixed input
   and keeps their ids.
9. **`slideCount` and `level` shape Plan.** `Brief.slideCount` (ruling 75) is a hard shape rule:
   `planSkeletonSchemaFor()` (`packages/generation/src/specs.ts:314`) requires the outline to
   have exactly that many entries (a shape miss, one retry). `lessonFromBrief` defaults it to 10
   (`documents/create-lesson.ts:110`). `Brief.level` (ruling 74) is written into the audience
   line of the Plan prompts; it does not change the Lesson shape table.
10. **Auto-continue.** A client that leaves the plan screen with "carry on without me" sets
    `continue_when_planned` (`setContinueWhenPlanned`). When the plan job reaches `planned` and
    the flag is set, the worker confirms the plan itself (`state = "confirmed"`, `confirmedAt`),
    enqueues `lesson.generate` under a new id and passes the lock with `handOffLock(ws, id,
    planJobId, generateJobId)` **before** releasing it. `false` means a concurrent `/plan` took
    the lock: the worker does nothing more. If the enqueue fails, the worker releases the lock and
    leaves the lesson at `planned`; the teacher can still press Generate. This is the only place
    the worker confirms a plan.
11. **`requestId` makes `POST /lessons` idempotent.** An optional client-minted uuid is stored in
    `documents.request_id`, unique per Workspace. A repeat with the same id answers the existing
    lesson (`findLessonByRequestId`) with `202` and its current `jobId` and `revision` instead of
    creating a second lesson and a second spend.
12. **Sources may change after creation.** `/plan` with a different `sourceIds` binds the new
    ones with `bindSourcesToLesson` and releases the dropped ones one by one with `unbindSource`,
    inside the same transaction as the compare-and-set; the lesson still holds at most three.
    This amends ADR 0027 §5, which bound sources only at creation.
13. **`POST /briefs/parse` fills the brief from the website box.** `{ text (1–500), yearGroups? }`
    → `200 { topic, yearGroup?, subject?, level?, durationMin?, inferred: string[] }`. Rules
    first: `yearNumberOf`, the subject list (moved from `apps/web/src/lib/brief-form.ts:35` to
    `@tj/domain`) and a minutes pattern. Then, for what is still blank, one `small` structured
    call with a 2 s deadline. Every returned string goes through the Identifier guard; a hit drops
    that field. A model failure or timeout returns the rules' result with `inferred: []` and
    `200`. The route is stateless — nothing is stored — and is rate-limited by `aiLimiter`.
    Running a bounded piece of work inside the request follows ADR 0027 §1 (extraction at
    upload); the api service already has `AWS_BEARER_TOKEN_BEDROCK` (`infra/env.contract.ts:545`,
    services `api` and `worker`). `/briefs` and `/briefs/*` join `PROTECTED_PATHS`.
14. **Progress names its stage.** `JobProgressSchema.stage` is written by every pipeline progress
    event (`check-input`, `plan`, `generate`, `illustrate`, `evaluate`, `repair`, and
    `worksheet` for ADR 0030). `ProgressExtra` (`packages/jobs/src/types.ts:60`) becomes
    `Pick<JobProgress, "documentUpdatedAt" | "stage">` and `PipelineDeps.onProgress` gains the
    stage argument. The plan job's `completed` event carries no result; the client refetches
    (ADR 0025 §7). One stream per job; the two streams a lesson now needs fit the default
    `EVENTS_MAX_STREAMS_PER_WORKSPACE` of 20.
15. **Logging (ADR 0015).** The new routes and handlers log ids, revisions, counts and booleans
    only — never brief, objective or parse-box text. `/briefs/parse` logs `{ rules, model,
    dropped, ms }`.

## Consequences

- The teacher confirms objectives before the deck is paid for, and an edit to the objectives is
  honoured instead of being thrown away with the next plan.
- Plan takes longer to reach `planned` (Verify is inside it, about 6–8 s): the target is under
  20 s. Skip planning keeps today's timing.
- A brief can cost up to three rate-limited calls (parse, create, generate). TEACH-13 checks the
  `RATE_LIMIT_*` allowance.
- The worker gains `lesson.generate`; `apps/api` gains `/lessons/:id/plan`, `/lessons/:id/generate`
  and `POST /briefs/parse`; `CreateLessonSchema` gains `skipPlanning` and `requestId`. No new
  table, no document `version` bump, no change to `runJob`, `enqueue`, cancel, retry or SSE
  replay.
- TEACH-13 must close the gap in item 5 before re-plan during planning can supersede a job.
- Amends ADR 0025 §5 and §7 (and its TEACH-233 amendment), ADR 0024 §6 and §18, ADR 0012
  (`progress.stage`) and ADR 0027 §5; refers to ADR 0015 for logging without changing it.
- Revisit if a third job ever needs the lesson lock in sequence: that would be a chain again, and
  §5's objection would apply.
