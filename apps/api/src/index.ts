/**
 * Process entry point: validate env, connect to Postgres, start `Bun.serve`, shut down cleanly
 * on SIGTERM/SIGINT (stop accepting, drain in-flight requests, close the pool, exit 0).
 */
import { createDb } from "@tj/db";
import { createBoss, ensureQueues, type JobsContext } from "@tj/jobs";
import { createStorage } from "@tj/storage";
import { createApp } from "./app";
import { createAuth } from "./auth/auth";
import { logUsersWithoutWorkspace } from "./auth/workspace-hook";
import { loadEnv } from "./env";
import { createEventsRuntime } from "./events/runtime";
import { createLogger } from "./logger";
import { CaptureMailSender, loadMailSender } from "./mail";
import { testRoutesEnabled } from "./routes/test-routes";

const env = loadEnv();
const logger = createLogger(env);
const db = createDb(env.DATABASE_URL);
// TEACH-22: under NODE_ENV=test + ENABLE_TEST_ROUTES=1 the console sender is wrapped so the last
// magic link can be read back through GET /__test/last-magic-link (Playwright sign-in fixture).
const testMail = testRoutesEnabled(env) ? new CaptureMailSender(loadMailSender(env, logger)) : null;
const auth = createAuth({ env, db, mail: testMail ?? loadMailSender(env, logger), logger });
// ADR 0006: the api only enqueues/cancels; `role: "enqueue-only"` disables pg-boss maintenance
// (`supervise`) and cron (`schedule`) so only the worker runs them.
const boss = createBoss(env.DATABASE_URL, { applicationName: "tj-api", role: "enqueue-only" });
boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
await boss.start();
await ensureQueues(boss);
const jobs: JobsContext = { boss, db: db.unsafeDb, sql: db.sql };
const events = createEventsRuntime({ jobs, databaseUrl: env.DATABASE_URL, logger });
// ADR 0011: Vercel Blob when BLOB_READ_WRITE_TOKEN is set, else local disk at STORAGE_ROOT
// (default .data/storage). These variables are all optional and read by @tj/storage directly;
// adding them to the env contract (TEACH-26) is a follow-up.
const storage = createStorage({
  BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
  STORAGE_ROOT: process.env.STORAGE_ROOT,
  STORAGE_PUBLIC_BASE_URL: process.env.STORAGE_PUBLIC_BASE_URL,
  STORAGE_PUBLIC_PREFIXES: process.env.STORAGE_PUBLIC_PREFIXES,
});
const app = createApp({
  env,
  db,
  logger,
  auth,
  jobs,
  events,
  testMail: testMail ?? undefined,
  storage: storage.adapter,
});
void logUsersWithoutWorkspace(db, logger).catch((err) =>
  logger.warn({ err }, "users-without-workspace self-check failed"),
);

const server = Bun.serve({
  port: env.PORT,
  hostname: "0.0.0.0",
  fetch: app.fetch,
});

logger.info(
  {
    port: server.port,
    node_env: env.NODE_ENV,
    web_origin: env.WEB_ORIGIN,
    web_origin_patterns: env.WEB_ORIGIN_PATTERNS,
    cookie_samesite: env.COOKIE_SAMESITE,
    storage: storage.kind,
  },
  `api listening on http://localhost:${server.port}`,
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  try {
    // `stop(false)` stops accepting new connections and resolves once in-flight requests finish.
    // Open SSE streams count as in-flight, so end them first.
    await events.stop();
    await server.stop(false);
    await boss.stop({ graceful: true, close: true });
    await db.close();
    logger.info("shutdown complete");
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "shutdown failed");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
