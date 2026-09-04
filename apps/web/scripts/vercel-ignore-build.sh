#!/usr/bin/env bash
# Vercel "Ignored Build Step" for the web project (TEACH-25). Vercel runs this from the project's
# Root Directory (apps/web) with VERCEL_GIT_PREVIOUS_SHA set to the last successfully deployed
# commit of this branch.
#
#   exit 0 -> skip the build (nothing that reaches the web bundle changed)
#   exit 1 -> build
#
# Anything else than a clean "no diff" builds: a missing/unknown previous SHA (first deploy of a
# branch, force-push, shallow clone) must never silently skip a deploy.
set -u

cd "$(dirname "$0")/../../.." || exit 1

# Paths whose changes can alter apps/web's output (apps/web itself, the packages it consumes from
# source, the lockfile and the turbo/root manifests). Keep in sync with infra/README.md.
PATHS=(
  apps/web
  packages/ui
  packages/api-client
  packages/domain
  packages/config
  bun.lock
  turbo.json
  package.json
  bunfig.toml
)

# The api is a type-only dependency of packages/api-client (`AppType`), so its route signatures
# reach the web typecheck but not the bundle; it is intentionally not listed.

if [[ -z "${VERCEL_GIT_PREVIOUS_SHA:-}" ]]; then
  echo "vercel-ignore-build: no VERCEL_GIT_PREVIOUS_SHA (first deploy of this branch) -> build"
  exit 1
fi

if ! git cat-file -e "${VERCEL_GIT_PREVIOUS_SHA}^{commit}" 2>/dev/null; then
  echo "vercel-ignore-build: ${VERCEL_GIT_PREVIOUS_SHA} not in this clone -> build"
  exit 1
fi

if git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- "${PATHS[@]}"; then
  echo "vercel-ignore-build: no web-relevant changes since ${VERCEL_GIT_PREVIOUS_SHA:0:7} -> skip"
  exit 0
fi

echo "vercel-ignore-build: web-relevant changes since ${VERCEL_GIT_PREVIOUS_SHA:0:7} -> build"
git diff --stat "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- "${PATHS[@]}" | tail -n 5
exit 1
