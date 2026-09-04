# Infrastructure — Vercel (web), Railway (api, worker, Postgres) and the Docker image

Runbook for everything that is not the local compose stack (that lives in
[`../docker-compose.yml`](../docker-compose.yml) and [`postgres/`](postgres/)). Decisions:
ADR [0001](../docs/adr/0001-bun-runtime-and-workspaces.md) (oven/bun base),
[0006](../docs/adr/0006-postgres-drizzle-pgboss.md) (Postgres 16 + pgvector, migrations never
on boot), [0010](../docs/adr/0010-hosting-vercel-railway.md) (Vercel web + Railway api/worker/db,
EU-West), [0016](../docs/adr/0016-prd-deviations.md) (EU not UK residency).

> **Status (TEACH-24, 2026-09-04) — live.** The workspace `omerbresinski's Projects` is on the
> Railway **Hobby** plan and `./infra/railway/provision.sh` was run end-to-end: project
> **`teaching-journey`** (`a79752e1-8bf5-41d0-b832-f1b64aaf6d2f`), environment `production`
> (`d595bbf8-dc4b-494f-b1f7-0023dd2dc25d`), region `europe-west4-drams3a`, services `postgres`
> (`5c408f9c-b1f2-4820-8a0b-a888391dfa02`), `api` (`ef433c66-c762-4c21-890e-c69856a09a39`, public
> domain **`https://api-production-903f.up.railway.app`**) and `worker`
> (`5d7a3bc8-a02d-44b8-83ca-ea11c20a1676`, no domain). GitHub source is connected for api + worker
> on `master`, PR environments are on and **verified with PR #30** (see "PR environments").
> Production is wired end-to-end to the Vercel web app (CORS preflight → 204, magic link → `302`
> back to `https://teaching-journey-web.vercel.app` with the session cookie → `/me` 200; pre-deploy
> `db:migrate: DATABASE_URL up to date`). The only known variable gap is `BLOB_READ_WRITE_TOKEN`
> (no Vercel Blob store yet — see "Post-provisioning checklist").

## Known gaps (read this first)

The stack works end-to-end but several pieces are deliberate stopgaps. Each is tracked as a
Linear issue in project **P1 — Production hardening**; update this table when one closes.

| Gap | Today | Target | Tracked / documented |
| --- | ----- | ------ | -------------------- |
| **Sign-in mail is console-only** | `MAIL_PROVIDER=console` in production: magic links are printed to the api log (`railway logs --service api`), never sent. Only someone with Railway access can sign in. | A real mail provider (Resend/Postmark) behind the existing `MailSender` interface, `MAIL_PROVIDER=resend` + API key on Railway. | TEACH-35; ADR 0008; `apps/api/src/mail/` |
| **Cross-site session cookie** | `COOKIE_SAMESITE=none` on the production api because `*.vercel.app` and `*.up.railway.app` share no parent domain. | Buy `<domain>`; `app.<domain>` → Vercel, `api.<domain>` → Railway; `COOKIE_SAMESITE=lax`, `COOKIE_DOMAIN=.<domain>`, `WEB_ORIGIN`/`BETTER_AUTH_URL`/`VITE_API_URL` updated. | TEACH-36; "Cookie stopgap" below; ADR 0008 amendment |
| **File storage is ephemeral** | No Vercel Blob store; api/worker run `storage: local-disk` inside the container, wiped on every deploy. Harmless until Artefact uploads exist. | Create the Blob store, set `BLOB_READ_WRITE_TOKEN` on api + worker (`bun run env:check` flags it). | TEACH-37; "Post-provisioning checklist"; ADR 0011 |
| **Railway config-as-code deprecated** | `infra/railway/*.json` applied by `provision.sh` through the API; files keep working until **2026-12-01**. | Migrate to `.railway/railway.ts` (`railway config migrate`). | TEACH-38; "Config-as-code" below; ADR 0010 amendment |
| **Vercel production is public** | `teaching-journey-web.vercel.app` has no Deployment Protection; sign-in is gated by the console-only mail, so exposure is low. | Founder decision once mail works: protect, or accept as the public entry point. | TEACH-39; "Dashboard-only (Vercel)" |
| **No CI remote cache / Speed Insights** | `TURBO_TOKEN` not set; Speed Insights feature toggle off (billing). | Vercel token → GitHub secret `TURBO_TOKEN`, variable `TURBO_TEAM`; toggle Speed Insights in the dashboard. | TEACH-39; "Turbo remote cache", "Dashboard-only (Vercel)" |
| **OAuth disabled** | Google/Microsoft sign-in off (no client credentials); magic link only. | Set the four `*_CLIENT_ID`/`*_CLIENT_SECRET` variables when the OAuth apps exist. | TEACH-39; `docs/env.md` |

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
| Domains                | `teaching-journey-web.vercel.app` (auto). `app.<domain>` — `TODO(domain)`, domain follow-up              |
| Deployment protection  | Vercel Authentication (SSO) — Hobby default "Standard Protection": previews ask for a Vercel login. Whether to also protect **production** (`teaching-journey-web.vercel.app`) is a founder decision (dashboard-only); since 2026-09-04 the site works end-to-end against the Railway api, so this is low urgency — see "Dashboard-only (Vercel)". A Protection Bypass for Automation secret exists (curl/e2e: `x-vercel-protection-bypass: <secret>`, read it in *Settings → Deployment Protection*; never commit it) |
| Speed Insights         | `@vercel/speed-insights` is loaded **only** when `VITE_APP_ENV=production` (`apps/web/src/lib/speed-insights.ts`, dynamic import, verified absent from preview `dist/`). Enabling the *feature* on the project is dashboard-only (CLI refuses: "incurs charges") |
| Verified preview       | `https://teaching-journey-5v1umubdb-omerbresinskis-projects.vercel.app` (2026-09-04): `/dev/jobs` → 200 HTML, `/assets/does-not-exist.js` → 404, `/assets/*` `Cache-Control: public, max-age=31536000, immutable`, `/` and deep links `no-cache`, security headers present, no speed-insights code |

