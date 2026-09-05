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

## Writing tickets (Linear issues)

Tickets are executed by implementing subagents that are **less capable than the agent writing the
ticket** and start with an empty context. A ticket that says "add a route like the others" will be
guessed; a ticket that names the file, the function and the pattern will be built. Before writing a
ticket, **read the code paths it touches** — never describe them from memory or by analogy:

- Name the exact files and symbols to create or change (`apps/api/src/routes/me.ts`,
  `meRoutes`, `CreateAppOptions.ai`), and the existing file that is the pattern to copy
  (`files.ts` for route injection, `ping.ts` for a job handler). Quote small signatures verbatim.
- State the repo-specific conventions the implementor cannot infer: how collaborators are injected
  (route-factory arguments, `deps` on `JobContext`), which helpers tests use (`TEST_ENV`,
  `fakeSql`, `WORKSPACE_HEADER`, `createFakeAi`), exact dependency pins, which skill to load and
  which of its advice an ADR overrides.
- Call out traps you found while reading: e.g. the dev header shim sets `workspaceId` but not
  `user`; route modules must not leak Bun-only types into `AppType`; pino drops `undefined`.
- Give a full acceptance table (setup → expected status/body/log lines), the test file names and
  the cases in each, and the exact PR title (≤ 100 chars, commitlint).
- Say what is out of scope and which ADR decides each design choice, so the implementor does not
  re-open it.

Always create tickets from the Linear **Agentic Task** issue template (`template: "Agentic Task"`
in `linear_save_issue`; `linear_get_template` shows its sections) and fill every section rather
than inventing a shape. A ticket is ready when a subagent could open the PR without asking a
single question.

### Tech debt

