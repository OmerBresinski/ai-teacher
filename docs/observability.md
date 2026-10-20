# Observability: PostHog events from the worker

The worker sends job errors, model calls and lesson-pipeline facts to PostHog EU (ADR 0041). It
sends **metadata only**: no lesson text, no prompts, no model output. Content stays in our own
database. Without `POSTHOG_API_KEY` nothing is sent. The code lives in `packages/observability`
(`@tj/observability`) and `apps/worker/src/observability.ts`.

## Grouping: every event of a lesson job lines up

| Property | On | Meaning |
| --- | --- | --- |
| distinct id | every event | `ws_` + the first 32 hex of SHA-256(workspaceId). `system:worker` outside a job. Never an email or a name. |
| `$ai_trace_id` | every job event | the jobId, so a job's `$ai_generation`, `gen_*` and `$exception` events form one trace |
| `jobId`, `lessonId`, `job` | every job event | the job, its lesson and the job name (`lesson.plan`, `lesson.generate`, …) |
| `attempt`, `resumed`, `usagePriorUsd` | `gen_*` from log lines | pg-boss retry count; whether the run resumed from a checkpoint; what the earlier attempts had spent |
| `service` | every event | `worker` |
| `$process_person_profile` | every event | `false`: these are not people |

## What is sent, and what never is

- Event properties are numbers, booleans, `null`, and strings that look like identifiers. A string
  is sent only if it matches `^[A-Za-z0-9_.:/+@-]{1,64}$`: no spaces, so never a sentence. Arrays
  are sent only if all their items qualify; otherwise just `<key>_count` is sent. Nested objects
  are flattened one or two levels (`images.placed` → `images_placed`).
- A key that can hold content is never sent with a string, array or object value: `text`,
  `prompt`, `output`, `fix`, `value`, `notes`, `title`, `heading`, `query`, `topic`, `words`,
  `answer`, `question`, `stem`, `missing`, `err`, `error`, `message` and the others listed in
  `packages/observability/src/events.ts` (`CONTENT_KEYS`). A number under such a key is sent
  (`byField_answer: 2`).
- `$ai_input` and `$ai_output_choices` are never set. The client also runs with
  `privacyMode: true`.
- Error messages are sent only for our own error classes (scrubbed of URL tokens and keys). Any
  other message becomes `<unrecognised>`. Stacks keep frames only.

## Core events

| Event | When | Properties |
| --- | --- | --- |
| `$ai_generation` | every model call | `$ai_model`, `$ai_provider`, `$ai_input_tokens`, `$ai_output_tokens`, `$ai_cache_read_input_tokens`, `$ai_cache_creation_input_tokens`, `$ai_total_cost_usd` (our list price), `$ai_latency` (seconds), `$ai_stop_reason`, `$ai_is_error`, `$ai_span_name` (= `stage`), `stage`, `promptVersion`, `effort`, `modelClass` |
| `$exception` | a failed job attempt; an infrastructure failure; an uncaught exception or unhandled rejection | `$exception_list` (type, own message or `<unrecognised>`, frames), `source` (`job`, `job:infrastructure`, `uncaughtException`, `unhandledRejection`), `job`, `jobId`, `lessonId`, `stage` (the last stage seen), `planner`, `attempt`, `willRetry`, `errorType`, `errorCode` |
| `gen_lesson` | once per lesson job (the `generation summary` line), whatever the outcome | `outcome` (`success`/`failed`), `planner`, `stages`, `costUsd`, `calls`, `inputTokens`, `outputTokens`, `durationMs`, `readableMs`, `checkedMs`, `findingsError`, `findingsWarning`, `imagesPhotographable`, `imagesRequested`, `imagesPlaced`, `imagesEmpty`, `imagesFailed`; fact-check totals `factChecks`, `factsChecked`, `factsCorrected`, `factsChanged`, `factWordsChanged`, `factChangeRate` (= factsChanged / factsChecked), `factChecksCapped`, `factChecksDropped`; repair totals `repairs`, `repairsReverted`, `repairsFailed` |
| `gen_job` | job lifecycle | `status`: `picked` (with `queueWaitMs`, from enqueue or re-queue to pick-up), `started`, `completed`, `cancelled` (Stop), `retry` (pg-boss will run it again), `failed`, `skipped` (already settled), `lock_kept` (lock kept for the retry, which resumes from the checkpoint) |
| `gen_stage` | each pipeline stage run (the timeline) | `stage`, `outcome` (`done`/`failed`), `startedAt` (ISO), `durationMs` |
| `gen_fact_check` | each fact-verification pass (`verify-facts`) | `outcome` (`checked`/`capped`/`dropped`), `factsChecked`, `proposed`, `corrections` (applied), `factsChanged`, `wordsChanged` (word edit distance summed over the changed strings; never the text), `byField_<field>`, `byReason_<reason>`, `durationMs`, `by` (`usd`/`tokens` when capped). The call's model, tokens, cost and latency are on its `$ai_generation` (same trace, `stage: plan`). |
| `gen_budget_stop` | illustrate stopped at the lesson's cap | the line's numbers (stage, spend against cap) |
| `gen_cost_over_target` | a finished lesson above `AI_LESSON_COST_WARN_USD` | `costUsd`, `planner` |
| `gen_input_rejected`, `gen_input_checked`, `gen_source_unavailable`, `gen_plan_call` | the input check, a missing Source, each Plan call | the line's metadata (check codes, counts, `cls`) |