### Environment variables

Names and scopes come from the env contract — [`docs/env.md`](../docs/env.md) is the source of
truth (Vercel `production`: `VITE_API_URL`, `VITE_APP_ENV`; `preview`: `VITE_APP_ENV`,
`RAILWAY_PR_API_URL_TEMPLATE`, `VITE_API_URL_FALLBACK`). `bun run env:check` verifies the names on
the project (`vercel env ls <env> --json`, values discarded) and `--fix` prints the `vercel env add`
commands. Current non-secret values (all set 2026-09-04, production redeployed and verified):

- `VITE_API_URL` (Production) = `https://api-production-903f.up.railway.app` — the live Railway
  api. **`TODO(domain)`**: change to `https://api.<domain>` via `vercel env rm VITE_API_URL
  production && vercel env add VITE_API_URL production` once the api has a custom domain.
- `RAILWAY_PR_API_URL_TEMPLATE` (Preview) = `https://api-ai-teacher-pr-{pr}.up.railway.app` —
  **confirmed** against PR #30 (Railway names the PR environment after the *GitHub repository*,
  `ai-teacher-pr-<n>`, not after the Railway project; see "PR environments").
- `VITE_API_URL_FALLBACK` (Preview) = `https://api-production-903f.up.railway.app` (branch previews
  without a PR number talk to the production api).

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

### Pairing a Vercel preview with a Railway PR environment (verified with PR #30, 2026-09-04)

1. Railway PR env `ai-teacher-pr-<n>` deploys the api at `https://api-ai-teacher-pr-<n>.up.railway.app`
   (matches `RAILWAY_PR_API_URL_TEMPLATE`; PR #30 → `https://api-ai-teacher-pr-30.up.railway.app`,
   `/health` → `{"ok":true,"db":"up"}`).
2. Vercel builds the PR with `VITE_API_URL` = that domain (see above).
3. The api in the PR env must accept the preview origin and set a cross-site cookie:
   `COOKIE_SAMESITE=none` (`apps/api`: cookie becomes `SameSite=None; Secure`, boot logs a
   warning) — PR environments inherit it from production, where it is **currently also `none`**
   (see "Cookie stopgap" below) — and
   `WEB_ORIGIN_PATTERNS=https://teaching-journey-web-*-omerbresinskis-projects.vercel.app`
   (glob, `*` = one DNS label — covers `…-git-<branch>-…` and `…-<hash>-…` preview URLs; also
   fed to better-auth `trustedOrigins`). `WEB_ORIGIN` keeps the exact production/alias origins.
   `WEB_ORIGIN_PATTERNS` is still set per PR environment by hand (checklist below); seeding it
   through `infra/railway/api.json` `environments.pr` overrides is a TEACH-24 follow-up.
