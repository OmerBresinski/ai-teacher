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
- **Amendment (TEACH-22, 2026-09-04):** instead of a per-run schema, integration tests share the `teaching_journey_test` database (`TEST_DATABASE_URL`), migrated once per process and truncated between tests, with a session-level advisory lock serialising concurrent packages; the api's SSE suite uses a derived `<db>_api` database. `REQUIRE_TEST_DB=1` (set by `bun run test:db` and CI) makes an unavailable database a failure rather than a skip. Details: [`docs/testing.md`](../testing.md).
