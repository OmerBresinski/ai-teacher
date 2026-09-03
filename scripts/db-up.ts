#!/usr/bin/env bun
// bun run db:up -- start the compose Postgres (idempotent) and wait until it is healthy.

import { startPostgres } from "./lib/docker";
import { databaseUrl, pgPort } from "./lib/env";
import { runMain } from "./lib/exit";
import { log } from "./lib/log";

await runMain(async () => {
  log.step(`Starting Postgres (TJ_PG_PORT=${await pgPort()})`);
  await startPostgres();
  log.info(`DATABASE_URL ${await databaseUrl()}`);
});
