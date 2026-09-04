# Infrastructure — Vercel (web), Railway (api, worker, Postgres) and the Docker image

Runbook for everything that is not the local compose stack (that lives in
[`../docker-compose.yml`](../docker-compose.yml) and [`postgres/`](postgres/)). Decisions:
ADR [0001](../docs/adr/0001-bun-runtime-and-workspaces.md) (oven/bun base),
[0006](../docs/adr/0006-postgres-drizzle-pgboss.md) (Postgres 16 + pgvector, migrations never
on boot), [0010](../docs/adr/0010-hosting-vercel-railway.md) (Vercel web + Railway api/worker/db,
EU-West), [0016](../docs/adr/0016-prd-deviations.md) (EU not UK residency).

> **Status (TEACH-24, 2026-09-04).** The image, config-as-code and the provisioning script are
> done and verified locally. **The Railway project itself is not created yet**: every workspace
> the CLI user belongs to (`omerbresinski's Projects`, `Grok Studio`, `Shortyy`) has
> `customer.state = INACTIVE` with no subscription, and Railway rejects `projectCreate` /
> `railway init` server-side with *"Your trial has expired. Please select a plan to continue
> using Railway."* Pick a plan (Hobby is enough) in the dashboard, then run
> `./infra/railway/provision.sh --deploy` once — it performs every step below. Fields marked
> `<pending>` are filled in by that run.

## Vercel (web) — TEACH-25

`apps/web` is a static Vite build on Vercel (ADR 0010). Everything below except the items in the
"dashboard-only" list was done with the CLI / API and is reproducible; ids live in the (gitignored)
`.vercel/project.json` created by `vercel link`, never in git.

| Setting                | Value                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| Team / project         | `omerbresinskis-projects` (personal) / **`teaching-journey-web`**                                  |
| Root Directory         | `apps/web` (`vercel project update teaching-journey-web --root-directory apps/web`); "Include source files outside of the Root Directory" is on (API `sourceFilesOutsideRootDirectory: true`, the default) |
| Framework preset       | Vite (project setting and `apps/web/vercel.json#framework`)                                         |
| Install / build        | from `apps/web/vercel.json`: `cd ../.. && bun install --frozen-lockfile --ignore-scripts` (skips the root `prepare` → `lefthook install`, which has no git repo on Vercel) and `cd ../.. && bun scripts/vercel-env.ts exec bunx turbo run build --filter=@tj/web`; output `dist` |
| Ignored Build Step     | `bash scripts/vercel-ignore-build.sh` (relative to `apps/web`): skips when nothing under `apps/web`, `packages/{ui,api-client,domain,config}`, `bun.lock`, `turbo.json`, root `package.json`/`bunfig.toml` changed since `VERCEL_GIT_PREVIOUS_SHA`; always builds when that SHA is missing |
| Git                    | `vercel git connect https://github.com/OmerBresinski/ai-teacher.git`; production branch **`master`** (the default was `main`; fixed with `PATCH /v1/projects/teaching-journey-web/branch {"branch":"master"}`). Pushes to `master` deploy production, every other branch/PR a preview |
| Domains                | `teaching-journey-web.vercel.app` (auto). `app.<domain>` — `TODO(domain)`, TEACH-26              |
| Deployment protection  | Vercel Authentication (SSO) on all non-custom-domain deployments — Hobby default; previews ask for a Vercel login. A Protection Bypass for Automation secret exists (curl/e2e: `x-vercel-protection-bypass: <secret>`, read it in *Settings → Deployment Protection*; never commit it) |
| Speed Insights         | `@vercel/speed-insights` is loaded **only** when `VITE_APP_ENV=production` (`apps/web/src/lib/speed-insights.ts`, dynamic import, verified absent from preview `dist/`). Enabling the *feature* on the project is dashboard-only (CLI refuses: "incurs charges") |
| Verified preview       | `https://teaching-journey-5v1umubdb-omerbresinskis-projects.vercel.app` (2026-09-04): `/dev/jobs` → 200 HTML, `/assets/does-not-exist.js` → 404, `/assets/*` `Cache-Control: public, max-age=31536000, immutable`, `/` and deep links `no-cache`, security headers present, no speed-insights code |

