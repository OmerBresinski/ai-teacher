#!/usr/bin/env bun
// bun run db:down -- stop the compose Postgres. Data is kept (use db:reset to wipe it).

import { composeDown, ensureDocker } from "./lib/docker";
import { runMain } from "./lib/exit";
import { log } from "./lib/log";

await runMain(async () => {
  log.step("Stopping Postgres (data kept)");
  await ensureDocker();
  await composeDown();
  log.ok("stopped -- `bun run db:up` starts it again");
});
