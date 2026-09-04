#!/bin/sh
# Teaching Journey image entrypoint (TEACH-24). One image, three commands:
#
#   api      -> bun apps/api/dist/index.js          (Railway `api` service start command)
#   worker   -> bun apps/worker/dist/index.js       (Railway `worker` service start command)
#   migrate  -> bun packages/db/dist/migrate.js     (Railway `api` pre-deploy command; ADR 0006:
#                                                    migrations never run on app boot)
#
# `exec` replaces this shell with Bun so SIGTERM from Docker/Railway reaches the process and the
# apps' own drain logic runs (api: stop accepting + drain in-flight; worker: 25 s job drain).
set -eu

cmd="${1:-api}"
[ "$#" -gt 0 ] && shift

# The bundles are production-only: with NODE_ENV=development pino loads `pino-pretty` in a worker
# thread, which `bun build` cannot bundle, and the process crashes on boot. The image ships no
# node_modules, so NODE_ENV is forced here regardless of what the caller passed (`-e NODE_ENV=…`
# or a Railway variable). Pretty logs are a `bun run dev` feature, never an image feature.
export NODE_ENV=production

case "$cmd" in
  api)     exec bun apps/api/dist/index.js "$@" ;;
  worker)  exec bun apps/worker/dist/index.js "$@" ;;
  migrate) exec bun packages/db/dist/migrate.js "$@" ;;
  *)
    echo "usage: <image> {api|worker|migrate}" >&2
    echo "unknown command: $cmd" >&2
    exit 2
    ;;
esac
