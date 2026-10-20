# 0015 — Environment validation, logging, commit conventions

- Status: Accepted
- Date: 2026-09-03
- Related PRD decisions: F15-R05 (secrets management), F13-R10 (observability — later), F18-R12 (error states)

## Context

Misconfigured environments should fail at boot, not at first request. Observability tooling (Sentry/OTel) is deferred; structured logs are the baseline. Nothing is published, so per-package versioning is unnecessary.

## Decision

- **Environment:** each app has `src/env.ts` that parses `process.env` (or `import.meta.env` for web) with a Zod schema and throws on missing/invalid values. `.env.example` is committed per app; real values live in Vercel/Railway. No secrets in the repository; a secret-scanning pre-commit hook is enabled.
- **Logging:** `pino` structured JSON logs in `apps/api` and `apps/worker` with a request-id middleware; `pino-pretty` in development. No prompt or content bodies are logged. Error tracking and tracing are deferred to a later ADR.
- **Commits:** trunk-based development on `master`; squash merges; Conventional Commits enforced by `commitlint` in a `lefthook` pre-commit/commit-msg hook alongside Biome. No changesets.

## Amendment (TEACH-26, 2026-09-04)

The per-app Zod schemas stay, but the set of variables is declared once in
`infra/env.contract.ts` (name, services, scope, local value, Railway/Vercel targets, who sets it).
`docs/env.md`, every `.env.example` and `.gitleaks.toml` are generated from it and checked in CI;
`bun run doctor` validates local `.env` files against it, `bun run env:check` compares provider
variable names with it, and per-app tests assert schema/contract parity. `bun run setup` generates
`BETTER_AUTH_SECRET` locally so the compose path needs no provider.

## Amendment (TEACH-282, 2026-09-13)

Error diagnostics are a positive allow-list (`@tj/domain` `safeError`): finite error class/code
values plus caller-supplied operation, request and job identifiers. An exception's message, stack,
cause, SQL params, response body and custom properties are not diagnostics. Pino projects errors
before its implicit `err.message` → `msg` copy as well as during serialization. Schema failures log
finite issue codes/counts; even paths, custom messages and purported log annotations can contain
user/model content. Retry prompts still receive the validation details internally.

Better Auth's message/argument forwarding is disabled; unexpected router errors propagate to
Hono's safe handler instead of Better Call's raw console fallback. Mastra receives a content-free
step-failure sentinel while the original stays in the in-process request context for the worker's
retry classifier. No new Mastra storage or retries are introduced.

Unexpected job failures use fixed public copy in retry progress, terminal events and pg-boss
outputs, including failures outside a handler. `apps/worker/src/job-errors.ts` explicitly maps
known input, Source, budget and AI-configuration refusals to safe copy. Retryability is still
determined independently by cancellation/shutdown and `NonRetryableError`. Previously stored
terminal failures are not copied verbatim into new pg-boss outputs. Historical records and sink
retention require their own retention/incident decision; this change does not delete them.

## Amendment (per-lesson debug records, 2026-10-20)

Greg decided on 20 Oct 2026: every lesson's generation keeps a **debug record for 30 days**, so a
bad production lesson can be root-caused without re-running it. Until now the worker kept only
pino lines on Railway (no `lessonId` on most of them), never the writer's raw output, counts but
not the faults behind them, and `safeError`'s class and code for a failed job.

- **What is stored.** A tenant table `generation_debug` (migration `0013`): `workspace_id`,
  `lesson_id`, `job_id`, `attempt`, `seq`, `kind`, nullable `slide_index`, `payload jsonb`,
  `created_at`, indexed on `(lesson_id, created_at)`. The writer path records its raw streamed
  output, the objectives or plan, each slide's check (fault lines and measured overflows), each
  repair, fit or restage attempt (slide before and after, accepted, rejected or reverted), each
  split, each picture-director decision (the director's answer, queries, choice, outcome), each
  Verify (fact-check) correction before and after, every model call (name, model, tokens, cost,
  duration, stage), the call that tripped the budget stop, a stage's thrown error, and a failed
  attempt's **full error with message, stack and cause chain**. The writer stage's structured
  events are copied in too, so one table holds the whole timeline.
- **Content in our own database, for 30 days.** This is not a new data class: the lesson body,
  which holds the same teaching content, is already stored in `documents`. Rows are kept for
  `GENERATION_DEBUG_TTL_DAYS` (default 30) and deleted by the worker's daily
  `generation.debug-cleanup` pg-boss cron; deleting the Workspace or hard-deleting the lesson
  removes them at once (FK cascades). The record is **never sent to a third party**: it is not
  logged, not in any job event, not in pg-boss outputs, and not returned by any API route. It is
  read only by `tools/lesson-debug`, with database access.
- **Logs are unchanged.** The no-content rule for logs stands, and so does `safeError` for log
  lines, job events and pg-boss outputs: the full error goes to `generation_debug` only. Every log
  line of a lesson job now carries `lessonId` (the job logger's child bindings).
- **Never on the lesson's path.** Records are snapshotted, capped at 256 KiB of JSON per row (a
  larger payload keeps its first 256 KiB and its size), at most 5000 rows per attempt, and written
  in batches off the pipeline; a failed or slow write is one warn line and never fails, slows or
  changes a lesson. The last batch is written after the job's terminal event.
- **Cost warning.** `AI_LESSON_COST_WARN_USD` (ADR 0033) defaults to 0.12, about 1.5 times the
  median real writer lesson in the lab ($0.079 over 20 lessons on pack v4.8); 0.03 warned on every
  writer lesson.

## Consequences

- Boot-time failures are explicit and readable.
- When observability is added, it hooks into the existing request-id and logger rather than replacing them.
