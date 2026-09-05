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
> `db:migrate: DATABASE_URL up to date`). Since TEACH-37 (2026-09-04) the Vercel Blob store
> **`teaching-journey`** (`store_Ii6wcxuuLOvPP4ou`, `fra1`, private) exists and
> `BLOB_READ_WRITE_TOKEN` is set on api + worker: the api boots with `storage="vercel-blob"`
> (see "Vercel Blob (files)" below).

## Known gaps (read this first)

The stack works end-to-end but several pieces are deliberate stopgaps. Each is tracked as a
Linear issue in project **P1 — Production hardening**; update this table when one closes.

| Gap | Today | Target | Tracked / documented |
| --- | ----- | ------ | -------------------- |
| **Sign-in mail is console-only** | `MAIL_PROVIDER=console` in production: magic links are printed to the api log (`railway logs --service api`), never sent. | A real mail provider (Resend/Postmark) behind the existing `MailSender` interface, `MAIL_PROVIDER=resend` + API key on Railway. | TEACH-35; ADR 0008; `apps/api/src/mail/` |
| **Console mail production acknowledgement** | `ALLOW_CONSOLE_MAIL_IN_PRODUCTION=1` is set on the production api, accepting that sign-in URLs are written to the log. | Remove the variable when TEACH-29 configures real mail delivery. | TEACH-76; TEACH-29 |
| **Cross-site session cookie** | `COOKIE_SAMESITE=none` on the production api because `*.vercel.app` and `*.up.railway.app` share no parent domain. | Buy `<domain>`; `app.<domain>` → Vercel, `api.<domain>` → Railway; `COOKIE_SAMESITE=lax`, `COOKIE_DOMAIN=.<domain>`, `WEB_ORIGIN`/`BETTER_AUTH_URL`/`VITE_API_URL` updated. | TEACH-36; "Cookie stopgap" below; ADR 0008 amendment |
| **Vercel production is public** | `teaching-journey-web.vercel.app` has no Deployment Protection; sign-in links are in the Railway api log for anyone with Railway project access or a log drain, opted in via `ALLOW_CONSOLE_MAIL_IN_PRODUCTION=1`. | Founder decision once mail works: protect, or accept as the public entry point. | TEACH-39; "Dashboard-only (Vercel)" |
| **No CI remote cache / Speed Insights** | `TURBO_TOKEN` not set; Speed Insights feature toggle off (billing). | Vercel token → GitHub secret `TURBO_TOKEN`, variable `TURBO_TEAM`; toggle Speed Insights in the dashboard. | TEACH-39; "Turbo remote cache", "Dashboard-only (Vercel)" |
| **OAuth disabled** | Google/Microsoft sign-in off (no client credentials); magic link only. | Set the four `*_CLIENT_ID`/`*_CLIENT_SECRET` variables when the OAuth apps exist. | TEACH-39; `docs/env.md` |
| **Single AI provider** | Bedrock only; no provider failover. | Add a second provider and failover in F13 (F13-D3). | ADR 0018; F13-D3 |
| **AI rate limit is per api replica (in memory)** | One Railway api replica applies the per-Workspace limit locally. | Use Postgres or Redis before scaling the api horizontally. | TEACH-75; `apps/api/src/rate-limit.ts` |

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
| Git                    | `vercel git connect https://github.com/OmerBresinski/ai-teacher.git`; production branch **`master`** (set via `PATCH /v1/projects/teaching-journey-web/branch {"branch":"master"}`). Pushes to `master` deploy production. **Preview deployments are disabled since 2026-09-05** (`apps/web/vercel.json` `git.deploymentEnabled: { "master": true, "*": false }`): PRs hit the Hobby-plan build rate limit and the previews were not being used. Re-enable by deleting that key; the pairing recipe below still applies then |
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