4. Vercel's SSO protection does not affect the page's own XHR/SSE to the api once the page loaded.

### Cookie stopgap: `COOKIE_SAMESITE=none` in production

`https://teaching-journey-web.vercel.app` and `https://api-production-903f.up.railway.app` share no
parent domain, so the ADR 0008 target (`SameSite=Lax` + `COOKIE_DOMAIN=.<domain>`) cannot work yet.
Since 2026-09-04 production runs **`COOKIE_SAMESITE=none`** (session cookie
`__Secure-tj.session_token …; Secure; SameSite=None`, verified: magic link → 302 to the Vercel
origin → `/me` 200). CSRF exposure is bounded by CORS (`WEB_ORIGIN` / `WEB_ORIGIN_PATTERNS`) and
better-auth's origin checks. Plan: once a domain exists, point `app.<domain>` at Vercel and
`api.<domain>` at Railway, then `COOKIE_DOMAIN=.<domain>` + `COOKIE_SAMESITE=lax` on the api
(post-provisioning checklist). Recorded as dated amendments in ADR 0008 and ADR 0010.

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

- [ ] Decide on *Deployment Protection* for **production** (previews are SSO-protected by default;
      production is functional against the Railway api since 2026-09-04, so low urgency).
- [ ] *Speed Insights → Enable* on `teaching-journey-web` (charges; CLI refuses non-interactively).
      The client code is already in the production bundle.
- [ ] Optional: *Web Analytics* (`@vercel/analytics` is not installed — add it the same
      production-only way if wanted).
- [ ] Create a **Vercel Blob store** (Storage → Blob) and copy its `BLOB_READ_WRITE_TOKEN` to the
      Railway api and worker (ADR 0011; see "Post-provisioning checklist").
- [ ] When domains exist (follow-up): add `app.<domain>`, set `VITE_API_URL` (Production) to
      `https://api.<domain>` and `VITE_API_URL_FALLBACK` to the same. `RAILWAY_PR_API_URL_TEMPLATE`
      is already confirmed and does not change.
- [x] GitHub App access to `OmerBresinski/ai-teacher` (`vercel git connect` succeeded, PR comments
      on) — re-check after any GitHub permission change.

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
| `api`      | GitHub repo, root `Dockerfile`          | `infra/railway/api.json`      | `PORT=3001`; `https://api-production-903f.up.railway.app`; `/health` |
| `worker`   | GitHub repo, root `Dockerfile`          | `infra/railway/worker.json`   | `PORT=3002` (health only); **no public domain**   |
| `postgres` | image `pgvector/pgvector:pg16` + volume `postgres-volume` (`/var/lib/postgresql/data`) | — (image service) | 5432 on the private network only; **no domain, no TCP proxy** |

Project `teaching-journey` (`a79752e1-8bf5-41d0-b832-f1b64aaf6d2f`), workspace
`omerbresinski's Projects` (Hobby). Environments: `production` (`d595bbf8-dc4b-494f-b1f7-0023dd2dc25d`)
+ ephemeral `ai-teacher-pr-<number>`. Service ids: `api` `ef433c66-c762-4c21-890e-c69856a09a39`,
`worker` `5d7a3bc8-a02d-44b8-83ca-ea11c20a1676`, `postgres` `5c408f9c-b1f2-4820-8a0b-a888391dfa02`
(`railway status --json`). Storage: the api runs `storage: "local-disk"` until a Vercel Blob store
exists — ephemeral on Railway, acceptable until Artefact uploads land (ADR 0011).

### Why not Railway's managed Postgres

