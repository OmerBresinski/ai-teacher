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

Every event goes through one gate, `enforce` in `packages/observability/src/events.ts`:

1. **Property names come from a fixed allowlist per event.** For a `gen_*` event, the allowlist is
   the property names its `ev` object literally has in the source. They are generated into
   `packages/observability/src/catalogue.gen.ts` by `bun packages/observability/scripts/catalogue.ts`,
   and a test fails when that file is stale. The names listed in `events.ts` (`OWN_KEYS`,
   `COMMON_KEYS`) are added to it. A name is never built from a value, so model text can never
   become a property name.
2. **Numbers and booleans pass.**
3. **A string passes only under a key with a rule**: an enum we define (table below), our id shape
   (UUID: `jobId`, `lessonId`, `$ai_trace_id`), an ISO time (`startedAt`), a prompt version
   (`name.v8`, `name-v4.8`), or a model id we configure or price (`$ai_model`, `modelId`).
   Arrays pass when they are all numbers or all rule-passing strings.
4. **Everything else is dropped**: free-text strings, values that fail their rule, objects, and
   names off the list. The event's `droppedProps` says how many.
5. **Backstop:** a content key (`text`, `title`, `prompt`, `fix`, `query`, `topic`, `answer`, …,
   `CONTENT_KEYS`) never passes with a string, whatever the allowlist says.
6. **Errors** send the error type, `errorCode`, `causeType` and stack frames, never a message
   (not even ours). A model id an `AiError` names is sent as `modelId`, checked against the model
   list.
7. `$ai_input` and `$ai_output_choices` are never set. The client also runs with
   `privacyMode: true`.

A one-word lesson title, an email address and a model-written reason are tested against the full
sent payload: none of them appears as a value or as a name
(`packages/observability/src/observability.test.ts`).

### Enum-checked keys

| Key | Allowed values |
| --- | --- |
| `stage` | `check-input`, `objectives`, `facts`, `plan`, `write`, `generate`, `illustrate`, `evaluate`, `repair` |
| `$ai_span_name` | `check-input`, `objectives`, `facts`, `plan`, `write`, `generate`, `illustrate`, `evaluate`, `repair` |
| `stages` | `check-input`, `objectives`, `facts`, `plan`, `write`, `generate`, `illustrate`, `evaluate`, `repair` |
| `outcome` | `success`, `failed`, `done`, `checked`, `capped`, `dropped`, `placed`, `empty`, `busy` |
| `status` | `picked`, `started`, `completed`, `cancelled`, `retry`, `failed`, `skipped`, `lock_kept`, `diagram`, `pending`, `photo` |
| `via` | `none`, `drawer`, `fetched`, `code`, `library`, `pexels`, `commons`, `generated` |
| `mode` | `fit`, `groups`, `chain`, `plot`, `reflect`, `route`, `stand-alone`, `translate`, `web`, `key` |
| `action` | `drop`, `edit`, `escalate`, `groups`, `kept`, `no-change`, `none`, `redrawn`, `refuse`, `words` |
| `planner` | `writer`, `objectives-first`, `legacy` |
| `template` | `banner-text`, `bar-model`, `big-diagram`, `big-visual`, `cards-grid`, `choose`, `compare`, `diagram-text`, `discussion`, `energy-profile`, `equation-hero`, `exit-ticket`, `explain`, `figure`, `hinge`, `hook`, `items-row`, `label`, `myth`, `objectives`, `pair`, `panel-list`, `photo`, `picture-sequence`, `picture-text`, `practice`, `question-set`, `reasons`, `right-triangle`, `sequence`, `source`, `split-compare`, `stages`, `steps`, `title`, `triangle`, `visual-text`, `worked` |
| `by` | `usd`, `tokens` |
| `level` | `info`, `warn`, `error` |
| `how` | `bare`, `explain-to-visual-text`, `figure-as-points`, `figure-dropped`, `library`, `log-only`, `none`, `sentences`, `sequence-as-steps`, `split`, `strip`, `strip-continued`, `title-one-thing` |
| `try` | `picture`, `split` |
| `call` | `demand`, `facts`, `label`, `objectives`, `outline`, `question-set`, `skeleton`, `slide`, `teach`, `verify` |
| `kind` | `single`, `set`, `handler`, `infrastructure` |
| `job` | `ping`, `ai.ping`, `lesson.plan`, `lesson.cascade`, `lesson.regenerate`, `lesson.generate`, `lesson.worksheet` |
| `source` | `writer`, `job`, `job:handler`, `job:infrastructure`, `uncaughtException`, `unhandledRejection` |
| `modelClass` | `frontier`, `standard`, `small` |
| `cls` | `frontier`, `standard`, `small` |
| `effort` | `none`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `$ai_stop_reason` | `stop`, `length`, `content-filter`, `tool-calls`, `error`, `other`, `unknown` |
| `$ai_provider` | `openai.chat`, `openai.responses`, `amazon-bedrock`, `bedrock`, `gateway`, `fake` |
| `service` | `worker` |

