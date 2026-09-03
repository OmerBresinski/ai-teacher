# 0013 — Monorepo layout and `@tj/*` package scope

- Status: Accepted
- Date: 2026-09-03
- Related PRD decisions: none

## Context

The product's working name is temporary. Packages are internal and never published to npm.

## Decision

Package scope is `@tj/*` ("Teaching Journey"). Repository name: `teaching-journey`. In-app path alias `@/` is reserved for intra-package imports.

```
apps/
  web/          @tj/web        Vite + React SPA (ADR 0004)
  api/          @tj/api        Hono on Bun (ADR 0005)
  worker/       @tj/worker     pg-boss consumer (ADR 0006)
packages/
  ui/           @tj/ui         Tailwind + shadcn design system (ADR 0009)
  db/           @tj/db         Drizzle schema, migrations, forWorkspace() (ADR 0006/0007)
  domain/       @tj/domain     Zod schemas + types for core objects (Master PRD §8), job names, StorageAdapter interface
  api-client/   @tj/api-client Hono RPC AppType export + typed client factory
  config/       @tj/config     Shared tsconfig bases, Biome preset, Tailwind preset
docs/
  adr/          Architecture decision records
  glossary.md   Shared vocabulary
```

Feature packages (e.g. `@tj/skills-runtime`, `@tj/identifier-guard`, `@tj/knowledge`) are added by the projects that own them (F13, F15, F05).

## Consequences

- Clear ownership per package; the dependency direction is apps → packages, never packages → apps, and `@tj/domain` depends on nothing internal.
- Renaming the scope later is a mechanical find/replace.
