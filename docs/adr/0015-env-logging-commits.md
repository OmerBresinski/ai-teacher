# 0015 — Environment validation, logging, commit conventions

- Status: Accepted
- Date: 2026-09-03
- Related PRD decisions: F15-R05 (secrets management), F13-R10 (observability — later), F18-R12 (error states)

## Context

Misconfigured environments should fail at boot, not at first request. Observability tooling (Sentry/OTel) is deferred; structured logs are the baseline. Nothing is published, so per-package versioning is unnecessary.

## Decision

- **Environment:** each app has `src/env.ts` that parses `process.env` (or `import.meta.env` for web) with a Zod schema and throws on missing/invalid values. `.env.example` is committed per app; real values live in Vercel/Railway. No secrets in the repository; a secret-scanning pre-commit hook is enabled.
- **Logging:** `pino` structured JSON logs in `apps/api` and `apps/worker` with a request-id middleware; `pino-pretty` in development. No prompt or content bodies are logged. Error tracking and tracing are deferred to a later ADR.
- **Commits:** trunk-based development on `master`; squash merges; Conventional Commits enforced by `commitlint` in a `lefthook` pre-commit/commit-msg hook alongside Biome. No changesets.

## Amendment (TEACH-26, 2026-09-04)

The per-app Zod schemas stay, but the set of variables is declared once in
`infra/env.contract.ts` (name, services, scope, local value, Railway/Vercel targets, who sets it).
`docs/env.md`, every `.env.example` and `.gitleaks.toml` are generated from it and checked in CI;
`bun run doctor` validates local `.env` files against it, `bun run env:check` compares provider
variable names with it, and per-app tests assert schema/contract parity. `bun run setup` generates
`BETTER_AUTH_SECRET` locally so the compose path needs no provider.

## Consequences

- Boot-time failures are explicit and readable.
- When observability is added, it hooks into the existing request-id and logger rather than replacing them.