`job`, `source`, `errorType` and `errorCode` are fixed sets too: the job names, the error sources,
and `safeError`'s type and code lists.

## Core events

| Event | When | Properties |
| --- | --- | --- |
| `$ai_generation` | every model call | `$ai_model`, `$ai_provider`, `$ai_input_tokens`, `$ai_output_tokens`, `$ai_cache_read_input_tokens`, `$ai_cache_creation_input_tokens`, `$ai_total_cost_usd` (our list price), `$ai_latency` (seconds), `$ai_stop_reason`, `$ai_is_error`, `$ai_span_name` (= `stage`), `stage`, `promptVersion`, `effort`, `modelClass` |
| `$exception` | a failed job attempt; an infrastructure failure; an uncaught exception or unhandled rejection | `$exception_list` (type and frames only, no message), `causeType`, `modelId`, `source` (`job`, `job:infrastructure`, `uncaughtException`, `unhandledRejection`), `job`, `jobId`, `lessonId`, `stage` (the last stage seen), `planner`, `attempt`, `willRetry`, `errorType`, `errorCode` |
| `gen_lesson` | once per lesson job (the `generation summary` line), whatever the outcome | `outcome` (`success`/`failed`), `planner`, `stages`, `costUsd`, `calls`, `inputTokens`, `outputTokens`, `durationMs`, `readableMs`, `checkedMs`, `findingsError`, `findingsWarning`, `imagesPhotographable`, `imagesRequested`, `imagesPlaced`, `imagesEmpty`, `imagesFailed`; fact-check totals `factChecks`, `factsChecked`, `factsCorrected`, `factsChanged`, `factWordsChanged`, `factChangeRate` (= factsChanged / factsChecked), `factChecksCapped`, `factChecksDropped`; repair totals `repairs`, `repairsReverted`, `repairsFailed` |
| `gen_job` | job lifecycle | `status`: `picked` (with `queueWaitMs`, from enqueue or re-queue to pick-up), `started`, `completed`, `cancelled` (Stop), `retry` (pg-boss will run it again), `failed`, `skipped` (already settled), `lock_kept` (lock kept for the retry, which resumes from the checkpoint) |
| `gen_stage` | each pipeline stage run (the timeline) | `stage`, `outcome` (`done`/`failed`), `startedAt` (ISO), `durationMs` |
| `gen_fact_check` | each fact-verification pass (`verify-facts`) | `outcome` (`checked`/`capped`/`dropped`), `factsChecked`, `proposed`, `corrections` (applied), `factsChanged`, `wordsChanged` (word edit distance summed over the changed strings; never the text), `reason_<reason>` and `field_<field>`: one count per member of `VERIFY_REASONS` and `VERIFY_FIELDS`, named from the enum, never from model text, `durationMs`, `by` (`usd`/`tokens` when capped). The call's model, tokens, cost and latency are on its `$ai_generation` (same trace, `stage: plan`). |
| `gen_budget_stop` | illustrate stopped at the lesson's cap | `stage`, `slideIndex`, `spentUsd` (the job's model spend so far), `capUsd` (the job's cap) |
| `gen_cost_over_target` | a finished lesson above `AI_LESSON_COST_WARN_USD` | `costUsd`, `planner` |
| `gen_input_rejected`, `gen_input_checked`, `gen_source_unavailable`, `gen_plan_call` | the input check, a missing Source, each Plan call | the line's metadata (check codes, counts, `cls`) |

**About the fact checker:** the `verify-facts` pass runs once per lesson, on the facts list the
objectives-first and legacy planners make, before any slide exists. So it is reported per pass,
not per slide. The writer planner, the default since 20 Oct, has no separate fact-check pass. Its
per-slide checks and rewrites are `gen_checks` and `gen_repair` below (slide, mode, ok,
reverted), totalled on `gen_lesson`.

## Writer and pipeline events (`ev` log lines)

Every structured log line with an `ev` field becomes `gen_<ev>`, with `-` changed to `_`. The
writer's lines carry `source: "writer"`. The table below lists each event's allowed property
names. A string under a name without a `*` is never sent; numbers and booleans under any listed
name are. Repairs are `gen_repair` (`slide`, `mode`, `ok`, `reverted`; never `fix`). Splits and
continuations are `gen_practice_continued`, `gen_quick_check_continued`, `gen_table_continued`
and `gen_unshown_strip`. Pictures are `gen_picture_outcome` (`via`, `outcome`, `kind`,
`attempts`, `slideIndex`). The picture `reason` is free text, so it is not sent.

| Event | Property names (a * marks an enum-checked string) |
| --- | --- |
| `gen_activity_dropped` | `slide`, `why` |
| `gen_activity_fixed` | `fixes`, `slide` |
| `gen_body_figure` | `key`, `kind`*, `slide`, `to` |
| `gen_card_retry` | `asked`, `slide`, `still` |
| `gen_checks` | `failing` |
| `gen_close_missing` | `level`*, `why` |
| `gen_count_miss` | `level`* |
| `gen_coverage_unmet` | `level`* |
| `gen_diagram_call` | `attempt`, `key` |
| `gen_diagram_done` | `key`, `ok`, `slide`, `via`* |
| `gen_diagram_final_fault` | `fault`, `key`, `via`* |
| `gen_diagram_relaid` | `ok`, `slide` |
| `gen_drafts` | `ms`, `n`, `peeks` |
| `gen_drafts_stopped` | none |
| `gen_duplicate_seen` | `fault`, `slide` |
| `gen_exit_ticket_missing` | `level`*, `slides` |
| `gen_fact_check` | `by`*, `call`*, `corrections`, `durationMs`, `factsChanged`, `factsChecked`, `outcome`*, `proposed`, `stage`*, `wordsChanged` |
| `gen_figure_stale` | `key`, `slide`, `why` |
| `gen_figure_sync` | `action`*, `slide`, `why` |
| `gen_figure_text` | `action`*, `key`, `kind`*, `slide` |
| `gen_figure_text_mismatch` | `dropped`, `key`, `slide`, `why` |
| `gen_gas8` | `fault`, `slide` |
| `gen_gas8_fallback` | `cleared`, `fault`, `slide` |
| `gen_grid_pick` | `judged`, `pick`, `set` |
| `gen_hinge_first_unmet` | `correct`, `slide` |
| `gen_keep_pic` | `key`, `orphans`, `rule`, `slide` |
| `gen_keep_pic_unused` | `key`, `path`, `slide`, `why` |
| `gen_lib_catalogue_failed` | none |
| `gen_lib_check_logged` | `key`, `model`, `reason` |
| `gen_lib_drawn` | `attempts`, `builds`, `bytes`, `key`, `model` |
| `gen_lib_failed` | `key`, `slide` |
| `gen_lib_fallback` | `key`, `model`, `reason`, `to` |
| `gen_lib_fill` | `attempt`, `key`, `model`, `ok` |
| `gen_lib_label_floor` | `key`, `model`, `typeScale` |
| `gen_lib_label_floor_too_big` | `key`, `model`, `reason`, `typeScale` |
| `gen_lib_points_to_notes` | `model`, `slide` |
| `gen_lib_side_slot` | `kind`*, `model`, `slide` |
| `gen_lib_type` | `key`, `minPt`, `model`, `scale` |
| `gen_look_added` | `how`*, `slide` |
| `gen_look_unmet` | `kind`*, `slide` |
| `gen_lost_picture` | `asked`, `landed`, `ok`, `slide`, `try`* |
| `gen_main_incomplete` | `chars`, `why` |
| `gen_notes` | `attempt`, `ms`, `of`, `slides`, `usd` |
| `gen_notes_error` | `attempt` |
| `gen_notes_missing` | `asked`, `got`, `ms`, `usd` |
| `gen_notes_missing_error` | `asked` |
| `gen_notes_redo` | `slide` |
| `gen_notes_redo_miss` | `kept`, `slide` |
| `gen_on_flow_failed` | none |
| `gen_on_flow_item_failed` | none |
| `gen_orphan6_drop` | `moved`, `orphans`, `slide` |
| `gen_picture_outcome` | `attempts`, `key`, `kind`*, `outcome`*, `set`, `slideIndex`, `stage`*, `via`* |
| `gen_pilot_fit` | `overs`, `path`, `slide`, `steps` |
| `gen_pilot_members_over` | `id`, `slide`, `template`* |
| `gen_point_guard` | `how`*, `removed`, `ships`, `slide` |
| `gen_pupil_objectives_error` | none |
| `gen_r2_spec_drawn` | `key`, `kind`* |
| `gen_r2_spec_fault` | `key`, `kind`* |
| `gen_r2_spec_fit_logged` | `fault`, `key` |
| `gen_r2_spec_redrawn` | `key`, `late`, `slide` |
| `gen_r2_spec_refault` | `key`, `late`, `slide` |
| `gen_relayout_kept_visual` | `faults`, `slide` |
| `gen_relayout_skipped` | `faults`, `slide` |
| `gen_repair` | `mode`*, `ok`, `reverted`, `slide` |
| `gen_repair_error` | `slide` |
| `gen_repair_rejected` | `mode`*, `slide`, `why` |
| `gen_repair_skipped` | `faults`, `slide` |
| `gen_restage_fallback` | `how`*, `mode`*, `slide` |
| `gen_restage_overflow` | `mode`*, `slide` |
| `gen_resume_notes` | `wanted`, `written` |
| `gen_set_attempt` | `mode`*, `odd`, `panels`, `same`, `set`, `usd` |
| `gen_set_capped` | `set`, `size` |
| `gen_set_done` | `of`, `placed`, `set` |
| `gen_set_error` | `mode`*, `reason`, `set` |
| `gen_set_panel_error` | `key`, `reason`, `set` |
| `gen_set_solo` | `key`, `ok`, `set`, `try`*, `usd` |
| `gen_set_solo_error` | `key`, `reason`, `set`, `try`* |
| `gen_set_start` | `aspect`, `mode`*, `n`, `set` |
| `gen_slide_role` | `role`, `slide`, `template`* |
| `gen_slide_tail_failed` | `slide` |
| `gen_slot_fill` | `fit`, `route`, `slide`, `template`*, `waveCCountCaps` |
| `gen_stage` | `durationMs`, `outcome`*, `stage`*, `startedAt` |
| `gen_stream_opened` | `of`, `slides` |
| `gen_stream_reopened` | `slide` |
| `gen_stream_stopped` | `why` |
| `gen_summary` | `coverage`, `dangling`, `textOnlyTeach` |
| `gen_table_continued` | `slide`, `slides` |
| `gen_tile_pictures` | `keys`, `slide` |
| `gen_tile_unshown` | `keys`, `slide` |
| `gen_title_one_thing` | `shows`, `slide` |
| `gen_title_retry` | `named`, `ok`, `shows`, `skipped`, `slide` |
| `gen_unpoint` | `slide` |
| `gen_unshared_pile` | `key`, `total`, `via`* |
| `gen_unshown_strip` | `how`*, `removed`, `slide` |
| `gen_visual_path` | `path`, `slide` |

## Building insights

- Cost per lesson: `gen_lesson`, sum of `costUsd`, broken down by `planner`.
- Where the time goes: `gen_stage`, average `durationMs` by `stage`; queue wait is `gen_job` with
  `status = picked`, average `queueWaitMs`.
- How much the fact checker changes: `gen_lesson`, average `factChangeRate` and
  `factWordsChanged`; or `gen_fact_check`, `reason_*` and `field_*`.
- Repairs that made things worse: `gen_repair` where `reverted = true`, by `mode`.
- Failures: Error tracking groups `$exception` by type and frames; filter on `job`, `stage` or
  `willRetry`.
- Properties the gate dropped: any event's `droppedProps`. Add a name or an enum value in `events.ts` if one should pass.
- Everything about one lesson: filter any event on `$ai_trace_id` = jobId, or on `lessonId`.

A job sends at most 2,000 `gen_*` log events. The cap protects the queue from a runaway loop.
