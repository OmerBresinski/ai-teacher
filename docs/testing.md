# Testing

How tests are run in this monorepo (ADR 0014, TEACH-22): which runner owns which files, how the
database harness works, how to sign in from a test, and how to run and debug the Playwright suite.

```sh
bun run test                       # every workspace's unit/integration suite (turbo run test)
bun run test:db                    # same, but Postgres is guaranteed up + migrated, and DB suites MUST run
bun run test --filter=@tj/api      # one workspace
bun run test:e2e                   # Playwright (builds @tj/web first)
```

## Runners and the naming rule

One unit runner (`bun test`), one browser runner (Playwright). A file's **suffix and location**
decide who runs it; `bunfig.toml#[test].root` and Playwright's `testDir`/`testMatch` enforce it,
so nothing is ever picked up twice.

| Runner | Workspaces | Files | Config |
| ------ | ---------- | ----- | ------ |
| `bun test` | `apps/api`, `apps/worker`, `packages/db`, `packages/domain`, `packages/jobs`, `packages/storage`, `packages/api-client`, root `scripts/` | `src/**/*.test.ts` (`*.db.test.ts` / `*.integration.test.ts` for suites that need Postgres) | none — `bun test` in the workspace |
| `bun test` + happy-dom | `apps/web`, `packages/ui` | `src/**/*.test.{ts,tsx}` only | `bunfig.toml` `[test]` with the `@tj/config/bun-test/*` preloads (see below) |
| Playwright | `apps/web` | `e2e/**/*.spec.ts` only | `apps/web/playwright.config.ts`, run as `bun --bun playwright test` |

Rules:

- **`*.test.*` is a unit/integration test; `*.spec.ts` is a Playwright spec.** Never mix.
- Every workspace's `package.json#scripts.test` is `bun test` (`turbo run test` calls it). In the
  React workspaces `bunfig.toml` sets `root = "src"`, so `bun test` there never sees `e2e/`.
- Bare `bun test` from the repository root is still not a supported entry point: it would run
  every workspace's files from one cwd, without the per-workspace `bunfig.toml` (no DOM preloads,
  no `root`). Use `bun run test` / `bun run test --filter=<workspace>`.
- `src/**/*.test-d.tsx` files are compile-time contracts checked by `tsc` (`bun run typecheck`),
  not executed — Bun's discovery glob matches `.test.`, `_test_`, `.spec.`, `_spec_` only.

## React workspaces: preloads in `@tj/config/bun-test`

No runtime other than Bun (ADR 0014, amended). `packages/config/bun-test/` holds two preloads that
must stay separate — ESM hoists imports, so `@testing-library/react` would otherwise be evaluated
before the DOM exists:

| Preload | Does |
| ------- | ---- |
| `@tj/config/bun-test/dom` | `GlobalRegistrator.register()` from `@happy-dom/global-registrator`: `window`, `document`, `localStorage`, `HTMLElement`, … on `globalThis`. |
| `@tj/config/bun-test/setup` | `expect.extend(@testing-library/jest-dom/matchers)` and `afterEach(cleanup)`. |
| `<workspace>/bun-test.setup.ts` | Workspace-specific: `packages/ui` mocks `matchMedia` (`setMatchMedia`, `emitMatchMediaChange`) and resets storage/`data-theme`; `apps/web` pins `VITE_API_URL=/api`, `VITE_APP_ENV=development` because under Bun `import.meta.env` is `process.env` (Vite only inlines `VITE_*` at build time) and `import.meta.env.PROD` is therefore `undefined`. |

```toml
# apps/web/bunfig.toml
[test]
root = "src"
preload = ["@tj/config/bun-test/dom", "@tj/config/bun-test/setup", "./bun-test.setup.ts"]
coverageReporter = ["text", "lcov"]
coverageDir = "coverage"
coverageSkipTestFiles = true
```

Bun reads the nearest `bunfig.toml` from the cwd, so each React workspace carries its own; install
settings (`exact = true`) still come from the root file. `@happy-dom/global-registrator` is declared
once, in `@tj/config` (the isolated linker resolves a preload's imports from the package that owns
it). Bun resolves `@/*` from `tsconfig.json#paths` natively; JSX needs no plugin. For the jest-dom
matcher **types**, list `"@tj/config/bun-test/jest-dom"` (with `"@types/bun"`) in the workspace
`tsconfig.json#compilerOptions.types`.

Coverage: `bun test --coverage` writes `coverage/lcov.info` (+ a text table). The `test` script is
`bun test ${CI:+--coverage}`, so it is on whenever `CI` is set and off locally; `turbo.json` caches
`coverage/**`.

### Mocking cheatsheet (Vitest → `bun:test`)

