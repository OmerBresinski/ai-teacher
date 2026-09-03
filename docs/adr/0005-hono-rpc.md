# 0005 — Hono on Bun with Hono RPC as the API contract

- Status: Accepted
- Date: 2026-09-03
- Related PRD decisions: Master PRD §16 (option C: API-first artefact engine), F13-R03 (streaming)

## Context

The web SPA needs a typed contract with the server without a code-generation step. Generation streams partial results. A future public API is possible but not planned for MVP.

## Decision

`apps/api` is a Hono application running on Bun. Route handlers validate input with Zod (`@hono/zod-validator`). The router's type is exported from `packages/api-client` and consumed by `apps/web` through `hc<AppType>()` (Hono RPC). Streaming endpoints use Hono's `streamSSE` (ADR 0012). Routes are grouped by feature under `apps/api/src/routes/`.

## Consequences

- End-to-end types with no generated clients; changing a route breaks the web build immediately.
- Hono RPC is TypeScript-only. If a public or third-party API is needed later, add `hono-openapi` on the same routes; do not introduce a second framework.
- `apps/worker` shares packages with `apps/api` but exposes no HTTP surface beyond a health endpoint.
