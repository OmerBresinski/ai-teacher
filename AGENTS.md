# AGENTS.md — Teaching Journey monorepo

**Teaching Journey** (working name "AI Teacher") is an AI-assisted planning tool that takes a
teacher from a goal to a sequence of Lessons, generates coherent Artefacts (plans, slides,
worksheets, quizzes, …) for each Lesson, and adapts future Lessons from class-level Observations.
This is a Bun + Turborepo monorepo. Product decisions are the founder's and are not recorded in
this repo; engineering decisions are ADRs in [`docs/adr/README.md`](docs/adr/README.md); shared
vocabulary (Journey, Lesson, Artefact,
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

Tickets are picked up by a fresh session (often on a cheaper model) that starts with an **empty
context** and none of the reading the ticket author did. A ticket that says "add a route like the others" will be
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
than inventing a shape. A ticket is ready when a cold session could open the PR without asking a
single question.

### Tech debt

There is a standing Linear project **Tech debt** (team Teacher AI,
https://linear.app/missionsxyz/project/tech-debt-e0bb70c65305) for real findings that are not
part of the work in hand.

File a finding there when it is a valid code-review finding (step 2 of the delivery workflow) but
out of scope for the PR under review; when the agent finds a defect,
performance risk or maintainability problem while reading code that is not what the user asked
for; or when the user declines a nice to have for now. Do not file anything blocking the current
PR (fix it), product or feature ideas (they are founder decisions), or work that already
has a ticket.

Create one Linear issue per finding with `project: "Tech debt"`, using the **Agentic Task**
template to the standard above: include the exact `path:line`, the pattern file and an acceptance
table. A Tech debt ticket is picked up cold months later, so "we should look at X"
is not a ticket. Set priority to High only for data loss, duplicate spend or a security hole;
otherwise Medium or Low — the project takes any priority. Before creating a ticket, search Linear
(`linear_list_issues` with `query` on the file or symbol name, not only the Tech debt project) and
comment on it instead of duplicating it.

The `reviewer` is read-only and does not create tickets. It prefixes each deferred **inline**
comment with `TECH-DEBT:` so the thread is identifiable, and lists them in one line of the review
summary; `BLOCKER:` is unchanged. The main agent files them after the review. The
thread is resolved only after a reply states why it is out of scope for this PR and names the Tech
debt ticket id; the ticket alone is not a decision.

When the user asks for an audit or a list of issues, report findings in chat first. The user
decides; file the findings they do not want fixed now in Tech debt.

## Delivery workflow (implement → PR → review → merge)

The user says **what** to do (a Linear project, a list of issues, a feature, a bug, a design
tweak, a one-line docs fix — anything that changes files); this section is **how** it gets
delivered. **It applies to every code change, not only to Linear-tracked work or work the user
asked to ship as a PR.** Runs without further prompting unless a step needs credentials, spends
money, or mutates live infrastructure — ask once, up front, for all of those together. Work
items that are dashboard-only or founder decisions are reported back, not faked.

**One agent implements; a separate agent reviews.** The main agent does the work itself —
reads the code, decides the approach, edits, tests, opens the PR, lands it. The only thing it
never does is code-review its own diff: that goes to the `reviewer` subagent (step 2), which runs
on a different model and is read-only.

### Tool portability

The mechanisms in this section are named after the founder's setup (OpenCode, the Linear MCP
server, the T3 Code browser). This file is plain `AGENTS.md` and is also read by Codex, Claude
Code and Cursor. Check your own tool list and map by **capability**, not by name:

- **A separate read-only review agent.** If you have a subagent/task tool: spawn one on a
  different model from yours, with file edits denied, have it load
  `.agents/skills/thermo-nuclear-code-quality-review`, and have **it** post the findings as the
  single `COMMENT` review in step 2 (posting a review is reporting, not editing code). If you
  cannot start a second agent, cannot give it a different model, or cannot make it read-only:
  stop after opening the PR and ask a human to review. Never review your own diff in the same
  session and never land an unreviewed PR.
- **Linear tools** (`linear_get_issue`, `linear_save_issue`, …). Same names if the Linear MCP
  server is installed. If absent: do steps 1–4 and list the Linear status changes for a human to
  make.
- **Browser/preview tools.** Any browser automation you have; the deliverable is a screenshot of
  the working UI on the PR. With no browser at all: say so in the PR description and ask the
  human to verify visually before landing — UI acceptance is not met until someone has.
- **Reviewer model.** In order: GPT-5.6 Luna; if unavailable, Claude Sonnet 5; if neither is
  available, ask a human to review. The reviewer must be a different model from the implementer:
  skip a candidate that is the implementer's own model and move to the next. Do not substitute
  another model. In OpenCode the choice is pinned in the user's global `reviewer` agent
  definition, not here.

Cost discipline still applies. The main agent's prompt is re-read on every turn, so each turn has a
fixed cost regardless of how little it does. Batch independent tool calls into one message. Never
spend a turn polling (CI, deploys, `sleep`) — `bun run land <pr>` does the whole wait-and-merge in
one bash call. Prefer a fresh session per feature over one long session: state lives in Linear and
GitHub, not in the chat. Every edit goes through the branch → PR → review → CI path; never commit
to `master` directly.

1. **Implement.** One PR per independent unit of work, done sequentially — finish and land one
   before starting the next when they touch the same files (e.g. `infra/README.md`). Open the PR
   with `gh pr create` (title `<type>(<scope>): …`, with `(TEACH-n)` and a link to the issue when
   there is one). **Branch name:** when there is a Linear issue, the branch **must** be the
   issue's `gitBranchName` exactly as returned by `linear_get_issue` (e.g.
   `omerbres/teach-69-packagesai-tjai-…`) — never invent, shorten or re-slug it; create it with
   `git checkout -b <gitBranchName>`. The issue ID in the branch is what Linear's GitHub
   integration uses to attach the PR to the ticket and drive its status. Without an issue, use
   `<type>/<short-slug>`. Run `bun run lint`, `bun run typecheck` and the relevant tests before
   opening the PR. A fresh `git worktree` has no `node_modules`: run
   `bun install --frozen-lockfile` in it first, or those scripts fail with
   `turbo: command not found`. **Lint the PR title locally before `gh pr create` and before any
   `gh pr edit --title`:** CI runs commitlint on the title (squash merges use it as the commit
   subject) and a rejected title costs a full CI round-trip. Run
   `printf '%s\n' "<title>" | bun run --silent commitlint` (needs `node_modules`; without them
   `bunx commitlint` fetches an unpinned copy that cannot resolve the shareable config) and fix
   until it prints nothing. The two rules that bite: `header-max-length` — the whole title including
   `(TEACH-n)` is ≤ 100 chars; `subject-case` — the subject after `<type>(<scope>): ` must not
   start with a capital or be Sentence/Start/UPPER case, so write `adr 0021`, `csrf`, `readme`,
   not `ADRs`, `CSRF`, `README` (identifiers like `@tj/ai` or `forWorkspace()` are fine). If CI
   fails on the title, `gh pr edit --title` then re-run the workflow — a plain rerun reuses the
   old title. When there is a Linear issue, move it to **In Progress** and set
   its **Assignee** to the currently authenticated Linear user (`assignee: "me"` in
   `linear_save_issue`) when work starts, so the ticket is never left unassigned while it is being
   worked on. Before touching an area, read its `AGENTS.md` and load the skills it names. For UI
   work, a verified visual result (screenshot via the preview tools, with the
   `GET /__test/last-magic-link` sign-in route) is part of acceptance.
