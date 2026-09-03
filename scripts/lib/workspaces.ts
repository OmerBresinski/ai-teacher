import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { $ } from "bun";
import { databaseUrl, testDatabaseUrl } from "./env";
import { UserFacingError } from "./exit";
import { log } from "./log";
import { ROOT, rel } from "./paths";

export interface PackageJson {
  name?: string;
  packageManager?: string;
  workspaces?: string[] | { packages?: string[] };
  scripts?: Record<string, string>;
}

export async function readPackageJson(dir: string): Promise<PackageJson | null> {
  const file = Bun.file(path.join(dir, "package.json"));
  if (!(await file.exists())) return null;
  try {
    return (await file.json()) as PackageJson;
  } catch {
    return null;
  }
}

/**
 * Directories of every workspace declared in the root `package.json#workspaces`
 * (`apps/*`, `packages/*`, ...). Only the `<dir>/*` glob form is supported, which is all Bun uses.
 */
export async function workspaceDirs(): Promise<string[]> {
  const root = await readPackageJson(ROOT);
  const patterns = Array.isArray(root?.workspaces)
    ? root.workspaces
    : (root?.workspaces?.packages ?? []);
  const dirs: string[] = [];
  for (const pattern of patterns) {
    const base = pattern.replace(/\/\*+$/, "");
    if (base === pattern) {
      dirs.push(path.join(ROOT, pattern));
      continue;
    }
    let entries: Dirent[];
    try {
      entries = await readdir(path.join(ROOT, base), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const dir = path.join(ROOT, base, entry.name);
        if (await Bun.file(path.join(dir, "package.json")).exists()) dirs.push(dir);
      }
    }
  }
  return dirs.sort();
}

export const DB_WORKSPACE_DIR = path.join(ROOT, "packages", "db");
export const DB_MIGRATE_SCRIPT = "db:migrate";

/**
 * The `db:migrate` hook contract (TEACH-14): `setup` and `db:reset` run
 * `bun run db:migrate` inside `packages/db` when that workspace exists and declares the script,
 * with `DATABASE_URL` and `TEST_DATABASE_URL` set in the environment (derived from `TJ_PG_PORT`
 * unless overridden). Until then they print a skip notice.
 */
export async function findDbMigrate(): Promise<{ dir: string; name: string } | null> {
  const pkg = await readPackageJson(DB_WORKSPACE_DIR);
  if (!pkg?.scripts?.[DB_MIGRATE_SCRIPT]) return null;
  return { dir: DB_WORKSPACE_DIR, name: pkg.name ?? "packages/db" };
}

export async function runMigrateIfPresent(): Promise<"ran" | "skipped"> {
  const db = await findDbMigrate();
  if (!db) {
    log.info("db:migrate skipped -- @tj/db not present yet (TEACH-14)");
    return "skipped";
  }
  const env = {
    ...process.env,
    DATABASE_URL: await databaseUrl(),
    TEST_DATABASE_URL: await testDatabaseUrl(),
  };
  log.info(`bun run ${DB_MIGRATE_SCRIPT} (${db.name}, ${rel(db.dir)})`);
  const result = await $`bun run ${DB_MIGRATE_SCRIPT}`.cwd(db.dir).env(env).nothrow();
  if (result.exitCode !== 0) {
    throw new UserFacingError(
      `${DB_MIGRATE_SCRIPT} failed in ${rel(db.dir)} (exit ${result.exitCode}). Fix the migration or run \`bun run db:reset\` for a clean database.`,
      result.exitCode,
    );
  }
  log.ok("migrations applied");
  return "ran";
}
