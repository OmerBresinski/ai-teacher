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
