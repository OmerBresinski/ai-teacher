# Teaching Journey

Monorepo for **Teaching Journey** (working name "AI Teacher"): an AI-assisted planning tool that
takes a teacher from a goal to a sequence of Lessons, generates coherent Artefacts (plans, slides,
worksheets, quizzes, …) for each Lesson, and adapts future Lessons from class-level Observations.
Product decisions live in Notion; engineering decisions live in [`docs/adr/`](docs/adr/README.md)
and shared vocabulary in [`docs/glossary.md`](docs/glossary.md).

## Prerequisites

- [Bun](https://bun.sh) **1.3.6** (pinned in `package.json#packageManager`; `bun >= 1.2` works)
- Docker (Postgres + pgvector for local development — wired up by TEACH-18)
- Optional: [`gitleaks`](https://github.com/gitleaks/gitleaks) on your `PATH` for the local secret
  scan (CI runs it regardless)

## Quick start

```sh
bun install        # installs deps and git hooks (lefthook) via the `prepare` script
bun run dev        # turbo run dev across all apps (nothing to run until the apps land)
```

Everyday commands (all run through Turborepo, see [ADR 0002](docs/adr/0002-turborepo.md)):

| Command                    | What it does                                                     |
| -------------------------- | ---------------------------------------------------------------- |
| `bun run dev`              | Start every app in watch mode (`persistent`, uncached)           |
| `bun run build`            | Build apps (and packages that opt in) in dependency order        |
| `bun run lint`             | Biome check per workspace + root config files                    |
| `bun run lint:fix`         | Same, applying safe fixes                                        |
| `bun run format`           | Biome format (write)                                             |
| `bun run typecheck`        | `tsc --noEmit` per workspace, dependencies first                 |
| `bun run test`             | Unit/integration tests (`bun test` or Vitest per workspace)      |
| `bun run test:e2e`         | Playwright + axe, after `build` ([`docs/testing.md`](docs/testing.md)) |
| `bun run verify-bootstrap` | End-to-end check of this scaffold (`scripts/verify-bootstrap.sh`) |

## Local development

One Postgres in Docker, everything else native (ADR [0006](docs/adr/0006-postgres-drizzle-pgboss.md),
[0015](docs/adr/0015-env-logging-commits.md); TEACH-18). Local development uses synthetic data only —
never point a local `.env` at production.

### Prerequisites

- **Bun 1.3.6** — pinned in `package.json#packageManager` and `.bun-version`; `bun upgrade` if older.
- **Docker** with Compose v2 (Docker Desktop on macOS; Docker Engine + compose plugin on Linux),
  running. The scripts call `docker compose`, not `docker-compose`.
- macOS, Linux or **WSL2**. Windows without WSL is not supported (the scripts rely on `lsof`,
  POSIX signals and LF line endings — see `.gitattributes`).
- Optional: `gh` (opening PRs from the terminal) and `gitleaks` (local secret scan; CI runs it
  regardless). `bun run doctor` warns when `gitleaks` is missing.

### The three commands

```sh
bun run setup     # once per machine, safe to re-run: checks Bun/Docker, creates .env files,
                  # starts Postgres, runs migrations (when @tj/db exists), installs git hooks
bun run dev       # starts Postgres if it is not reachable, then `turbo run dev`; Ctrl-C stops
                  # turbo and every app it started (no orphans)
bun run doctor    # PASS / WARN / FAIL per check with a plain-language fix; exit 1 on any FAIL
```

All root scripts are TypeScript run by Bun (`scripts/*.ts`, helpers in `scripts/lib/`):

| Command                | What it does                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `bun run setup [--ci]` | Bootstrap (above). `--ci` skips `lefthook install`.                                 |
| `bun run dev`          | Ensure Postgres, then `turbo run dev` (prefixed logs; `TURBO_UI=tui bun run dev` for the TUI). Extra args pass through: `bun run dev -- --filter=@tj/web`. |
| `bun run doctor`       | Diagnose: Bun, Docker, compose health, `DATABASE_URL`/`TEST_DATABASE_URL`, databases, pgvector, `.env` keys, ports 3001/3002/5173, lefthook, gitleaks. |
| `bun run db:up`        | `docker compose up -d --wait postgres` (idempotent).                               |
| `bun run db:down`      | Stop Postgres; the data volume is kept.                                             |
| `bun run db:reset`     | `down -v` → up → re-run init scripts → migrate. **Deletes all local data.**          |
| `bun run db:logs`      | `docker compose logs -f postgres`.                                                  |
| `bun run clean`        | Remove `node_modules`, `dist`, `.turbo`, `coverage` in the root and every workspace (not the DB volume). Follow with `bun install`. |
| `bun run test:scripts` | `bun test scripts/` — unit tests for the helpers; also runs as part of `bun run test`. |
| `bun run db:migrate` / `db:generate` / `db:studio` / `test:db` | Database commands — see "Database" below. |

### What `docker-compose.yml` runs

A single `postgres` service from `pgvector/pgvector:pg16` (user/password `postgres`/`postgres`),
published on `localhost:${TJ_PG_PORT:-5432}`, data in the named volume `tj_pgdata`, healthcheck
`pg_isready`. On the **first boot of an empty volume** `infra/postgres/init/01-create-test-db.sh`
creates `teaching_journey_test` and enables pgvector in both `teaching_journey` and
`teaching_journey_test` (`CREATE EXTENSION IF NOT EXISTS vector;` — `@tj/db` migrations may repeat
it). pgvector needs no `shared_preload_libraries`. The compose project is named `teaching-journey`
so every checkout or worktree shares the same container and volume. No other services: no Redis,
no mail catcher (ADR 0008 logs mail to the console).

### Environment files

- **Root `.env`** (copied from `.env.example` by `setup`): `TJ_PG_PORT` and, optionally,
  `DATABASE_URL` / `TEST_DATABASE_URL`. When the URLs are unset the scripts derive them from
  `TJ_PG_PORT` (`postgres://postgres:postgres@localhost:<port>/teaching_journey[_test]`), so a port
  conflict needs one change. Read by **docker compose** (it loads `.env` from the directory of the
  compose file) and by the **root scripts** (Bun auto-loads `.env` from the cwd).
- **Per-app `.env`** next to each `package.json`: every app/package that reads env keeps its own
  `.env.example` (ADR 0015). Bun loads `.env` from the process cwd only — it does **not** walk up
  to the root, and Turborepo does not load env files either — so `apps/api` reads `apps/api/.env`.
  `WEB_ORIGIN=http://localhost:5173` lives there (see "API" below); `VITE_API_URL=/api` lives in
  `apps/web/.env` (the web app proxies `/api/*` to the API through Vite so cookies stay same-origin,
  see "Web app" below).
- `setup` discovers every `**/.env.example` (skipping `node_modules`, build output) and copies it
  to a sibling `.env` **only when missing** — it never overwrites. `doctor` lists, per file, the
  keys of the example that the `.env` lacks. New apps are picked up automatically.
- Precedence everywhere: shell variable > `.env` file > built-in default
  (`TJ_PG_PORT=5433 bun run db:up`).
- `setup` and `db:reset` run `bun run db:migrate` inside `packages/db` when that workspace exists
  and declares the script, with `DATABASE_URL` and `TEST_DATABASE_URL` set in its environment.

### Reset the database

```sh
bun run db:reset   # docker compose down -v -> up --wait -> init scripts -> db:migrate (if present)
```

Use it after a schema change you cannot migrate forward, after editing `infra/postgres/init/`, or
whenever the volume looks broken. `db:down` alone keeps the data.

### Database

Schema and migrations live in [`packages/db`](packages/db/README.md) (`@tj/db`, ADR 0006/0007).

```sh
bun run db:migrate    # apply packages/db/drizzle to DATABASE_URL, then TEST_DATABASE_URL (idempotent)
bun run db:generate   # after editing packages/db/src/schema: drizzle-kit generate -> review -> commit
bun run db:studio     # Drizzle Studio against DATABASE_URL
bun run test:db       # ensure Postgres, migrate, run EVERY workspace's tests with REQUIRE_TEST_DB=1
```

Migrations are committed SQL under `packages/db/drizzle/` and run as an explicit step (`setup`,
`db:reset`, `test:db`, the deploy pipeline) — never on app boot. Tenant tables are only reached
through `forWorkspace(db, workspaceId)`, which injects the `workspace_id` predicate; the raw client
is exported as `unsafeDb` on purpose. `job_events` plus `pg_notify('job_events', …)` is the
contract between the worker and the API's SSE stream (ADR 0012). Details, rules and the testing
helper: `packages/db/README.md`.

### Worker & jobs

Background jobs run on **pg-boss** in the same Postgres (ADR 0006). [`packages/jobs`](packages/jobs/README.md)
(`@tj/jobs`) is the typed layer both sides share: `createBoss()` + `ensureQueues()` at boot,
`enqueue(ctx, name, payload, { workspaceId })` / `cancel(ctx, jobId)` for the API, and
`runJob()` + the `JobRegistry` mapped type for the worker. Payloads are Zod-validated before
pg-boss is touched; every job writes `queued → started → progress* → completed | failed |
cancelled` to `job_events` (ADR 0012). [`apps/worker`](apps/worker/README.md) (`@tj/worker`) is
the sole consumer: `bun run dev` inside it (env from `apps/worker/.env`), `GET :3002/health`,
SIGTERM waits up to 25 s for active jobs and exits 0. pg-boss installs its own `pgboss` schema on
first start (`pgboss_test` in tests) — the one set of tables not managed by `@tj/db` migrations.

### Testing

Full guide: [`docs/testing.md`](docs/testing.md) — runners and the file-naming rule (`bun test`
for server packages, Vitest via the `@tj/config/vitest/react` preset for React packages, Playwright
`e2e/**/*.spec.ts`), the `withTestDb()` harness and factories, the test-only magic-link capture
route, running subsets, e2e locally, flake guidance.

Integration tests use `TEST_DATABASE_URL` (default
`postgres://postgres:postgres@localhost:5432/teaching_journey_test`), never `DATABASE_URL`, so a test
run cannot clobber your development data. The test database exists as long as the volume was created
by our init script — if `doctor` reports it missing, run `bun run db:reset`. `bun run test` skips
DB suites with a printed reason when the database is unreachable; `bun run test:db` sets
`REQUIRE_TEST_DB=1` so they fail instead. `turbo.json` passes `DATABASE_URL`, `TEST_DATABASE_URL`
and `REQUIRE_TEST_DB` through to the `test` task, so a value exported in the shell (as CI does)
reaches every workspace's tests; locally the per-package `.env` files supply them.

### API

`apps/api` ([`@tj/api`](apps/api/README.md), ADR 0005/0015) is Hono on Bun; `packages/api-client`
([`@tj/api-client`](packages/api-client/README.md)) is the typed Hono RPC client for `apps/web`.

- **Env** (`apps/api/.env`, from `.env.example`): `NODE_ENV`, `PORT` (3001), `DATABASE_URL`
  (required), `WEB_ORIGIN` (comma-separated CORS origins, default `http://localhost:5173`),
  `LOG_LEVEL`. Boot fails with one `VAR: message` line per problem and exit code 1.
- **Error envelope**: every non-2xx body is
  `{ error: { code, message, requestId, retryable, fields? } }`; `message` is a plain sentence safe
  for the UI; `x-request-id` is echoed (or generated) on every response.
- **Adding a route**: create a chained router under `apps/api/src/routes/` (`new Hono<AppEnv>()
  .get(…)`) validated with `zValidator(target, schema, validationHook)`, then append it to the
  `app.route("/", …)` chain in `apps/api/src/app.ts`. `AppType` updates automatically and
  `@tj/api-client` (type-only import of `@tj/api/app`) exposes it as `client.<path>.$get()`.

### Web app

`apps/web` ([`@tj/web`](apps/web/README.md), ADR 0004) is a Vite + React SPA with **code-based**
TanStack Router routes (`src/routes/<name>.route.ts` + `<name>.page.tsx`, assembled in
`src/router.ts`), TanStack Query and the typed RPC client. `bun run --filter=@tj/web dev` serves it
on `http://localhost:5173`.

- **Env** (`apps/web/.env`, from `.env.example`): `VITE_API_URL=/api` and `VITE_APP_ENV`, validated
  by Zod in `src/env.ts`; `VITE_DEV_API_TARGET` (default `http://localhost:3001`) is where the dev
  proxy forwards `/api/*` after stripping the prefix, so auth cookies stay same-origin.
- **Routes**: `/sign-in` (magic link), `/` (who am I + sign out) and `/dev/jobs` (development aid:
  enqueue `ping`, follow it over SSE, cancel). Everything but `/sign-in` sits under an auth layout
  whose `beforeLoad` resolves `/me` through the Query client and redirects when there is no session.
- **Bundle budget**: `bun run --filter=@tj/web build` then `bun run check:bundle-budget` (root)
  prints the gzip table; CI fails above 250 KB.

### Troubleshooting

| Symptom                                                                | Fix                                                                                                                   |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Docker does not appear to be running. Start Docker Desktop and re-run.` | Start Docker Desktop (or `sudo systemctl start docker`), then re-run the command.                                     |
| Port 5432 is taken by another Postgres                                 | Set `TJ_PG_PORT=5433` in the root `.env` and run `bun run db:up` (compose recreates the container on the new port). If you set `DATABASE_URL` explicitly, keep its port in sync — `doctor` warns otherwise. |
| `doctor`: `Compose service postgres — healthy, but publishes port X while TJ_PG_PORT=Y` | The container was started with a different port. `bun run db:up`.                                          |
| Stale volume after a schema change / `teaching_journey_test` missing / pgvector not enabled | `bun run db:reset` — init scripts only run on an empty volume.                                          |
| Postgres never becomes healthy                                         | `bun run db:logs`; a corrupt volume is fixed by `bun run db:reset`.                                                   |
| `doctor`: `Env <file> — missing N key(s)`                              | Copy the listed keys from the sibling `.env.example` into that `.env`.                                                |
| `doctor`: `Port 3001/3002/5173 — in use by <process>`                  | Stop that process (the PID is printed) or change the app's port in its `.env`.                                        |
| Git hooks missing                                                      | `bunx lefthook install` (also runs on `bun install`).                                                                 |
| `bun run dev` leaves processes behind                                  | It should not: `dev.ts` forwards SIGINT/SIGTERM to turbo and waits for it. Report it with `pgrep -fl turbo` output.   |


## Package map

From [ADR 0013](docs/adr/0013-monorepo-layout.md). Everything internal is scoped `@tj/*` and never
published. Dependency direction is apps → packages, never packages → apps; `@tj/domain` depends on
nothing internal.

```
apps/
  web/          @tj/web        Vite + React SPA, TanStack Router (code-based)   ADR 0004
  api/          @tj/api        Hono on Bun, Hono RPC contract                    ADR 0005
  worker/       @tj/worker     pg-boss consumer                                  ADR 0006
packages/
  ui/           @tj/ui         Tailwind v4 + shadcn design system               ADR 0009
  db/           @tj/db         Drizzle schema, migrations, forWorkspace()       ADR 0006/0007
  domain/       @tj/domain     Zod schemas + types, job names, StorageAdapter   Master PRD §8
  api-client/   @tj/api-client Hono RPC AppType + typed client factory          ADR 0005
  config/       @tj/config     Shared tsconfig bases, Tailwind preset           (this ticket)
docs/
  adr/          Architecture decision records
  glossary.md   Shared vocabulary
```

Only `packages/config` exists today; sibling tickets add the rest (see `docs/p0-ticket-map.md`).

## Agent skills

Coding agents start from [`AGENTS.md`](AGENTS.md) (root) and the `AGENTS.md` in each app/package,
which name the vendored skills to load (`<location>/.agents/skills/<name>/`) and the ADR constraints
that override generic skill advice. Sources, pinned commits, re-install commands and the
`bun run skills:check` verifier are documented in [`docs/agent-skills.md`](docs/agent-skills.md).

## Internal packages are consumed from source

**Decision (TEACH-11):** internal `@tj/*` packages are *just-in-time* packages. Their
`package.json#exports` point at TypeScript **source**, not at a `dist/` build. Bun, Vite and `tsc`
(`moduleResolution: "bundler"`) all resolve this directly, so:

- `typecheck` is `tsc --noEmit` in every workspace and does **not** depend on `^build`. In
  `turbo.json` it has `dependsOn: ["^typecheck", "//#typecheck:root"]` so failures surface in the
  package that owns them first (and so a dependency's changes invalidate dependents' caches).
- `build` is only meaningful for **apps** (`apps/api` and `apps/worker` bundle with
  `bun build --target=bun`; `apps/web` with `vite build`) and for packages that opt in (e.g.
  `@tj/domain` may add a `tsup` build to verify tree-shaking). `build` keeps
  `dependsOn: ["^build"]` and `outputs: ["dist/**"]`; packages without a `build` script are simply
  skipped.
- Nothing needs to be built before you can run `dev`, `typecheck` or `test`.

Every new package **must** copy this shape:

```jsonc
// packages/<name>/package.json
{
  "name": "@tj/<name>",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*.ts"          // optional: subpath exports, also from source
  },
  "scripts": {
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write .",
    "typecheck": "tsc --noEmit",
    "test": "bun test"           // or "vitest run" for React packages (ADR 0014)
  },
  "devDependencies": {
    "@tj/config": "workspace:*",
    "typescript": "5.9.3"
  }
}
```

```jsonc
// packages/<name>/tsconfig.json  (apps/web and packages/ui use tsconfig/react.json)
{
  "extends": "@tj/config/tsconfig/node.json",
  "include": ["src"]
}
```

Consumers declare the dependency as `"@tj/<name>": "workspace:*"`. Bun 1.3 uses the **isolated**
linker for workspaces (pnpm-style), so a workspace can only import what it declares — including
`@tj/config` when it extends a tsconfig from it.

### `@tj/config`

| Export                                | Purpose                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `@tj/config/tsconfig/base.json`       | strict, `ES2022`/`ESNext`, `moduleResolution: bundler`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `isolatedModules`, `skipLibCheck` |
| `@tj/config/tsconfig/node.json`       | base + `lib: ESNext` + `@types/bun` (apps/api, apps/worker, server packages)              |
| `@tj/config/tsconfig/react.json`      | base + `lib: DOM, DOM.Iterable, ESNext` + `jsx: react-jsx` (apps/web, packages/ui)        |
| `@tj/config/tailwind.preset`          | Tailwind preset placeholder — filled by F18 (ADR 0009)                                    |

Biome is configured once in the root `biome.json` (ADR 0003); packages do not carry their own.

## Conventions

- **Default branch is `master`** (not `main`; see the amendment in
  [`docs/adr/README.md`](docs/adr/README.md)). Trunk-based development, squash merges.
- **Pull requests are required** to change `master` (branch protection; CI checks are added by
  TEACH-23). Do not push directly.
- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`, `build:`, `ci:`, `refactor:`,
  `test:`, …) enforced by `commitlint` in the `commit-msg` hook ([ADR 0015](docs/adr/0015-env-logging-commits.md)).
- **Biome** is the only linter/formatter: 2-space indent, double quotes, trailing commas, 100-column
  lines, recommended rules + the `a11y` group at `error`, imports organised automatically. The
  `pre-commit` hook runs `biome check --staged --write` and re-stages the result.
- **Secrets never land in git.** The `pre-commit` hook runs `gitleaks protect --staged` when
  `gitleaks` is installed (and prints a one-line warning otherwise); CI scans unconditionally.
- **Exact versions.** `bunfig.toml` sets `[install] exact = true`; `bun add` pins exact versions
  and `bun.lock` is committed. CI installs with `bun install --frozen-lockfile`.
- **Hooks** are managed by [lefthook](https://github.com/evilmartians/lefthook) (`lefthook.yml`).
  `LEFTHOOK=0 git commit …` bypasses them in an emergency; CI re-runs the same checks.
- Product terms (Journey, Lesson, Artefact, Workspace, …) are used exactly as defined in
  [`docs/glossary.md`](docs/glossary.md).

## Deploy

### Vercel (web)

`apps/web` deploys to Vercel as a static Vite build — project `teaching-journey-web`, Root Directory
`apps/web`, production branch **`master`** (ADR 0010 says "production"; the repo's default branch
is `master`, see Conventions). Every PR gets a preview whose `VITE_API_URL` is derived at build time
from the Railway PR-environment URL template (`scripts/vercel-env.ts`); Speed Insights loads in
production builds only. Config: [`apps/web/vercel.json`](apps/web/vercel.json); runbook, env
scopes and dashboard-only steps: [`infra/README.md` → "Vercel (web)"](infra/README.md#vercel-web--teach-25).

### Railway (api, worker, Postgres)

`apps/api` and `apps/worker` ship as **one Docker image** built from the root
[`Dockerfile`](Dockerfile) (multi-stage, `oven/bun:1.3.6-alpine`, ~155 MB) and run on Railway in
EU-West (Amsterdam) next to a `pgvector/pgvector:pg16` Postgres (ADR
[0010](docs/adr/0010-hosting-vercel-railway.md)). The image's entrypoint takes one word:
`api`, `worker` or `migrate`; Railway runs `migrate` as the api's pre-deploy command (ADR 0006:
never on boot). Config-as-code lives in [`infra/railway/`](infra/railway/), the full runbook
(topology, variables, deploy/rollback, PR environments, dashboard-only steps) in
[`infra/README.md`](infra/README.md).

Local parity against the compose Postgres:

```sh
bun run docker:build         # docker build -t tj:local .
bun run docker:migrate       # idempotent: "DATABASE_URL up to date"
bun run docker:run:api       # http://localhost:3001/health -> {"ok":true,"db":"up"}
bun run docker:run:worker    # http://localhost:3002/health
```

## CI

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on every pull request
and on pushes to `master` (TEACH-23). One run per branch: a new push cancels the previous run.
Every job starts from the composite action [`.github/actions/setup`](.github/actions/setup/action.yml)
(Bun from `.bun-version`, install cache keyed on `bun.lock`, `bun install --frozen-lockfile`).

| Job | What it runs | Reproduce locally | Blocking |
| --- | ------------ | ----------------- | -------- |
| `quality` | `bun run lint`, `typecheck`, `skills:check`, `verify-bootstrap`; commitlint on the PR title | the same four commands; `echo "<title>" \| bunx --bun commitlint` | yes |
| `tooling-smoke` | `bun run setup --ci && bun run doctor` against docker compose, then `bun run test:scripts` | the same commands (needs Docker) | yes |
| `test` | `bun run test:db` against a `pgvector/pgvector:pg16` service with `teaching_journey` + `teaching_journey_test` (migrates, `REQUIRE_TEST_DB=1`); uploads `coverage/` | `bun run test:db` | **gated** (see below) |
| `build` | `bun run build`; `bun run check:bundle-budget --markdown-out bundle-budget.md`; sticky PR comment `<!-- tj-bundle-budget -->` | `bun run build && bun run check:bundle-budget` | yes |
| `e2e` | Postgres service + `teaching_journey_test`, Playwright Chromium (cached) + `bun run test:e2e`; report uploaded on failure | `bunx playwright install chromium && bun run test:e2e` (needs the compose Postgres) | **gated** |
| `audit` | `bun audit --audit-level=high` (native in Bun 1.3.6); when npm's advisory endpoint is down it falls back to `osv-scanner` on `bun.lock`, failing only on high/critical; `actions/dependency-review-action` with `fail-on-severity: high` on PRs | `bun audit --audit-level=high` (or `docker run --rm -v "$PWD:/src" -w /src ghcr.io/google/osv-scanner:v2.5.1 --lockfile=bun.lock`) | yes |
| `secrets` | `gitleaks/gitleaks-action` over the full history (`fetch-depth: 0`) | `gitleaks git --redact .` (or `gitleaks protect --staged` via the pre-commit hook) | yes |
| `docker-build-smoke` | `docker build .` -- skipped until a `Dockerfile` exists | `docker build .` | yes (once present) |
| `detect` | probes for `apps/web/package.json` and `Dockerfile` so the optional jobs above can be skipped (`hashFiles()` is not allowed in job-level `if`) | -- | -- |

### Phase split and `CI_STRICT`

`apps/*` and `packages/db` land in TEACH-14/16/21/22, so Phase 1 ships the pipeline with the
Postgres-backed `test` job and the Playwright `e2e` job **gated**: they run, but a failure does not
block the PR (`continue-on-error`). The gate is the repository variable `CI_STRICT`:

- `CI_STRICT` unset or anything other than `true` -> `test` and `e2e` are informational (Phase 1).
- `CI_STRICT=true` -> `test` and `e2e` are blocking, like every other job (Phase 2).

Flip it with `gh variable set CI_STRICT --body true --repo OmerBresinski/ai-teacher` once the first
real test suites are green. The `build` job's bundle-budget step prints
`Bundle budget: skipped — apps/web/dist/.vite/manifest.json not found (TEACH-21)` and exits 0 until
the web app produces a Vite manifest; from then on it fails above 250 KB gzip (warns above 200 KB;
override with `BUNDLE_BUDGET_KB` / `BUNDLE_WARN_KB`).

### Phase 2: require the checks on `master`

Branch protection is **not** changed by Phase 1. Once `CI_STRICT=true` has produced a few green
runs, require every job with (do not run this before then -- gated jobs would still be required):

```sh
cat > /tmp/protection.json <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["quality", "tooling-smoke", "test", "build", "e2e", "audit", "secrets"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
gh api -X PUT repos/OmerBresinski/ai-teacher/branches/master/protection --input /tmp/protection.json
```

### Remote cache and secrets

- **Turborepo remote cache** ([ADR 0002](docs/adr/0002-turborepo.md)): the workflow forwards
  `TURBO_TOKEN` (repository secret) and `TURBO_TEAM` (repository variable). Both are empty until
  the Vercel project exists (TEACH-21/ADR 0010); `turbo` then simply runs without a remote cache.
  `TURBO_TELEMETRY_DISABLED=1` and `DO_NOT_TRACK=1` are set for every job.
- **Dependency graph / Dependabot alerts** are enabled on the repository (TEACH-23 turned them on
  via `gh api -X PUT repos/OmerBresinski/ai-teacher/vulnerability-alerts`); `dependency-review-action`
  refuses to run without the graph.
- **gitleaks**: `GITLEAKS_LICENSE` is only required for organisation-owned repositories.
  `OmerBresinski/ai-teacher` is a personal repository, so no license is configured; if the repo
  ever moves to an organisation, obtain a free key at gitleaks.io and add it as a repository
  secret. A `.gitleaks.toml` at the root is picked up automatically if an allowlist is ever needed.
- **Dependabot** ([`.github/dependabot.yml`](.github/dependabot.yml)): weekly, `bun` ecosystem with
  minor/patch grouped into one PR, plus `github-actions` (SHA-pinned actions with `# vX.Y.Z`
  comments). [`CODEOWNERS`](.github/CODEOWNERS) requests a review from `@OmerBresinski` on every
  PR; the [PR template](.github/pull_request_template.md) carries the merge checklist.
