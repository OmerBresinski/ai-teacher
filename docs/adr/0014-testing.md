# 0014 — Testing: bun test, Vitest, Playwright

- Status: Accepted
- Date: 2026-09-03
- Related PRD decisions: F15-R11 (audit-readiness test suite), F18-R09 (a11y), F13-R08 (eval harness — later)

## Context

Server packages run on Bun; React components need a DOM environment and Testing Library; core flows need browser tests with accessibility checks.

## Decision

- `bun test` for `apps/api`, `apps/worker`, `packages/db`, `packages/domain`. Integration tests run against the docker-compose Postgres using a per-run schema.
- Vitest + React Testing Library + jsdom for `apps/web` and `packages/ui`.
- Playwright for end-to-end tests in `apps/web/e2e/`, with `@axe-core/playwright` asserting no serious/critical violations on every visited page.
- Turborepo task `test` runs all unit/integration suites; `test:e2e` runs Playwright against a built preview in CI.

## Consequences

- Two unit runners, each idiomatic for its target; both are fast.
- The F15-R11 "statement verification" suite will live in `packages/db` and `apps/api` tests once those features exist.
