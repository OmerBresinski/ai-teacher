/**
 * Process entry point: validate env, connect to Postgres, start `Bun.serve`, shut down cleanly
 * on SIGTERM/SIGINT (stop accepting, drain in-flight requests, close the pool, exit 0).
 */
import { createDb } from "@tj/db";
import { createApp } from "./app";
import { createAuth } from "./auth/auth";
import { logUsersWithoutWorkspace } from "./auth/workspace-hook";
import { loadEnv } from "./env";
import { createLogger } from "./logger";
import { loadMailSender } from "./mail";

const env = loadEnv();
const logger = createLogger(env);
const db = createDb(env.DATABASE_URL);
const auth = createAuth({ env, db, mail: loadMailSender(env, logger), logger });
const app = createApp({ env, db, logger, auth });
void logUsersWithoutWorkspace(db, logger).catch((err) =>
  logger.warn({ err }, "users-without-workspace self-check failed"),
);

const server = Bun.serve({
  port: env.PORT,
  hostname: "0.0.0.0",
  fetch: app.fetch,
});

logger.info(
  { port: server.port, node_env: env.NODE_ENV, web_origin: env.WEB_ORIGIN },
  `api listening on http://localhost:${server.port}`,
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  try {
    // `stop(false)` stops accepting new connections and resolves once in-flight requests finish.
    await server.stop(false);
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
