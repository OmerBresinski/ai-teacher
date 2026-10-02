#!/bin/zsh
# Visual render stack: api + web from a pv-visual worktree (detached at spike/plan-write) on its own
# Postgres (compose project tj-wt-pv-visual, port 5641). Ports: api 3641, web 4641. Never Greg's 5433/5174/3001.
# Photos: STORAGE_ROOT is lab/visual/stack/storage; fit-drive.ts --images (via gen-images-stream.sh) stores placed Pexels photos there, so the
# presenter serves them through /files/<key> exactly as production does.
S=${SCRATCH:?set SCRATCH to the folder holding the pv-visual worktree}
R="${0:a:h}/../stack"
T=$S/pv-visual API=3641 WEB=4641 DB=postgres://postgres:postgres@localhost:5641/teaching_journey
ST=$R/storage; mkdir -p $ST
(cd $T && docker compose up -d >/dev/null 2>&1)
cd $T/apps/api && (env NODE_ENV=test ENABLE_TEST_ROUTES=1 PORT=$API DATABASE_URL=$DB TEST_DATABASE_URL=$DB WEB_ORIGIN=http://localhost:$WEB BETTER_AUTH_URL=http://localhost:$API BETTER_AUTH_SECRET=$(openssl rand -hex 32) MAIL_PROVIDER=console STORAGE_ROOT=$ST LOG_LEVEL=warn sh -c "bun ../../packages/db/src/migrate.ts && bun src/index.ts" > $R/api.log 2>&1 &)
cd $T/apps/web && (env VITE_API_URL=http://localhost:$API bunx vite --port $WEB --strictPort > $R/web.log 2>&1 &)
echo "api http://localhost:$API  web http://localhost:$WEB  (logs in $R)"
