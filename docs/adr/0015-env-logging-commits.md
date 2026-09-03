# 0015 — Environment validation, logging, commit conventions

- Status: Accepted
- Date: 2026-09-03
- Related PRD decisions: F15-R05 (secrets management), F13-R10 (observability — later), F18-R12 (error states)

## Context

Misconfigured environments should fail at boot, not at first request. Observability tooling (Sentry/OTel) is deferred; structured logs are the baseline. Nothing is published, so per-package versioning is unnecessary.

## Decision

- **Environment:** each app has `src/env.ts` that parses `process.env` (or `import.meta.env` for web) with a Zod schema and throws on missing/invalid values. `.env.example` is committed per app; real values live in Vercel/Railway. No secrets in the repository; a secret-scanning pre-commit hook is enabled.
- **Logging:** `pino` structured JSON logs in `apps/api` and `apps/worker` with a request-id middleware; `pino-pretty` in development. No prompt or content bodies are logged. Error tracking and tracing are deferred to a later ADR.
- **Commits:** trunk-based development on `main`; squash merges; Conventional Commits enforced by `commitlint` in a `lefthook` pre-commit/commit-msg hook alongside Biome. No changesets.

## Consequences

- Boot-time failures are explicit and readable.
- When observability is added, it hooks into the existing request-id and logger rather than replacing them.
