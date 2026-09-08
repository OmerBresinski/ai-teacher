/**
 * Process entry point: validate env, connect to Postgres, start `Bun.serve`, shut down cleanly
 * on SIGTERM/SIGINT (stop accepting, drain in-flight requests, close the pool, exit 0).
 */

import { createAi } from "@tj/ai";
import { createDb } from "@tj/db";
import { createPexelsClient } from "@tj/images";
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
// ADR 0026: the Railway Bucket (S3) when S3_BUCKET is set, else local disk at STORAGE_ROOT
// (default .data/storage). These variables are `runtimeOnly` in infra/env.contract.ts and read by
// @tj/storage directly; a set S3_BUCKET with a missing S3_* sibling throws here (boot fails).
const storage = createStorage({
  S3_BUCKET: process.env.S3_BUCKET,
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_REGION: process.env.S3_REGION,
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  STORAGE_ROOT: process.env.STORAGE_ROOT,
  STORAGE_PUBLIC_BASE_URL: process.env.STORAGE_PUBLIC_BASE_URL,
});
const ai = createAi(env, { logger });
// Images project: no key degrades to `503` on the route, never a boot failure.
const images = env.PEXELS_API_KEY ? createPexelsClient({ apiKey: env.PEXELS_API_KEY }) : undefined;
const app = createApp({
  env,
  db,
  logger,
  auth,
  jobs,
  events,
  testMail: testMail ?? undefined,
  storage: storage.adapter,
  ai,
  images,
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
    ai: ai.kind,
    images: images ? "pexels" : "disabled",
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