**About the fact checker:** the `verify-facts` pass runs once per lesson, on the facts list the
objectives-first and legacy planners make, before any slide exists. So it is reported per pass,
not per slide. The writer planner, the default since 20 Oct, has no separate fact-check pass. Its
per-slide checks and rewrites are `gen_checks` and `gen_repair` below (slide, mode, ok,
reverted), totalled on `gen_lesson`.

## Writer and pipeline events (`ev` log lines)

Every structured log line with an `ev` field becomes `gen_<ev>`, with `-` changed to `_`. The
writer's lines carry `source: "writer"`. The table below is generated from the source (the
literal keys of each `ev` object). Strings are sent only when identifier-shaped, as described
above, so free-text values such as a `why` sentence are dropped. Picture outcomes are
`gen_picture_outcome` (`kind`, `via`, `outcome`, `attempts`, `reason` when it is a code). Splits
and continuations are `gen_practice_continued`, `gen_quick_check_continued`,
`gen_table_continued` and `gen_unshown_strip`. Repairs are `gen_repair` (`slide`, `mode`, `ok`,
`reverted`; never `fix`). The check pass is `gen_checks` (`failing`).

| Event | Emitted in (`packages/generation/src/`) | Properties sent (content keys dropped) |
| --- | --- | --- |
| `gen_activity_dropped` | writer/stage.ts | `slide`, `why` |
| `gen_activity_fixed` | writer/stage.ts | `slide`, `fixes` |
| `gen_body_figure` | writer/diagrams.ts, writer/stage.ts | `slide`, `key`, `to`, `kind` |
| `gen_card_retry` | writer/stage.ts | `slide`, `asked`, `still` |
| `gen_checks` | writer/stage.ts | `failing` |
| `gen_close_missing` | writer/stage.ts | `level`, `why` |
| `gen_count_miss` | writer/stage.ts | `level`, `miss` |
| `gen_coverage_unmet` | writer/stage.ts | `level` (never sent: `missing`) |
| `gen_diagram_call` | writer/diagrams.ts | `key`, `attempt` (never sent: `err`) |
| `gen_diagram_done` | writer/stage.ts | `slide`, `key`, `via`, `ok` |
| `gen_diagram_final_fault` | writer/diagrams.ts | `key`, `via`, `fault` |
| `gen_diagram_relaid` | writer/stage.ts | `slide`, `ok` |
| `gen_drafts` | writer/stage.ts | `n`, `peeks`, `ms` |
| `gen_drafts_stopped` | writer/stage.ts | — (never sent: `err`) |
| `gen_duplicate_seen` | writer/stage.ts | `slide`, `fault` |
| `gen_exit_ticket_missing` | writer/stage.ts | `level`, `slides` |
| `gen_fact_check` | stages/verify.ts | `stage`, `call`, `outcome`, `factsChecked`, `proposed`, `corrections`, `factsChanged`, `wordsChanged`, `byField`, `byReason`, `durationMs`, `by` (never sent: `err`) |
| `gen_figure_stale` | writer/stage.ts | `slide`, `key`, `why` |
| `gen_figure_sync` | writer/stage.ts | `slide`, `action`, `why` |
| `gen_figure_text` | writer/stage.ts | `slide`, `key`, `kind`, `action` |
| `gen_figure_text_mismatch` | writer/stage.ts | `slide`, `key`, `why`, `dropped` |
| `gen_gas8` | writer/stage.ts | `slide`, `fault` |
| `gen_gas8_fallback` | writer/stage.ts | `slide`, `fault`, `cleared` |
| `gen_grid_pick` | stages/picture-set.ts | `set`, `judged`, `pick` |
| `gen_hinge_first_unmet` | writer/stage.ts | `slide`, `correct` |
| `gen_keep_pic` | writer/stage.ts | `slide`, `rule`, `orphans`, `key` |
| `gen_keep_pic_unused` | writer/stage.ts | `slide`, `key`, `path`, `why` |
| `gen_lib_catalogue_failed` | writer/stage.ts | — (never sent: `err`) |
| `gen_lib_check_logged` | library/fill.ts | `key`, `model`, `reason` |
| `gen_lib_drawn` | library/fill.ts | `key`, `model`, `attempts`, `builds`, `bytes` |
| `gen_lib_failed` | writer/stage.ts | `slide`, `key` (never sent: `err`) |
| `gen_lib_fallback` | library/fill.ts | `key`, `model`, `to`, `reason` |
| `gen_lib_fill` | library/fill.ts | `key`, `model`, `attempt`, `ok` |
| `gen_lib_label_floor` | library/fill.ts | `key`, `model`, `typeScale` |
| `gen_lib_label_floor_too_big` | library/fill.ts | `key`, `model`, `typeScale`, `reason` |
| `gen_lib_points_to_notes` | writer/stage.ts | `slide`, `model` |
| `gen_lib_side_slot` | writer/stage.ts | `slide`, `model`, `kind` |
| `gen_lib_type` | library/fill.ts | `key`, `model`, `scale`, `minPt` |
| `gen_look_added` | writer/stage.ts | `slide`, `how` |
| `gen_look_unmet` | writer/stage.ts | `slide`, `kind` |
| `gen_lost_picture` | writer/stage.ts | `slide`, `try`, `ok`, `landed`, `asked` |
| `gen_main_incomplete` | writer/stage.ts | `why`, `chars` |
| `gen_notes` | writer/notes.ts | `attempt`, `slides`, `of`, `usd`, `ms` |
| `gen_notes_error` | writer/notes.ts | `attempt` (never sent: `err`) |
| `gen_notes_missing` | writer/notes.ts | `asked`, `got`, `usd`, `ms` |
| `gen_notes_missing_error` | writer/notes.ts | `asked` (never sent: `err`) |
| `gen_notes_redo` | writer/stage.ts | `slide` |
| `gen_notes_redo_miss` | writer/stage.ts | `slide`, `kept` |
| `gen_on_flow_failed` | writer/stage.ts | — (never sent: `err`) |
| `gen_on_flow_item_failed` | writer/stage.ts | — (never sent: `err`) |
| `gen_orphan6_drop` | writer/stage.ts | `slide`, `orphans`, `moved` |
| `gen_picture_outcome` | stages/picture-director.ts, stages/picture-set.ts | `stage`, `kind`, `slideIndex`, `outcome`, `via`, `attempts`, `set`, `key` |
| `gen_pilot_fit` | writer/stage.ts | `slide`, `path`, `overs`, `steps` |
| `gen_pilot_members_over` | writer/stage.ts | `slide`, `id`, `template` |
| `gen_point_guard` | writer/stage.ts | `slide`, `removed`, `how`, `ships` |
| `gen_pupil_objectives_error` | writer/stage.ts | — (never sent: `err`) |
| `gen_r2_spec_drawn` | writer/diagrams.ts | `key`, `kind` |
| `gen_r2_spec_fault` | writer/diagrams.ts | `key`, `kind` |
| `gen_r2_spec_fit_logged` | writer/diagrams.ts | `key`, `fault` |
| `gen_r2_spec_redrawn` | writer/stage.ts | `slide`, `key`, `late` |
| `gen_r2_spec_refault` | writer/stage.ts | `slide`, `key`, `late` |
| `gen_relayout_kept_visual` | writer/stage.ts | `slide`, `faults` |
| `gen_relayout_skipped` | writer/stage.ts | `slide`, `faults` |
| `gen_repair` | writer/stage.ts | `slide`, `mode`, `ok`, `reverted` (never sent: `fix`) |
| `gen_repair_error` | writer/stage.ts | `slide` (never sent: `err`) |
| `gen_repair_rejected` | writer/stage.ts | `slide`, `mode`, `why` (never sent: `fix`) |
| `gen_repair_skipped` | writer/stage.ts | `slide`, `faults` |
| `gen_restage_fallback` | writer/stage.ts | `slide`, `mode`, `how` |
| `gen_restage_overflow` | writer/stage.ts | `slide`, `mode` |
| `gen_resume_notes` | writer/resume-notes.ts | `wanted`, `written` |
| `gen_set_attempt` | stages/picture-set.ts | `set`, `mode`, `usd`, `panels`, `same`, `odd` |
| `gen_set_capped` | stages/picture-set.ts | `set`, `size` |
| `gen_set_done` | stages/picture-set.ts | `set`, `placed`, `of` |
| `gen_set_error` | stages/picture-set.ts | `set`, `mode`, `reason` (never sent: `err`) |
| `gen_set_panel_error` | stages/picture-set.ts | `set`, `key`, `reason` (never sent: `err`) |
| `gen_set_solo` | stages/picture-set.ts | `set`, `key`, `try`, `ok`, `usd` |
| `gen_set_solo_error` | stages/picture-set.ts | `set`, `key`, `try`, `reason` (never sent: `err`) |
| `gen_set_start` | stages/picture-set.ts | `set`, `n`, `mode`, `aspect` |
| `gen_slide_role` | writer/stage.ts | `slide`, `template`, `role` |
| `gen_slide_tail_failed` | writer/stage.ts | `slide` (never sent: `where`) |
| `gen_slot_fill` | writer/slot-fill.ts, writer/stage.ts | `slide`, `template`, `fit`, `route`, `waveCCountCaps` |
| `gen_stage` | workflow.ts | `stage`, `outcome`, `startedAt`, `durationMs` |
| `gen_stream_opened` | writer/stage.ts | `slides`, `of` |
| `gen_stream_reopened` | writer/stage.ts | `slide` |
| `gen_stream_stopped` | writer/stage.ts | `why` |
| `gen_summary` | writer/stage.ts | `textOnlyTeach`, `dangling`, `coverage` |
| `gen_table_continued` | writer/stage.ts | `slide`, `slides` |
| `gen_tile_pictures` | writer/stage.ts | `slide`, `keys` |
| `gen_tile_unshown` | writer/stage.ts | `slide`, `keys` |
| `gen_title_one_thing` | writer/stage.ts | `slide`, `shows` |
| `gen_title_retry` | writer/stage.ts | `slide`, `ok`, `skipped`, `shows`, `named` |
| `gen_unpoint` | writer/stage.ts | `slide` |
| `gen_unshared_pile` | writer/diagrams.ts | `key`, `total`, `via` |
| `gen_unshown_strip` | writer/stage.ts | `slide`, `removed`, `how` |
| `gen_visual_path` | writer/stage.ts | `slide`, `path` |

## Building insights

- Cost per lesson: `gen_lesson`, sum of `costUsd`, broken down by `planner`.
- Where the time goes: `gen_stage`, average `durationMs` by `stage`; queue wait is `gen_job` with
  `status = picked`, average `queueWaitMs`.
- How much the fact checker changes: `gen_lesson`, average `factChangeRate` and
  `factWordsChanged`; or `gen_fact_check`, `byField_*` and `byReason_*`.
- Repairs that made things worse: `gen_repair` where `reverted = true`, by `mode`.
- Failures: Error tracking groups `$exception` by type and frames; filter on `job`, `stage` or
  `willRetry`.
- Everything about one lesson: filter any event on `$ai_trace_id` = jobId, or on `lessonId`.

A job sends at most 2,000 `gen_*` log events. The cap protects the queue from a runaway loop.
