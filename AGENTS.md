# AGENTS.md — Teaching Journey monorepo

**Teaching Journey** (working name "AI Teacher") is an AI-assisted planning tool that takes a
teacher from a goal to a sequence of Lessons, generates coherent Artefacts (plans, slides,
worksheets, quizzes, …) for each Lesson, and adapts future Lessons from class-level Observations.
This is a Bun + Turborepo monorepo. Product decisions live in Notion; engineering decisions are
ADRs in [`docs/adr/README.md`](docs/adr/README.md); shared vocabulary (Journey, Lesson, Artefact,
Workspace, Observation, …) is defined in [`docs/glossary.md`](docs/glossary.md) and must be used
exactly as written. Setup, commands and conventions: [`README.md`](README.md).

## Ground rules

- **Default branch is `master`.** Trunk-based, squash merges, PRs required.
  Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, …) are enforced by commitlint.
- **Internal packages are consumed from source** (see README "Internal packages are consumed from
  source"): `@tj/*` `package.json#exports` point at `src/*.ts`; nothing is built before `dev`,
  `typecheck` or `test`; `typecheck` does not depend on `^build`.
- Dependency direction is apps → packages, never packages → apps; `@tj/domain` depends on nothing
  internal. Bun uses the isolated linker: a workspace can only import what it declares.
- Biome is the only linter/formatter (root `biome.json`; 2-space, double quotes, 100 cols, `a11y`
  at `error`). Exact dependency versions (`bunfig.toml` `exact = true`). No secrets in git.
- **Load the relevant skill before touching that area.** Each app/package has its own `AGENTS.md`
  naming the skills to load and the ADR constraints that override generic skill advice.

## Delivery workflow (Linear → PR → review → merge)

Default for "implement what is in Todo" style requests. Runs without further prompting unless a
step needs credentials, spends money, or mutates live infrastructure — ask once, up front, for
all of those together.

1. **Scope.** Read the Linear project/issues (`linear_get_issue` for full descriptions). Only
   issues in **Todo** are in scope; Backlog stays untouched. Work items that are dashboard-only or
   founder decisions are reported back, not faked.
2. **Implement in parallel with subagents.** One `general` subagent per independent issue, each
   on its own branch (use the Linear `gitBranchName`), each opening its own PR with `gh pr create`
   (title `<type>(<scope>): … (TEACH-n)`, body linking the issue). Serialize issues that touch the
   same files (e.g. `infra/README.md`) — merge one, rebase the next. Subagents must run
   `bun run lint`, `bun run typecheck` and the relevant tests before opening the PR, and must not
   merge.
3. **Review with a separate subagent.** For every PR, launch a fresh `general` subagent that
   loads **`thermo-nuclear-code-quality-review`** (root `.agents/skills/`) and reviews the branch
   diff against `master`. It reports findings only; it does not edit code.
4. **Fix, push, merge.** If the review has findings, fix them (or the implementing subagent
   does), push, and re-review only if the fix was structural. If it has none, merge straight
   away. Merge with `gh pr merge --squash --delete-branch` once CI is green
   (`gh pr checks --watch`).
5. **Close the loop.** Move the Linear issue to Done with a comment naming the PR and anything
   deliberately left open; keep `infra/README.md` "Known gaps" in sync when the issue is one.

## Package map

From [ADR 0013](docs/adr/0013-monorepo-layout.md):

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
  jobs/         @tj/jobs       pg-boss runtime + typed job registry             ADR 0006
  storage/      @tj/storage    StorageAdapter impls (local disk, Vercel Blob)   ADR 0011
  config/       @tj/config     Shared tsconfig bases, Tailwind preset           TEACH-11
docs/
  adr/          Architecture decision records
  glossary.md   Shared vocabulary
```

Per-area agent guides: [`apps/web/AGENTS.md`](apps/web/AGENTS.md),
[`apps/api/AGENTS.md`](apps/api/AGENTS.md), [`apps/worker/AGENTS.md`](apps/worker/AGENTS.md),
[`packages/ui/AGENTS.md`](packages/ui/AGENTS.md).

## Agent skills

Skills are vendored per app/package under `<location>/.agents/skills/<name>/SKILL.md` (with
`.claude/skills/<name>` symlinks). Inventory, sources, pinned commits and re-install commands:
[`docs/agent-skills.md`](docs/agent-skills.md). `bun run skills:check` verifies they are present.
Never hand-edit skill contents.
Skills live in `<location>/.agents/skills`; `.claude/skills` entries are relative symlinks — never
edit or copy them (ADR 0017).

| Skill | Where | Load when… |
| ----- | ----- | ---------- |
| `tanstack-router` | `apps/web` | defining routes, loaders, search params, navigation (**code-based routes only**, ADR 0004) |
| `tanstack-query` | `apps/web` | fetching/caching server state, invalidation, mutations |
| `shadcn` | `packages/ui`, `apps/web` | adding or composing UI components (add them in `packages/ui` only, ADR 0009) |
| `vercel-react-best-practices` | `apps/web` | writing/reviewing React for performance and bundle size (F18-R05: 250 KB gz) |
| `deploy-to-vercel` | `apps/web` | Vercel projects, previews, env vars (ADR 0010) |
| `hono` | `apps/api` | Hono routes, middleware, validation, `streamSSE`, RPC (ADR 0005, 0012) |
| `use-railway` | `apps/api`, `apps/worker` | Railway services, Postgres, variables, PR environments (ADR 0010) |
| `thermo-nuclear-code-quality-review` | repo root | reviewing a PR diff in step 3 of the delivery workflow — **review agents only** |

