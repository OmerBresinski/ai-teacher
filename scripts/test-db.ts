#!/usr/bin/env bun
// bun run test:db -- run the @tj/db integration tests against the compose test database:
//   ensure Postgres is up  ->  bun run db:migrate (both databases)  ->  bun test in packages/db
// with TEST_DATABASE_URL set so the tests do not skip. Extra args pass through to `bun test`:
//   bun run test:db -- --watch

import { $ } from "bun";
import { startPostgres } from "./lib/docker";
import { databaseUrl, testDatabaseUrl } from "./lib/env";
import { runMain, UserFacingError } from "./lib/exit";
import { log } from "./lib/log";
import { rel } from "./lib/paths";
import { DB_WORKSPACE_DIR, findDbMigrate, runMigrateIfPresent } from "./lib/workspaces";

await runMain(async () => {
  if ((await findDbMigrate()) === null) {
    throw new UserFacingError(
      `${rel(DB_WORKSPACE_DIR)} does not declare a db:migrate script; nothing to test.`,
    );
  }

  log.step("Postgres (docker compose)");
  await startPostgres();

  log.step("Database migrations");
  await runMigrateIfPresent();

  const testUrl = await testDatabaseUrl();
  if (testUrl === (await databaseUrl())) {
    throw new UserFacingError(
      "TEST_DATABASE_URL equals DATABASE_URL. The tests truncate tables; point TEST_DATABASE_URL at a separate database.",
    );
  }

  log.step(`bun test (${rel(DB_WORKSPACE_DIR)}, TEST_DATABASE_URL=${testUrl})`);
  const extra = process.argv.slice(2);
  const result = await $`bun test ${extra}`
    .cwd(DB_WORKSPACE_DIR)
    .env({ ...process.env, TEST_DATABASE_URL: testUrl })
    .nothrow();
  if (result.exitCode !== 0) {
    throw new UserFacingError(`@tj/db tests failed (exit ${result.exitCode}).`, result.exitCode);
  }
  log.ok("@tj/db tests passed");
});
