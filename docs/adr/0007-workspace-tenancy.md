# 0007 — Workspace tenancy via `workspace_id` and a scoped DB helper

- Status: Accepted
- Date: 2026-09-03
- Related PRD decisions: Master PRD §12 (per-workspace data isolation), F17 §5 (personal workspace), F15 §5 (access control)

## Context

Every user has exactly one personal Workspace at MVP (team workspaces arrive in V2). All tenant data (Journeys, Sources, Observations, …) belongs to a Workspace. A handler bug must never expose one workspace's rows to another.

## Decision

- Every tenant-owned table has a non-null `workspace_id` column with a foreign key to `workspaces` and an index.
- `packages/db` exports `forWorkspace(workspaceId)` which returns a query interface that always applies the `workspace_id` predicate. Route handlers and workers use only this interface for tenant tables; direct access to the raw Drizzle client for tenant tables fails lint (custom Biome rule or a restricted export).
- Postgres Row-Level Security is **not** enabled in the scaffold. It is scheduled for the F15 project as defence in depth, using `SET LOCAL app.workspace_id` per transaction.

## Consequences

- One convention, easy to test: an integration test asserts that every table except a documented allow-list has `workspace_id`.
- Isolation is enforced in application code until RLS lands; code review must reject raw tenant queries.
