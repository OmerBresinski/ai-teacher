# 0002 — Turborepo for task orchestration

- Status: Accepted
- Date: 2026-09-03
- Related PRD decisions: none

## Context

With three apps and several packages, `lint`, `typecheck`, `test` and `build` must run in dependency order with caching, locally and in CI.

## Decision

Turborepo (`turbo.json` at the root) orchestrates workspace tasks over Bun workspaces. Tasks: `dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e`. Remote caching is enabled in CI via Vercel Remote Cache once the Vercel project exists.

## Consequences

- One command (`bun run dev`) boots web, api and worker.
- CI only rebuilds what changed.
- Nx generators and project graph tooling are not available; if we need code generation we write small scripts instead.
