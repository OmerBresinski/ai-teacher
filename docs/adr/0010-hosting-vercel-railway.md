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