| Vitest | `bun:test` |
| ------ | ---------- |
| `vi.fn()` | `mock()` |
| `vi.spyOn(obj, "m")` … `vi.restoreAllMocks()` | `spyOn(obj, "m")` … `spy.mockRestore()` (or `mock.restore()` for all) |
| `vi.stubGlobal("fetch", f)` / `vi.unstubAllGlobals()` | `const orig = globalThis.fetch; globalThis.fetch = f;` … `afterEach(() => { globalThis.fetch = orig; })` |
| `vi.mock("@/lib/auth", factory)` (hoisted) | `mock.module("@/lib/auth", factory)` **before** the import that needs it — put it at the top and `await import("./subject")` afterwards |
| `vi.mock("pkg", async (importOriginal) => ({ ...(await importOriginal()), x }))` | `const actual = await import("pkg"); mock.module("pkg", () => ({ ...actual, x }));` |

`mock.module()` is **per process**, and `bun test` runs every file of a workspace in one process: a module mocked in one file stays mocked for files that run after it. Keep module mocks to modules that only the mocking file imports (today: `sign-in.page.test.tsx` mocks `@/lib/auth` and `@tanstack/react-router`, and no other `apps/web` unit test imports either). If a test fails only in the full run, run it alone (`bun test src/path/file.test.tsx`) to bisect.
| `expect(x).toEqual(y)` (untyped `y`) | typed `y: typeof x` — widen with `expect<T>(x)` or cast the fixture when `x` carries a branded/tagged type |

See `apps/web/src/routes/sign-in.page.test.tsx` (module mocks), `apps/web/src/lib/query.test.ts`
(global swap) and `packages/ui/bun-test.setup.ts` (`matchMedia`).

## Server tests and the database harness

Integration tests derive their databases from **`TEST_DATABASE_URL`** (default
`postgres://postgres:postgres@localhost:5432/teaching_journey_test`), never `DATABASE_URL`, so a
test run cannot touch development data; each package connects to its own database (see "One
database per package" below). The harness is `withTestDb()` from `@tj/db/testing`:

```ts
import { afterAll, beforeEach, describe } from "bun:test";
import { createTestUserWithWorkspace, withTestDb } from "@tj/db/testing";

const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping foo tests: ${t.reason}`);

