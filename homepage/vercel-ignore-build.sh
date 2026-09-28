#!/usr/bin/env bash
# Vercel "Ignored Build Step" for the marketing project (dayback.app, TEACH-78). Vercel runs this
# from the project's Root Directory (homepage/). exit 0 skips the build, exit 1 builds; anything
# but a clean "no diff" builds, so an unknown previous SHA never silently skips a deploy.
set -u

# Production only, like the app project (apps/web/scripts/vercel-ignore-build.sh): previews would
# spend the build quota that production deploys need.
if [[ "${VERCEL_ENV:-}" != "production" ]]; then
  echo "site-ignore-build: VERCEL_ENV=${VERCEL_ENV:-unset} is not production -> skip"
  exit 0
fi

cd "$(dirname "$0")/.." || exit 1

# The static site reads nothing outside these paths: its own sources and the build-env resolver.
PATHS=(homepage scripts/vercel-env.ts scripts/lib)

if [[ -z "${VERCEL_GIT_PREVIOUS_SHA:-}" ]] || ! git cat-file -e "${VERCEL_GIT_PREVIOUS_SHA}^{commit}" 2>/dev/null; then
  echo "site-ignore-build: no usable VERCEL_GIT_PREVIOUS_SHA -> build"
  exit 1
fi

if git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- "${PATHS[@]}"; then
  echo "site-ignore-build: no site changes since ${VERCEL_GIT_PREVIOUS_SHA:0:7} -> skip"
  exit 0
fi
echo "site-ignore-build: site changes since ${VERCEL_GIT_PREVIOUS_SHA:0:7} -> build"
exit 1
