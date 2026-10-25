import { createDb } from "@tj/db";
import { JobName, safeError } from "@tj/domain";
import {
  type BossJob,
  createBoss,
  ensureQueues,
  type JobsContext,
  REAP_INTERVAL_MS,
  reapOrphanedLocks,
  runJob,
} from "@tj/jobs";
import { createWorkerDeps } from "./deps";
import { parseEnv } from "./env";
import { publicJobFailure } from "./job-errors";
import {
  ANONYMOUS_CLEANUP_CRON,
  ANONYMOUS_CLEANUP_QUEUE,
  GENERATION_DEBUG_CLEANUP_CRON,
  GENERATION_DEBUG_CLEANUP_QUEUE,
  registry,
  runAnonymousCleanup,
  runGenerationDebugCleanup,
} from "./jobs";
import { createLogger, type LogTap } from "./logger";
import { createWorkerObservability, lessonIdOf, reportJobFailure } from "./observability";
import { verifyStorage } from "./storage-check";

/** How long shutdown waits for active jobs before failing them (retryable) and exiting. */
const SHUTDOWN_GRACE_MS = 25_000;
/** pg-boss polling interval per worker; small because the ADR 0012 demo should feel immediate. */
const POLLING_INTERVAL_SECONDS = 0.5;

const env = parseEnv();
// ADR 0041: every job log line is also offered to PostHog as a `gen_*` event (metadata only).
let logTap: LogTap | undefined;
const logger = createLogger(env, undefined, (bindings, record, msg) =>
  logTap?.(bindings, record, msg),
);
// ADR 0041: PostHog (EU) error tracking and model-call metrics; a no-op without POSTHOG_API_KEY.
const observability = createWorkerObservability(env, logger);
if (observability.enabled) logTap = observability.captureLogLine;
if (observability.enabled) {
  // A crash still crashes (exit 1, as before); it is reported first, scrubbed, within the flush
  // timeout. Registered only with a key, so dev and tests keep the runtime's own behaviour.
  const crash = (source: string) => (error: unknown) => {
    logger.fatal({ err: safeError(error), source }, "worker crashed");
    observability.captureException(error, source);
    void observability.shutdown().finally(() => process.exit(1));
  };
  process.on("uncaughtException", crash("uncaughtException"));
  process.on("unhandledRejection", crash("unhandledRejection"));
}

const { unsafeDb, sql, close } = createDb(env.DATABASE_URL, { max: 4 });
// The debug record's own pool (Greg, 20 Oct): one connection, so a debug batch never holds a
// connection a lesson save is waiting for.
const debugPool = createDb(env.DATABASE_URL, { max: 1 });
const boss = createBoss(env.DATABASE_URL);
const ctx: JobsContext = { boss, db: unsafeDb, sql };
const shutdown = new AbortController();
/** Stops the storage re-check as soon as shutdown starts (`shutdown` aborts only after the grace). */
const stopRecheck = new AbortController();
const base = createWorkerDeps(env, logger, unsafeDb, debugPool.unsafeDb, observability);
// 25 Oct 2026: a store that cannot take a write closes the picture gate (never the boot); it is
// re-checked in the background with backoff and reopens on a pass. Shutdown stops the re-check.
const { gate: storageGate, storageCheck } = await verifyStorage(
  base.storage,
  base.storageKind,
  logger,
  { signal: stopRecheck.signal },
);
const deps = { ...base, storageGate, jobs: ctx };

boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
boss.on("warning", (w) => logger.warn({ err: safeError(w) }, "pg-boss warning"));

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
        const data = job.data as { jobId?: unknown; workspaceId?: unknown } | null;
        const endScope =
          typeof data?.jobId === "string"
            ? observability.beginJob(data.jobId, {
                job: name,
                workspaceId: typeof data.workspaceId === "string" ? data.workspaceId : undefined,
                lessonId: lessonIdOf(job.data),
                capUsd: name === "lesson.worksheet" ? deps.worksheetCapUsd : deps.caps.capUsd,
              })
            : undefined;
        if (typeof data?.jobId === "string") {
          // Queue wait: from the enqueue to this pick-up (and, on a retry, from the re-queue).
          observability.captureJobEvent(data.jobId, "gen_job", {
            status: "picked",
            attempt: job.retryCount,
            queueWaitMs: Date.now() - new Date(job.createdOn).getTime(),
          });
        }
        const run = runJob(ctx, name, registry, job, {
          shutdown: shutdown.signal,
          logger,
          deps,
          failureMessage: publicJobFailure,
          onFailure: (report) => reportJobFailure(observability, report),
        });
        active.set(job.id, run);
        try {
          results.push(await run);
        } finally {
          active.delete(job.id);
          endScope?.();
          // Sends this job's events now, in the background: never awaited, so a slow PostHog
          // never holds the job's slot (ADR 0041).
          void observability.flush();
        }
      }
      return results;
    },
  );
  logger.info({ queue: name, concurrency: env.WORKER_CONCURRENCY }, "worker registered");
}

