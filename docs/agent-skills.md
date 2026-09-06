# Agent skills

Agent skills are folders of instructions (`SKILL.md` plus optional references/scripts) that coding
agents load on demand. They are installed **per app/package** so an agent working in `apps/api` sees
Hono guidance and an agent working in `apps/web` sees TanStack/shadcn/Vercel guidance. Each
`AGENTS.md` (root and per app/package) tells the agent which skills to load; this file is the
inventory and the re-install recipe (TEACH-27).

Skill contents are vendored verbatim from upstream and **never hand-edited** — re-run the install
command to update. `**/.agents/**`, `**/.claude/**` and `**/.opencode/**` are excluded from Biome,
from Turborepo task inputs (so skill edits never bust caches) and marked `linguist-vendored`.

`bun run skills:check` (`scripts/skills-check.ts`, also run by `bun run doctor`) parses the table
below and fails if any `Path` lacks a `SKILL.md` **or** violates the layout in
[ADR 0017](adr/0017-agent-skill-layout.md) — see [Layout](#layout).

## Installed skills

Installed on 2026-09-04 with `skills` CLI **v1.5.23** (`npx skills`, from
[vercel-labs/skills](https://github.com/vercel-labs/skills)). `Commit` is the source repo's default
branch HEAD at install time (`gh api repos/<o>/<r>/commits/HEAD -q .sha`); the CLI's own
`skills-lock.json` in each location records the upstream `skillPath` and a content hash
(`computedHash`) rather than a commit.

| Skill | Source | Commit | Path | Purpose | Serves |
| ----- | ------ | ------ | ---- | ------- | ------ |
| `tanstack-router` | [tanstack-skills/tanstack-skills](https://github.com/tanstack-skills/tanstack-skills) (`plugins/tanstack-router/skills/tanstack-router`) | `6f5521ecbdfbfa3d54d335eba6c8b4df0b804c03` | `apps/web/.agents/skills/tanstack-router` | TanStack Router API: `createRoute`/`createRootRouteWithContext`, search params, loaders, code splitting. **Its "use file-based routing" advice is overridden by ADR 0004 (code-based).** | TEACH-21; ADR 0004; F18 App Shell |
| `tanstack-query` | [tanstack-skills/tanstack-skills](https://github.com/tanstack-skills/tanstack-skills) (`plugins/tanstack-query/skills/tanstack-query`) | `6f5521ecbdfbfa3d54d335eba6c8b4df0b804c03` | `apps/web/.agents/skills/tanstack-query` | Server-state: query keys, `queryOptions`, invalidation, mutations, prefetching via router loaders. | TEACH-21, TEACH-19 (SSE → invalidate); ADR 0004, 0012; F18-R04 |
| `shadcn` | [shadcn-ui/ui](https://github.com/shadcn-ui/ui) (`skills/shadcn`) | `8720dec73f5aebed9f649ea58636f54599fdedf1` | `packages/ui/.agents/skills/shadcn`, `apps/web/.agents/skills/shadcn`, `packages/editor/.agents/skills/shadcn` | Official shadcn skill: `components.json`, registries, adding/composing components, Tailwind v4 styling. Components are added in `packages/ui` only (ADR 0009). | TEACH-13, TEACH-21; ADR 0009; F18-R13, F18-R09 |
| `ai-sdk` | [vercel/ai](https://github.com/vercel/ai) (`skills/use-ai-sdk`) | `d0b6d6d83aadb4188afc13b504b2fb2d88468050` | `packages/ai/.agents/skills/ai-sdk`, `apps/worker/.agents/skills/ai-sdk`, `apps/api/.agents/skills/ai-sdk` | Vercel AI SDK API (`generateText`, `streamText`, `Output.object`, middleware, `ai/test` mocks). **Its "use the Vercel AI Gateway" and "fetch model IDs from `ai-gateway.vercel.sh`" advice is overridden by ADR 0018 (Bedrock via `createAi`, model IDs from env).** | P2 (TEACH-69..72); ADR 0018; F13 |
| `hono` | [honojs/skills](https://github.com/honojs/skills) (`skills/hono`) — successor of `yusukebe/hono-skill`, see below | `b04b90bfe0a3a41789045bc114b5834d0333e15c` | `apps/api/.agents/skills/hono` | Official Hono skill: routing, middleware, `@hono/zod-validator`, `streamSSE`, testing, RPC (`hc<AppType>`). | TEACH-16, TEACH-19, TEACH-20; ADR 0005, 0012, 0015 |
| `vercel-react-best-practices` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) (`skills/react-best-practices`) | `063bee94c3f4df8453406c830b0a7df0f2860278` | `apps/web/.agents/skills/vercel-react-best-practices`, `packages/editor/.agents/skills/vercel-react-best-practices` | React performance rules (waterfalls, bundle size, re-renders). Next.js-specific sections do not apply (Vite SPA). | TEACH-21, TEACH-23 (bundle budget); ADR 0004; F18-R05 |
| `deploy-to-vercel` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) (`skills/deploy-to-vercel`) | `063bee94c3f4df8453406c830b0a7df0f2860278` | `apps/web/.agents/skills/deploy-to-vercel` | Vercel CLI deploys, preview URLs, project linking, env vars. | TEACH-25, TEACH-26; ADR 0010, 0011 |
| `use-railway` | [railwayapp/railway-skills](https://github.com/railwayapp/railway-skills) (`plugins/railway/skills/use-railway`) | `5d1e97178f86c82795d6737928bd641e0552166a` | `apps/api/.agents/skills/use-railway`, `apps/worker/.agents/skills/use-railway` | Railway CLI/API: services, Postgres, variables, PR environments, domains, `.railway/railway.ts` IaC, troubleshooting. | TEACH-24, TEACH-26; ADR 0006, 0010 |
| `thermo-nuclear-code-quality-review` | [cursor/plugins](https://github.com/cursor/plugins) (`cursor-team-kit/skills/thermo-nuclear-code-quality-review`) | `93b00b89ef425a9c1bac0d0b317dfc49c930ac99` | `.agents/skills/thermo-nuclear-code-quality-review` | Strict maintainability review of a branch's diff (abstractions, file size, spaghetti growth). Loaded by the **review agent** in the delivery workflow (root `AGENTS.md` → "Delivery workflow"), never by the implementing agent. | P1 hardening (TEACH-37/38) |

Per location, on disk:

| Location | `.agents/skills/` | `.claude/skills/` (symlinks → `../../.agents/skills/<name>`) | Manifest |
| -------- | ----------------- | ------------------------------------------------------------ | -------- |
| repo root | `thermo-nuclear-code-quality-review` | same one | `skills-lock.json` |
| `apps/web` | `tanstack-router`, `tanstack-query`, `shadcn`, `vercel-react-best-practices`, `deploy-to-vercel` | same five | `apps/web/skills-lock.json` |
| `apps/api` | `hono`, `use-railway`, `ai-sdk` | same three | `apps/api/skills-lock.json` |
| `apps/worker` | `use-railway`, `ai-sdk` | same two | `apps/worker/skills-lock.json` |
| `packages/ai` | `ai-sdk` | same one | `packages/ai/skills-lock.json` |
| `packages/ui` | `shadcn` | same one | `packages/ui/skills-lock.json` |
| `packages/editor` | `shadcn`, `vercel-react-best-practices` | same two | `packages/editor/skills-lock.json` |

## Layout

Decided in [ADR 0017](adr/0017-agent-skill-layout.md) (TEACH-28): **`<location>/.agents/skills/<name>/`
is the canonical real copy; `<location>/.claude/skills/<name>` is a relative symlink to it.** There
is one real copy *per location* — the same skill in two locations is two real directories, each
with its own symlink. The repo root is a location too (`.agents/skills/<name>`, `.claude/skills/<name>`);
it holds skills that serve the whole repo rather than one app, currently only the review skill.
A real directory where a symlink is expected, a broken or absolute symlink,
or a missing `.claude` link fails `bun run skills:check` with a message naming the path, e.g.

```
apps/api/.claude/skills/hono: real directory where a relative symlink to apps/api/.agents/skills/hono was expected
```

`.opencode/skills/` is not created by the CLI (OpenCode reads `.agents/skills/` directly); if one
ever appears it must also be a relative symlink to the `.agents` copy. Windows without symlink
support (`core.symlinks=false`) is unsupported; use WSL.

### Audit, 2026-09-04 (TEACH-28)

Commands: `find . -path '*/skills/*' -maxdepth 5 \( -type l -o -type d \) -not -path
'*/node_modules/*' -exec ls -ld {} +` and `git ls-files -s | grep ^120000`. CLI: `skills`
v1.5.23 (`npx -y skills --version`), installed with `--agent universal claude-code -y`, no
`--dir` flag exists (installs into `cwd`). `git config core.symlinks` is unset (git default;
symlinks honoured on macOS/Linux). No `.opencode/` directory anywhere.

| Path | Kind | Link target (relative) |
| ---- | ---- | ---------------------- |
| `apps/api/.agents/skills/hono` | real dir | — |
| `apps/api/.agents/skills/use-railway` | real dir | — |
| `apps/api/.claude/skills/hono` | symlink (git `120000`) | `../../.agents/skills/hono` |
| `apps/api/.claude/skills/use-railway` | symlink (git `120000`) | `../../.agents/skills/use-railway` |
| `apps/web/.agents/skills/deploy-to-vercel` | real dir | — |
| `apps/web/.agents/skills/shadcn` | real dir | — |
| `apps/web/.agents/skills/tanstack-query` | real dir | — |
| `apps/web/.agents/skills/tanstack-router` | real dir | — |
| `apps/web/.agents/skills/vercel-react-best-practices`, `packages/editor/.agents/skills/vercel-react-best-practices` | real dir | — |
| `apps/web/.claude/skills/deploy-to-vercel` | symlink (git `120000`) | `../../.agents/skills/deploy-to-vercel` |
| `apps/web/.claude/skills/shadcn` | symlink (git `120000`) | `../../.agents/skills/shadcn` |
| `apps/web/.claude/skills/tanstack-query` | symlink (git `120000`) | `../../.agents/skills/tanstack-query` |
| `apps/web/.claude/skills/tanstack-router` | symlink (git `120000`) | `../../.agents/skills/tanstack-router` |
| `apps/web/.claude/skills/vercel-react-best-practices` | symlink (git `120000`) | `../../.agents/skills/vercel-react-best-practices` |
| `apps/worker/.agents/skills/use-railway` | real dir | — |
| `apps/worker/.claude/skills/use-railway` | symlink (git `120000`) | `../../.agents/skills/use-railway` |
| `packages/ui/.agents/skills/shadcn` | real dir | — |
| `packages/ui/.claude/skills/shadcn` | symlink (git `120000`) | `../../.agents/skills/shadcn` |

Duplicates across locations: `diff -rq packages/ui/.agents/skills/shadcn apps/web/.agents/skills/shadcn`
and `diff -rq apps/api/.agents/skills/use-railway apps/worker/.agents/skills/use-railway` both
report no differences. These are separate real installs in different locations — expected
per-location vendoring, not symlink drift. Result: 9 real dirs, 9 relative symlinks, 0 violations;
nothing needed fixing. Size: `.agents` totals 1.9 MB (`apps/web` 624K, `apps/api` 588K,
`apps/worker` 572K, `packages/ui` 128K); symlinks + `skills-lock.json` files add ~16 KB, so the
vendored total is ≈1.9 MB and the two duplicated skills account for ~700 KB of it.

Prevention outside the check: `**/.agents`, `**/.claude`, `**/.opencode`, `**/skills-lock.json`
are excluded in `biome.json`, Turborepo task `inputs` (`turbo.json`), the root `.dockerignore`
(TEACH-28; TEACH-24 extends it), and marked `linguist-vendored` in `.gitattributes`.

### Substitutions recorded at install time

- **`hono`**: the ticket named `https://github.com/yusukebe/hono-skill`. That repository is archived
  and its README says "Moved to honojs/skills"; the `skills` CLI reports "No valid skills found" for
  it. Installed from **`https://github.com/honojs/skills --skill hono`** instead (the official
  successor, same skill name).
- No other substitutions; every other skill existed under the requested name in the requested repo.
  No fallback copies from the founder's global `~/.agents/skills` were needed.

## Re-install / update

The `skills` CLI installs **relative to the current working directory**, not the git root: run each
command from the target app/package directory. It writes the canonical copy to
`<cwd>/.agents/skills/<name>/`, a relative symlink at `<cwd>/.claude/skills/<name>`, and
`<cwd>/skills-lock.json`. We pin the agent targets to `--agent universal claude-code` so the layout
does not depend on which agents happen to be installed on the machine (`universal` = every agent
that reads `.agents/skills/`, including OpenCode, Codex, Cursor, Gemini CLI; `claude-code` adds
the `.claude/skills/` symlink). `-y` skips prompts. There is no `--dir`/`--path` flag.

```sh
# Node/npx via nvm (this is the one place npx is used in the repo)
source ~/.nvm/nvm.sh
S="npx -y skills add"
A="--agent universal claude-code -y"

( cd apps/web \
  && $S https://github.com/tanstack-skills/tanstack-skills --skill tanstack-router $A \
  && $S https://github.com/tanstack-skills/tanstack-skills --skill tanstack-query  $A \
  && $S https://github.com/shadcn-ui/ui                      --skill shadcn          $A \
  && $S https://github.com/vercel-labs/agent-skills          --skill vercel-react-best-practices $A \
  && $S https://github.com/vercel-labs/agent-skills          --skill deploy-to-vercel $A )

( cd apps/api \
  && $S https://github.com/honojs/skills                     --skill hono            $A \
  && $S https://github.com/railwayapp/railway-skills         --skill use-railway     $A \
  && $S https://github.com/vercel/ai                         --skill ai-sdk          $A )

( cd apps/worker \
  && $S https://github.com/railwayapp/railway-skills         --skill use-railway     $A \
  && $S https://github.com/vercel/ai                         --skill ai-sdk          $A )

( cd packages/ai \
  && $S https://github.com/vercel/ai                         --skill ai-sdk          $A )

( cd packages/ui \
  && $S https://github.com/shadcn-ui/ui                      --skill shadcn          $A )

# repo root (review agent only)
$S https://github.com/cursor/plugins --skill thermo-nuclear-code-quality-review $A

bun run skills:check
```

To update everything already listed in a location's `skills-lock.json`: `cd <location> && npx -y
skills update -y`. To see what a repo offers before installing: `npx -y skills add <repo> --list`.
After any update, refresh the `Commit` column above (`gh api repos/<o>/<r>/commits/HEAD -q .sha`)
and commit the CLI's changes as-is (`chore(skills): …`).

`ai-sdk` is installed in `packages/ai`, `apps/worker`, and `apps/api`; update all three together,
like the other multi-location skills, so their vendored copies do not drift.

Observed CLI behaviour (v1.5.23), for the record:

- Installs into `cwd`, so sub-directory installs work without a `package.json` in that directory.
  `apps/web`, `apps/api`, `apps/worker` and `packages/ui` had no `package.json` when the skills
  were installed; Bun/Turbo ignore directories without one, so `bun install --frozen-lockfile`
  and `bun run lint` are unaffected.
- With plain `-y` (no `--agent`) the CLI writes `.agents/skills/` plus symlinks for every agent it
  detects on the machine — machine-dependent, hence the explicit `--agent` list above.
- `--agent opencode` alone is treated as "universal" and writes only `.agents/skills/` (no
  `.opencode/` directory is created). OpenCode reads `.agents/skills/` directly.
- `skills-lock.json` is per-cwd and records `source`, `skillPath` and `computedHash` (not a commit).