> Vercel previews are currently **disabled** (see the Git row above); this section describes how the
> pairing works when they are turned back on.

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
   `WEB_ORIGIN_PATTERNS` is inherited from production by PR environments (it is set there today);
   `.railway/railway.ts` cannot seed PR-only values — see "Config-as-code" (`preserve()` only).
   A new web origin absent from `WEB_ORIGIN`/`WEB_ORIGIN_PATTERNS` receives 403 on protected routes
   instead of a silent CORS failure.
4. Vercel's SSO protection does not affect the page's own XHR/SSE to the api once the page loaded.

### Cookie stopgap: `COOKIE_SAMESITE=none` in production

`https://teaching-journey-web.vercel.app` and `https://api-production-903f.up.railway.app` share no
parent domain, so the ADR 0008 target (`SameSite=Lax` + `COOKIE_DOMAIN=.<domain>`) cannot work yet.
Since 2026-09-04 production runs **`COOKIE_SAMESITE=none`** (session cookie
`__Secure-tj.session_token …; Secure; SameSite=None`, verified: magic link → 302 to the Vercel
origin → `/me` 200). Cross-site requests are rejected by `rejectCrossSiteRequests` (403) using the
same origin allow-list as CORS; CORS alone does not prevent CSRF. Plan: once a domain exists, point
`app.<domain>` at Vercel and
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
- [x] **Vercel Blob store** — done from the CLI on 2026-09-04 (TEACH-37), no dashboard step was
      needed; see "Vercel Blob (files)" below.
- [ ] When domains exist (follow-up): add `app.<domain>`, set `VITE_API_URL` (Production) to
      `https://api.<domain>` and `VITE_API_URL_FALLBACK` to the same. `RAILWAY_PR_API_URL_TEMPLATE`
      is already confirmed and does not change.
- [x] GitHub App access to `OmerBresinski/ai-teacher` (`vercel git connect` succeeded, PR comments
      on) — re-check after any GitHub permission change.

## Vercel Blob (files) — TEACH-37

Object storage for Sources / Artefacts is a **Vercel Blob** store (ADR 0011), consumed only by the
Railway api and worker through `@tj/storage` (`createStorage` picks `VercelBlobStorage` whenever
`BLOB_READ_WRITE_TOKEN` is set). Created with the CLI on 2026-09-04 — nothing dashboard-only:

| Setting  | Value                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------- |
| Store    | **`teaching-journey`** (`store_Ii6wcxuuLOvPP4ou`), team `omerbresinskis-projects`                 |
| Access   | **private** (store-level, immutable): every blob needs the token; browsers read files through the api proxy `GET /files/:key` (ADR 0011 amendment). `STORAGE_PUBLIC_PREFIXES` must stay unset — a private store cannot hold `access: "public"` blobs |
| Region   | **`fra1`** (Frankfurt, EU). Blob offers no Amsterdam region (allowed: `arn1 bom1 cdg1 cle1 cpt1 dub1 dxb1 fra1 gru1 hkg1 hnd1 iad1 icn1 kix1 lhr1 pdx1 sfo1 sin1 syd1 yul1`); `fra1` is the closest to Railway's `europe-west4` (Amsterdam) and keeps the EU residency of ADR 0016. Immutable after creation |
| Base URL | `ii6wcxuulovpp4ou.private.blob.vercel-storage.com` (not browsable without the token)              |
| Command  | `vercel blob create-store teaching-journey --access private --region fra1 --environment production --environment preview --yes --scope omerbresinskis-projects` (from the repo root, project linked) |
| Project link | The CLI connected the store to `teaching-journey-web` and injected `BLOB_READ_WRITE_TOKEN` into the project's Production env (`vercel env ls` shows no copy in Preview or Development). The SPA never reads it, so it was removed again (`vercel env rm BLOB_READ_WRITE_TOKEN production`) to keep the secret off the web project; the store stays connected and the token stays valid. `bun run env:check` treats it as `extra` if it reappears |
| Token    | Lives on Railway `api` + `worker` (`production`; PR environments inherit it). Never in git, never on Vercel |
| Verified | api boot log `storage="vercel-blob"` (production, 2026-09-04); `BLOB_READ_WRITE_TOKEN=… bun test packages/storage/src/vercel-blob.test.ts` → 10 pass against the real store (writes under a fresh `ws_*` prefix and deletes it; the store was empty afterwards) |

