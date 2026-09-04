# 0014 — Testing: bun test, Playwright (Vitest retired)

- Status: Accepted
- Date: 2026-09-03
- Related PRD decisions: F15-R11 (audit-readiness test suite), F18-R09 (a11y), F13-R08 (eval harness — later)

## Context

Server packages run on Bun; React components need a DOM environment and Testing Library; core flows need browser tests with accessibility checks.

## Decision

- `bun test` for `apps/api`, `apps/worker`, `packages/db`, `packages/domain`. Integration tests run against the docker-compose Postgres using a per-run schema.
- ~~Vitest + React Testing Library + jsdom for `apps/web` and `packages/ui`.~~ Superseded by the 2026-09-04 amendment below: `bun test` + happy-dom + React Testing Library.
- Playwright for end-to-end tests in `apps/web/e2e/`, with `@axe-core/playwright` asserting no serious/critical violations on every visited page.
- Turborepo task `test` runs all unit/integration suites; `test:e2e` runs Playwright against a built preview in CI.

## Consequences

- ~~Two unit runners, each idiomatic for its target; both are fast.~~ One unit runner (`bun test`) since the amendment below.
- The F15-R11 "statement verification" suite will live in `packages/db` and `apps/api` tests once those features exist.
- **Amendment (TEACH-22, 2026-09-04):** instead of a per-run schema, integration tests share the `teaching_journey_test` database (`TEST_DATABASE_URL`), migrated once per process and truncated between tests, with a session-level advisory lock serialising concurrent packages; the api's SSE suite uses a derived `<db>_api` database. `REQUIRE_TEST_DB=1` (set by `bun run test:db` and CI) makes an unavailable database a failure rather than a skip. Details: [`docs/testing.md`](../testing.md).
- **Amendment (pure Bun, 2026-09-04):** Vitest, jsdom and the system-Node prerequisite are removed. `apps/web` and `packages/ui` run React unit tests with **`bun test` + happy-dom (`@happy-dom/global-registrator`) + React Testing Library**, wired through two shared preloads in `@tj/config` (`bun-test/dom` registers the DOM; `bun-test/setup` extends `expect` with `@testing-library/jest-dom/matchers` and calls `cleanup()` after each test) that every React workspace lists in `bunfig.toml#[test].preload`. Playwright is invoked as `bun --bun playwright …`, which runs the Playwright test runner on Bun (verified: 10/10 e2e specs with no `node` on `PATH`).
  - *Rationale:* a single runtime for dev, build, test and CI. Vitest 4 cannot run under `bun --bun` (its jsdom worker pool needs Node), so keeping it meant keeping Node ≥ 20 installed for two workspaces only, plus `.nvmrc` and a doctor check. Bun's runner also honours `tsconfig` `paths` natively and needs no Vite plugin for JSX.
  - *Trade-offs accepted:* (1) no `vi.mock` hoisting — `mock.module()` must run before the mocked module is imported, so tests that mock modules `await import()` the subject after `mock.module()`; (2) happy-dom implements less of the platform than jsdom (e.g. `matchMedia` is static, layout is absent) — we already mocked `matchMedia`; anything else missing is mocked per test, not papered over with a second DOM; (3) `vi.stubGlobal` / `vi.unstubAllGlobals` have no equivalent — globals are swapped by hand and restored in `afterEach`; (4) Bun's `expect(x).toEqual(y)` is typed `y: typeof x`, so a couple of assertions widen the type explicitly; (5) coverage is Bun's built-in (`--coverage`, lcov), switched on with `CI=true`.
  - *Unchanged:* the file-naming rule (`*.test.*` unit, `e2e/**/*.spec.ts` Playwright), the database harness, Playwright + axe. Details: [`docs/testing.md`](../testing.md).
