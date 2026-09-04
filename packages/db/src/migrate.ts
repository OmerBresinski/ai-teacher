#!/usr/bin/env bun
// bun run db:migrate  (packages/db)
//
// Applies the committed migrations in `drizzle/` to DATABASE_URL and then, when set, to
// TEST_DATABASE_URL. Called by the root `bun run setup`, `bun run db:reset`, `bun run test:db`
// and by the deploy pipeline before the api/worker start (ADR 0006: never migrate on boot).

import { migrateDatabase } from "./migrator";

function redact(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return url;
  }
}

const targets: { name: string; url: string }[] = [];
const dev = process.env.DATABASE_URL;
const test = process.env.TEST_DATABASE_URL;
if (dev) targets.push({ name: "DATABASE_URL", url: dev });
if (test && test !== dev) targets.push({ name: "TEST_DATABASE_URL", url: test });

if (targets.length === 0) {
  console.error(
    "db:migrate: DATABASE_URL is not set. Export it (or run `bun run db:migrate` from the repository root, which sets it) and try again.",
  );
  process.exit(1);
}

for (const target of targets) {
  const started = performance.now();
  try {
    await migrateDatabase(target.url);
    const ms = Math.round(performance.now() - started);
    console.log(`db:migrate: ${target.name} up to date (${redact(target.url)}, ${ms} ms)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `db:migrate: migrating ${target.name} (${redact(target.url)}) failed: ${message}. Check that Postgres is running (\`bun run doctor\`) and that the migration SQL in packages/db/drizzle is valid.`,
    );
    process.exit(1);
  }
}