Inspect / rotate (the token is only ever piped, never printed):

```sh
vercel blob list-stores --all --scope omerbresinskis-projects       # name, id, region, size, connected projects
vercel blob get-store store_Ii6wcxuuLOvPP4ou --scope omerbresinskis-projects
vercel blob list --rw-token "$(cat /tmp/token)"                       # contents; `del <pathname>` / `empty-store`
# obtain the token: dashboard → Storage → teaching-journey → ".env.local" tab, or reconnect the store
# to the project and `vercel env pull /tmp/prod.env --environment production` (then `vercel env rm` it
# again). Write ONLY the value to /tmp/token, then:
railway variable set BLOB_READ_WRITE_TOKEN --stdin --service api --skip-deploys < /tmp/token
railway variable set BLOB_READ_WRITE_TOKEN --stdin --service worker --skip-deploys < /tmp/token
railway redeploy --service api --yes && railway redeploy --service worker --yes
rm /tmp/token /tmp/prod.env
```

## AI provider (Bedrock) — TEACH-72

The api and worker call Amazon Bedrock through `@tj/ai` (ADR [0018](../docs/adr/0018-ai-provider.md)).
The variable descriptions and full matrix are generated in [`docs/env.md`](../docs/env.md); this
section records the Railway production runbook. PR environments inherit production values when
Railway creates them.

The api limits model-call requests per Workspace with `AI_RATE_LIMIT_PER_WORKSPACE` and
`AI_RATE_LIMIT_WINDOW_S`; defaults apply unless those config variables are set.

| Name | Scope | Services | Where set |
| ---- | ----- | -------- | --------- |
| `AWS_BEARER_TOKEN_BEDROCK` | secret | api, worker | manual, via stdin |
| `AWS_REGION` | config | api, worker | template / `railwayValue` |
| `AI_MODEL_FRONTIER` | config | api, worker | template / `railwayValue` |
| `AI_MODEL_STANDARD` | config | api, worker | template / `railwayValue` |
| `AI_MODEL_SMALL` | config | api, worker | template / `railwayValue` |

### Set or rotate the bearer token

Never echo the token or pass it as an argument. Set both production services without triggering two
intermediate deployments, then redeploy them:

```sh
printf '%s' "$AWS_BEARER_TOKEN_BEDROCK" | railway variable set AWS_BEARER_TOKEN_BEDROCK --stdin -p <project> -e production -s api --skip-deploys
printf '%s' "$AWS_BEARER_TOKEN_BEDROCK" | railway variable set AWS_BEARER_TOKEN_BEDROCK --stdin -p <project> -e production -s worker --skip-deploys
railway redeploy -p <project> -e production -s api -y
railway redeploy -p <project> -e production -s worker -y
```

### Change a model

Set the selected model ID on both production services, then redeploy them:

```sh
railway variable set AI_MODEL_SMALL=<id> -p <project> -e production -s api --skip-deploys
railway variable set AI_MODEL_SMALL=<id> -p <project> -e production -s worker --skip-deploys
railway redeploy -p <project> -e production -s api -y
railway redeploy -p <project> -e production -s worker -y
```

Use the matching `AI_MODEL_STANDARD` or `AI_MODEL_FRONTIER` name for those classes. Update the
matching `railwayValue` in [`infra/env.contract.ts`](env.contract.ts) as well so a fresh
`provision.sh` seeds the same ID. Neither `railway config plan` nor `bun run env:check` compares
variable **values** (both check names only), so the only check that a model change took effect is
the smoke test below: its progress message names the model ID that actually answered.

### Smoke test

1. Sign in on production. Magic links are console-logged because of Known gap TEACH-35:
   `railway logs -s api -e production`.
