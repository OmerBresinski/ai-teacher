# ADR 0041: PostHog (EU) for worker error tracking and model-call metrics, metadata only

- Status: Accepted (20 Oct 2026, Greg)
- Builds on: ADR 0015 (structured logs, never content), ADR 0025 §16 (the `ai` and `generation
  summary` log lines), ADR 0018 / 0031 (model calls through `@tj/ai`).
- Package: `packages/observability` (`@tj/observability`), `posthog-node` 5.55.0.

## Context

The worker's only window on failures and model spend is Railway's log stream: a failed lesson is
a `job failed` line with an error type, and cost per stage is a grep over `ai` lines. Nothing
alerts, nothing groups the same failure across jobs, and the per-lesson numbers (cost, time to a
readable lesson, findings, pictures placed) are not charted anywhere.

Greg decided on 20 Oct 2026 to use PostHog, EU cloud, for error tracking and LLM-call tracing on
the worker. Product metrics (the web app) come later and are out of scope here. Prompt text, model
output and lesson content stay in our own database (the generation debug records).

## Decision

1. **PostHog EU, worker only.** `POSTHOG_API_KEY` (the project API key, `phc_…`) and
   `POSTHOG_HOST` (`https://eu.i.posthog.com`, also the default) on the Railway worker service.
   Without the key the client is a no-op: dev, tests and CI send nothing.
2. **Metadata only, by allowlist.** Every event goes through one gate (`events.ts` `enforce`).
   Property names come from a fixed list per event; for `gen_*` events, the names its `ev`
   object literally has in the source (generated, test-checked). Numbers and booleans pass.
   Strings pass only under a key with a rule: an enum we define, our UUID shape, an ISO time, a
   prompt version, or a configured or priced model id. Everything else is dropped and counted
   (`droppedProps`). A content-key denylist stays as a backstop. No name is built from a value.
   No `$ai_input` or `$ai_output_choices`, and `privacyMode: true` on the client. Errors send
   their type, code and stack frames, never a message (review of #603: a one-word title, an
   email or a model-written reason must not get through). `safeError` and the log lines are
   unchanged.
3. **Distinct id.** `ws_` plus the first 32 hex of SHA-256 of the Workspace id; `system:worker`
   outside a job. Never an email, a name or our own id. `$process_person_profile: false` on every
   event and GeoIP off: these are not people.
4. **Events.**
   - `$exception` for a failed job attempt (retried or terminal, from `runJob`'s `onFailure`),
     an infrastructure failure, and an uncaught exception or unhandled rejection (then the process
     still exits 1). Properties: `job`, `jobId`, `lessonId`, `stage` (the last model call's or
     the summary's last stage), `planner`, `attempt`, `willRetry`, `errorType`, `errorCode`.
   - `$ai_generation`, one per model call, from the `@tj/ai` logging middleware's `onCall` hook:
     `$ai_trace_id` = jobId, `$ai_span_name` = stage, `$ai_model`, `$ai_provider`,
     `$ai_input_tokens`, `$ai_output_tokens`, `$ai_cache_read_input_tokens`,
     `$ai_cache_creation_input_tokens`, `$ai_total_cost_usd` (our list price), `$ai_latency`
     (seconds), `$ai_stop_reason`, `$ai_is_error`, plus `lessonId`, `promptVersion`, `effort`,
     `modelClass`.
   - `gen_lesson`, one per lesson job, from the pipeline's `onSummary` hook (the
     `generation summary` line): outcome, planner, stages, cost, calls, tokens, duration,
     readable and checked ms, findings by severity, picture counts, and per-job totals of the
     fact checker (facts checked and changed, change rate, words changed) and of repairs.
   - `gen_*` for every pipeline fact the logs already carry (Greg, 20 Oct: "logging everything we
     can for full verbosity"): the worker's logger hook offers each job log line to PostHog; a line
     with an `ev` (the writer's checks, repairs, splits, pictures, diagrams; the stage timeline;
     the fact check) becomes `gen_<ev>`, and job-lifecycle and budget messages map to `gen_job`
     (picked with queue wait, started, retry, cancelled, failed, lock kept) and
     `gen_budget_stop`. They pass the same allowlist gate, and a job sends at most 2,000 such
     events. Every event and property
     is listed in `docs/observability.md`.
5. **Never fail or slow a lesson.** Capture only queues. Batches of 20 or every 5 s, a 3 s request
   timeout, no retries; a failed send is logged (`posthog send failed; events dropped`, first and
   every 50th) and dropped. After each job a flush starts in the background and is never awaited.
   Shutdown waits at most 3 s. A throwing hook is caught where it is called.
6. **Not used:** `enableExceptionAutocapture` (it would send raw messages; our own handlers send
   the scrubbed error) and `@posthog/ai` (it wraps the model; we already have the middleware, and
   manual capture keeps content out by construction).

## Consequences

- One more third party receives worker metadata: model ids, token counts, costs, durations, stage
  names, hashed Workspace ids, lesson and job ids, and stack frames of our own code. The PostHog
  client's exception parser may add source context lines of the frames' files (our bundled code),
  never runtime values.
- `@tj/ai`, `@tj/jobs` and `@tj/generation` gain optional hooks (`onCall`, `onFailure`,
  `onSummary`) and stay free of PostHog; only the worker wires them.
- Turning it off is unsetting `POSTHOG_API_KEY` on Railway.
