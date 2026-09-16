# 0030 — The worksheet is an independent job

- Status: Accepted
- Date: 2026-09-16
- Related PRD decisions: F06 backend PRD "Lesson creation flow — plan, slides, optional
  worksheet" (§8: multiple worksheets allowed, own cost cap, no Evaluate on the worksheet — the
  last one pending Omer's confirmation, see Decision 5); ADRs 0007, 0021, 0022, 0025, 0029
- Linear: TEACH-12. The design is the TDD in the description of the Linear project "Lesson
  creation flow — confirmed plan, slides, optional worksheet (backend)" (§4.2, §6, §7)

## Context

ADR 0025 §4 made the worksheet a second `documents` row that the `lesson.plan` job creates during
Generate, under the lesson's lock and budget. On `master` at `b924555e` that looks like this:

- `apps/worker/src/jobs/lesson-plan.ts`: `loadLockedLesson()` (`:175`) mints the worksheet id when
  the lesson has none (`stored.artefacts?.worksheetId ?? newId()`, `:186`), and the `finally`
  (`:145`) clears both locks.
- `packages/generation/src/stages/generate.ts`: `worksheetWork` (`:306`) runs beside the slide
  calls in one `Promise.allSettled` (`:353`), and the lesson is written with
  `artefacts: { worksheetId }` (`:370`). `materialiseWorksheet()` is at `:548`; `stemPlan()`
  (`:515`) is pure and decides which questions the slides use and which are reserved for the
  worksheet.
- `checkLesson(lesson, worksheet?)` (`packages/domain/src/documents/checks.ts:39`) skips the
  worksheet half of the objective check when no worksheet is passed.
- The worksheet recipes are editor code: `WORKSHEET_RECIPES`
  (`packages/editor/src/model/worksheet-recipes.ts:434`), `RECIPE_PROMPT_VERSION` (`:50`), the
  placeholder paragraph "Generation writes this part: …" (`:75`), `suggestRecipe()`
  (`model/worksheet-creation.ts:89`) and `estimateMinutes()` (`worksheet/metrics.ts:126`). The
  worker cannot import `@tj/editor`. `@tj/slides` depends on `@tj/domain`, `nanoid` and `zod`
  only (`packages/slides/package.json:29-33`), and `packages/slides/src/bundle.test.ts` guards
  that.
- The lesson's budget is `AI_LESSON_COST_CAP_USD` (default 0.5) and `AI_LESSON_TOKEN_CAP`
  (`apps/worker/src/env.ts:28-29`).

The product now makes the worksheet optional and separate: the teacher confirms the plan (ADR
0029), gets the slides, and may then ask for one or more worksheets with a chosen recipe and
practice time. A failed or cancelled worksheet must not fail, block or bill the lesson.

TEACH-311 (PR #290) and TEACH-312 (PR #291) landed the contracts this decision uses:

- `WorksheetGenerationSchema` (`packages/domain/src/documents/worksheet.ts:73`): `{ jobId, stage:
  "framed" | "filled" | "checked", startedAt, completedAt?, promptVersions, usage, findings,
  recipeId (string ≤ 40), practiceMinutes }`, stored as `Worksheet.generation` (`:286`).
  `Worksheet.lessonId` stays `z.string().optional()` (`:284`).
- `LessonWorksheetPayloadSchema` (`packages/domain/src/jobs.ts:88`): `{ lessonId, worksheetId,
  revision, recipeId, practiceMinutes }`. `lesson.worksheet` is registered as a `notImplemented`
  placeholder (`apps/worker/src/jobs/index.ts:26`) until TEACH-14.
- Migration `packages/db/drizzle/0007_documents_lesson_link.sql` adds `documents.lesson_id uuid`
  and the index `(workspace_id, lesson_id)`. `promotedColumns()`
  (`packages/db/src/documents.ts:156`) writes it on every insert and update.
  `listWorksheetsOfLesson` (`:314`) and `findWorksheetForGeneration` (`:335`) read the column.

## Decision

1. **`lesson.worksheet` is its own job with its own row, lock and budget.** `POST
   /lessons/:id/worksheet` creates (or reuses, item 7) a worksheet row with `lesson_id` and
   `generating_job_id` set, and enqueues `lesson.worksheet { lessonId, worksheetId, revision,
   recipeId, practiceMinutes }` in one transaction, deleting the row again if the enqueue fails.
   The job writes only the worksheet row, through `putDocumentAsJob`; it never writes the lesson,
   which may be locked by another job. Its budget is `AI_WORKSHEET_COST_CAP_USD` (default
   `0.10`, in `apps/worker/src/env.ts` and `infra/env.contract.ts`), separate from the lesson's
   spend; usage is recorded on `Worksheet.generation.usage`. Cancelling either job never cancels
   the other.
2. **The lesson pipeline stops writing worksheets.** Generate is slides only: `worksheetWork`,
   the `allSettled` pair and the `artefacts` write are removed from `stages/generate.ts`, and the
   worker no longer mints or locks a worksheet row. `stemPlan` moves to
   `stages/question-pool.ts` so both jobs compute the same question pool from
   `facts.questions` and the outline's `factRefs`. Evaluate and Repair in the lesson pipeline no
   longer read a worksheet; `checkLesson` without one already skips the worksheet half.
3. **Frame from the recipe, fill from the model.** The job runs:
   1. **Frame**, no model call: `recipe.build(facts)` gives headings, instructions, derived blocks
      and the placeholder blocks. Persisted at once with `stage: "framed"`.
   2. **Fill**: one `small` call at low effort (prompt `generate-worksheet-fill.v1`) that returns
      content for the placeholder slots only. Its schema, `worksheetFillSchemaFor(recipe,
      minutes)`, is built like `planSkeletonSchemaFor`: allowed block types and counts per slot
      are shape rules (one retry); tier order and "every objective practised" are editorial
      findings (TEACH-257). `estimateMinutes(blocks)` more than 30 % away from the practice time
      is a `warning`.
   3. **Splice and materialise** through `materialiseBlock` with `generatedFrom` and
      `authoredBy: "ai"`; frame blocks carry `RECIPE_PROMPT_VERSION`.
   4. **Check**: the worksheet half of `checkLesson(lesson, worksheet)` (findings targeting a
      block), the spec-rule findings and the no-picture rule. `error` findings get **one** repair
      pass through the block branch of Repair. Persisted with `stage: "checked"`, lock released,
      `completed`.

   The job reads the lesson and requires its `generation.stage` to be `planned` or later and its
   `plan.revision` to equal the payload's. Facts read after `planned` are verified (ADR 0029
   item 2). Progress events carry `stage: "worksheet"` and the worksheet row's
   `documentUpdatedAt`: `5 "Framing"`, `20 "Writing the questions"`, `80 "Checking"`,
   `100 "Worksheet ready"`.