2. `POST /jobs/ai-ping` with `{"class":"small"}`, `{"class":"standard"}`, or
   `{"class":"frontier"}`.
3. Follow `GET /jobs/:id/events` until `completed`. The second `progress` message carries
   `<modelId>: in=<n> out=<n> finish=<reason>`.

Bedrock runs in `us-east-1`; prompts and completions transit the US in flight. This residency
deviation is recorded in ADR [0016 §5](../docs/adr/0016-prd-deviations.md#amendment-2026-09-04-adr-0018).

**Verification recorded (2026-09-04):** both services deploy `SUCCESS` and boot with
`ai="bedrock"`; production verification is the `ai.ping` job path in ADR
[0018 §7](../docs/adr/0018-ai-provider.md#decision). Three-class smoke test against production
(`POST /jobs/ai-ping` → `GET /jobs/:id/events`, all `completed`; model access is granted for all
three in `us-east-1`):

| class | progress message |
| ----- | ---------------- |
| `small` | `us.anthropic.claude-haiku-4-5-20251001-v1:0: in=16 out=5 finish=stop` |
| `standard` | `us.anthropic.claude-sonnet-5: in=17 out=4 finish=stop` |
| `frontier` | `us.anthropic.claude-opus-5: in=17 out=4 finish=stop` |

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

| Service    | Source                                  | Declared in (IaC)                        | Ports / network                                   |
| ---------- | --------------------------------------- | ---------------------------------------- | ------------------------------------------------- |
| `api`      | GitHub repo, root `Dockerfile`          | `.railway/railway.ts` `service("api")`   | `PORT=3001`; `https://api-production-903f.up.railway.app`; `/health` |
| `worker`   | GitHub repo, root `Dockerfile`          | `.railway/railway.ts` `service("worker")` | `PORT=3002` (health only); **no public domain**   |
| `postgres` | image `pgvector/pgvector:pg16` + volume `postgres-volume` (`/var/lib/postgresql/data`) | `.railway/railway.ts` `service("postgres")` + `volume("postgres-volume")` | 5432 on the private network only; **no domain, no TCP proxy** |

Project `teaching-journey` (`a79752e1-8bf5-41d0-b832-f1b64aaf6d2f`), workspace
`omerbresinski's Projects` (Hobby). Environments: `production` (`d595bbf8-dc4b-494f-b1f7-0023dd2dc25d`)
+ ephemeral `ai-teacher-pr-<number>`. Service ids: `api` `ef433c66-c762-4c21-890e-c69856a09a39`,
`worker` `5d7a3bc8-a02d-44b8-83ca-ea11c20a1676`, `postgres` `5c408f9c-b1f2-4820-8a0b-a888391dfa02`
(`railway status --json`). Storage: api and worker run `storage: "vercel-blob"` against the private
store `teaching-journey` (`fra1`, see "Vercel Blob (files)"); without `BLOB_READ_WRITE_TOKEN` they
would fall back to `local-disk`, which is ephemeral on Railway (ADR 0011).

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
"start command" **replaces the `ENTRYPOINT`** (exec form), which is why `.railway/railway.ts` uses
the full `/app/entrypoint.sh api` etc. `HEALTHCHECK` fetches `http://127.0.0.1:$PORT/health`.
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

## Config-as-code (`.railway/railway.ts`, infrastructure-as-code)

**TEACH-38 (2026-09-04):** Railway deprecated per-service config-as-code files (`railway.json` /
`railway.toml`, read from the repo at deploy time; hard cutoff **2026-12-01**) in favour of
project-level **infrastructure-as-code**: one [`.railway/railway.ts`](../.railway/railway.ts)
describing the whole Railway project, evaluated by the CLI (`railway config plan` / `apply`).
The old `infra/railway/{api,worker}.json` + `serviceInstanceUpdate` shim and the root
`railway.json` are gone; the TS file is the single source of truth for service settings **and**
for the `postgres` image service + its volume. Facts that shape how it is used:

- **The CLI is the only path.** Railway does *not* read `.railway/railway.ts` from the repository
  at build or deploy time — settings change only when someone runs `railway config apply`
  (`provision.sh` step 3 does; a plain push of the file changes nothing on Railway). `railway config
  plan` is read-only and is the drift check (`--detailed-exit-code`: 0 = in sync, 2 = drift).
- **Whole environment, omit = delete.** The file must list every service, volume *and variable*
  of the environment; anything missing is planned as a destructive delete. Variables are therefore
  rendered from [`env.contract.ts`](env.contract.ts) (`railwayNames()`, production ∪ PR names) as
  `preserve()` = "keep whatever value Railway has" (a no-op when the variable is not set). Values
  are never in the file; they are seeded / rotated by `provision.sh` and `railway variable set` as
  before. A variable on Railway that the contract does not know shows up in `plan` as a delete,
  which is the intended drift check — `provision.sh` runs `apply --yes` *without*
  `--confirm-destructive`, so such a plan aborts instead of deleting.
- **Postgres in IaC: yes.** `service("postgres", { source: image("pgvector/pgvector:pg16"),
  volumeMounts, replicas: { "europe-west4-drams3a": 1 }, deploy: { restartPolicyType: "ALWAYS" } })`
  and `volume("postgres-volume", { region, sizeMB: 5000, … })` were imported with `railway config
  pull` and plan as a no-op against the live service, so the GraphQL region/restart-policy mutation
  left `provision.sh`. The volume/service are still *created* by the CLI in step 2 (proven path);
  `apply` then reconciles. Volume lifecycle is deliberately conservative on Railway's side
  (detach/shrink/delete are destructive and blocked non-interactively).
- **PR-environment variables: no.** `apply` targets one linked environment (production). PR
  environments are copies of production created by Railway; IaC has no `environments.pr`-style
  overrides (the `ctx.environment` switch only changes what a manual `apply` against that
  environment would render). `WEB_ORIGIN_PATTERNS` therefore keeps living on production (inherited
  by PR envs) and `projectUpdate { prDeploys: true }` stays the one GraphQL call in `provision.sh`.
- **Tooling.** `railway` (npm, root devDependency) provides `railway/iac` and its types; the CLI
  (5.49+) evaluates the file with **Node ≥ 22.6** (`--experimental-strip-types`; Node 18/20 fail
  with `bad option`). The file imports `../infra/env.contract.ts` (extension required for Node;
  root `tsconfig.json` has `allowImportingTsExtensions`). It is linted/typechecked by
  `bun run lint` / `typecheck` (`lint:root`, `typecheck:root`), excluded from the Docker context
  (`.dockerignore`) and not a turbo input of any app task. `preDeployTimeoutSeconds` is accepted by
  the CLI but missing from the SDK types (3.11.0) — hence the one cast in the file. Restart policy
  `ON_FAILURE` is Railway's default and stored as `null`, so it is *not* written explicitly (an
  explicit value never converges in `plan`); only `restartPolicyMaxRetries` is.

Settings declared per service (all live in production, `plan` = "already up to date"):

| Setting                                 | `service("api")`                              | `service("worker")`            |
| --------------------------------------- | --------------------------------------------- | ------------------------------ |
| `source`                                | `github("OmerBresinski/ai-teacher", { branch: "master" })` | same              |
| `build.builder` / `dockerfilePath`      | `DOCKERFILE` / `Dockerfile`                   | same                           |
| `build.watchPatterns`                   | image inputs (`Dockerfile`, `.dockerignore`, `infra/docker/**`, `.railway/**`, manifests) + db/domain/jobs/config + `apps/api/**` | same + `apps/worker/**` |
| `replicas`                              | `{ "europe-west4-drams3a": 1 }` (region)      | same                           |
| `start`                                 | `/app/entrypoint.sh api`                      | `/app/entrypoint.sh worker`    |
| `preDeploy` / `preDeployTimeoutSeconds` | `/app/entrypoint.sh migrate` / 600 s          | —                              |
| `healthcheck` / `healthcheckTimeout`    | `/health` / 300 s                             | `/health` / 300 s (on `PORT`)  |
| restart policy                          | `ON_FAILURE` (default) / `restartPolicyMaxRetries: 5` | same                   |
| `deploy.drainingSeconds`                | 30 (Railway sends SIGTERM, then SIGKILL)      | 30 (worker drains jobs ≤ 25 s) |
| `deploy.overlapSeconds`                 | 10 (old api serves while new one warms up)    | — (one consumer at a time)     |
| `env`                                   | contract names as `preserve()`                | same                           |

Pre-deploy runs in the freshly built image **before** the new api replica starts and before the
health check; a failed migration fails the deploy and the previous deployment keeps serving.

```sh
export PATH="$HOME/.nvm/versions/node/v22.17.0/bin:$HOME/.bun/bin:$PATH"   # node >= 22.6 + railway CLI
railway config plan                    # read-only diff vs production
railway config apply                   # interactive confirm; provision.sh uses --yes
railway config pull --force            # re-import live state (then diff against git; it also
                                       #   rewrites variables as an explicit preserve() list)
```

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
contract requires is present, including **`BLOB_READ_WRITE_TOKEN`** on both services (set from the
CLI on 2026-09-04, TEACH-37 — store `teaching-journey`, `store_Ii6wcxuuLOvPP4ou`, `fra1`; the api
boots with `storage="vercel-blob"`). `COOKIE_SAMESITE` is `none` in production (cookie stopgap, see
"Vercel (web)"); `COOKIE_DOMAIN` and the OAuth credentials are unset by design until the domain /
F17 arrive (`env:check` still lists them under `missing` for `api`).

```sh
bun run env:check --fix                 # names on api/worker production vs docs/env.md; prints the commands
# Blob token (done 2026-09-04; this is the re-set / rotation recipe — see "Vercel Blob (files)"):
railway variable set BLOB_READ_WRITE_TOKEN --stdin --service api --skip-deploys < /tmp/token    # ADR 0011
railway variable set BLOB_READ_WRITE_TOKEN --stdin --service worker --skip-deploys < /tmp/token
# Bedrock bearer token (done 2026-09-04; use stdin so it is never printed or passed as argv):
printf '%s' "$AWS_BEARER_TOKEN_BEDROCK" | railway variable set AWS_BEARER_TOKEN_BEDROCK --stdin -p <project> -e production -s api --skip-deploys
printf '%s' "$AWS_BEARER_TOKEN_BEDROCK" | railway variable set AWS_BEARER_TOKEN_BEDROCK --stdin -p <project> -e production -s worker --skip-deploys
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
./infra/railway/provision.sh                 # idempotent: project, services, volume, IaC settings
                                             # (railway config apply), vars, domain, GitHub source,
                                             # PR environments (variables: infra/env.contract.ts)
./infra/railway/provision.sh --deploy        # ...plus a first `railway up` of api and worker
```

The script uses the CLI for everything it can — service settings, region, the GitHub source and
the postgres image/volume come from `.railway/railway.ts` via `railway config apply --yes` (step 3,
see "Config-as-code"; the Railway GitHub App must be installed on the repo first, otherwise apply
fails there) — and one GraphQL mutation for what it cannot: `projectUpdate { prDeploys: true }`
(PR environments). The script requires `node >= 22.6` on `PATH` and refuses to run otherwise. Re-running is safe; it never prints secrets. It was executed end-to-end on
2026-09-04 (all steps passed, including the GitHub source connect — the Railway GitHub App was
already installed); the IaC step replaced the former `serviceInstanceUpdate` shim on the same day
(TEACH-38) and was verified with `plan` → apply → `plan` = no changes against production. A fresh
provisioning run with the IaC step has not been exercised end-to-end.

### Platform findings from the first live run (fixed in PR #30, master `08239fc`)

1. **No `--mount=type=cache` in the `Dockerfile`.** Railway's builder rejects BuildKit cache mounts
   unless their id is `s/<service id>-<path>`; the mount was removed rather than hard-coding a
   service id into a file that also builds locally and in CI.
2. **`railway volume add` (CLI 5.49) has no `--service` flag** — it attaches the volume to the
   *linked* service, so the script `railway service link`s `postgres` first.
3. **Config-as-code files are deprecated** (`railwayConfigFile` errors, `DOCKERFILE` left the
   `Builder` enum). First worked around with a `serviceInstanceUpdate` shim; since TEACH-38 the
   settings live in `.railway/railway.ts` and are applied with `railway config apply` (see
   "Config-as-code").

| Task                     | Command                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| Deploy from a checkout   | `railway up --service api --ci -m "<why>"` (same for `worker`); GitHub pushes to `master` deploy automatically once the source is connected |
| Watch                    | `railway deployment list --service api --json \| jq '.[0].status'`; `railway logs --service api --lines 200` (`--build` for build logs; pre-deploy output is in the deploy logs) |
| Roll back                | `railway redeploy --service api --yes` re-deploys the latest; for an older build use the dashboard → Deployments → ⋯ → *Redeploy* on the good one. Migrations are forward-only: roll back code, not the schema. |
| Restart                  | `railway restart --service api --yes`                                                            |
| Manual migrate           | `railway ssh --service api /app/entrypoint.sh migrate` (runs inside the live api container, which has the bundle and the private-network `DATABASE_URL`). `railway run` is *local* execution with Railway variables — the private Postgres host is not reachable from a laptop, so it is not an option here. **Needs an SSH key registered with Railway** (`railway ssh keys`) — not done yet. |
| Connect to Postgres      | `railway connect postgres` (SSH tunnel; no public proxy exists on purpose), then `select extname from pg_extension;` → `vector`. Same SSH-key prerequisite as above (`railway ssh keys`); until it is registered, the only DB access is through the api/worker themselves. |
| Variables                | `bun run env:check [--pr <n>] [--fix]` (names vs `docs/env.md`); `railway variable list --service api --json`; `railway variable set K=V --service api`; secrets via `--stdin` |
| Settings drift           | `railway config plan --detailed-exit-code` (exit 2 = `.railway/railway.ts` and production differ); `railway config apply` to push the file |

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
- [x] **Railway GitHub App** on `OmerBresinski/ai-teacher` — already installed; the api/worker
      `source: github(...)` declared in `.railway/railway.ts` applies cleanly and pushes to `master`
      auto-deploy.
- [x] *Settings → Environments → Enable PR environments* — on (`prDeploys: true`), verified with PR #30.
- [x] **Vercel Blob store** `teaching-journey` (`fra1`, private) + `BLOB_READ_WRITE_TOKEN` on api +
      worker — done from the CLI on 2026-09-04 (TEACH-37, ADR 0011).

Open:

- [ ] **Buy a domain** (`TODO(domain)`): `app.<domain>` → Vercel, `api.<domain>` → Railway
      (`railway domain add api.<domain> --service api` + CNAME), then `COOKIE_DOMAIN` /
      `COOKIE_SAMESITE=lax`, Vercel `VITE_API_URL` / `VITE_API_URL_FALLBACK`, narrower CSP `connect-src`.
- [ ] Vercel: Deployment Protection decision for production; *Speed Insights → Enable*.
- [ ] GitHub: `TURBO_TOKEN` secret + `TURBO_TEAM` variable for the CI remote cache (see "Turbo remote cache").
- [ ] Optional: Google / Microsoft OAuth credentials (F17); `railway ssh keys` for `railway ssh` /
      `railway connect`.

Everything else — project, region, image + volume, services, service settings
(`.railway/railway.ts`), variables, public domain, GitHub source, PR environments — is done by
`provision.sh` via CLI, `railway config apply` and one GraphQL call.
