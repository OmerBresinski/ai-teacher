import { type CreatedAi, createAi } from "@tj/ai";
import type { Db } from "@tj/db";
import { newId, type ReadableStorageAdapter, type StorageAdapter } from "@tj/domain";
import { type Planner, planWriteRoute, type ReasoningEffort } from "@tj/generation";
import {
  createOpenAiEmbedder,
  createOpenAiImageGenerator,
  createPexelsClient,
  type PexelsClient,
} from "@tj/images";
import type { JobsContext } from "@tj/jobs";
import { createStorage, type StorageKind } from "@tj/storage";
import type { Logger } from "pino";
import type { Env } from "./env";
import { createPerJobFakeAi } from "./fake-ai";
import { createPictureBank } from "./picture-bank";

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
  /** `AI_REASONING_EFFORT` (TEACH-72): every call's effort; `low` when unset (25–26 Sept 2026). */
  reasoningEffort?: ReasoningEffort;
  /** `AI_LESSON_PLANNER` (TEACH-93): the planner a lesson with no checkpoint is planned with. */
  planner?: Planner;
  /** `AI_LESSON_COST_WARN_USD` (TEACH-93): the per-lesson cost a finished lesson is warned above. */
  costWarnUsd?: number;
  storage: ReadableStorageAdapter;
  images?: {
    client: PexelsClient;
    storage: StorageAdapter;
    /** TEACH-84 picture library: present with an OpenAI key (embeddings and generation). */
    bank?: ReturnType<typeof createPictureBank>;
  };
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
    ai:
      env.AI_FAKE_SCRIPT === "pipeline"
        ? createPerJobFakeAi(env)
        : createAi(env, {
            logger,
            // Plan-write routes its planner and writer calls by prompt version; no other call moves.
            ...(env.AI_LESSON_PLANNER === "plan-write"
              ? { route: planWriteRoute(env.PLAN_WRITE_PLANNER_MODEL) }
              : {}),
          }),
    db,
    caps: { capUsd: env.AI_LESSON_COST_CAP_USD, capTokens: env.AI_LESSON_TOKEN_CAP },
    worksheetCapUsd: env.AI_WORKSHEET_COST_CAP_USD,
    ...(env.AI_PLAN_FRONTIER_FROM_YEAR !== undefined
      ? { planFrontierFromYear: env.AI_PLAN_FRONTIER_FROM_YEAR }
      : {}),
    ...(env.AI_REASONING_EFFORT !== undefined ? { reasoningEffort: env.AI_REASONING_EFFORT } : {}),
    planner: env.AI_LESSON_PLANNER,
    costWarnUsd: env.AI_LESSON_COST_WARN_USD,
    storage: storage.adapter,
    images: env.PEXELS_API_KEY
      ? {
          client: createPexelsClient({ apiKey: env.PEXELS_API_KEY }),
          storage: storage.adapter,
          ...(env.OPENAI_API_KEY
            ? {
                bank: createPictureBank({
                  db,
                  storage: storage.adapter,
                  embedder: createOpenAiEmbedder({ apiKey: env.OPENAI_API_KEY }),
                  generator: createOpenAiImageGenerator({ apiKey: env.OPENAI_API_KEY }),
                  // A process-life cap until IMAGE_BANK_DAILY_CAP_USD lands (TEACH-84 FR 4).
                  capUsd: 1,
                  ids: newId,
                }),
              }
            : {}),
        }
      : undefined,
    storageKind: storage.kind,
  };
}