### Environment variables (names + non-secret values)

| Variable                      | Scope      | Value                                                                                             |
| ----------------------------- | ---------- | ------------------------------------------------------------------------------------------------- |
| `VITE_APP_ENV`                | Production | `production`                                                                                      |
| `VITE_API_URL`                | Production | `https://api.example.invalid` — **placeholder, `TODO(domain)`**: replace with `https://api.<domain>` (TEACH-26) via `vercel env rm VITE_API_URL production && vercel env add VITE_API_URL production --value https://api.<domain> --no-sensitive` |
| `VITE_APP_ENV`                | Preview    | `preview`                                                                                         |
| `RAILWAY_PR_API_URL_TEMPLATE` | Preview    | `https://api-pr-{pr}.up.railway.app` — the *expected* Railway PR-environment domain (see "PR environments"); **confirm after the first Railway PR deploy** and update with `vercel env` |
| `VITE_API_URL_FALLBACK`       | Preview    | `https://api.example.invalid` placeholder — used for branch pushes without a PR and while the template is unconfirmed; point it at the Railway production api once it exists |

`scripts/vercel-env.ts` (repo root, `bun test scripts/`) turns these into the two `VITE_*` values
the bundle sees: production → the explicit `VITE_API_URL`; preview → `RAILWAY_PR_API_URL_TEMPLATE`
with `{pr}` = `VERCEL_GIT_PULL_REQUEST_ID`, else `VITE_API_URL_FALLBACK`, else the build fails
loudly. The `vercel-env:` line in the build log shows which rule fired. `turbo.json` lists
`VITE_API_URL` / `VITE_APP_ENV` under `@tj/web#build.env`, so the turbo cache key changes with
them (Vercel's build uses its own remote cache: "Detected Turbo").

### Headers and rewrites (`apps/web/vercel.json`)

- Rewrite `/((?!assets/|_vercel/).*)` → `/index.html` (SPA deep links); missing `/assets/*` files
  stay 404 instead of returning HTML.
- `/assets/*` → `public, max-age=31536000, immutable` (hashed filenames); everything else
  (`/`, `/index.html`, deep links) → `no-cache`. Note: a 404 under `/assets/` also carries the
  immutable header — harmless because hashed names never repeat, but do not add un-hashed files
  under `assets/`.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy:
  strict-origin-when-cross-origin`, `Permissions-Policy` denying camera/microphone/geolocation/
  payment/usb/interest-cohort.
- `Content-Security-Policy-Report-Only` — `default-src 'self'`; `script-src 'self'
  '<sha256 of THEME_INIT_SCRIPT>'` (the inline theme script is allowed by hash, not
  `'unsafe-inline'`; `apps/web/src/vercel-config.test.ts` fails with the new hash whenever the
  script changes); `style-src 'self' 'unsafe-inline'` (React/Radix inline styles); `connect-src
  'self' https:` — `vercel.json` is static, so the exact API origin cannot be injected per
  environment; `https:` is the honest conservative choice. It is report-only with no `report-to`,
  i.e. violations only show in the browser console. Follow-up: enforce it (and narrow
  `connect-src`) once the API domains are fixed, e.g. by generating the header at build time.

### Pairing a Vercel preview with a Railway PR environment (pending Railway billing)

1. Railway PR env `pr-<n>` deploys the api at the domain matching `RAILWAY_PR_API_URL_TEMPLATE`.
2. Vercel builds the PR with `VITE_API_URL` = that domain (see above).
3. The api in the PR env must accept the preview origin and set a cross-site cookie: on the Railway
   **PR environment only** set `COOKIE_SAMESITE=none` (`apps/api`: cookie becomes `SameSite=None;
   Secure`, boot logs a warning; production stays `lax` + `COOKIE_DOMAIN`) and
   `WEB_ORIGIN_PATTERNS=https://teaching-journey-web-*-omerbresinskis-projects.vercel.app`
   (glob, `*` = one DNS label — covers `…-git-<branch>-…` and `…-<hash>-…` preview URLs; also
   fed to better-auth `trustedOrigins`). `WEB_ORIGIN` keeps the exact production/alias origins.
   Both can be seeded through `infra/railway/api.json` once Railway's `environments.pr` overrides
   are wired (TEACH-24 follow-up).
4. Vercel's SSO protection does not affect the page's own XHR/SSE to the api once the page loaded.

### Turbo remote cache (TEACH-23 phase 2)

`bunx turbo link --yes --scope omerbresinskis-projects` succeeded locally on 2026-09-04 (turbo
reuses the Vercel CLI login; `.turbo/config.json` holds only the team id and is gitignored) and a
`--cache=remote:rw` run hit the remote cache. For GitHub Actions: create a token at
<https://vercel.com/account/tokens> (scope `omerbresinskis-projects`), then
`gh secret set TURBO_TOKEN --repo OmerBresinski/ai-teacher` and
`gh variable set TURBO_TEAM --body omerbresinskis-projects --repo OmerBresinski/ai-teacher`.
`.github/workflows/ci.yml` already forwards both. No token is stored in this repository.

### Manual deploys

```sh
export PATH="$HOME/.bun/bin:$PATH"                     # vercel CLI logged in
vercel link --yes --project teaching-journey-web --scope omerbresinskis-projects   # from the repo ROOT
vercel deploy --yes --target=preview                   # preview; Root Directory applies server-side
vercel deploy --yes --prod                             # production (master) — avoid; let Git do it
```

Link and deploy from the **repository root**, not `apps/web`: with Root Directory set, a CLI
upload from `apps/web` fails with `Root Directory "apps/web" does not exist`. `.vercelignore`
(root) keeps `.env*` files, `dist`, `node_modules` etc. out of CLI uploads — the CLI does **not**
read `.gitignore`. Delete `.env.local` if `vercel link` creates one.

### Dashboard-only (Vercel)

- [ ] *Speed Insights → Enable* on `teaching-journey-web` (charges; CLI refuses non-interactively).
      The client code is already in the production bundle.
- [ ] Optional: *Web Analytics* (`@vercel/analytics` is not installed — add it the same
      production-only way if wanted).
- [ ] When domains exist (TEACH-26): add `app.<domain>`, set `VITE_API_URL` (Production) to
      `https://api.<domain>`, point `VITE_API_URL_FALLBACK` at the production api, and confirm
      `RAILWAY_PR_API_URL_TEMPLATE` from a real Railway PR environment.
- [ ] Confirm the GitHub App has access to `OmerBresinski/ai-teacher` (it did — `vercel git connect`
      succeeded and PR comments are on) after any GitHub permission change.

## Topology

```
                 GitHub OmerBresinski/ai-teacher (master)          PR branch
                                │                                     │
                     Railway GitHub App ── auto-deploy ──┐   PR environment (ephemeral copy
                                                         │    of production: api + worker,
  Vercel  apps/web  ──── HTTPS ────►  ┌───────────────┐  │    own Postgres, own domains)
  (TEACH-21/25)                       │  api          │◄─┘
                                      │  Dockerfile   │      one image, three commands
                                      │  entry: api   │      ┌──────────────────────────┐
                                      │  pre-deploy:  │      │ /app/entrypoint.sh api    │
                                      │    migrate    │      │ /app/entrypoint.sh worker │
                                      └───────┬───────┘      │ /app/entrypoint.sh migrate│
                    private IPv6 network      │              └──────────────────────────┘
                    (postgres.railway.internal)│ pg-boss queues live in the same DB
                                      ┌───────▼───────┐      ┌───────────────┐
                                      │  postgres     │◄─────│  worker       │
                                      │  pgvector/    │      │  Dockerfile   │
                                      │  pgvector:pg16│      │  entry: worker│
                                      │  volume       │      │  no domain    │
                                      └───────────────┘      └───────────────┘
                              region: europe-west4-drams3a (EU-West, Amsterdam)
```

| Service    | Source                                  | Config-as-code                | Ports / network                                   |
| ---------- | --------------------------------------- | ----------------------------- | ------------------------------------------------- |
| `api`      | GitHub repo, root `Dockerfile`          | `infra/railway/api.json`      | `PORT=3001`; public Railway domain; `/health`     |
| `worker`   | GitHub repo, root `Dockerfile`          | `infra/railway/worker.json`   | `PORT=3002` (health only); **no public domain**   |
| `postgres` | image `pgvector/pgvector:pg16` + volume | — (image service)             | 5432 on the private network only; **no domain, no TCP proxy** |

Project name: `teaching-journey`. Environment: `production` (+ ephemeral `pr-<number>`).
Project / service ids: `<pending>` — `railway status --json` after provisioning.

### Why not Railway's managed Postgres

`railway add --database postgres` deploys `ghcr.io/railway/postgres-ssl`, which has no
`pgvector`. Migration `0000_init.sql` runs `CREATE EXTENSION IF NOT EXISTS vector`, so the server
must ship the extension: we run the same `pgvector/pgvector:pg16` image as `docker-compose.yml`
with a volume at `/var/lib/postgresql/data` and `PGDATA=/var/lib/postgresql/data/pgdata` (the
official image refuses a non-empty mount root). Trade-off: no Railway backups UI / `DATABASE_URL`
auto-variable; `DATABASE_URL` is a reference variable instead (below), and backups are a
TEACH-26+ follow-up (`pg_dump` cron or Railway volume backups).

## The image (`Dockerfile`)

Multi-stage, pinned to `oven/bun:1.3.6-alpine` (matches `.bun-version`; bump together).

| Stage     | What                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------- |
| `pruner`  | `turbo prune @tj/api @tj/worker --docker` → `json/` (manifests + pruned `bun.lock`), `full/` (sources)  |
| `deps`    | `bun install --frozen-lockfile --ignore-scripts` from `json/` (layer cached until a manifest changes)     |
| `build`   | `turbo run build` → `apps/{api,worker}/dist/index.js`; `bun build packages/db/src/migrate.ts` → `packages/db/dist/migrate.js`; then deletes `node_modules` and re-bundles the three files to **prove they are self-contained** |
| `runtime` | non-root `bun` user, `/app/apps/*/dist`, `/app/packages/db/{dist,drizzle}`, `entrypoint.sh`. No sources, no `node_modules`. **~155 MB** (`docker images tj:local`) |

`infra/docker/entrypoint.sh` (`ENTRYPOINT`, default `CMD ["api"]`) `exec`s Bun so SIGTERM reaches
the process: `api` → `bun apps/api/dist/index.js`, `worker` → `bun apps/worker/dist/index.js`,
`migrate` → `bun packages/db/dist/migrate.js`, anything else → usage, exit 2. Railway's
"start command" **replaces the `ENTRYPOINT`** (exec form), which is why the config files use the
full `/app/entrypoint.sh api` etc. `HEALTHCHECK` fetches `http://127.0.0.1:$PORT/health`.

Local parity (root `package.json`, all verified against the compose Postgres):

```sh
bun run docker:build         # docker build -t tj:local .
bun run docker:migrate       # db:migrate: DATABASE_URL up to date (... 33 ms)
bun run docker:run:api       # GET :3001/health -> {"ok":true,"db":"up"}; docker stop -> exit 0
bun run docker:run:worker    # GET :3002/health -> {"ok":true,"activeJobs":0,"boss":"started"}
```

`.dockerignore` keeps the context to manifests, sources, `packages/db/drizzle/**` and
`infra/docker/`; `apps/web`, `packages/ui`, docs, tests, CI and env files never reach the daemon.
CI job `docker-build-smoke` runs `docker build .` on every PR.

## Config-as-code (`infra/railway/*.json`)

One `railway.json` per service, selected by the service setting **Config-as-code path**
(`serviceInstanceUpdate.railwayConfigFile`, set by the script). The root `railway.json` is the
fallback for a service without a path. Values override dashboard settings on the next deploy.

| Key                                  | `api.json`                                   | `worker.json`                  |
| ------------------------------------ | -------------------------------------------- | ------------------------------ |
| `build.builder` / `dockerfilePath`   | `DOCKERFILE` / `Dockerfile`                  | same                           |
| `build.watchPatterns`                | api + db/domain/jobs/config + Docker files   | worker + same packages         |
| `deploy.region`                      | `europe-west4-drams3a`                       | same                           |
| `deploy.startCommand`                | `/app/entrypoint.sh api`                     | `/app/entrypoint.sh worker`    |
| `deploy.preDeployCommand`            | `["/app/entrypoint.sh migrate"]` (600 s max) | —                              |
| `deploy.healthcheckPath` / timeout   | `/health` / 300 s                            | `/health` / 300 s (on `PORT`)  |
| `deploy.restartPolicyType` / retries | `ON_FAILURE` / 5                             | same                           |
| `deploy.drainingSeconds`             | 30 (Railway sends SIGTERM, then SIGKILL)     | 30 (worker drains jobs ≤ 25 s) |
| `deploy.overlapSeconds`              | 10 (old api serves while new one warms up)   | — (one consumer at a time)     |

Pre-deploy runs in the freshly built image **before** the new api replica starts and before the
health check; a failed migration fails the deploy and the previous deployment keeps serving.

## Variables (names only — values live in Railway, never in git)

| Variable              | api | worker | Set by / value shape                                                                                              |
| --------------------- | :-: | :----: | ----------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | ✓   | ✓      | reference: `postgres://${{postgres.POSTGRES_USER}}:${{postgres.POSTGRES_PASSWORD}}@${{postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/${{postgres.POSTGRES_DB}}` |
| `PORT`                | 3001| 3002   | script                                                                                                            |
| `NODE_ENV`            | ✓   | ✓      | `production`                                                                                                      |
| `LOG_LEVEL`           | ✓   | ✓      | `info`                                                                                                            |
| `BETTER_AUTH_SECRET`  | ✓   |        | script, `openssl rand -base64 32` via `--stdin`; rotate with the same command                                     |
| `BETTER_AUTH_URL`     | ✓   |        | `https://${{RAILWAY_PUBLIC_DOMAIN}}` (resolves per environment, PR envs included)                                 |
| `WEB_ORIGIN`          | ✓   |        | production: `https://teaching-journey-web.vercel.app` (+ `https://app.<domain>` later), comma-separated exact origins |
| `WEB_ORIGIN_PATTERNS` | ✓   |        | PR environments: `https://teaching-journey-web-*-omerbresinskis-projects.vercel.app` (glob; see "Vercel (web)"); unset in production |
| `COOKIE_SAMESITE`     | ✓   |        | `none` while web and api are on unrelated origins (forces `Secure`; boot warning); `lax` + `COOKIE_DOMAIN` once `app.<d>`/`api.<d>` exist — ADR 0008/0010 |
| `COOKIE_DOMAIN`       | ✓   |        | unset; **TEACH-26** sets `.<domain>` once custom domains exist                                                     |
| `MAIL_PROVIDER`       | ✓   |        | `console` until F17                                                                                               |
| `GOOGLE_*`, `MICROSOFT_*` | ✓ |      | unset (optional OAuth) — TEACH-26                                                                                 |
| `WORKER_CONCURRENCY`  |     | ✓      | `4`                                                                                                               |
| `POSTGRES_USER/PASSWORD/DB`, `PGDATA` | postgres | | script (`postgres` / random hex / `teaching_journey` / `/var/lib/postgresql/data/pgdata`)                 |

Never set `ENABLE_TEST_ROUTES` on Railway (the api refuses it with `NODE_ENV=production`).

## Provision, deploy, roll back

```sh
export PATH="$HOME/.bun/bin:$PATH"           # railway >= 5.49, logged in
./infra/railway/provision.sh                 # idempotent: project, services, volume, vars, domain,
                                             # config paths, GitHub source, PR environments
./infra/railway/provision.sh --deploy        # ...plus a first `railway up` of api and worker
```

The script uses the CLI for everything it can and two GraphQL mutations for what it cannot:
`serviceInstanceUpdate { railwayConfigFile, region }` (config-as-code path) and
`projectUpdate { prDeploys: true }` (PR environments). Re-running is safe; it never prints secrets.
It has been syntax-checked and its JSON parsing verified against a live project's CLI output, but
**not yet executed end-to-end** (blocked on billing, see Status above).

| Task                     | Command                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| Deploy from a checkout   | `railway up --service api --ci -m "<why>"` (same for `worker`); GitHub pushes to `master` deploy automatically once the source is connected |
| Watch                    | `railway deployment list --service api --json \| jq '.[0].status'`; `railway logs --service api --lines 200` (`--build` for build logs; pre-deploy output is in the deploy logs) |
| Roll back                | `railway redeploy --service api --yes` re-deploys the latest; for an older build use the dashboard → Deployments → ⋯ → *Redeploy* on the good one. Migrations are forward-only: roll back code, not the schema. |
| Restart                  | `railway restart --service api --yes`                                                            |
| Manual migrate           | `railway ssh --service api /app/entrypoint.sh migrate` (runs inside the live api container, which has the bundle and the private-network `DATABASE_URL`). `railway run` is *local* execution with Railway variables — the private Postgres host is not reachable from a laptop, so it is not an option here. |
| Connect to Postgres      | `railway connect postgres` (SSH tunnel; no public proxy exists on purpose), then `select extname from pg_extension;` → `vector` |
| Variables                | `railway variable list --service api --json`; `railway variable set K=V --service api`; secrets via `--stdin` |

## PR environments

`projectUpdate(prDeploys: true)` (dashboard: *Settings → Environments → Enable PR environments*).
Each PR against `master` gets an environment named `pr-<number>` that copies `production`'s
services and variables, builds the PR commit for `api` and `worker`, and gets a fresh `postgres`
(empty volume → migrations create the schema via the pre-deploy step). Reference variables
resolve inside the PR environment, so `DATABASE_URL` points at the PR's own database and
`BETTER_AUTH_URL` at the PR api. The environment is deleted when the PR closes.

API preview URL pattern (Vercel preview → Railway preview): Railway generates
`https://<service>-<environment>.up.railway.app`, i.e. expected `https://api-pr-<number>.up.railway.app`
— the production one is `https://api-production-<hash>.up.railway.app` unless renamed with
`railway domain update`. TEACH-25 does **not** hard-code it: the Vercel Preview variable
`RAILWAY_PR_API_URL_TEMPLATE=https://api-pr-{pr}.up.railway.app` feeds `scripts/vercel-env.ts`.
**Confirm the actual generated name** from `railway domain list --service api --environment pr-<n> --json`
after the first PR deploy and update that variable. The PR environment's api needs
`WEB_ORIGIN_PATTERNS` (Vercel preview origins) and `COOKIE_SAMESITE=none` — see "Vercel (web)".

## Networking notes

- Service-to-service traffic uses Railway's **private network, which is IPv6-only**
  (`postgres.railway.internal`). Bun's `postgres` driver resolves AAAA records fine; nothing binds
  to `::` explicitly because only *outbound* traffic to Postgres crosses the private network.
  The api listens on `0.0.0.0:$PORT` for the public edge.
- `postgres` has no public domain and no TCP proxy. Use `railway connect postgres` (SSH) for a shell.
- The worker's `/health` is only reachable inside the private network / by Railway's health check.

## Graceful shutdown

Railway sends `SIGTERM`, waits `drainingSeconds` (30), then `SIGKILL`. The entrypoint `exec`s Bun,
so the signal reaches the app: the api stops accepting, ends SSE streams, drains in-flight
requests, stops pg-boss and closes the pool (`apps/api/src/index.ts`); the worker stops fetching
and waits up to 25 s for running jobs (`apps/worker`). Both were observed exiting 0 under
`docker stop`.

## Dashboard-only steps (checklist)

- [ ] **Billing**: choose a plan for the workspace that will own `teaching-journey` (blocks everything).
- [ ] **Railway GitHub App** installed on `OmerBresinski/ai-teacher` (Settings → Integrations →
      GitHub) so `railway service source connect --repo OmerBresinski/ai-teacher --branch master`
      succeeds and pushes to `master` auto-deploy. The script prints `!!` if this is missing.
- [ ] Confirm *Settings → Environments → Enable PR environments* shows on (set by the script).
- [ ] Optional: rename the generated api domain (`railway domain update <old> --domain api-teaching-journey`)
      and later add `api.<domain>` (TEACH-26).

Everything else — project, region, image + volume, services, config-as-code paths, variables,
public domain, PR environments — is done by `provision.sh` via CLI/GraphQL.
