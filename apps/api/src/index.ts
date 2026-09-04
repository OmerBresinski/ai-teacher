/**
 * Process entry point: validate env, connect to Postgres, start `Bun.serve`, shut down cleanly
 * on SIGTERM/SIGINT (stop accepting, drain in-flight requests, close the pool, exit 0).
 */
import { createDb } from "@tj/db";
import { createBoss, ensureQueues, type JobsContext } from "@tj/jobs";
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
const boss = createBoss(env.DATABASE_URL, { applicationName: "tj-api" });
boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
await boss.start();
await ensureQueues(boss);
const jobs: JobsContext = { boss, db: db.unsafeDb, sql: db.sql };
const events = createEventsRuntime({ jobs, databaseUrl: env.DATABASE_URL, logger });
const app = createApp({ env, db, logger, auth, jobs, events, testMail: testMail ?? undefined });
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
