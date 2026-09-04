import { createDb } from "@tj/db";
import { JobName } from "@tj/domain";
import { type BossJob, createBoss, ensureQueues, type JobsContext, runJob } from "@tj/jobs";
import { parseEnv } from "./env";
import { registry } from "./jobs";
import { createLogger } from "./logger";

/** How long shutdown waits for active jobs before failing them (retryable) and exiting. */
const SHUTDOWN_GRACE_MS = 25_000;
/** pg-boss polling interval per worker; small because the ADR 0012 demo should feel immediate. */
const POLLING_INTERVAL_SECONDS = 0.5;

const env = parseEnv();
const logger = createLogger(env);

const { unsafeDb, sql, close } = createDb(env.DATABASE_URL, { max: 4 });
const boss = createBoss(env.DATABASE_URL);
const ctx: JobsContext = { boss, db: unsafeDb, sql };

boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
boss.on("warning", (w) => logger.warn({ warning: w }, "pg-boss warning"));

const shutdown = new AbortController();
const active = new Map<string, Promise<unknown>>();
let bossState: "starting" | "started" | "stopping" | "stopped" = "starting";

await boss.start();
await ensureQueues(boss);
bossState = "started";

for (const name of Object.values(JobName)) {
  await boss.work(
    name,
    {
      batchSize: 1,
      localConcurrency: env.WORKER_CONCURRENCY,
      includeMetadata: true,
      perJobResults: true,
      pollingIntervalSeconds: POLLING_INTERVAL_SECONDS,
    },
    async (jobs) => {
      const results = [];
      for (const job of jobs as BossJob[]) {
        const run = runJob(ctx, name, registry, job, { shutdown: shutdown.signal, logger });
        active.set(job.id, run);
        try {
          results.push(await run);
        } finally {
          active.delete(job.id);
        }
      }
      return results;
    },
  );
  logger.info({ queue: name, concurrency: env.WORKER_CONCURRENCY }, "worker registered");
}

const server = Bun.serve({
  port: env.PORT,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({
        ok: bossState === "started",
        activeJobs: active.size,
        boss: bossState,
      });
    }
    return new Response("not found", { status: 404 });
  },
});
logger.info({ port: server.port, env: env.NODE_ENV }, "worker ready");

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  bossState = "stopping";
  logger.info({ signal, activeJobs: active.size }, "shutting down");
  // After the grace period, abort every active handler (`signal.reason === "shutdown"`); runJob
  // then settles the attempt as retryable so pg-boss re-queues it.
  const deadline = setTimeout(() => {
    logger.warn({ activeJobs: active.size }, "grace period elapsed; aborting active jobs");
    shutdown.abort("shutdown");
  }, SHUTDOWN_GRACE_MS);
  try {
    // Stops fetching, waits for active handlers to settle (bounded by `timeout`), fails whatever
    // is still active, closes pg-boss's pool and emits `stopped` before resolving.
    await boss.stop({ graceful: true, close: true, timeout: SHUTDOWN_GRACE_MS + 5_000 });
    await Promise.allSettled([...active.values()]);
  } catch (err) {
    logger.error({ err }, "error while stopping pg-boss");
  } finally {
    clearTimeout(deadline);
  }
  bossState = "stopped";
  server.stop(true);
  await close();
  logger.info("worker exited cleanly");
  process.exit(0);
}

process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));