2. **Review with a separate subagent.** For every PR, launch a fresh **`reviewer`** subagent (a
   read-only agent on a different model from the implementer; in OpenCode it is defined in the
   user's global config with `edit` denied — see "Tool portability" for other harnesses)
   that loads **`thermo-nuclear-code-quality-review`** (root `.agents/skills/`) and reviews the
   branch diff against `master`. It reports findings only; it does not edit code. Move the Linear
   issue to **In Review** when the PR is open and the review starts.
   **Findings are posted on the GitHub PR as inline review comments**, anchored to the file and
   line they concern, in one review submission via the REST API (not `gh pr review`, which only
   takes a body):

   ```sh
   # commit_id: gh pr view <n> --json headRefOid -q .headRefOid
   # event is always "COMMENT": GitHub rejects REQUEST_CHANGES/APPROVE on your own PR (422),
   # and the reviewer runs as the PR author. Flag blockers in the review body as "BLOCKER:" instead,
  # and prefix each deferred inline comment with "TECH-DEBT:" so the thread is identifiable, listing
   # them in one line of the review summary (see "Tech debt" above).
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
    also returns the same findings as a compact list in its terse final message so step 3 can act
    on them.
3. **Fix, push, merge.** If the review has findings, the main agent fixes them, pushes, and the
   `reviewer` re-reviews only if the fix was structural. `master` requires every review thread to
   be resolved:
   after a finding is fixed, or deferred with a reply that says why it is out of scope for this PR
   and names the Tech debt ticket id (the ticket alone is not a decision), resolve its thread —
   there is no `gh` command for this, use GraphQL:

   ```sh
   gh api graphql -f query='{repository(owner:"{owner}",name:"{repo}"){pullRequest(number:<n>){
     reviewThreads(first:100){nodes{id isResolved}}}}}' \
     -q '.data.repository.pullRequest.reviewThreads.nodes[]|select(.isResolved==false)|.id' |
   xargs -I{} gh api graphql -f query='mutation{resolveReviewThread(input:{threadId:"{}"}){thread{isResolved}}}'
   ```

   Then run `bun run land <pr>` in a single bash call (allow a long timeout, ~25 min). It waits
   for CI, refuses unresolved review threads, rebases when `BEHIND`, squash-merges, watches Vercel
   and both Railway services, and runs `bun run smoke:prod`, printing one summary block. Do not
   poll any of those by hand.
4. **Watch the deploys.** A merge to `master` deploys Vercel (web) and Railway (api, worker).
   The latest Production Vercel deployment must be `Ready`; each Railway service must be `SUCCESS`,
   or `SKIPPED` when the change is outside the service's watch paths, e.g. docs-only. `-p` is the
   `teaching-journey` project id and is required whenever the CLI runs from a directory that is not
   `railway link`ed — worktrees never are. `bun run smoke:prod` (`scripts/smoke-prod.ts`) sends the
   request shapes a
   real browser produces from the production web origin — including `Sec-Fetch-Site: cross-site`,
   which every request carries until TEACH-30 — and must exit 0. Local e2e cannot catch guard
   regressions because the Vite proxy makes requests same-origin (2026-09-05 CSRF incident,
   PR #66). If the deploy or the smoke check failed, fix it before doing anything else — a fix PR
   through the same implement → review → merge steps — and do not mark the Linear issue Done
   until both are green. A PR that changes `apps/api/src/app.ts`, `csrf.ts`, `origins.ts` or
   `auth/require-session.ts` adds a smoke case for any new browser-facing request shape.
   The individual commands live in `scripts/land-pr.ts` if something has to be run by hand.
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
  editor/       @tj/editor     Lesson/worksheet editor, viewer, present, export   ADR 0022
  slides/       @tj/slides     Pure slide recipes, theme catalogue, materialise   ADR 0025
  config/       @tj/config     Shared tsconfig bases, Tailwind preset           TEACH-11
docs/
  adr/          Architecture decision records
  glossary.md   Shared vocabulary
```

