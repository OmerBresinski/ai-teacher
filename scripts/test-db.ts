#!/usr/bin/env bun
// bun run test:db -- run EVERY workspace's `test` task against the compose test database:
//   ensure Postgres is up  ->  bun run db:migrate (both databases)  ->  turbo run test
// with TEST_DATABASE_URL set and REQUIRE_TEST_DB=1, so a DB suite that cannot reach the database
// FAILS (with the reason) instead of skipping — a green run is never an all-skipped run.
//
//   bun run test:db                       # everything
//   bun run test:db -- --filter=@tj/api   # extra args pass through to `turbo run test`
//
// In CI (`CI=true`) Postgres is a job service, not docker compose: the compose step is skipped and
// TEST_DATABASE_URL must already be reachable (the migration step fails loudly otherwise).

import { $ } from "bun";
import { startPostgres } from "./lib/docker";
import { databaseUrl, testDatabaseUrl } from "./lib/env";
import { runMain, UserFacingError } from "./lib/exit";
import { log } from "./lib/log";
import { ROOT, rel } from "./lib/paths";
import { DB_WORKSPACE_DIR, findDbMigrate, runMigrateIfPresent } from "./lib/workspaces";

await runMain(async () => {
  if ((await findDbMigrate()) === null) {
    throw new UserFacingError(
      `${rel(DB_WORKSPACE_DIR)} does not declare a db:migrate script; nothing to test.`,
    );
  }

  if (process.env.CI === "true") {
    log.step("Postgres: CI=true, using the job's Postgres service (docker compose skipped)");
  } else {
    log.step("Postgres (docker compose)");
    await startPostgres();
  }

  log.step("Database migrations");
  await runMigrateIfPresent();

  const testUrl = await testDatabaseUrl();
  if (testUrl === (await databaseUrl())) {
    throw new UserFacingError(
      "TEST_DATABASE_URL equals DATABASE_URL. The tests truncate tables; point TEST_DATABASE_URL at a separate database.",
    );
  }

  log.step(`turbo run test (TEST_DATABASE_URL=${testUrl}, REQUIRE_TEST_DB=1)`);
  const extra = process.argv.slice(2);
  const result = await $`turbo run test ${extra}`
    .cwd(ROOT)
    .env({ ...process.env, TEST_DATABASE_URL: testUrl, REQUIRE_TEST_DB: "1" })
    .nothrow();
  if (result.exitCode !== 0) {
    throw new UserFacingError(
      `Tests failed (exit ${result.exitCode}). A "REQUIRE_TEST_DB=1 but the test database is unavailable" failure means a DB suite could not connect; run \`bun run doctor\`.`,
      result.exitCode,
    );
  }
  log.ok("all test suites passed against the test database (no DB suite skipped)");
});