4. **The recipes move from `@tj/editor` to `@tj/slides`.** `WORKSHEET_RECIPES`,
   `RECIPE_PROMPT_VERSION`, `suggestRecipe` and `estimateMinutes` move, with what they import:
   `worksheet/word-search.ts`, `model/factories.ts`, `model/worksheet-factories.ts` and the
   `PLACEHOLDER_IMAGE` constant from `model/layouts.ts`. `@tj/editor` re-exports them so no
   import site in `apps/web` changes. `@tj/slides` keeps its three dependencies, and `bundle.test.ts` keeps React and
   Tiptap out. Until the move lands, `recipeId` in the domain schemas stays a bounded string,
   because `@tj/domain` cannot import `@tj/slides`.
5. **No model Evaluate call on the worksheet by default.** The worksheet gets the deterministic
   checks and one repair (item 3), not the model Evaluate call the lesson gets (ADR 0025 §11).
   A worksheet is a projection of facts that Verify has already checked, its questions come from
   the same verified pool, and the cap is a fifth of the lesson's. **This default is Omer's
   decision to confirm or override**; overriding it means adding an Evaluate step to item 3 and
   re-sizing `AI_WORKSHEET_COST_CAP_USD`, not a new design.
6. **The lesson→worksheet link is the `documents.lesson_id` column.** `Worksheet.lessonId` in the
   body is the source, and `promotedColumns()` copies it to the column on every write.
   `Lesson.artefacts.worksheetId` stays in the schema so old documents still parse, is **no
   longer written**, and is read only to find the worksheet of a lesson generated before this
   change. `GET /lessons/:id/worksheets` returns `{ items: DocumentSummary[] }` from the column,
   with `generatingJobId` and `generation` on each row, so it answers while either document is
   locked.
7. **The column is filled only when `lessonId` is a uuid.** `Worksheet.lessonId` is `z.string()`,
   and fixtures and imported files name their lesson with keys such as `gen-water-cycle`. Such a
   key names no row and the `uuid` column would reject it, so `promotedColumns()` writes it only
   when it matches `UUID_PATTERN` (`documents.ts:127`, applied at `:159`), and migration 0007's
   backfill has the same regular-expression guard. Those rows keep `lesson_id` null and are not
   listed under any lesson. The domain type is not narrowed: an imported file stays importable.
8. **Several worksheets per lesson, one worksheet job at a time.** `POST /lessons/:id/worksheet`
   takes `{ expectedRevision, recipeId?: RecipeId | "auto", practiceMinutes?: 5 | 10 | 15 | 20 |
   30 | 45 | "auto" }` and answers `202 { worksheetId, jobId }`. The API resolves `"auto"`
   (`suggestRecipe`, the recipe's default minutes) so the payload always carries real values. It
   requires `plan.state = "confirmed"` (`409 planning` before that) and a matching revision
   (`409 stale`). `findWorksheetForGeneration` decides the row: a locked worksheet of this lesson
   is `409 generating` with its `worksheetId` and `jobId`; a worksheet left at `framed` by a
   failed fill is reused; otherwise a new row is created. The job's `singletonKey` is
   `<lessonId>:worksheet` with a 30 s slot. The route is registered with `aiLimiter` on its own
   path (ADR 0029 item 7).
9. **A failed fill keeps the frame.** A fill that misses its schema twice fails the job with
   `failed { retryable: false }`, keeps the `framed` document and releases the lock. A retry is
   the same request again, which reuses that row (item 8) under a new job id — `runJob`'s
   terminal guard is per job id.

## Consequences

- A worksheet can no longer fail or bill a lesson, and a teacher can have several worksheets of
  different shapes for one lesson.
- The lesson costs one call fewer; each worksheet costs one `small` fill call and at most one
  repair, capped at $0.10.
- The `generated` checkpoint no longer contains a worksheet. Evaluate already handles that
  (`checks.ts:39`, `worksheet?`).
- `@tj/slides` grows by the recipe files; `bundle.test.ts` must stay green.
- The editor's lint badge needs the worksheet to check the objective half; it finds it through
  `GET /lessons/:id/worksheets`, not `artefacts.worksheetId`.
- A worksheet imported with a non-uuid `lessonId` is not linked to any lesson. That is the right
  answer for a file from elsewhere; linking it would need a separate "attach to lesson" action.
- Deleting a lesson still does not delete its worksheets (ADR 0025 §4, F15).
- Amends ADR 0025 §4, §8, §9 (the recipe move), §10, §11, §12, §15 and §22.
- Revisit item 5 if the eval shows worksheet answer errors that the deterministic checks miss.
