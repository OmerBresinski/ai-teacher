# 0006 — Postgres + Drizzle; pg-boss for background jobs

- Status: Accepted
- Date: 2026-09-03
- Related PRD decisions: Master PRD §14 (typed Journey state), F13-R03 (DAG execution, partial completion, retry), F18-R04 (activity tray), F03 (embeddings)

## Context

The Journey is a typed, versioned document; artefacts and observations are relational; F03 needs vector retrieval; generation runs asynchronously with progress, cancel and retry. Adding Redis for a queue would add a second stateful service.

## Decision

- Postgres 16 with the `pgvector` extension is the only database. Local development runs it via `docker-compose`; production uses Railway Postgres (ADR 0010).
- Drizzle ORM defines the schema in `packages/db/src/schema/`; migrations are generated with `drizzle-kit` and committed under `packages/db/drizzle/`. Migrations run as an explicit step, never on app boot.
- Background jobs use **pg-boss**, which stores queues in the same Postgres. `apps/worker` is the only consumer; `apps/api` only enqueues. Job payloads are Zod-validated; job names are constants exported from `packages/domain`.

## Consequences

- One stateful service to operate and back up; residency and deletion (F15-R02) are simpler because job payloads live in the same database.
- pg-boss throughput is bounded by Postgres; adequate at MVP volumes (hundreds of generations per hour). Revisit if the worker saturates the database.
- Schema changes are reviewable SQL in git.
