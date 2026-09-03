#!/usr/bin/env bash
# Verifies the monorepo bootstrap (TEACH-11) end to end. Exit non-zero on any failure.
#
#   bun run verify-bootstrap
#
# Steps: frozen install -> lint -> typecheck -> build -> commitlint negative/positive tests.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok() { printf '\033[1;32m    ok  %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m    FAIL  %s\033[0m\n' "$*" >&2; exit 1; }

step "bun install --frozen-lockfile"
bun install --frozen-lockfile
git diff --quiet -- bun.lock || fail "bun.lock changed during --frozen-lockfile install"
ok "lockfile unchanged"

step "bun run lint"
bun run lint
ok "lint"

step "bun run typecheck"
bun run typecheck
ok "typecheck"

step "bun run build"
bun run build
ok "build"

step "commitlint: non-conventional message must be rejected"
if echo "update stuff" | bunx --bun commitlint >/dev/null 2>&1; then
  fail "commitlint accepted 'update stuff'"
fi
ok "'update stuff' rejected"

step "commitlint: conventional message must be accepted"
if ! echo "chore: bootstrap monorepo" | bunx --bun commitlint >/dev/null 2>&1; then
  fail "commitlint rejected 'chore: bootstrap monorepo'"
fi
ok "'chore: bootstrap monorepo' accepted"

step "lefthook config"
bunx --bun lefthook validate >/dev/null
ok "lefthook.yml valid"

printf '\n\033[1;32mBootstrap verified.\033[0m\n'