describeDb("foo", () => {
  if (!t.ok) return;
  const { unsafeDb, sql, truncateTenantTables, close } = t.db;
  beforeEach(() => truncateTenantTables());
  afterAll(() => close());
  // …
});
```

What it guarantees:

- **Migrated once per process** (`migrateDatabase(url)` is memoised per URL); the committed SQL in
  `packages/db/drizzle` is the only schema source.
- **Truncate between tests**: `truncateTenantTables()` runs `TRUNCATE … RESTART IDENTITY CASCADE`
  over every application table. Add new tenant tables there; `packages/db/src/schema.test.ts`
  reminds you.
- **One database per package**: `withTestDb()` uses `<TEST_DATABASE_URL database>_<package
  name>` (`packageTestDatabaseUrl`, scope dropped, e.g. `teaching_journey_test_api` for `@tj/api`,
  whichever folder of the package `bun test` runs from), creating it on first use, so the packages turbo runs in parallel never truncate each other's rows. Until TEACH-190
  part e they shared one database behind one lock and took turns. Processes of the same package
  are still serialised by a Postgres session-level advisory lock held until `close()`. **Always
  call `close()` in `afterAll`.** The base `TEST_DATABASE_URL` database must exist (compose and
  CI create it); the derived ones need the `CREATEDB` privilege (the `postgres` user has it).
- **Skip visibly, or fail loudly.** With no `TEST_DATABASE_URL` or an unreachable server,
  `withTestDb()` returns `{ ok: false, reason }` and the file prints `skipping …: <reason>`. With
  **`REQUIRE_TEST_DB=1`** it *throws* instead, so the file fails with
  `REQUIRE_TEST_DB=1 but the test database is unavailable — …`. `bun run test:db` and CI set that
  variable: a green run there is never an all-skipped run.

`bun run test:db` (`scripts/test-db.ts`): starts docker compose Postgres (skipped when `CI=true`,
where Postgres is a job service), runs `bun run db:migrate` for both databases, then
`turbo run test` with `TEST_DATABASE_URL` and `REQUIRE_TEST_DB=1`. Extra arguments pass through:
`bun run test:db -- --filter=@tj/jobs`. The only suite that still skips under `test:db` is the
S3 storage contract (`packages/storage/src/s3.test.ts`), gated on the `S3_*` variables of the
Railway Bucket (not a database concern); it prints its reason.

pg-boss: the `@tj/jobs`, `@tj/worker` and `@tj/api` integration suites use pg-boss schema
`pgboss_test` (on their own package database, through `t.db.url`), so the development `pgboss`
schema is never touched and the packages' queues never mix.

## Factories and authenticated requests

From `@tj/db/testing` (no better-auth dependency — `@tj/db` stays below `apps/api`):

| Helper | Use |
| ------ | --- |
| `createTestUserWithWorkspace(db, opts?)` | Inserts a `users` row directly plus its personal `workspaces` row, exactly what a first sign-in produces. Returns `{ userId, workspaceId, email }`. |
| `issueSessionCookie(auth, userId)` | Signs `userId` in through better-auth's own `magic-link/verify` handler and returns a `Cookie` header value (`tj.session_token=…`). `auth` is structurally typed (`SessionIssuer`); pass the instance from `createAuth()` in `apps/api`. |
| `cookieHeaderFromResponse(res)` | `Set-Cookie` headers → `Cookie` request header. |

Typical api test: `createAuth({ env, db, mail: new CaptureMailSender(), logger })`, then
`app.request("/me", { headers: { cookie: await issueSessionCookie(auth, userId) } })`. See
`apps/api/src/auth.db.test.ts` and `apps/api/src/routes/jobs.integration.test.ts`.

## Test-only capture route (api)

`GET /__test/last-magic-link?email=<address>` → `200 { email, url }` with the last magic link the
api "sent" to that address (case-insensitive), or `404 not_found` before any was sent. It reads
from an in-memory `CaptureMailSender` that wraps the normal sender (the console sender still logs).

Safety gate (two independent checks, both in `apps/api`):

1. The route exists only when `NODE_ENV === "test"` **and** `ENABLE_TEST_ROUTES=1`
   (`testRoutesEnabled()` in `src/routes/test-routes.ts`). Either condition missing → the path is
   an ordinary 404. It is not part of `AppType`, so it never appears in the RPC client.
2. `src/env.ts` refuses to boot with `ENABLE_TEST_ROUTES` set when `NODE_ENV=production`:
   `ENABLE_TEST_ROUTES: Cannot be set when NODE_ENV=production`, exit 1 — reported even if other
   variables are also missing.

Only Playwright's fixtures call it. `ENABLE_TEST_ROUTES` is documented (unset) in
`apps/api/.env.example`.

## End-to-end tests (Playwright + axe)

`apps/web/e2e/` — Chromium only. `playwright.config.ts` boots the full stack against the **test**
database on ports that never collide with `bun run dev`:

| Process | URL | Started as |
| ------- | --- | ---------- |
| api | `http://localhost:3811` | `bun ../../packages/db/src/migrate.ts && bun src/index.ts` with `NODE_ENV=test ENABLE_TEST_ROUTES=1 DATABASE_URL=$TEST_DATABASE_URL WEB_ORIGIN=http://localhost:4193 …` |
| worker | `http://localhost:3822` | `bun src/index.ts` against the same database |
| web | `http://localhost:4193` | `vite build --outDir dist/e2e` with `VITE_API_URL=http://localhost:3811`, then `vite preview` |

A production build bakes an absolute `VITE_API_URL` (`src/env.ts` rejects `/api`), so the e2e
build is separate from `dist/` — `turbo run test:e2e` still depends on `build` so the normal
build is verified first locally; CI calls Playwright in `apps/web` directly, because the `build`
job already checks the build. `reuseExistingServer: !CI`: locally, leave the three processes
running (`E2E_VERBOSE=1` pipes their stdout) and re-run specs in seconds.

The opt-in screenshot specs (`*-screenshots.spec.ts`) are left out of the run unless
`TEACH_SCREENSHOTS=1`, so they never count towards a shard.

Fixtures (`e2e/fixtures.ts`) — import `test`/`expect` from here:

- `signedInPage` → `{ page, email, ids, paths }` for a brand-new user, sitting on `/` with a real
  session and the demo library seeded (`ids` maps demo keys to the server's uuids, `paths` builds
  routes from them; `test.use({ seed: false })` starts from an empty Workspace). Implementation
  (`signInByApi`): `POST /auth/sign-in/magic-link` like the form does, read the link back from
  `GET /__test/last-magic-link`, spend its token with `GET /auth/magic-link/verify` through Bun's
  `fetch` and copy the session cookies into the browser context (`page.request` throws on a
  response that sets a cookie under `bun --bun playwright`), `POST /__test/seed-library`, then one
  `page.goto("/")`.
- `signIn(page, request, email?, callbackPath?)` signs in through the screens (confirm page and
  its Sign in button) for the specs about signing in; `requestMagicLink`, `lastMagicLink`,
  `uniqueEmail()` (the e2e database is not truncated; every test uses its own address, and the
  e2e api raises `MAGIC_LINK_SENDS_DAILY_CAP` so repeated local runs stay under it).

