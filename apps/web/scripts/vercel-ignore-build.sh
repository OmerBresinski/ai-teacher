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

# Preview deployments are off: only `master` (VERCEL_ENV=production) is ever built. The
# `git.deploymentEnabled` key in vercel.json cannot express this -- it takes literal branch names,
# no wildcard -- so PR pushes still reached the build queue and burned the Hobby-plan build quota
# that production deploys need (2026-09-05 .. 2026-09-13, 40+ previews). Vercel runs this script
# for every Git-triggered deployment with VERCEL_ENV set to `production` or `preview`; a manual
# `vercel deploy` from a laptop sets it too. Re-enable previews by deleting this block.
if [[ "${VERCEL_ENV:-}" != "production" ]]; then
  echo "vercel-ignore-build: VERCEL_ENV=${VERCEL_ENV:-unset} is not production -> skip (previews are disabled)"
  exit 0
fi

cd "$(dirname "$0")/../../.." || exit 1

# Paths whose changes can alter apps/web's output: apps/web itself, the packages it consumes from
# source (its transitive @tj/* closure -- editor pulls in slides, TEACH-276), the lockfile and the
# turbo/root manifests. scripts/deploy-watch.test.ts pins this list against the workspace
# manifests; keep infra/README.md in sync.
PATHS=(
  apps/web
  homepage
  packages/ui
  packages/editor
  packages/slides
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