`railway add --database postgres` deploys `ghcr.io/railway/postgres-ssl`, which has no
`pgvector`. Migration `0000_init.sql` runs `CREATE EXTENSION IF NOT EXISTS vector`, so the server
must ship the extension: we run the same `pgvector/pgvector:pg16` image as `docker-compose.yml`
with a volume at `/var/lib/postgresql/data` and `PGDATA=/var/lib/postgresql/data/pgdata` (the
official image refuses a non-empty mount root). Trade-off: no Railway backups UI / `DATABASE_URL`
auto-variable; `DATABASE_URL` is a reference variable instead (below), and backups are a
a follow-up (`pg_dump` cron or Railway volume backups).

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
The entrypoint also forces `NODE_ENV=production` for every command: the bundles cannot load
`pino-pretty` (a worker thread `bun build` does not bundle), so `NODE_ENV=development` would crash
the image on boot.

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

One `railway.json` per service. **Railway deprecated config-as-code files** (`railway.json` /
`railway.toml`) in favour of `.railway/railway.ts` infrastructure-as-code: the
`serviceInstanceUpdate.railwayConfigFile` field now errors and `DOCKERFILE` is no longer in the
`Builder` enum. Existing files keep working until **2026-12-01**. Therefore `provision.sh` no
longer points the service at a file; it reads `infra/railway/{api,worker}.json` and applies the
values directly via `serviceInstanceUpdate` (the files stay the single, reviewable source of the
settings). Migrating to `.railway/railway.ts` (`railway config migrate`) is a follow-up to finish
before that date.

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

The per-service matrix (which name, which environment, who sets it) is generated from
[`infra/env.contract.ts`](env.contract.ts) into [`docs/env.md`](../docs/env.md) — that page is the
source of truth; this section only says how the values get there.

- **Seeded by `provision.sh`** (step 4) from the contract via `bun scripts/railway-vars.ts api|worker`:
  plain config (`NODE_ENV`, `PORT`, `LOG_LEVEL`, `MAIL_PROVIDER`, `COOKIE_SAMESITE`,
  `WORKER_CONCURRENCY`, `WEB_ORIGIN`) and the references
  `DATABASE_URL=postgres://${{postgres.POSTGRES_USER}}:${{postgres.POSTGRES_PASSWORD}}@${{postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/${{postgres.POSTGRES_DB}}`
  and `BETTER_AUTH_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}` (resolve per environment, PR envs included).
- **Generated by `provision.sh`**: `BETTER_AUTH_SECRET` (`openssl rand -base64 32 | railway variable
  set BETTER_AUTH_SECRET --stdin --service api`); rotate with the same command (`docs/env.md`
  "Rotating a secret").
- **`postgres` service**: `POSTGRES_USER` / `POSTGRES_PASSWORD` (random hex) / `POSTGRES_DB` /
  `PGDATA=/var/lib/postgresql/data/pgdata` — set once at `railway add`.

### Post-provisioning checklist (after `provision.sh`, manual values)

State on 2026-09-04 (`bun run env:check` against `api`/`worker` production): everything the
contract requires is present **except `BLOB_READ_WRITE_TOKEN`** on both services — no Vercel Blob
store exists yet, and the api runs `storage: "local-disk"` meanwhile (ADR 0011). `COOKIE_SAMESITE`
is `none` in production (cookie stopgap, see "Vercel (web)"); `COOKIE_DOMAIN` and the OAuth
credentials are unset by design until the domain / F17 arrive.

```sh
bun run env:check --fix                 # names on api/worker production vs docs/env.md; prints the commands
# Blob store (open): Vercel dashboard → Storage → Create → Blob, copy the read-write token, then
railway variable set BLOB_READ_WRITE_TOKEN --stdin --service api --skip-deploys < /tmp/token    # ADR 0011
railway variable set BLOB_READ_WRITE_TOKEN --stdin --service worker --skip-deploys < /tmp/token
# domain (open, TODO(domain)): once app.<domain> / api.<domain> exist,
railway variable set COOKIE_DOMAIN=.<domain> --service api --skip-deploys
railway variable set COOKIE_SAMESITE=lax --service api --skip-deploys              # switch from the `none` stopgap
# OAuth (optional, F17):
railway variable set GOOGLE_CLIENT_ID=<id> --service api --skip-deploys
railway variable set GOOGLE_CLIENT_SECRET --stdin --service api --skip-deploys < /tmp/secret
railway variable set MICROSOFT_CLIENT_ID=<id> --service api --skip-deploys
railway variable set MICROSOFT_CLIENT_SECRET --stdin --service api --skip-deploys < /tmp/secret
railway redeploy --service api --yes && railway redeploy --service worker --yes
# per PR environment (after the first PR deploy; the environment is named after the GitHub repo):
railway variable set --service api --environment ai-teacher-pr-<n> --skip-deploys \
  'WEB_ORIGIN_PATTERNS=https://teaching-journey-web-*-omerbresinskis-projects.vercel.app'
bun run env:check --pr <n>
```

