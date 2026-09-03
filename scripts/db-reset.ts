#!/usr/bin/env bun
// bun run db:reset -- wipe the Postgres volume and start fresh:
//   docker compose down -v  ->  up --wait  ->  db:migrate (when @tj/db exists)
// The init scripts in infra/postgres/init only run on an empty volume, so this is what recreates
// `teaching_journey_test` and re-enables pgvector after a schema change or a broken volume.

import { composeDown, ensureDocker, startPostgres } from "./lib/docker";
import { DEV_DB, databaseUrl, TEST_DB } from "./lib/env";
import { runMain } from "./lib/exit";
import { log } from "./lib/log";
import { listDatabases } from "./lib/pg";
import { runMigrateIfPresent } from "./lib/workspaces";

await runMain(async () => {
  log.step("Removing the Postgres container and volume");
  await ensureDocker();
  await composeDown({ volumes: true });
  log.ok("volume tj_pgdata removed");

  log.step("Starting a fresh Postgres");
  await startPostgres();
  const databases = await listDatabases(await databaseUrl());
  for (const db of [DEV_DB, TEST_DB]) {
    if (databases.includes(db)) log.ok(`database ${db} present`);
    else log.warn(`database ${db} missing -- check \`bun run db:logs\` for init script errors`);
  }

  log.step("Database migrations");
  await runMigrateIfPresent();
});
