#!/usr/bin/env bun
// bun run setup [--ci]
//
// One-command bootstrap of the local development environment (TEACH-18). Idempotent: safe to
// re-run at any time. `--ci` skips installing git hooks.
//
//   1. prerequisites: Bun >= package.json#packageManager, Docker daemon, gh (optional)
//   2. copy every **/.env.example -> .env that is missing (never overwrites)
//   3. docker compose up -d --wait postgres
//   4. bun run db:migrate in packages/db when @tj/db exists (TEACH-14), else a skip notice
//   5. bunx lefthook install (unless --ci)
//   6. next steps

import { copyFile } from "node:fs/promises";
import { $ } from "bun";
import { dockerStatus, startPostgres } from "./lib/docker";
import { databaseUrl, envPathFor, findEnvExamples, pgPort, testDatabaseUrl } from "./lib/env";
import { ExitCode, runMain, UserFacingError } from "./lib/exit";
import { missingLefthookHooks } from "./lib/git";
import { colour, log } from "./lib/log";
import { ROOT, rel } from "./lib/paths";
import { parseBunVersion, satisfiesMinimum } from "./lib/versions";
import { readPackageJson, runMigrateIfPresent } from "./lib/workspaces";

const args = new Set(process.argv.slice(2));
const ci = args.has("--ci");
const unknown = [...args].filter((a) => a !== "--ci");
if (unknown.length > 0) {
  console.error(`Unknown option(s): ${unknown.join(" ")}\nUsage: bun run setup [--ci]`);
  process.exit(ExitCode.Usage);
}

async function checkBun(): Promise<void> {
  const pkg = await readPackageJson(ROOT);
  const required = parseBunVersion(pkg?.packageManager);
  if (required === null) {
    log.warn("package.json#packageManager is not `bun@X.Y.Z`; skipping the Bun version check");
    return;
  }
  if (!satisfiesMinimum(Bun.version, required)) {
    throw new UserFacingError(
      `Bun ${Bun.version} is older than the pinned ${required}. Upgrade with \`bun upgrade\` (or \`curl -fsSL https://bun.sh/install | bash -s "bun-v${required}"\`) and re-run.`,
    );
  }
  log.ok(`Bun ${Bun.version} (pinned ${required})`);
}

async function checkDocker(): Promise<void> {
  const status = await dockerStatus();
  if (!status.ok) throw new UserFacingError(status.message);
  log.ok(`Docker daemon ${status.serverVersion}`);
}

async function checkGh(): Promise<void> {
  if (Bun.which("gh") === null) {
    log.info("gh (GitHub CLI) not found -- optional, only needed to open PRs from the terminal");
    return;
  }
  const result = await $`gh --version`.quiet().nothrow();
  const version = result.stdout.toString().split("\n")[0]?.trim() ?? "gh";
  log.ok(`${version} (optional)`);
}

async function scaffoldEnvFiles(): Promise<{ created: string[]; kept: string[] }> {
  const created: string[] = [];
  const kept: string[] = [];
  for (const example of await findEnvExamples(ROOT)) {
    const target = envPathFor(example);
    if (await Bun.file(target).exists()) {
      kept.push(target);
      log.info(`${rel(target)} exists -- left untouched`);
    } else {
      await copyFile(example, target);
      created.push(target);
      log.ok(`created ${rel(target)} from ${rel(example)}`);
    }
  }
  if (created.length === 0 && kept.length === 0) log.info("no .env.example files found");
  return { created, kept };
}

async function installHooks(): Promise<void> {
  if (ci) {
    log.info("--ci: skipping git hooks");
    return;
  }
  const result = await $`bunx --bun lefthook install`.cwd(ROOT).quiet().nothrow();
  if (result.exitCode !== 0) {
    log.warn(
      `lefthook install failed (exit ${result.exitCode}); run \`bunx lefthook install\` manually.`,
    );
    return;
  }
  const missing = await missingLefthookHooks();
  if (missing.length > 0) {
    log.warn(`hooks still missing after install: ${missing.join(", ")}`);
    return;
  }
  log.ok("git hooks installed (lefthook: pre-commit, commit-msg)");
}

await runMain(async () => {
  log.step("Checking prerequisites");
  await checkBun();
  await checkDocker();
  await checkGh();

  log.step("Environment files");
  await scaffoldEnvFiles();

  log.step("Postgres (docker compose)");
  const port = await pgPort();
  log.info(`TJ_PG_PORT=${port}`);
  await startPostgres();

  log.step("Database migrations");
  await runMigrateIfPresent();

  log.step("Git hooks");
  await installHooks();

  const dbUrl = await databaseUrl();
  const testUrl = await testDatabaseUrl();
  log.blank();
  console.log(colour.bold(colour.green("Setup complete.")));
  console.log(`
Next steps:
  [ ] bun run dev        start every app in watch mode (Postgres is already up)
  [ ] bun run doctor     check the environment whenever something looks off
  [ ] bun run db:reset   wipe and recreate the database after a schema change
  [ ] bun run db:logs    follow Postgres logs

  DATABASE_URL       ${dbUrl}
  TEST_DATABASE_URL  ${testUrl}
  Edit ${rel(`${ROOT}/.env`)} to change TJ_PG_PORT if 5432 is taken. See README "Local development".`);
  return ExitCode.Ok;
});