`docs/env.md` and `scripts/env-check.ts` still write the PR environment as `pr-<n>`; the real
Railway name is `ai-teacher-pr-<n>` (follow-up: teach `env-check --pr` the prefix).

Never set `ENABLE_TEST_ROUTES` on Railway (the api refuses it with `NODE_ENV=production`).

## Provision, deploy, roll back

```sh
export PATH="$HOME/.bun/bin:$PATH"           # railway >= 5.49, logged in
./infra/railway/provision.sh                 # idempotent: project, services, volume, vars, domain,
                                             # config paths, GitHub source, PR environments
                                             # (variables come from infra/env.contract.ts)
./infra/railway/provision.sh --deploy        # ...plus a first `railway up` of api and worker
```

The script uses the CLI for everything it can and two GraphQL mutations for what it cannot:
`serviceInstanceUpdate` (builder, start/pre-deploy commands, health check, restart policy, region —
the values from `infra/railway/{api,worker}.json`) and `projectUpdate { prDeploys: true }` (PR
environments). Re-running is safe; it never prints secrets. It was executed end-to-end on
2026-09-04 (all steps passed, including the GitHub source connect — the Railway GitHub App was
already installed).

### Platform findings from the first live run (fixed in PR #30, master `08239fc`)

1. **No `--mount=type=cache` in the `Dockerfile`.** Railway's builder rejects BuildKit cache mounts
   unless their id is `s/<service id>-<path>`; the mount was removed rather than hard-coding a
   service id into a file that also builds locally and in CI.
2. **`railway volume add` (CLI 5.49) has no `--service` flag** — it attaches the volume to the
   *linked* service, so the script `railway service link`s `postgres` first.
3. **Config-as-code files are deprecated** (see "Config-as-code"): `railwayConfigFile` errors and
   `DOCKERFILE` left the `Builder` enum, so the script applies the JSON values through
   `serviceInstanceUpdate` instead. Files work until 2026-12-01; then `.railway/railway.ts`.

| Task                     | Command                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| Deploy from a checkout   | `railway up --service api --ci -m "<why>"` (same for `worker`); GitHub pushes to `master` deploy automatically once the source is connected |
| Watch                    | `railway deployment list --service api --json \| jq '.[0].status'`; `railway logs --service api --lines 200` (`--build` for build logs; pre-deploy output is in the deploy logs) |
| Roll back                | `railway redeploy --service api --yes` re-deploys the latest; for an older build use the dashboard → Deployments → ⋯ → *Redeploy* on the good one. Migrations are forward-only: roll back code, not the schema. |
| Restart                  | `railway restart --service api --yes`                                                            |
| Manual migrate           | `railway ssh --service api /app/entrypoint.sh migrate` (runs inside the live api container, which has the bundle and the private-network `DATABASE_URL`). `railway run` is *local* execution with Railway variables — the private Postgres host is not reachable from a laptop, so it is not an option here. **Needs an SSH key registered with Railway** (`railway ssh keys`) — not done yet. |
| Connect to Postgres      | `railway connect postgres` (SSH tunnel; no public proxy exists on purpose), then `select extname from pg_extension;` → `vector`. Same SSH-key prerequisite as above (`railway ssh keys`); until it is registered, the only DB access is through the api/worker themselves. |
| Variables                | `bun run env:check [--pr <n>] [--fix]` (names vs `docs/env.md`); `railway variable list --service api --json`; `railway variable set K=V --service api`; secrets via `--stdin` |

## PR environments

