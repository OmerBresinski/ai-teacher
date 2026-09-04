/**
 * Workspace-specific `bun test` preload for `@tj/web` (runs after the shared `@tj/config` ones).
 *
 * Under Bun `import.meta.env` is `process.env` (Vite inlines `VITE_*` only at build time), so
 * `src/env.ts` sees whatever the shell or `apps/web/.env` provides. Pin the values the unit tests
 * assume — the dev proxy path and `development` — regardless of the developer's `.env`, and make
 * sure no `PROD` flag leaks in from a production shell.
 */
process.env.VITE_API_URL = "/api";
process.env.VITE_APP_ENV = "development";
delete process.env.PROD;