Per-area agent guides: [`apps/web/AGENTS.md`](apps/web/AGENTS.md),
[`apps/api/AGENTS.md`](apps/api/AGENTS.md), [`apps/worker/AGENTS.md`](apps/worker/AGENTS.md),
[`packages/ui/AGENTS.md`](packages/ui/AGENTS.md), [`packages/ai/AGENTS.md`](packages/ai/AGENTS.md),
[`packages/editor/AGENTS.md`](packages/editor/AGENTS.md),
[`packages/slides/AGENTS.md`](packages/slides/AGENTS.md).

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
| `shadcn` | `packages/ui`, `apps/web`, `packages/editor` | adding or composing UI components (add them in `packages/ui` only, ADR 0009) |
| `ai-sdk` | `packages/ai`, `apps/worker`, `apps/api` | calling models: `generateText`/`streamText`/structured output through `@tj/ai` (**Bedrock via `createAi`, never the AI Gateway**, ADR 0018) |
| `vercel-react-best-practices` | `apps/web`, `packages/editor` | writing/reviewing React for performance and bundle size (F18-R05: 250 KB gz) |
| `deploy-to-vercel` | `apps/web` | Vercel projects, previews, env vars (ADR 0010) |
| `hono` | `apps/api` | Hono routes, middleware, validation, `streamSSE`, RPC (ADR 0005, 0012) |
| `use-railway` | `apps/api`, `apps/worker` | Railway services, Postgres, variables, PR environments (ADR 0010) |
| `thermo-nuclear-code-quality-review` | repo root | reviewing a PR diff in step 2 of the delivery workflow — **`reviewer` subagent only** |
