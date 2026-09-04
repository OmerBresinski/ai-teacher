import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit configuration (`bun run db:generate`, `bun run db:studio`).
 *
 * `DATABASE_URL` is only needed by commands that talk to a database (`studio`, `push`,
 * `introspect`); `generate` diffs the schema against the snapshots in `./drizzle` and works
 * offline. Applying migrations is **not** a drizzle-kit job here: `bun run db:migrate`
 * (`src/migrate.ts`) does it with `drizzle-orm/postgres-js/migrator` against `DATABASE_URL` and
 * `TEST_DATABASE_URL`.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/*.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/teaching_journey",
  },
  strict: true,
  verbose: true,
});