`projectUpdate(prDeploys: true)` (dashboard: *Settings → Environments → Enable PR environments*).
Each PR against `master` gets an environment named **`ai-teacher-pr-<number>`** — Railway uses the
*GitHub repository* name, not the project name — that copies `production`'s services and variables,
builds the PR commit for `api` and `worker`, and gets a fresh `postgres` (empty volume → migrations
create the schema via the pre-deploy step). Reference variables resolve inside the PR environment,
so `DATABASE_URL` points at the PR's own database and `BETTER_AUTH_URL` at the PR api. Railway
reports `teaching-journey - api` / `teaching-journey - worker` statuses on the GitHub PR. The
environment is deleted when the PR closes.

**Verified with PR #30 (2026-09-04):** environment `ai-teacher-pr-30`, api at
`https://api-ai-teacher-pr-30.up.railway.app`, `/health` → `{"ok":true,"db":"up"}`, both services
`SUCCESS`.

API preview URL pattern (Vercel preview → Railway preview): Railway generates
`https://<service>-<environment>.up.railway.app`, i.e. **`https://api-ai-teacher-pr-<number>.up.railway.app`**
— the production one is `https://api-production-903f.up.railway.app` (rename with
`railway domain update` if ever wanted). TEACH-25 does **not** hard-code it: the Vercel Preview
variable `RAILWAY_PR_API_URL_TEMPLATE=https://api-ai-teacher-pr-{pr}.up.railway.app` feeds
`scripts/vercel-env.ts`. If the pattern ever changes, `railway domain list --service api
--environment ai-teacher-pr-<n> --json` shows the generated name. The PR environment's api needs
`WEB_ORIGIN_PATTERNS` (Vercel preview origins) and `COOKIE_SAMESITE=none` (inherited from
production today) — see "Vercel (web)".

## Networking notes

- Service-to-service traffic uses Railway's **private network, which is IPv6-only**
  (`postgres.railway.internal`). Bun's `postgres` driver resolves AAAA records fine; nothing binds
  to `::` explicitly because only *outbound* traffic to Postgres crosses the private network.
  The api listens on `0.0.0.0:$PORT` for the public edge.
- `postgres` has no public domain and no TCP proxy. Use `railway connect postgres` (SSH; needs a
  registered key, `railway ssh keys`) for a shell.
- The worker's `/health` is only reachable inside the private network / by Railway's health check.

## Graceful shutdown

Railway sends `SIGTERM`, waits `drainingSeconds` (30), then `SIGKILL`. The entrypoint `exec`s Bun,
so the signal reaches the app: the api stops accepting, ends SSE streams, drains in-flight
requests, stops pg-boss and closes the pool (`apps/api/src/index.ts`); the worker stops fetching
and waits up to 25 s for running jobs (`apps/worker`). Both were observed exiting 0 under
`docker stop`.

## Dashboard-only / founder steps (checklist, 2026-09-04)

Done:

- [x] **Billing**: `omerbresinski's Projects` is on Hobby; `teaching-journey` lives there.
- [x] **Railway GitHub App** on `OmerBresinski/ai-teacher` — already installed, so
      `railway service source connect --repo OmerBresinski/ai-teacher --branch master` succeeded for
      api and worker; pushes to `master` auto-deploy.
- [x] *Settings → Environments → Enable PR environments* — on (`prDeploys: true`), verified with PR #30.

Open:

- [ ] **Buy a domain** (`TODO(domain)`): `app.<domain>` → Vercel, `api.<domain>` → Railway
      (`railway domain add api.<domain> --service api` + CNAME), then `COOKIE_DOMAIN` /
      `COOKIE_SAMESITE=lax`, Vercel `VITE_API_URL` / `VITE_API_URL_FALLBACK`, narrower CSP `connect-src`.
- [ ] **Vercel Blob store** → `BLOB_READ_WRITE_TOKEN` on api + worker (ADR 0011; the one
      `bun run env:check` drift today).
- [ ] Vercel: Deployment Protection decision for production; *Speed Insights → Enable*.
- [ ] GitHub: `TURBO_TOKEN` secret + `TURBO_TEAM` variable for the CI remote cache (see "Turbo remote cache").
- [ ] Optional: Google / Microsoft OAuth credentials (F17); `railway ssh keys` for `railway ssh` /
      `railway connect`; config-as-code migration to `.railway/railway.ts` before 2026-12-01.

Everything else — project, region, image + volume, services, service settings, variables,
public domain, GitHub source, PR environments — is done by `provision.sh` via CLI/GraphQL.