// TEACH-222: the daily anonymous cleanup, a system job on pg-boss cron (not a `JobName`: no
// Workspace, no job events). `schedule` is idempotent; only the worker runs the cron (ADR 0006).
await boss.createQueue(ANONYMOUS_CLEANUP_QUEUE);
await boss.schedule(ANONYMOUS_CLEANUP_QUEUE, ANONYMOUS_CLEANUP_CRON, {}, { tz: "UTC" });
await boss.work(ANONYMOUS_CLEANUP_QUEUE, { batchSize: 1 }, async () => {
  await runAnonymousCleanup({
    sql,
    storage: deps.storage,
    ttlDays: env.ANONYMOUS_USER_TTL_DAYS,
    logger: logger.child({ job: ANONYMOUS_CLEANUP_QUEUE }),
    signal: shutdown.signal,
  });
});
logger.info(
  {
    queue: ANONYMOUS_CLEANUP_QUEUE,
    cron: ANONYMOUS_CLEANUP_CRON,
    ttlDays: env.ANONYMOUS_USER_TTL_DAYS,
  },
  "worker registered",
);

// Greg, 20 Oct 2026: the daily delete of `generation_debug` rows past their TTL, the same shape.
await boss.createQueue(GENERATION_DEBUG_CLEANUP_QUEUE);
await boss.schedule(
  GENERATION_DEBUG_CLEANUP_QUEUE,
  GENERATION_DEBUG_CLEANUP_CRON,
  {},
  { tz: "UTC" },
);
await boss.work(GENERATION_DEBUG_CLEANUP_QUEUE, { batchSize: 1 }, async () => {
  await runGenerationDebugCleanup({
    sql,
    ttlDays: env.GENERATION_DEBUG_TTL_DAYS,
    logger: logger.child({ job: GENERATION_DEBUG_CLEANUP_QUEUE }),
    signal: shutdown.signal,
  });
});
logger.info(
  {
    queue: GENERATION_DEBUG_CLEANUP_QUEUE,
    cron: GENERATION_DEBUG_CLEANUP_CRON,
    ttlDays: env.GENERATION_DEBUG_TTL_DAYS,
  },
  "worker registered",
);

// TEACH-202 part g: a job that died on its last attempt (crash, OOM) never ran its `finally`;
// once pg-boss settles it, this sweep writes its terminal event and releases its lock.
const reaper = setInterval(() => {
  reapOrphanedLocks(ctx, { logger: logger.child({ task: "reap-locks" }) }).catch((err) =>
    logger.error({ err: safeError(err) }, "lock reaper failed"),
  );
}, REAP_INTERVAL_MS);
reaper.unref();
shutdown.signal.addEventListener("abort", () => clearInterval(reaper), { once: true });

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
logger.info(
  {
    port: server.port,
    env: env.NODE_ENV,
    ai: deps.ai.kind,
    costCapUsd: deps.caps.capUsd,
    tokenCap: deps.caps.capTokens,
    worksheetCapUsd: deps.worksheetCapUsd,
    images: deps.images ? "pexels" : "disabled",
    storage: deps.storageKind,
    storageCheck,
    imageGeneration: deps.imageGeneration && storageGate.open ? "on" : "off",
  },
  "worker ready",
);

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  stopRecheck.abort();
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
  // Whatever is still queued for PostHog, bounded by its flush timeout (ADR 0041).
  await observability.shutdown();
  await close();
  await debugPool.close();
  logger.info("worker exited cleanly");
  process.exit(0);
}

process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));
