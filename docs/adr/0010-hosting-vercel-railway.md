# 0010 — Hosting: Vercel (web) + Railway (api, worker, Postgres)

- Status: Accepted
- Date: 2026-09-03
- Related PRD decisions: F15-D5 (data residency) — deviated, see ADR 0016; F18-R05 (web vitals)

## Context

We want managed hosting with PR previews and minimal ops. Cloudflare Pages and Fly.io were considered. The founder prefers Vercel for the SPA and Railway for the services.

## Decision

- `apps/web` deploys to **Vercel** as a static Vite build with an SPA rewrite (`/* -> /index.html`). Every PR gets a preview URL. Vercel Analytics/Speed Insights are enabled for web-vitals monitoring.
- `apps/api` and `apps/worker` deploy to **Railway** as two services built from the same root `Dockerfile` (multi-stage, `oven/bun` base) with different start commands. Railway's Postgres (pgvector-enabled image) is the database. Region: **EU-West (Amsterdam)** for all Railway services.
- Railway PR environments are enabled so API previews pair with Vercel previews; the Vercel preview points at the matching Railway preview via an environment variable.
- Domains: `app.<domain>` (Vercel) and `api.<domain>` (Railway) under one parent domain so auth cookies can be shared (ADR 0008). CORS on the API allows the Vercel production and preview origins only.

## Consequences

- No servers to manage; previews for every change.
- Two providers means two dashboards and two sets of environment variables; `.env.example` documents both.
- All data is stored in the EU, not the UK. This deviates from F15-D5 and F15 commitment #8; recorded in ADR 0016.
- **Amendment (TEACH-24/25, 2026-09-04) — live state.** The decision stands; three facts differ from the text above. (1) The production branch is **`master`** on both providers (the repo's default branch), not "production". (2) Railway deprecated config-as-code files (`railway.json`/`railway.toml`; they stop working on 2026-12-01) in favour of `.railway/railway.ts`; `infra/railway/{api,worker}.json` are kept as the reviewed source of service settings and applied by `infra/railway/provision.sh` via the `serviceInstanceUpdate` API, with the `.railway/railway.ts` migration as a follow-up. (3) No parent domain exists yet, so the web app (`https://teaching-journey-web.vercel.app`) and the api (`https://api-production-903f.up.railway.app`) are cross-site and the api runs with **`COOKIE_SAMESITE=none`** as a temporary stopgap (ADR 0008 amendment); the `app.<domain>`/`api.<domain>` + shared-cookie target is unchanged and is what the domain follow-up restores. PR environments are named `ai-teacher-pr-<n>` (GitHub repo name), giving the api preview URL `https://api-ai-teacher-pr-<n>.up.railway.app`. Runbook: [`infra/README.md`](../../infra/README.md).
- **Amendment (TEACH-38, 2026-09-04) — Railway configuration is infrastructure-as-code.** Point (2) of the previous amendment is closed: the Railway project (`postgres` image service + volume, `api`, `worker` with builder, watch patterns, start / pre-deploy commands, health check, restart retries, draining/overlap and region) is declared in one [`.railway/railway.ts`](../../.railway/railway.ts) (`railway/iac` DSL, `railway` npm devDependency) and pushed with `railway config apply`; `infra/railway/{api,worker}.json`, the root `railway.json` and the `serviceInstanceUpdate` shim in `provision.sh` were removed. Constraints that follow from Railway's model: the file is evaluated only by the CLI (Node ≥ 22.6), never read at deploy time, so `provision.sh` runs `railway config apply --yes` and `railway config plan` is the drift check; the file covers the whole environment ("omit means delete"), so variable *names* are rendered from `infra/env.contract.ts` as `preserve()` — values stay in Railway (ADR 0015 contract unchanged) and an unknown variable surfaces as a destructive plan that non-interactive apply refuses; PR-environment variable overrides and `prDeploys` cannot be expressed in IaC, so PR environments keep inheriting production values and `projectUpdate { prDeploys: true }` remains the one GraphQL call. Runbook: [`infra/README.md`](../../infra/README.md) "Config-as-code".
