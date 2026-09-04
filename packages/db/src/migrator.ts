import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Absolute path of the committed `drizzle/` folder, independent of the process cwd. */
export const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle",
);

/**
 * Apply every pending migration in `drizzle/` to the database at `url`. Idempotent: Drizzle
 * records applied migrations in `drizzle.__drizzle_migrations` and skips them next time. Uses a
 * one-connection client that is closed afterwards.
 */
export async function migrateDatabase(url: string): Promise<void> {
  // Short connect timeout so an unreachable server fails fast (tests skip, scripts report).
  const sql = postgres(url, { max: 1, connect_timeout: 10, onnotice: () => undefined });
  try {
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