There is a standing Linear project **Tech debt** (team Teacher AI,
https://linear.app/missionsxyz/project/tech-debt-e0bb70c65305) for real findings that are not
part of the work in hand.

File a finding there when it is a valid code-review finding (step 2 of the delivery workflow) but
out of scope for the PR under review; when an implementing or exploring subagent finds a defect,
performance risk or maintainability problem while reading code that is not what the user asked
for; or when the user declines a nice to have for now. Do not file anything blocking the current
PR (fix it), product or feature ideas (they are Notion / founder decisions), or work that already
has a ticket.

Create one Linear issue per finding with `project: "Tech debt"`, using the **Agentic Task**
template to the standard above: include the exact `path:line`, the pattern file and an acceptance
table. A Tech debt ticket is picked up cold by a subagent months later, so "we should look at X"
is not a ticket. Set priority to High only for data loss, duplicate spend or a security hole;
otherwise use Medium or Low. Before creating a ticket, search the project for one on the same
file or symbol and comment on it instead of duplicating it.

The `reviewer` is read-only and does not create tickets. It marks these findings in its review
body as `TECH-DEBT:` alongside the existing `BLOCKER:` convention in step 2; the main agent files
them after the review, replies on the thread with the ticket id, and resolves it. A filed ticket
counts as consciously declined with a stated reason for the purpose of step 3.

When the user asks for an audit or a list of issues, report findings in chat first. The user
decides; file the findings they do not want fixed now in Tech debt.

## Delivery workflow (implement → PR → review → merge)

The user says **what** to do (a Linear project, a list of issues, a feature, a bug, a design
tweak, a one-line docs fix — anything that changes files); this section is **how** it gets
delivered. **It applies to every code change, not only to Linear-tracked work or work the user
asked to ship as a PR.** Runs without further prompting unless a step needs credentials, spends
money, or mutates live infrastructure — ask once, up front, for all of those together. Work
items that are dashboard-only or founder decisions are reported back, not faked.

**The main agent never implements and never code-reviews.** Its job is to gather context (via
`explore` subagents), decide the approach, write the brief, delegate the implementation to
`general` subagents (step 1) and the code review to the `reviewer` subagent (step 2), and then
run the **acceptance check**: does the result match the brief — right branch and PR title, CI
green, every review finding fixed or declined with a stated reason, screenshots or a verified
visual result for UI work, nothing outside the brief touched. It does not read the diff for
quality; that is the reviewer's job and doing it twice wastes the expensive model. The only
edits it makes itself are to the brief. If it catches itself editing source, tests, styles or
docs in the working tree, that is the signal to stop and delegate. Reasons this rule exists:
the main agent runs on the most expensive model, and direct edits skip the branch → PR →
review → CI path that `master` protection depends on.

1. **Implement in parallel with subagents.** Split the request into independent units of work.
   One `general` subagent per unit, each on its own branch (the Linear `gitBranchName` when there
   is an issue), each opening its own PR with `gh pr create` (title `<type>(<scope>): …`, with
   `(TEACH-n)` and a link to the issue when there is one). Serialize units that touch the same
   files (e.g. `infra/README.md`) — merge one, rebase the next. Subagents must run
   `bun run lint`, `bun run typecheck` and the relevant tests before opening the PR, and must not
   merge. A fresh `git worktree` has no `node_modules`: run `bun install --frozen-lockfile` in it
   first, or those scripts fail with `turbo: command not found`. (The commit hooks and CI still run
   Biome, commitlint and the test suite, so a docs-only change may rely on those instead — say
   which in the brief.) When there is a Linear issue, move it to **In Progress** and set its
   **Assignee** to the currently authenticated Linear user (`assignee: "me"` in
   `linear_save_issue`) when work starts, so the ticket is never left unassigned while it is being
   worked on.
   The brief to each subagent meets the "Writing tickets" standard above (exact files and
   symbols, pattern file, non-inferable conventions, traps, acceptance table, tests, branch name,
   exact PR title); the per-area `AGENTS.md` names the conventions and skills for that area. For
   UI work, a verified visual result is part of acceptance — say how to obtain it (which servers
   and ports, the `GET /__test/last-magic-link` sign-in route).
2. **Review with a separate subagent.** For every PR, launch a fresh **`reviewer`** subagent (a
   read-only agent defined in the user's global opencode config — `edit` denied, its own model —
   fall back to `general` only if `reviewer` is not available) that loads
   **`thermo-nuclear-code-quality-review`** (root `.agents/skills/`) and reviews the branch
   diff against `master`. It reports findings only; it does not edit code. Move the Linear issue
   to **In Review** when the PR is open and the review starts.
   **Findings are posted on the GitHub PR as inline review comments**, anchored to the file and
   line they concern, in one review submission via the REST API (not `gh pr review`, which only
   takes a body):

   ```sh
   # commit_id: gh pr view <n> --json headRefOid -q .headRefOid
   # event is always "COMMENT": GitHub rejects REQUEST_CHANGES/APPROVE on your own PR (422),
   # and the reviewer runs as the PR author. Flag blockers as "BLOCKER:" and out-of-scope findings
   # as "TECH-DEBT:" (see "Tech debt" above) in the body instead.
   gh api repos/{owner}/{repo}/pulls/<n>/reviews --input - <<'EOF'
   {
     "commit_id": "<head sha>",
     "event": "COMMENT",
     "body": "<one-paragraph summary; 'No findings.' when empty>",
     "comments": [
       { "path": "apps/api/src/routes/lessons.ts", "line": 42, "side": "RIGHT",
         "body": "<finding, phrased as in the skill>" }
     ]
   }
   EOF
   ```

   The heredoc is quoted (`<<'EOF'`) on purpose: the payload must be literal, valid JSON — no
   comments inside it, and no shell interpolation, so backticks in finding text survive.
   `line` is the line number in the **new** file for added/changed lines (`side: "RIGHT"`); use
   `side: "LEFT"` only for deleted lines. Use `start_line`/`start_side` for multi-line ranges.
   Only lines inside the diff hunks can be anchored — put a finding about unchanged code in the
   review `body` with a `path:line` reference instead. A review with no findings is still
   submitted (`comments: []`, `event: "COMMENT"`) so the PR carries the record. The subagent
   also returns the same findings in its final message so step 3 can act on them.
3. **Fix, push, merge.** If the review has findings, the implementing subagent fixes them
   (resume it with its `task_id`), pushes, and the `reviewer` re-reviews only if the fix was
   structural. With or without findings, the main agent then runs the acceptance check described
   above and merges only when it passes. `master` requires every review thread to be resolved, so
   after a finding is fixed (or consciously declined, with a reply saying why — filing a Tech debt
   ticket and naming it in the reply counts) resolve its
   thread — there is no `gh` command for this, use GraphQL:

   ```sh
   gh api graphql -f query='{repository(owner:"{owner}",name:"{repo}"){pullRequest(number:<n>){
     reviewThreads(first:100){nodes{id isResolved}}}}}' \
     -q '.data.repository.pullRequest.reviewThreads.nodes[]|select(.isResolved==false)|.id' |
   xargs -I{} gh api graphql -f query='mutation{resolveReviewThread(input:{threadId:"{}"}){thread{isResolved}}}'
   ```

   Merge with `gh pr merge --squash --delete-branch` once CI is green (`gh pr checks --watch`).
   `master` also requires the branch to be up to date: if `gh pr view <n> --json
   mergeStateStatus` says `BEHIND`, rebase on `origin/master`, `git push --force-with-lease`,
   and wait for CI again. `gh pr checks --watch` can return while a second run for the same
   head is still in progress — re-check `mergeStateStatus` before merging rather than
   reaching for `--admin`.
4. **Watch the deploys.** A merge to `master` deploys Vercel (web) and Railway (api, worker).
   After merging, wait for both and check they succeeded:
   `vercel ls teaching-journey-web --scope omerbresinskis-projects` (latest Production must be
   `Ready`) and, for Railway, `for s in api worker; do railway deployment list
   -p a79752e1-8bf5-41d0-b832-f1b64aaf6d2f -e production -s $s --json | jq -r '.[0].status';
   done` (each must be `SUCCESS`, or `SKIPPED` when the change is outside the service's watch
   paths, e.g. docs-only; `railway logs -p a79752e1-8bf5-41d0-b832-f1b64aaf6d2f -e production
   -s <svc> --build` for the failure). `-p` is the `teaching-journey` project id and is required
   whenever the CLI runs from a directory that is not `railway link`ed — worktrees never are.
   Then run **`bun run smoke:prod`** (`scripts/smoke-prod.ts`): it sends the request shapes a
   real browser produces from the production web origin — including `Sec-Fetch-Site: cross-site`,
   which every request carries until TEACH-30 — and must exit 0. Local e2e cannot catch guard
   regressions because the Vite proxy makes requests same-origin (2026-09-05 CSRF incident,
   PR #66). If the deploy or the smoke check failed, fix it before doing anything else — a fix PR
   through the same implement → review → merge steps — and do not mark the Linear issue Done
   until both are green. A PR that changes `apps/api/src/app.ts`, `csrf.ts`, `origins.ts` or
   `auth/require-session.ts` adds a smoke case for any new browser-facing request shape.
5. **Close the loop.** When the work came from Linear, move the issue to **Done** once the PR is
   merged and deployed, with a comment naming the PR and anything deliberately left open; keep
   `infra/README.md` "Known gaps" in sync when the issue is one.

Linear status mirrors the pipeline: Todo → In Progress (branch started, assignee set to the
authenticated user) → In Review (PR open, review running) → Done (merged and deployed). Never
skip a state and never mark Done before the merge and the deploy check.

Work that did not come from Linear still goes through steps 1–4; only step 5 is skipped.

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
| `thermo-nuclear-code-quality-review` | repo root | reviewing a PR diff in step 2 of the delivery workflow — **`reviewer` subagent only** |