Specs:

- `auth.spec.ts` — protected page → `/sign-in?redirect=…`; magic-link sign-in through the form
  landing on the redirect target; **keyboard-only** sign-in (`Tab`/type/`Enter`); sign-out locks
  protected pages again.
- `jobs.spec.ts` — run `ping` → `queued … progress 100% … completed`; cancel mid-run →
  `cancelled` and never `completed`; **reload mid-run**: the events seen before the reload appear
  again, in order and without duplicates, then the stream finishes (ADR 0012 replay).
- `a11y.spec.ts` — `@axe-core/playwright` (WCAG 2.1 A/AA + best-practice) on `/sign-in`, `/` and
  `/dev/jobs` (idle and with events). `serious`/`critical` fail the test; `moderate`/`minor` are
  printed with the page label (currently one moderate `page-has-heading-one` on every page —
  follow-up: `CardTitle` renders a `div`).

Timing: the `ping` job takes 300 ms per step (5 steps). Never `waitForTimeout` for SSE — use
`expect.poll(...)` / auto-retrying `expect` on the event list (`getByRole("list", { name: "Job
events" })`). The one `waitForTimeout(700)` in the cancel spec is a negative check (nothing more
must arrive).

Running and debugging:

```sh
bunx --bun playwright install chromium           # once per Playwright version
bun run test:e2e                                 # from the root, via turbo (build first)
cd apps/web && bun --bun playwright test         # directly (the Playwright runner runs on Bun)
cd apps/web && bun --bun playwright test auth    # one file
cd apps/web && bun --bun playwright test --ui    # or `bun run test:e2e:ui`
cd apps/web && bun --bun playwright show-report  # html report (playwright-report/)
cd apps/web && bun --bun playwright show-trace test-results/<test>/trace.zip
```

Traces and screenshots are kept for failures only; in CI a failed shard uploads its
`blob-report/` (which carries them) and the `e2e report` job merges those into the
`playwright-report` artifact. `dist/e2e`, `playwright-report/`, `test-results/`, `blob-report/`,
`all-blob-reports/` and `coverage/` are git-ignored.

## Flake guidance

- **Retries hide bugs.** Playwright retries once in CI only (`retries: CI ? 1 : 0`); a retried
  pass is a flake to investigate, not a fix. `bun test` never retries.
- SSE/pg-boss timing: assert with `expect.poll` or `waitFor` loops bounded well above the job's
  duration (the specs use 15 s for a 1.5 s job). Never compare wall-clock durations tighter than
  the pg-boss polling interval (500 ms) unless the test controls the clock.
- Shared database: suites of the same package share its database; if two interfere, the missing
  piece is `close()` in `afterAll` (the advisory lock) or a table missing from
  `truncateTenantTables()`.
- Isolation in e2e comes from fresh users (`uniqueEmail()`), not truncation; do not assert on
  global counts.
- A `REQUIRE_TEST_DB` failure is an environment problem (`bun run doctor`), not a flake.
- Time-based UI (fixture pacing, GSAP motion, idle timers) runs on Playwright's clock:
  `page.clock.install()` before the first `page.goto` (and before any init script that reads
  `performance.now()`), then `page.clock.runFor(ms)`, which fires every timer and animation frame
  on the way (prefer it to `fastForward`, whose single jump GSAP's lag smoothing shortens). CSS
  animations are not faked: wait for them with `settled()` from `e2e/a11y.ts`. `waitForTimeout`
  is only for a negative check (something must not happen) or an idle window, at most 700 ms,
  with a comment saying which (TEACH-250).

## CI

`test` job: Postgres service + `teaching_journey_test`, then `bun run test:db` (compose skipped
under `CI=true`; `REQUIRE_TEST_DB=1`), coverage uploaded on pushes to `master` only. e2e runs as six `e2e-shard` jobs at
once, each with its own Postgres service + `teaching_journey_test`,
`bunx --bun playwright install --only-shell chromium` (browser cache keyed on the Playwright
version; no `--with-deps`, since the runner image has the libraries; the step names any linked
library that goes missing and starts the shell once) and `bun run test:e2e --shard=n/6` in
`apps/web`; a failed shard uploads its blob report. Each shard is a required check by name
(`e2e shard 1/6` to `6/6`); there is no gate job. On a PR that changes only documentation each
shard's Scope step (`scripts/e2e-scope.ts`) skips the suite and the shard passes. When a shard
failed, the `e2e report` job merges the blob reports into one `playwright-report` artifact. Run
one shard locally with `cd apps/web && bunx --bun playwright test --shard=1/6`. `test` and the
six shards are required status checks on `master` (README "CI").
