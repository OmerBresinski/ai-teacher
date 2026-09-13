# 0012 — Server-sent events for generation progress

- Status: Accepted
- Date: 2026-09-03
- Related PRD decisions: F18-R04 (activity tray), F13-R03 (streaming, partial completion), F18 §5 (generation never blocks)

## Context

The teacher starts a generation, navigates away, and sees progress in an activity tray; artefacts open as soon as they land. The traffic is one-directional (server to client).

## Decision

Progress streams over **Server-Sent Events** from `apps/api` (`GET /jobs/:id/events` and a per-workspace `GET /events` firehose) using Hono's `streamSSE`. The worker publishes job events to Postgres (`LISTEN/NOTIFY` via pg-boss's completion hooks or a small `job_events` table polled by the API); the API fans them out to connected clients. The web app consumes events with `EventSource`, updates the activity tray store, and invalidates the relevant TanStack Query keys.

## Consequences

- Works through Vercel/Railway without sticky sessions; reconnects natively via `Last-Event-ID`.
- One-way only; any client-to-server action (cancel, retry) is a normal HTTP request.
- The scaffold implements one end-to-end demo: enqueue a `ping` job, worker runs it, API streams `started`/`progress`/`completed`, web renders it.

## Amendment (2026-09-06, ADR 0025)

The six event types are unchanged; two payloads grow. `JobProgressSchema` gains an optional
`documentUpdatedAt` so a generating job can tell the editor the document changed and it refetches
(ADR 0025 §7) — slide content never travels in an event. `JobCompletedEventSchema` gains an
optional `result`, a discriminated union on `result.job` (a `job_events` row has no job name),
so proposal jobs (`lesson.cascade`,
`lesson.regenerate`) hand a bounded result to the editor over the stream it already follows
(ADR 0025 §19). `runJob` writes a handler's return value into that field.

## Amendment (TEACH-283, 2026-09-13): stream authorization leases

Both event routes require the server-owned authorization installed by `requireSession` and
revalidate it before replay. Session identity must still match; revocation, expiry or a failed
lookup ends the response and releases the hub subscription and stream slot. The explicitly enabled
development header shim has its own tagged path, never a synthetic production session.

The stream rechecks every 15 seconds with at most one lookup in flight. Authorization is leased for
at most 30 seconds from the lookup's **start**, capped by the original session expiry. A stalled
lookup cannot renew the lease; an independent timer aborts the stream at the deadline. Every row
write checks the lease. Teardown races pending replay/drains against closure, so a blocked DB read
does not prevent slot release, and late lookup completion cannot restart a closed stream. This
adds one pre-replay lookup plus at most four periodic lookups per minute per long-lived stream.

Reconnect and Last-Event-ID ordering are unchanged. The separate bounded-backlog replay behavior
in TEACH-80 remains outstanding; this amendment is authorization, not a claim that backlog paging
has been fixed. All revocation/resource experiments use synthetic local sessions and rows.
