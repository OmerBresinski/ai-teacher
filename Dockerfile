# syntax=docker/dockerfile:1.7
# Teaching Journey -- one image for `api`, `worker` and `migrate` (ADR 0001, 0006, 0010; TEACH-24).
#
# Railway builds this file for the `api` and `worker` services with different start commands
# (see infra/railway/*.json); the same image runs migrations as the api's pre-deploy command.
# Locally: `bun run docker:build` then `docker:migrate` / `docker:run:api` / `docker:run:worker`.
#
# Stages
#   pruner   turbo prune --docker  -> minimal workspace (manifests in json/, sources in full/)
#   deps     bun install --frozen-lockfile against the pruned lockfile (cached by manifests only)
#   build    bun build (via turbo) -> self-contained single-file bundles (no node_modules needed)
#   runtime  oven/bun slim, non-root, bundles + drizzle SQL + entrypoint. No sources, no deps.
#
# Pin matches `.bun-version` / root package.json `packageManager` -- bump them together.
ARG BUN_VERSION=1.3.6

# ---------------------------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-alpine AS base
WORKDIR /app
ENV CI=true \
    TURBO_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1

# ---------------------------------------------------------------------------------------------
FROM base AS pruner
COPY . .
# Turbo 2.10 understands bun.lock: `json/` holds every package.json + pruned lockfile, `full/`
# the sources of @tj/api, @tj/worker and their transitive workspace deps (db, jobs, domain, config).
RUN bunx turbo@2.10.12 prune @tj/api @tj/worker --docker --out-dir /pruned

# ---------------------------------------------------------------------------------------------
FROM base AS deps
COPY --from=pruner /pruned/json/ ./
# `--ignore-scripts`: the root `prepare` (lefthook install) needs a git checkout.
RUN --mount=type=cache,id=bun-install-cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --ignore-scripts

# ---------------------------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/ ./
COPY --from=pruner /pruned/full/ ./
# `bun build --target=bun` bundles every dependency into one file per entry point
# (apps/*/package.json "build"); the only unbundled imports are Bun/Node built-ins.
RUN bunx turbo run build --filter=@tj/api --filter=@tj/worker \
 && bun build packages/db/src/migrate.ts --target=bun --outdir packages/db/dist
# Prove the bundles are self-contained: with node_modules gone, re-bundling fails on any bare
# import that was left unresolved ("Could not resolve"). Cheap, and it keeps the runtime stage
# free of node_modules on purpose (bundle size is the only thing that ships).
RUN rm -rf node_modules apps/*/node_modules packages/*/node_modules \
 && bun build apps/api/dist/index.js apps/worker/dist/index.js packages/db/dist/migrate.js \
      --target=bun --outdir /tmp/selfcontained-check >/dev/null \
 && rm -rf /tmp/selfcontained-check

# ---------------------------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    DO_NOT_TRACK=1

COPY --chown=bun:bun infra/docker/entrypoint.sh /app/entrypoint.sh
COPY --from=build --chown=bun:bun /app/apps/api/dist       /app/apps/api/dist
COPY --from=build --chown=bun:bun /app/apps/worker/dist    /app/apps/worker/dist
COPY --from=build --chown=bun:bun /app/packages/db/dist    /app/packages/db/dist
# migrate.js resolves `../drizzle` relative to itself (packages/db/src/migrator.ts).
COPY --from=build --chown=bun:bun /app/packages/db/drizzle /app/packages/db/drizzle
RUN chmod 0755 /app/entrypoint.sh

USER bun
# api: 3001 (PORT default), worker health: 3002 (PORT default). Railway sets PORT per service.
EXPOSE 3001 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch(`http://127.0.0.1:${process.env.PORT ?? 3001}/health`).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["api"]
