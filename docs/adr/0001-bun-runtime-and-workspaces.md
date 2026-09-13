# 0001 — Bun runtime and workspaces

- Status: Accepted
- Date: 2026-09-03
- Related PRD decisions: none (engineering only)

## Context

We need one toolchain for a TypeScript monorepo with a browser SPA, an HTTP API and a background worker. Options considered: Bun end-to-end; pnpm + Node 22; Bun as package manager with Node as runtime.

## Decision

Bun is the package manager, script runner, test runner (for non-React packages) and production runtime for `apps/api` and `apps/worker`. Workspaces are declared in the root `package.json` (`"workspaces": ["apps/*", "packages/*"]`). `bun.lock` is committed. The extraction-child exception below is the only Node runtime in production images.

## Consequences

- Fast installs and cold starts; a single lockfile; `bun test` for server-side packages.
- Some native or Node-specific libraries (PDF/PPTX generation in F12, some OCR tooling in F03 V1) may need compatibility checks. If a required library does not run on Bun, the affected service may run on Node without changing this ADR's package-management decision; record that as a new ADR.
- Docker images use `oven/bun` as the base.

## Amendment (TEACH-278, 2026-09-13): memory-isolated extraction child

Native Railway Linux x64 probes showed Bun 1.3.6 cannot boot under a useful per-process address-space
or data-memory ceiling. Node 24.14.1 can run the same pure-byte extraction libraries under a
1536 MiB `RLIMIT_AS`, with 256 MiB V8 old-space and 8 MiB semi-space limits. The Docker image
therefore copies the pinned Node binary and its C++ runtime libraries solely for the compiled
`extract-child.mjs` process. API, worker, migrations, package management and local source-mode
tooling remain Bun. ADR 0027 records the boundary, tests and refusal behavior; every Docker build
verifies normal fixtures, child memory failure, slot release and continued parent operation.
