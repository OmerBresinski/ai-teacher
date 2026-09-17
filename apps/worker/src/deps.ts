import { type CreatedAi, createAi } from "@tj/ai";
import type { Db } from "@tj/db";
import type { ReadableStorageAdapter, StorageAdapter } from "@tj/domain";
import { createPexelsClient, type PexelsClient } from "@tj/images";
import type { JobsContext } from "@tj/jobs";
import { createStorage, type StorageKind } from "@tj/storage";
import type { Logger } from "pino";
import type { Env } from "./env";
import { createPerJobFakeAi } from "./fake-ai";

/**
 * Boot-owned dependencies every handler receives as `ctx.deps`. `db` is the same pooled Drizzle
 * client the `JobsContext` holds (one pool per process); handlers reach tenant tables through
 * `forWorkspace(deps.db, workspaceId)` only (ADR 0007). `caps` are the per-lesson budget limits
 * (ADR 0025 §15) and `worksheetCapUsd` the per-worksheet one (ADR 0030 item 1); `storage` is the object store the Source loader reads `extracted.json` from
 * (ADR 0027 §6) — the loader itself is built per job because it is scoped to a Workspace
 * (`storageSourceLoader` in `sources.ts`). `AI_FAKE_SCRIPT` swaps Bedrock for the scripted fake
 * (test and development only; `env.ts` refuses it in production). `images` is the Pexels client +
 * the same object storage behind illustrate (Images project); absent without a key, and the step
 * skips placements instead of failing. `jobs` is the worker's own `JobsContext`, for the one job
 * that enqueues another (the plan job's auto-continue, ADR 0029 item 10); boot sets it, and
 * without it auto-continue leaves the lesson at `planned`.
 */
export type WorkerDeps = {
  ai: CreatedAi;
  db: Db;
  caps: { capUsd: number; capTokens: number };
  /** `AI_WORKSHEET_COST_CAP_USD` (ADR 0030 item 1): the worksheet job's own cap, beside the lesson's token cap. */
  worksheetCapUsd: number;
  /** `AI_PLAN_FRONTIER_FROM_YEAR` (TEACH-259): Plan on `frontier` from this year group; unset → `standard`. */
  planFrontierFromYear?: number;
  storage: ReadableStorageAdapter;
  images?: { client: PexelsClient; storage: StorageAdapter };
  jobs?: JobsContext;
};

export function createWorkerDeps(
  env: Env,
  logger: Logger,
  db: Db,
): WorkerDeps & { storageKind: StorageKind } {
  // ADR 0026: the Railway Bucket (S3) when S3_BUCKET is set, else local disk — the same call the
  // api makes. These variables are `runtimeOnly` and read from the process environment directly.
  const storage = createStorage({
    S3_BUCKET: process.env.S3_BUCKET,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_REGION: process.env.S3_REGION,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    STORAGE_ROOT: process.env.STORAGE_ROOT,
    STORAGE_PUBLIC_BASE_URL: process.env.STORAGE_PUBLIC_BASE_URL,
  });
  return {
    ai: env.AI_FAKE_SCRIPT === "pipeline" ? createPerJobFakeAi(env) : createAi(env, { logger }),
    db,
    caps: { capUsd: env.AI_LESSON_COST_CAP_USD, capTokens: env.AI_LESSON_TOKEN_CAP },
    worksheetCapUsd: env.AI_WORKSHEET_COST_CAP_USD,
    ...(env.AI_PLAN_FRONTIER_FROM_YEAR !== undefined
      ? { planFrontierFromYear: env.AI_PLAN_FRONTIER_FROM_YEAR }
      : {}),
    storage: storage.adapter,
    images: env.PEXELS_API_KEY
      ? {
          client: createPexelsClient({ apiKey: env.PEXELS_API_KEY }),
          storage: storage.adapter,
        }
      : undefined,
    storageKind: storage.kind,
  };
}
