# 0017 — Agent skill layout: canonical `.agents/skills/` with relative symlinks

- Status: Accepted
- Date: 2026-09-04
- Related PRD decisions: none (engineering/tooling only). Related tickets: TEACH-27 (install),
  TEACH-28 (this decision), TEACH-24 (Docker build context).

## Context

Agent skills (TEACH-27) are vendored per app/package with the `skills` CLI (vercel-labs/skills,
v1.5.23) using `--agent universal claude-code -y`. For each install the CLI writes:

- `<location>/.agents/skills/<name>/` — the real files (`SKILL.md` + references), read directly
  by every "universal" agent (OpenCode, Codex, Cursor, Gemini CLI, …);
- `<location>/.claude/skills/<name>` — a **relative** symlink (`../../.agents/skills/<name>`)
  for Claude Code, which only reads `.claude/skills/`;
- `<location>/skills-lock.json` — the CLI's manifest.

`--agent opencode` is treated as "universal" and creates no `.opencode/` directory. The CLI has no
`--dir` flag; it installs relative to `cwd`, which is why installs are run from each location.

An audit (TEACH-28) of the repo found the layout to be consistent: 9 real directories, 9 relative
symlinks committed as git mode `120000`, no `.opencode/` directories, `core.symlinks` unset (git
default: symlinks honoured on macOS/Linux). The same skill legitimately exists as a real directory
in more than one location (`shadcn` in `packages/ui` and `apps/web`; `use-railway` in `apps/api`
and `apps/worker`); `diff -rq` shows those copies identical. That is **per-location vendoring**, not
drift: each app/package is self-contained so an agent scoped to one directory finds its skills
without walking up the tree.

The risk is not what exists today but what can creep in: an agent or editor "helpfully" replacing
a `.claude/skills/<name>` symlink with a copied directory (two copies that then diverge), a symlink
with an absolute target (breaks on any other checkout), a symlink left dangling after a rename, or
a new `.opencode/skills/` copy. Nothing in TEACH-27's `skills:check` detected any of these — it only
looked for `SKILL.md` at the `.agents` path.

## Decision

1. **`<location>/.agents/skills/<name>/` is the single canonical, real copy per location.** It is
   the only place skill content lives.
2. **`<location>/.claude/skills/<name>` must be a relative symlink to (1)**, exactly as the CLI
   writes it. If an `.opencode/skills/<name>` entry ever appears it must likewise be a relative
   symlink to (1); we do not create it ourselves.
3. **One real copy per location, never a real copy where a symlink is expected.** The same skill
   in two locations is two real directories (one per `.agents`), each with its own symlink.
4. `scripts/skills-check.ts` (`bun run skills:check`, also run by `bun run doctor`) enforces 1–3
   for every path in the `docs/agent-skills.md` skill table and fails with a plain message naming
   the offending path for: missing canonical dir, canonical dir that is itself a symlink, real
   directory/file where a symlink is expected, broken symlink, absolute symlink target, symlink
   resolving elsewhere, missing `.claude` link.
5. Skill directories, `skills-lock.json` and `AGENTS.md` stay excluded from Biome, Turborepo task
   inputs and `linguist` stats (TEACH-27), and are excluded from Docker build contexts via the root
   `.dockerignore` (TEACH-24 extends it).
6. Skill content is never hand-edited or copied. Updates go through `npx -y skills update -y` in
   the location, and the resulting diff is committed as-is.

## Consequences

- Easier: one obvious place to look and to `du`; agents that read `.agents/skills/` and Claude
  Code see identical content by construction; `skills:check` turns layout drift into a CI/doctor
  failure with an actionable path instead of a silent fork.
- Harder: **Windows without symlink support is unsupported** for this repo. A checkout with
  `core.symlinks=false` materialises the links as plain text files containing the target path,
  and `skills:check` will fail on every `.claude/skills/<name>` ("real file where a relative
  symlink … was expected"). Use WSL (ext4, symlinks honoured). We do not add a copy-based
  fallback because that would reintroduce exactly the duplication this ADR removes.
- Docker: symlinks inside a build context are copied as symlinks, but the whole set is excluded
  anyway; images never need skills.
- Revisit when: the `skills` CLI changes its layout (e.g. writes `.opencode/` or stops creating
  `.claude` symlinks), when Claude Code starts reading `.agents/skills/` natively (then drop the
  `.claude` requirement), or if a Windows-native contributor appears.
