# 0001 — Bun runtime and workspaces

- Status: Accepted
- Date: 2026-09-03
- Related PRD decisions: none (engineering only)

## Context

We need one toolchain for a TypeScript monorepo with a browser SPA, an HTTP API and a background worker. Options considered: Bun end-to-end; pnpm + Node 22; Bun as package manager with Node as runtime.

## Decision

Bun is the package manager, script runner, test runner (for non-React packages) and production runtime for `apps/api` and `apps/worker`. Workspaces are declared in the root `package.json` (`"workspaces": ["apps/*", "packages/*"]`). `bun.lock` is committed. Node is not installed in production images.

## Consequences

- Fast installs and cold starts; a single lockfile; `bun test` for server-side packages.
- Some native or Node-specific libraries (PDF/PPTX generation in F12, some OCR tooling in F03 V1) may need compatibility checks. If a required library does not run on Bun, the affected service may run on Node without changing this ADR's package-management decision; record that as a new ADR.
- Docker images use `oven/bun` as the base.
