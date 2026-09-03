# Teaching Journey

Monorepo for **Teaching Journey** (working name "AI Teacher"): an AI-assisted planning tool that
takes a teacher from a goal to a sequence of Lessons, generates coherent Artefacts (plans, slides,
worksheets, quizzes, …) for each Lesson, and adapts future Lessons from class-level Observations.
Product decisions live in Notion; engineering decisions live in [`docs/adr/`](docs/adr/README.md)
and shared vocabulary in [`docs/glossary.md`](docs/glossary.md).

## Prerequisites

- [Bun](https://bun.sh) **1.3.6** (pinned in `package.json#packageManager`; `bun >= 1.2` works)
- Docker (Postgres + pgvector for local development — wired up by TEACH-18)
- Optional: [`gitleaks`](https://github.com/gitleaks/gitleaks) on your `PATH` for the local secret
  scan (CI runs it regardless)

## Quick start

```sh
bun install        # installs deps and git hooks (lefthook) via the `prepare` script
bun run dev        # turbo run dev across all apps (nothing to run until the apps land)
```

Everyday commands (all run through Turborepo, see [ADR 0002](docs/adr/0002-turborepo.md)):

| Command                    | What it does                                                     |
| -------------------------- | ---------------------------------------------------------------- |
| `bun run dev`              | Start every app in watch mode (`persistent`, uncached)           |
| `bun run build`            | Build apps (and packages that opt in) in dependency order        |
| `bun run lint`             | Biome check per workspace + root config files                    |
| `bun run lint:fix`         | Same, applying safe fixes                                        |
| `bun run format`           | Biome format (write)                                             |
| `bun run typecheck`        | `tsc --noEmit` per workspace, dependencies first                 |
| `bun run test`             | Unit/integration tests (`bun test` or Vitest per workspace)      |
| `bun run test:e2e`         | Playwright, after `build`                                        |
| `bun run verify-bootstrap` | End-to-end check of this scaffold (`scripts/verify-bootstrap.sh`) |

## Package map

From [ADR 0013](docs/adr/0013-monorepo-layout.md). Everything internal is scoped `@tj/*` and never
published. Dependency direction is apps → packages, never packages → apps; `@tj/domain` depends on
nothing internal.

```
apps/
  web/          @tj/web        Vite + React SPA, TanStack Router (code-based)   ADR 0004
  api/          @tj/api        Hono on Bun, Hono RPC contract                    ADR 0005
  worker/       @tj/worker     pg-boss consumer                                  ADR 0006
packages/
  ui/           @tj/ui         Tailwind v4 + shadcn design system               ADR 0009
  db/           @tj/db         Drizzle schema, migrations, forWorkspace()       ADR 0006/0007
  domain/       @tj/domain     Zod schemas + types, job names, StorageAdapter   Master PRD §8
  api-client/   @tj/api-client Hono RPC AppType + typed client factory          ADR 0005
  config/       @tj/config     Shared tsconfig bases, Tailwind preset           (this ticket)
docs/
  adr/          Architecture decision records
  glossary.md   Shared vocabulary
```

Only `packages/config` exists today; sibling tickets add the rest (see `docs/p0-ticket-map.md`).

## Internal packages are consumed from source

**Decision (TEACH-11):** internal `@tj/*` packages are *just-in-time* packages. Their
`package.json#exports` point at TypeScript **source**, not at a `dist/` build. Bun, Vite and `tsc`
(`moduleResolution: "bundler"`) all resolve this directly, so:

- `typecheck` is `tsc --noEmit` in every workspace and does **not** depend on `^build`. In
  `turbo.json` it has `dependsOn: ["^typecheck"]` only so failures surface in the package that
  owns them first (and so a dependency's changes invalidate dependents' caches).
- `build` is only meaningful for **apps** (`apps/api` and `apps/worker` bundle with
  `bun build --target=bun`; `apps/web` with `vite build`) and for packages that opt in (e.g.
  `@tj/domain` may add a `tsup` build to verify tree-shaking). `build` keeps
  `dependsOn: ["^build"]` and `outputs: ["dist/**"]`; packages without a `build` script are simply
  skipped.
- Nothing needs to be built before you can run `dev`, `typecheck` or `test`.

Every new package **must** copy this shape:

```jsonc
// packages/<name>/package.json
{
  "name": "@tj/<name>",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*.ts"          // optional: subpath exports, also from source
  },
  "scripts": {
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write .",
    "typecheck": "tsc --noEmit",
    "test": "bun test"           // or "vitest run" for React packages (ADR 0014)
  },
  "devDependencies": {
    "@tj/config": "workspace:*",
    "typescript": "5.9.3"
  }
}
```

```jsonc
// packages/<name>/tsconfig.json  (apps/web and packages/ui use tsconfig/react.json)
{
  "extends": "@tj/config/tsconfig/node.json",
  "include": ["src"]
}
```

Consumers declare the dependency as `"@tj/<name>": "workspace:*"`. Bun 1.3 uses the **isolated**
linker for workspaces (pnpm-style), so a workspace can only import what it declares — including
`@tj/config` when it extends a tsconfig from it.

### `@tj/config`

| Export                                | Purpose                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `@tj/config/tsconfig/base.json`       | strict, `ES2022`/`ESNext`, `moduleResolution: bundler`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `isolatedModules`, `skipLibCheck` |
| `@tj/config/tsconfig/node.json`       | base + `lib: ESNext` + `@types/bun` (apps/api, apps/worker, server packages)              |
| `@tj/config/tsconfig/react.json`      | base + `lib: DOM, DOM.Iterable, ESNext` + `jsx: react-jsx` (apps/web, packages/ui)        |
| `@tj/config/tailwind.preset`          | Tailwind preset placeholder — filled by F18 (ADR 0009)                                    |

Biome is configured once in the root `biome.json` (ADR 0003); packages do not carry their own.

## Conventions

- **Default branch is `master`** (not `main`; see the amendment in
  [`docs/adr/README.md`](docs/adr/README.md)). Trunk-based development, squash merges.
- **Pull requests are required** to change `master` (branch protection; CI checks are added by
  TEACH-23). Do not push directly.
- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`, `build:`, `ci:`, `refactor:`,
  `test:`, …) enforced by `commitlint` in the `commit-msg` hook ([ADR 0015](docs/adr/0015-env-logging-commits.md)).
- **Biome** is the only linter/formatter: 2-space indent, double quotes, trailing commas, 100-column
  lines, recommended rules + the `a11y` group at `error`, imports organised automatically. The
  `pre-commit` hook runs `biome check --staged --write` and re-stages the result.
- **Secrets never land in git.** The `pre-commit` hook runs `gitleaks protect --staged` when
  `gitleaks` is installed (and prints a one-line warning otherwise); CI scans unconditionally.
- **Exact versions.** `bunfig.toml` sets `[install] exact = true`; `bun add` pins exact versions
  and `bun.lock` is committed. CI installs with `bun install --frozen-lockfile`.
- **Hooks** are managed by [lefthook](https://github.com/evilmartians/lefthook) (`lefthook.yml`).
  `LEFTHOOK=0 git commit …` bypasses them in an emergency; CI re-runs the same checks.
- Product terms (Journey, Lesson, Artefact, Workspace, …) are used exactly as defined in
  [`docs/glossary.md`](docs/glossary.md).
