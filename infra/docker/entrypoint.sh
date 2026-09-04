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
