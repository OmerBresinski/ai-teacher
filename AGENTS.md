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

## Delivery workflow (implement → PR → review → merge)

The user says **what** to do (a Linear project, a list of issues, a feature, a bug — anything);
this section is **how** it gets delivered. Runs without further prompting unless a step needs
credentials, spends money, or mutates live infrastructure — ask once, up front, for all of those
together. Work items that are dashboard-only or founder decisions are reported back, not faked.

1. **Implement in parallel with subagents.** Split the request into independent units of work.
   One `general` subagent per unit, each on its own branch (the Linear `gitBranchName` when there
   is an issue), each opening its own PR with `gh pr create` (title `<type>(<scope>): …`, with
   `(TEACH-n)` and a link to the issue when there is one). Serialize units that touch the same
   files (e.g. `infra/README.md`) — merge one, rebase the next. Subagents must run
   `bun run lint`, `bun run typecheck` and the relevant tests before opening the PR, and must not
   merge. When there is a Linear issue, move it to **In Progress** and set its **Assignee** to
   the currently authenticated Linear user (`assignee: "me"` in `linear_save_issue`) when work
   starts, so the ticket is never left unassigned while it is being worked on.
2. **Review with a separate subagent.** For every PR, launch a fresh `general` subagent that
   loads **`thermo-nuclear-code-quality-review`** (root `.agents/skills/`) and reviews the branch
   diff against `master`. It reports findings only; it does not edit code. Move the Linear issue
   to **In Review** when the PR is open and the review starts.
3. **Fix, push, merge.** If the review has findings, fix them (or the implementing subagent
   does), push, and re-review only if the fix was structural. If it has none, merge straight
   away. Merge with `gh pr merge --squash --delete-branch` once CI is green
   (`gh pr checks --watch`).
4. **Watch the deploys.** A merge to `master` deploys Vercel (web) and Railway (api, worker).
   After merging, wait for both and check they succeeded:
   `vercel ls teaching-journey-web --scope omerbresinskis-projects` (latest Production must be
   `Ready`) and `railway deployment list --service api|worker --environment production --json |
   jq '.[0].status'` (must be `SUCCESS`; `railway logs --service <svc> --build` for the failure).
   If either failed, fix it before doing anything else — a fix PR through the same
   implement → review → merge steps — and do not mark the Linear issue Done until the deploy is
   green.
5. **Close the loop.** When the work came from Linear, move the issue to **Done** once the PR is
   merged and deployed, with a comment naming the PR and anything deliberately left open; keep
   `infra/README.md` "Known gaps" in sync when the issue is one.

Linear status mirrors the pipeline: Todo → In Progress (branch started, assignee set to the
authenticated user) → In Review (PR open, review running) → Done (merged and deployed). Never
skip a state and never mark Done before the merge and the deploy check.

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
  ai/           @tj/ai         Model client: Bedrock via Vercel AI SDK, classes   ADR 0018
  config/       @tj/config     Shared tsconfig bases, Tailwind preset           TEACH-11
docs/
  adr/          Architecture decision records
  glossary.md   Shared vocabulary
```

Per-area agent guides: [`apps/web/AGENTS.md`](apps/web/AGENTS.md),
[`apps/api/AGENTS.md`](apps/api/AGENTS.md), [`apps/worker/AGENTS.md`](apps/worker/AGENTS.md),
[`packages/ui/AGENTS.md`](packages/ui/AGENTS.md), [`packages/ai/AGENTS.md`](packages/ai/AGENTS.md).

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
| `ai-sdk` | `packages/ai`, `apps/worker`, `apps/api` | calling models: `generateText`/`streamText`/structured output through `@tj/ai` (**Bedrock via `createAi`, never the AI Gateway**, ADR 0018) |
| `vercel-react-best-practices` | `apps/web` | writing/reviewing React for performance and bundle size (F18-R05: 250 KB gz) |
| `deploy-to-vercel` | `apps/web` | Vercel projects, previews, env vars (ADR 0010) |
| `hono` | `apps/api` | Hono routes, middleware, validation, `streamSSE`, RPC (ADR 0005, 0012) |
| `use-railway` | `apps/api`, `apps/worker` | Railway services, Postgres, variables, PR environments (ADR 0010) |
| `thermo-nuclear-code-quality-review` | repo root | reviewing a PR diff in step 2 of the delivery workflow — **review agents only** |
